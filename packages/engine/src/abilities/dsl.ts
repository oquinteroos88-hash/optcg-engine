import type { CardCategory } from '../registry.js';
import type { InstanceId, Orientation, PlayerId } from '../types.js';

/**
 * The card-effect DSL.
 *
 * Everything here is *definition* data: it lives in the card registry beside
 * the printed stat line and never enters GameState. What enters GameState is
 * only the position inside a script (see `StackItem` in types.ts), which is why
 * a suspended effect survives a JSON round trip.
 *
 * Two distinctions in this file are load-bearing and deliberately encoded as
 * different types rather than as fields of one thing:
 *
 * - `Condition` is a requirement that is *checked*. `Cost` is a price that is
 *   *paid* and can fail. `[DON!! x2]` is a Condition (`donAttached`); `DON!! -1`
 *   is a Cost (`returnDon`). They never share a field.
 * - An ability with `trigger: 'static'` is continuous: it is true while its
 *   source is on the field and it mutates nothing. It has no script and never
 *   reaches the interpreter; it is read by `getPower` and `hasKeyword`.
 */

export type Keyword = 'rush' | 'blocker' | 'doubleAttack' | 'banish';

/** Matches `Modifier['duration']`: the two lifetimes the engine can expire. */
export type Duration = 'endOfBattle' | 'endOfTurn';

/** Resolved against the ability's controller, not the state's active player. */
export type PlayerRef = 'you' | 'opponent';

/**
 * `CardDefinition.color` is a plain string in the registry, so a color here is
 * one too. Kept as a named alias because the DSL reads better with it and so a
 * future enum has one place to land.
 */
export type Color = string;

/**
 * When an ability wakes up.
 *
 * Most members name something the *source* did or had done to it. Three name
 * something that happened **elsewhere on the board**, and they exist because the
 * card text does: "when your opponent activates an Event", "when your
 * opponent's Character is K.O.'d". The side lives in the trigger name rather
 * than in a condition, following `whenOpponentAttacks` — the firing site decides
 * who is notified, so an ability that watches the wrong side is unspellable
 * rather than merely wrong.
 */
export type Trigger =
  | 'onPlay'
  | 'whenAttacking'
  | 'onBlock'
  | 'onKO'
  | 'whenOpponentAttacks'
  /**
   * The activator's own field, when they use an Event card from hand.
   *
   * CR 8-5-2 defines *card activation* as "using an Event card from your hand",
   * which is what "when you activate an Event" names — so both the `[Main]` and
   * the `[Counter]` route fire it, and an Event's `[Trigger]` fired out of the
   * Life area does not. The official Q&A says the last part outright: activating
   * an Event card's `[Trigger]` instead of adding it to hand does not activate
   * effects that read "when you activate an Event".
   */
  | 'whenActivatingEvent'
  /** The other player's field, on the same event. */
  | 'whenOpponentActivatesEvent'
  /**
   * The other player's field, when one of your Characters is K.O.'d.
   *
   * A K.O. only — CR 3-7-6-1-1 makes the 6th-Character trash "processing a
   * rule, and no effect can be applied", and the Q&A repeats it: "the trashed
   * Character is not K.O.'d, but directly moved to your trash".
   */
  | 'whenOpponentCharacterKOd'
  | 'activateMain'
  | 'trigger'
  | 'counterEvent'
  | 'mainEvent'
  | 'endOfTurn'
  | 'static';

/**
 * The printed properties of a card, without the zone and owner that say *where*
 * to look for it.
 *
 * Split out of `Selector` for one caller. A `discardHand` cost always looks in
 * its own controller's hand — "trash 1 {Land of Wano} type card from your hand"
 * names the filter and nothing else — so the cost should not be able to say
 * anything about zone or owner, right or wrong. Everything here reads off the
 * card definition and needs no board state.
 */
export interface CardFilter {
  category?: CardCategory[];
  colors?: Color[];
  types?: string[];
  costMax?: number;
  costMin?: number;
}

/**
 * A filter over cards in one zone. `owner` is relative to the ability's
 * controller.
 *
 * `deckTop` is the only zone where `count` means anything: it takes the first
 * `count` cards of the deck rather than filtering the whole deck.
 */
export interface Selector extends CardFilter {
  zone: 'field' | 'hand' | 'trash' | 'deckTop' | 'life';
  owner: 'you' | 'opponent' | 'any';
  powerMax?: number;
  powerMin?: number;
  orientation?: Orientation;
  excludeSelf?: boolean;
  count?: number;
}

/** How an instruction names the cards it acts on. */
export type Ref =
  | { self: true }
  | { var: string }
  | { battle: 'attacker' | 'target' }
  | { selector: Selector };

/**
 * A destination zone. Cards always move to the zones of their *owner*, which
 * is the physical rule, so no owner field is needed or wanted here.
 */
export interface ZoneRef {
  zone: 'hand' | 'deck' | 'trash' | 'life';
}

/**
 * Who a `static` ability applies to.
 *
 * Reuses the two `Ref` shapes that mean something for a continuous effect — the
 * card that carries it, or everything a selector matches — and deliberately
 * leaves out `{var}` and `{battle}`. A static has no script frame and no
 * variables, and it is read outside any battle, so those two could only ever
 * name something that does not exist; making them unspellable here is the point.
 *
 * `{self: true}` is the exact inverse of `Selector.excludeSelf`: "only the
 * source", where `excludeSelf` says "everyone the selector matches but the
 * source". Neither can be written in terms of the other, which is why both
 * exist.
 */
export type Audience = { self: true } | { selector: Selector };

/**
 * `restSelf` is "rest this card" as the price of its own ability, and it is the
 * one cost whose payability depends on the source's *orientation* rather than
 * on a pool of resources.
 *
 * A rested card cannot pay it. Resting is a state change, and a card already in
 * that state has none to make — the same reason CR 7-1-1-1 has an attack rest
 * "their active Leader card or 1 active Character card", never a rested one.
 * Official Q&A groups the two outright: an effect reading "cannot be rested"
 * stops "any actions that require them to be rested, such as attacking or
 * activating [Blocker]", and names "[Activate: Main] You may rest this
 * Character:" as one of them. An unpayable part of an activation cost makes the
 * whole cost unpayable (CR 8-3-1-3), so the ability is not activatable at all —
 * which `canPayCosts` reports and `legalActions` therefore honours for free.
 *
 * The consequence is the card's own limiter: the source only returns to active
 * in its controller's Refresh Phase (CR 6-2-4, which names the Stage area), so
 * the ability is once per turn without printing [Once Per Turn]. Cards that
 * print the keyword as well still say so; this is not a substitute for it.
 */
export type Cost =
  | { kind: 'restDon'; count: number }
  | { kind: 'returnDon'; count: number }
  | { kind: 'trashSelf' }
  | { kind: 'restSelf' }
  /**
   * "Trash N card(s) from your hand" as the price of an ability.
   *
   * The one cost the *player* pays a choice for. CR 8-3-1-5 spells the shape out
   * for the DON!! symbol — the player "must select" the cards that pay — and
   * CR 8-4-1-3 puts that selection inside the payment step ("determine the
   * activation costs and pay all activation costs"), not in 8-4-1-2, which only
   * specifies *which effect* is being activated. So the choice suspends the
   * payment, and the interpreter treats a cost list the way it treats a script:
   * a cursor, and an answer that advances it.
   *
   * `filter` is the printed restriction and nothing more. Absent, any card in
   * hand can pay; present, only matching cards are candidates — and
   * `canPayCosts` counts *matching* cards, so an ability whose filter no hand
   * card satisfies is never offered.
   */
  | { kind: 'discardHand'; count: number; filter?: CardFilter };

export type Condition =
  | { kind: 'donAttached'; min: number }
  | { kind: 'isYourTurn' }
  | { kind: 'lifeAtMost'; player: PlayerRef; value: number }
  | { kind: 'countCards'; selector: Selector; min?: number; max?: number }
  /**
   * Whether a `confirm` answered yes. Not in the Phase 2A brief's Condition
   * list, and added because without it `confirm` is unreachable: the op writes
   * a boolean into `vars` that no other part of the DSL can read, so a "you may
   * do X, otherwise Y" card could be written but never behave differently.
   * `optional: true` covers "you may activate at all"; this covers a branch
   * *inside* a script.
   */
  | { kind: 'varTrue'; name: string }
  | { kind: 'and'; of: Condition[] }
  | { kind: 'or'; of: Condition[] };

export type Instruction =
  // Suspend execution and wait for the controller.
  | { op: 'select'; as: string; from: Selector; min: number; max: number; prompt: string }
  | { op: 'confirm'; as: string; prompt: string }
  // Mutate the state.
  | { op: 'ko'; target: Ref }
  | { op: 'rest'; target: Ref }
  | { op: 'setActive'; target: Ref }
  | { op: 'addPower'; target: Ref; value: number; duration: Duration }
  | { op: 'grantKeyword'; target: Ref; keyword: Keyword; duration: Duration }
  | { op: 'moveCard'; target: Ref; to: ZoneRef; position?: 'top' | 'bottom' }
  | { op: 'draw'; player: PlayerRef; count: number }
  | { op: 'discard'; player: PlayerRef; count: number }
  | { op: 'giveDon'; target: Ref; count: number }
  /**
   * Turns up to `count` of a player's cost-area DON!! to `orientation`.
   *
   * The one instruction that names cards by *quantity* rather than by `Ref`,
   * because DON!! are fungible: "rest up to 1 of your opponent's DON!! cards"
   * does not care which one, and no printed card in the game asks to point at a
   * particular DON!! card. Making them selectable would mean giving DON!! a
   * `Selector` zone and putting them in front of the player as choices, which is
   * a large capability answering a question nothing has asked. If a card ever
   * does need to name one, that is the moment to add it.
   *
   * `player` is relative to the controller, like `draw` and `discard`: 'you' for
   * a card that refreshes its own DON!!, 'opponent' for one that rests theirs.
   *
   * Only the cost area. A given DON!! has no orientation to change (CR 4-4-2:
   * "given DON!! cards are neither active nor rested"), so attached DON!! are
   * not merely skipped, they are not candidates. Official Q&A for ST02-008 says
   * both halves outright: a DON!! given to a Character cannot be rested by it,
   * and neither can one that is rested already — "you must choose up to 1 active
   * DON!! card from your opponent's cost area."
   */
  | { op: 'orientDon'; player: PlayerRef; orientation: Orientation; count: number }
  | { op: 'reveal'; as: string; from: Selector }
  /**
   * Puts one card into its controller's Character area — "play up to 1 red
   * Character card with a cost of 2 or less from your hand", or the whole text
   * of "[Trigger] Play this card".
   *
   * **It plays, it does not move.** `moveCard` shuffles a card between zones and
   * `ZoneRef` has no `field` member on purpose: putting a card on the field is
   * a routine, not a destination. It stamps `playedOnTurn` so CR 3-7-4's
   * summoning sickness applies, places the card active unless `rested` says
   * otherwise (CR 3-7-5), resolves the 6th-Character sacrifice by *asking*
   * (CR 3-7-6-1), and fires the card's `[On Play]` (official Q&A). All of that
   * is `enterCharacterArea`, shared with the `PLAY_CARD` action.
   *
   * **No cost is paid.** CR 6-5-3-1's "you can pay the cost and play a
   * Character card" is the Main Phase *action*; CR 3-7-3 calls the bare placing
   * of a card in the Character area "playing" it too, and that is the sense a
   * card effect uses. Both readings exist in the text, so the choice is behind
   * `rules.playFromEffectPaysCost` — see the README.
   *
   * **One card.** The `Ref` may name several and only the first is placed; a
   * script that puts down two writes `forEach`, whose frame cursor already
   * tracks which iteration it is on. Every printed card in this set says "up to
   * 1", and a single-card instruction is what keeps the suspension honest: the
   * sacrifice choice carries the entering card in its own sink, so there is no
   * state in which a card is half onto the field.
   */
  | { op: 'play'; target: Ref; rested?: boolean }
  // Control flow. Both nest, which is why the cursor is a frame stack.
  | { op: 'if'; cond: Condition; then: Instruction[]; else?: Instruction[] }
  | { op: 'forEach'; in: Ref; do: Instruction[] };

export interface Ability {
  id: string;
  trigger: Trigger;
  /** Checked, never paid. Fails silently: the ability just does not fire. */
  condition?: Condition;
  /** Paid before the script runs. Unpayable means the ability cannot fire. */
  cost?: Cost[];
  /** "You may" rather than "you must": the controller is asked to opt in. */
  optional?: boolean;
  oncePerTurn?: boolean;
  /** Empty for `trigger: 'static'`. */
  script: Instruction[];
  /** `static` only: who the continuous effect applies to. */
  affects?: Audience;
  /** `static` only: what it grants them. */
  grants?: { power?: number; keyword?: Keyword };
}

/**
 * The reserved variable a `forEach` binds on each iteration.
 *
 * Nested loops shadow it, and it keeps the last item after the loop ends. The
 * alternative — a per-loop binding name — would need `forEach` to carry an `as`
 * field, which the DSL does not have.
 */
export const LOOP_VAR = 'it';

/**
 * Printed keyword spellings. `CardDefinition.keywords` stores the printed form
 * (`'Blocker'`), which Phase 0 already shipped and `blocker.test.ts` depends on;
 * the DSL speaks in lowercase identifiers. This map is the only bridge, and
 * `hasKeyword` is the only thing allowed to cross it.
 */
export const PRINTED_KEYWORD: Readonly<Record<Keyword, string>> = Object.freeze({
  rush: 'Rush',
  blocker: 'Blocker',
  doubleAttack: 'Double Attack',
  banish: 'Banish',
});

export const KEYWORDS: readonly Keyword[] = Object.freeze([
  'rush',
  'blocker',
  'doubleAttack',
  'banish',
]);

/** Everything a script may park in `vars`: ids and scalars, never objects. */
export type VarValue = string | number | boolean | InstanceId[];

/** Resolution context for refs, selectors and conditions. */
export interface AbilityContext {
  source: InstanceId;
  controller: PlayerId;
  vars: Record<string, VarValue>;
}

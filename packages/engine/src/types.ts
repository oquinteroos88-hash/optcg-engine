import type {
  CardPredicate,
  Duration,
  Keyword,
  LegalityClause,
  LegalityEffect,
  VarValue,
} from './abilities/dsl.js';
import type { GameEvent } from './events.js';

export type PlayerId = 'p1' | 'p2';
export type CardId = string; // "TEST-001", the printed card
export type InstanceId = string; // "p1-c14", this physical copy
export type Orientation = 'active' | 'rested';

export const PLAYER_IDS: readonly PlayerId[] = ['p1', 'p2'];

export interface GameState {
  version: 1;
  matchId: string;
  status: 'mulligan' | 'playing' | 'finished';
  winner: PlayerId | null;
  endReason: 'lifeOut' | 'deckOut' | 'concede' | null;
  turn: number;
  activePlayer: PlayerId;
  firstPlayer: PlayerId;
  phase: 'refresh' | 'draw' | 'don' | 'main' | 'end';
  priority: PlayerId; // who acts NOW (defender during block/counter)
  players: Record<PlayerId, PlayerState>;
  cards: Record<InstanceId, CardInstance>;
  battle: Battle | null;
  modifiers: Modifier[];
  /**
   * Timed rules about what a player may do. `Modifier`'s sibling, not its
   * fourth member.
   *
   * They share everything that makes a grant a grant — an id, a source, one of
   * the two durations the engine can expire — and differ in the only thing that
   * decides which array a record belongs in: what a reader has to ask it. Every
   * `Modifier` answers "what value does this **card** have", which is why every
   * member has a `target` and why `getPower` and `hasKeyword` can walk the list
   * card-first. A legality rule answers "may this **action** happen", is scoped
   * by a question rather than by a card, and is read by different callers at
   * different sites. Merging them would make `target` nullable for the sake of
   * entries `getPower` could only ever skip.
   */
  legality: LegalityRule[];
  /** Card effects being resolved, LIFO: `stack.at(-1)` runs next. */
  stack: StackItem[];
  /** The question the engine is waiting on, if any. */
  pending: PendingChoice | null;
  /**
   * Engine-level continuations, LIFO: `resume.at(-1)` runs next.
   *
   * Not in the original Phase 2A shape, and added for one reason: an effect can
   * suspend in the middle of a *rule*, not only in the middle of a script. A
   * `[Trigger]` question opens between the two damage instances of a Double
   * Attack, and an `endOfTurn` ability can suspend before the next turn starts.
   * The rest of that rule has to survive the pause, so it is stored the same way
   * a script position is: as a tagged, serializable record. Never a closure.
   */
  resume: ResumeStep[];
  rng: { seed: number; cursor: number };
  log: GameEvent[];
  rules: {
    firstPlayerCannotAttackTurnOne: boolean;
    /**
     * Whether a card put onto the field by an *effect* — "play up to 1 Character
     * card with a cost of 2 or less from your hand" — makes its controller pay
     * that card's printed cost.
     *
     * False, and the flag exists because the Comprehensive Rules use "play" in
     * two senses and never reconcile them. CR 6-5-3-1 and 4-7-1 define the Main
     * Phase *action* as paying and then placing; CR 3-7-3 calls the bare placing
     * of a card in the Character area "playing" it, with no payment in sight,
     * and CR 3-7-6-1 describes the full-board case in those terms too. Card
     * effects use the second sense, and two printed cards make that the only
     * workable reading: `OP01-014`'s `[On Block]` and `ST02-017`'s `[Trigger]`
     * both fire on the opponent's turn, when the defender's cost area is
     * empty — a card printed to be unplayable is not a card. The cost cap the
     * effects print ("with a cost of 2 or less") is the balancing mechanism,
     * and it would be redundant if the DON!! had to be there anyway.
     */
    playFromEffectPaysCost: boolean;
    /**
     * Whether the second damage of a Double Attack can win the game against a
     * player who had exactly 1 life card. Official Q&A says no (see README);
     * the flag exists because the Comprehensive Rules do not spell out the
     * mechanism, only the outcome.
     */
    doubleAttackCanWinFromOneLife: boolean;
    /**
     * Whether a Character an *effect* puts on the field counts as its controller
     * having **played a Character**, for the two cards that watch the opponent
     * do it.
     *
     * True, and the flag exists because CR uses "play" in two senses that it
     * never reconciles — the same crack `playFromEffectPaysCost` sits in, seen
     * from the trigger's side instead of the cost's. CR 3-7-3 calls the bare
     * placing of a card in the Character area "playing" it, with no payment in
     * sight, and that is the sense a card effect uses; CR 6-5-3-1 defines the
     * Main Phase *action* as paying and then placing. PR #29 separated the two
     * **for cost**, and nothing in that separation says a card an effect put
     * down was not played.
     *
     * The printed text agrees as far as it can. `OP04-024` says only "when your
     * opponent plays a Character" and names no route. `OP12-081` names two
     * timings — a Character with a base cost of 8 or more, **or** one played
     * "using a Character's effect" — which is a card treating the effect route
     * as a play it has to *narrow*, not as one it has to add.
     *
     * False makes the trigger fire only for the paid Main Phase action.
     */
    effectPlayIsPlayingACharacter: boolean;
    /**
     * Whether a Character *placed* rested — `OP01-060`'s "play it rested", or a
     * `play` instruction that says so — fires "when this Character becomes
     * rested" on the way in.
     *
     * False. "Becomes" is a transition and a card arriving rested made none: it
     * was not on the field a moment earlier, so there is no active state it left.
     * CR 3-7-5 words this act as **placing** — "when placing cards in the
     * Character area, they should be set as active unless otherwise specified" —
     * against CR 7-1-1-1's *resting* of a card that is already there.
     *
     * A flag rather than a decision, because the argument the other way is real:
     * the card is rested and it was not before, and none of the eight cards in
     * the family prints a cause that would exclude this. No printed card can
     * currently reach the case — nothing in OP-01 or either starter watches for
     * "becomes rested" at all — so the choice costs nothing today and is written
     * down before it can cost something.
     */
    placedRestedBecomesRested: boolean;
    /**
     * Whether a turn already **in progress** can be the "next turn" that
     * `endOfOpponentNextTurn` counts to.
     *
     * True — it cannot. The effect must survive the End Phase of the turn it was
     * written in and die in the *following* one of the opponent's.
     *
     * The Comprehensive Rules do not answer this. CR 6-6-1-2 says which End
     * Phase clause processes the expiry and says nothing about counting, and the
     * phrase "your opponent's next turn" appears on 43 printed cards and in no
     * rule. So the default is read off the English: a turn that is happening is
     * not a turn that is *next*, and a card wanting the current one says
     * "during this turn" — 459 cards do exactly that, which is what makes the
     * distinction load-bearing rather than stylistic.
     *
     * **The case is reachable, which is why it is a flag and not a comment.**
     * `OP08-112` S-Snake prints "[Trigger] Activate this card's [On Play]
     * effect", and a `[Trigger]` fires out of the Life area during the
     * opponent's turn — so its "cannot attack until the end of your opponent's
     * next turn" really can be written while that turn is in progress. Nothing
     * in `OP01-085` can reach it: its `[On Play]` is a Main Phase action and
     * fires on its controller's own turn only.
     *
     * False makes the turn in progress count, so an effect written during the
     * opponent's turn dies at the end of it — behaving as `endOfTurn`.
     */
    nextTurnExcludesTurnInProgress: boolean;
    /**
     * Whether an ability still resolves when **its own activation cost removed
     * its source from the field**.
     *
     * True. `OP01-047` Trafalgar Law is the card that reaches it: its `[On Play]`
     * costs "return 1 Character to your hand", nothing excludes Law itself, and
     * a card that excludes itself says so (`OP08-047` prints "other than this
     * Character"). So Law may pay with Law, and the "play a Character with a cost
     * of 3 or less" that follows runs from the hand.
     *
     * **The Comprehensive Rules point both ways, which is why this is a flag.**
     * CR 8-1-3-1-3 says an auto effect "will not activate and cannot be resolved
     * ... if the card that fulfilled the activation timing of that auto effect
     * moves to another area **before that effect is activated**", and CR 8-4-1
     * orders payment (8-4-1-3) ahead of activation (8-4-1-4) — read together,
     * self-payment would fizzle the ability. But CR 8-3-1-3-1 describes the same
     * sequence as "you have fulfilled the conditions to pay the activation cost,
     * **activated the effect**, and become unable to pay the activation cost
     * while in the process of paying", which puts activation *before* the
     * payment finishes and leaves 8-1-3-1-3 talking about a card removed by
     * something else in between.
     *
     * True is the reading that matches everything this engine already does. A
     * script whose source has left keeps running — `OP01-007` Caribou's
     * `[On K.O.]` resolves from the trash and `OP01-079`'s does too — and "no
     * instruction can abort its script" has been the interpreter's rule since
     * Phase 2A. It is also the reading that makes the printed card mean
     * something: a Law that fizzled when it paid with itself would be a cost the
     * card offers and a player can never take.
     *
     * False makes an ability whose cost removed its own source resolve nothing,
     * and the selector still offers the source — the difference is in what
     * happens after, not in what may be chosen.
     */
    selfReturnResolvesEffect: boolean;
    /**
     * How **"a different color than X"** reads against a two-colour card.
     *
     * True: the candidate must share **no** colour with the reference. That is
     * the direct consequence of CR 2-3-5 — "cards with multiple colors, such as
     * red and green, are treated as a card of every color they possess" — so a
     * red/green candidate *is* a red card and is therefore not different from a
     * red one.
     *
     * It is a flag rather than a fact because the step from "is a card of every
     * colour it has" to "is not *different* from" is an inference, not a
     * sentence, and no rule or Q&A states the comparison outright. **Two cards
     * in the entire game print the phrase** — `OP01-002` and `EB01-020` — which
     * is exactly the size where two implementers choose differently and neither
     * finds out.
     *
     * False takes the whole-set reading: a candidate is different unless its
     * colour set is identical, so red/green would count as different from red.
     */
    differentColorMeansNoSharedColor: boolean;
  };
}

export interface PlayerState {
  leader: InstanceId;
  characters: InstanceId[]; // max 5, order = board position
  stage: InstanceId | null;
  hand: InstanceId[];
  deck: InstanceId[]; // [0] = top
  trash: InstanceId[]; // [0] = most recent
  life: InstanceId[]; // [0] = top; damage takes from here
  don: DonCard[]; // the 10 DON!!, each with its location
  hasMulliganed: boolean; // true only when the player accepted the redraw
}

export interface CardInstance {
  instanceId: InstanceId;
  cardId: CardId;
  owner: PlayerId;
  controller: PlayerId;
  orientation: Orientation; // only relevant on the field
  attachedDon: InstanceId[];
  playedOnTurn: number | null;
  /** Ability ids already used this turn, for `oncePerTurn`. Cleared at End. */
  usedThisTurn: string[];
}

export interface DonCard {
  instanceId: InstanceId;
  location:
    | { kind: 'donDeck' }
    | { kind: 'cost'; orientation: Orientation }
    | { kind: 'attached'; to: InstanceId };
}

export interface Battle {
  step: 'attack' | 'block' | 'counter' | 'damage';
  attacker: InstanceId;
  target: InstanceId; // changes if a Blocker enters
  originalTarget: InstanceId;
  wasBlocked: boolean;
}

/**
 * A timed grant written onto the state by a script instruction.
 *
 * A discriminated union rather than one shape with optional fields: a power
 * modifier has no keyword and a keyword modifier has no value, and
 * `exactOptionalPropertyTypes` plus the no-explicit-undefined rule make the
 * union the only encoding that round-trips exactly.
 *
 * Continuous (`static`) abilities never produce a Modifier. They are read at
 * lookup time by `getPower`/`hasKeyword` and mutate nothing.
 */
export type Modifier =
  | {
      id: string;
      target: InstanceId;
      kind: 'power';
      value: number;
      duration: Duration;
      source: InstanceId;
      controller: PlayerId;
      writtenOnTurn: number;
    }
  | {
      id: string;
      target: InstanceId;
      kind: 'grantKeyword';
      keyword: Keyword;
      duration: Duration;
      source: InstanceId;
      controller: PlayerId;
      writtenOnTurn: number;
    };

/**
 * What every timed record has to know once one of the durations spans a change
 * of turn player, and why both fields are **required** rather than added only to
 * the entries that need them.
 *
 * `controller` is *whose* effect this is, and it is stored rather than derived
 * from `source`. A rule outlives the card that wrote it — ST01-016's source is
 * an Event sitting in the trash before the rule is ever consulted — so
 * `state.cards[source].controller` is a question that can stop having an answer,
 * and control of a card can change while a rule it wrote is still in force.
 *
 * `writtenOnTurn` is `state.turn` at the moment of writing, and it exists for
 * one question: whether a turn already **in progress** counts as "your
 * opponent's *next* turn". See `rules.nextTurnExcludesTurnInProgress`.
 *
 * Neither is optional. `exactOptionalPropertyTypes` plus the no-explicit-
 * undefined rule make an always-present field the only encoding that round-trips
 * exactly, and a record that sometimes knows whose it is would put the question
 * "does this one have a controller?" in front of every reader.
 */

/**
 * A timed legality rule written onto the state by a `setLegality` instruction.
 *
 * The whole record is data — no functions, no closures — for the reason the
 * whole engine is: a game that suspends mid-effect has to survive
 * `JSON.parse(JSON.stringify(state))` and come back the same game. A predicate
 * expressed as a function would be the one thing in here that could not.
 *
 * `subject` says which cards the rule speaks about, in the two forms the
 * printed cards need: a **set** ("your opponent cannot activate a [Blocker]
 * Character that has 5000 or more power" — a side plus a predicate) or an
 * **exact card** (OP01-112 Page One buying the permission for itself). The
 * `match` predicate is read with the effective lens, so a Blocker pushed to
 * 5000 by somebody else's continuous effect falls under ST01-002's ban and one
 * that is not, blocks.
 *
 * `whileAttacker` gates the rule on the open battle's attacker, and it is the
 * field that keeps ST01-016 from needing a mechanism of its own: the rule is
 * written when the Event resolves, sits inert through every other card's
 * attack, applies to an attack declared by the named card minutes later, and
 * expires with the turn whether or not that attack ever came.
 *
 * A rule is **not** dropped when its `source` leaves the field — ST01-016's
 * source is an Event sitting in the trash before the rule is ever consulted,
 * exactly as a Counter's power modifier outlives the card that granted it.
 */
export interface LegalityRule {
  id: string;
  source: InstanceId;
  duration: Duration;
  /** See the note above `Modifier`'s pair of the same two fields. */
  controller: PlayerId;
  writtenOnTurn: number;
  effect: LegalityEffect;
  /** Whose cards, and which of them. Absolute sides: `PlayerRef` is resolved. */
  subject: { player: PlayerId; match?: CardPredicate } | { is: InstanceId };
  clause: LegalityClause;
  /** Dormant unless this exact card is the open battle's attacker. */
  whileAttacker?: InstanceId;
}

/**
 * One instruction-list being executed, plus where in it we are.
 *
 * `path` locates the list inside the ability's script (`[]` is the root
 * script); `index` is the next instruction in that list. A `forEach` body frame
 * additionally carries its own iteration state. Numbers and strings only — this
 * is the whole reason a suspended effect survives `JSON.parse(JSON.stringify)`.
 */
export interface Frame {
  path: PathStep[];
  index: number;
  loop: LoopState | null;
}

export interface PathStep {
  /** Index of the nesting instruction inside its own list. */
  i: number;
  branch: 'then' | 'else' | 'do';
}

export interface LoopState {
  items: InstanceId[];
  at: number;
}

export interface StackItem {
  abilityId: string;
  source: InstanceId;
  controller: PlayerId;
  /**
   * Where the item is in its own lifecycle. Not in the original Phase 2A shape.
   *
   * `optIn` — a "you may" ability (or a life card's `[Trigger]`) waiting for
   * the controller to accept. `ready` — accepted, costs not yet paid.
   * `running` — costs paid, executing instructions.
   *
   * It lives on the item rather than in a separate queue so an optional ability
   * keeps its place in the resolution order: a side queue would let a later
   * mandatory trigger overtake an earlier optional one.
   */
  status: 'optIn' | 'ready' | 'running';
  /**
   * How many entries of `Ability.cost` are already paid. Only meaningful while
   * `status` is `'ready'`, which is the window CR 8-4-1-3 covers.
   *
   * The cost list is walked one entry at a time for the same reason the script
   * is: a cost can ask a question. "Trash 1 card from your hand" is a player
   * decision (CR 8-3-1-5 has the player *select* what pays), and a decision
   * needs a `PendingChoice`, and a `PendingChoice` ends the reducer. So payment
   * gets a cursor, and the same invariant as the script cursor holds over it —
   * **a cost that suspends does not advance this number; the answer does.** A
   * serialized state is never halfway through paying one cost; it is stopped
   * before a cost that has not started.
   */
  costsPaid: number;
  /** Innermost frame last. Empty means the script ran to the end. */
  cursor: Frame[];
  vars: Record<string, VarValue>;
}

export interface PendingChoice {
  id: string;
  player: PlayerId;
  kind: 'selectCards' | 'yesNo' | 'selectOption' | 'orderCards' | 'partitionCards';
  prompt: string;
  candidates: InstanceId[];
  min: number;
  max: number;
  /**
   * Where the answer goes when it arrives. Not in the original Phase 2A shape;
   * without it the reducer would have to guess whether an answer belongs to a
   * script variable or to a rule the engine paused in the middle of, and that
   * guess is exactly the kind of implicit continuation this design forbids.
   *
   * `cost` is the third member and the reason the field was worth having: the
   * answer to a `discardHand` cost is not a script variable at all — it is the
   * payment itself, applied against `StackItem.costsPaid`, which names the cost
   * being paid without the choice having to repeat it.
   *
   * `play` is the fourth, and the first that has to *carry* something. The other
   * three are derivable from where the interpreter stopped; which card is coming
   * onto the field is not, because re-resolving the instruction's `Ref` after the
   * answer could name a different card. So the record is complete on its own: the
   * card entering, and whether it enters rested. Nothing about the placement is
   * left to be looked up again.
   *
   * `orderToBottom` is the fifth, and it grew the union for the reason `play`
   * did: **the answer is not a value, it is an action.** A `var` sink would
   * write the permutation into a variable and leave the placement to a following
   * instruction, which makes "look at 5, put the rest back" expressible as a
   * script that looks and never puts back — a half-executed printed sentence,
   * which is the failure `play`'s sink exists to prevent.
   *
   * Unlike `play` it carries nothing, and that is checkable rather than lucky:
   * the cards to place are `PendingChoice.candidates`, and validation
   * guarantees the answer is exactly that multiset, so the placement reads the
   * answer alone and re-resolves nothing.
   *
   */
  sink:
    | { kind: 'var'; name: string }
    | { kind: 'optIn' }
    | { kind: 'cost' }
    | { kind: 'play'; entering: InstanceId; rested: boolean }
    | { kind: 'orderToBottom' }
    | { kind: 'orderToDeckEnds' }
    /**
     * The seventh, and the first whose answer comes from a player who may not
     * control the effect at all.
     *
     * It carries `owner` for `play`'s reason rather than `orderToBottom`'s. The
     * cards to trash are `candidates` and validation proves the answer is a
     * subset of them, so the *cards* need no recording — but **whose hand they
     * leave** is a second fact, and the only other way to get it is to re-read
     * the instruction's `owner` against `StackItem.controller` after the answer.
     * That is a second resolution of the same reference, which is exactly what
     * `play`'s sink exists to avoid. One field makes the record complete.
     *
     * It is a sink rather than a `var` for `orderToBottom`'s reason: **the
     * answer is an action, not a value.** A variable would make "your opponent
     * trashes 1 card from their hand" expressible as a script that asks and
     * never trashes.
     */
    | { kind: 'discard'; owner: PlayerId };
}

/**
 * A rule the engine paused in the middle of. Tagged data, resolved by a switch
 * — the engine-level twin of a script's program counter.
 */
export type ResumeStep =
  /** Deal `remaining` more damage to `player`'s leader. */
  | {
      kind: 'damage';
      player: PlayerId;
      remaining: number;
      /** Life cards go straight to the trash and skip their `[Trigger]`. */
      banish: boolean;
      /** False once at least one damage instance of this attack has landed. */
      first: boolean;
    }
  /** Close the turn and start the next one. */
  | { kind: 'startTurn'; player: PlayerId };

/** The payload of an answered choice. Absent on the `legalActions` marker. */
export type ChoiceAnswer =
  | { kind: 'cards'; selected: InstanceId[] }
  | { kind: 'yesNo'; value: boolean }
  | { kind: 'option'; index: number }
  /**
   * A permutation of `PendingChoice.candidates` — every one of them, once each,
   * in the order the player wants them placed.
   *
   * A separate member rather than a re-use of `cards` with `min === max`,
   * because the two answer different questions. `cards` says *which*, and its
   * order is incidental — `selectCards` ignores it. This says *in what order*,
   * and nothing is being selected: the set was already decided by the cards the
   * player did not take. Sharing the member would make a `selectCards` answer
   * silently acceptable for an ordering question, and `choiceKindMismatch`
   * would stop meaning anything.
   */
  | { kind: 'order'; order: InstanceId[] }
  /**
   * A **partition** of `PendingChoice.candidates` between the two ends of the
   * deck, each side ordered — "place them at the top **or** bottom of the deck
   * in any order".
   *
   * A fifth member rather than `order` with an optional destination field, and
   * the rule that decides it is the one `order` itself was split out under: two
   * answers that mean different things do not share a member, or a permutation
   * becomes an acceptable reply to a partition and back. With one member and a
   * flag, an answer that named a destination for a plain `orderCards` question
   * would validate; `choiceKindMismatch` would stop meaning anything, which is
   * exactly the argument that kept `cards` and `order` apart.
   *
   * **Both lists read as draw order**, which is the whole of the mapping and is
   * stated once here so the two sides cannot drift: `top[0]` is the card its
   * owner draws first of all, `top.at(-1)` the last of the top group; then
   * whatever the deck already held; then `bottom[0]` down to `bottom.at(-1)`
   * deepest. See `placeAtDeckEnds` for the CR 3-2-3 reading that gets there.
   *
   * Either side may be empty — "all five to the bottom" is a legal answer to a
   * top-or-bottom question, and so is all five to the top.
   */
  | { kind: 'partition'; top: InstanceId[]; bottom: InstanceId[] };

export interface Decklist {
  leader: CardId;
  cards: CardId[]; // exactly 50
}

export type Action =
  | { type: 'MULLIGAN'; player: PlayerId; accept: boolean }
  | { type: 'PLAY_CARD'; player: PlayerId; instanceId: InstanceId; trashCharacter?: InstanceId }
  | { type: 'ATTACH_DON'; player: PlayerId; to: InstanceId; count: number }
  | { type: 'DECLARE_ATTACK'; player: PlayerId; attacker: InstanceId; target: InstanceId }
  | { type: 'DECLARE_BLOCK'; player: PlayerId; blocker: InstanceId }
  | { type: 'PLAY_COUNTER'; player: PlayerId; instanceId: InstanceId; target: InstanceId }
  /**
   * Activate a [Counter] Event from hand during the Counter Step (CR 7-1-3-2-2).
   *
   * A different move from PLAY_COUNTER, not a second payment form of it. The
   * printed Counter value drives PLAY_COUNTER and names its target in the
   * action; a [Counter] Event has no printed value — it is paid by its printed
   * cost, trashed, and its effect chooses its own targets through the script's
   * `select`, resolved afterwards through `pending`. So it carries no `target`.
   */
  | { type: 'PLAY_COUNTER_EVENT'; player: PlayerId; instanceId: InstanceId }
  | { type: 'PASS'; player: PlayerId }
  | { type: 'END_TURN'; player: PlayerId }
  | { type: 'CONCEDE'; player: PlayerId }
  /**
   * Activate a Main-phase ability. Not in the Phase 2A brief, which lists only
   * ANSWER_CHOICE as new — but the brief also requires `activateMain` abilities
   * to be gated by cost in `legalActions`, and there is no other action that
   * could carry one. Without it the trigger is unreachable. Documented in the
   * README as a deliberate divergence.
   */
  | { type: 'ACTIVATE_ABILITY'; player: PlayerId; instanceId: InstanceId; abilityId: string }
  /**
   * Answer the open `pending`. `answer` is optional *only* because
   * `legalActions` emits a marker without one; `applyAction` rejects an answer
   * that is missing. This is the single action whose legality is not fully
   * enumerated by `legalActions` — see the README.
   */
  | { type: 'ANSWER_CHOICE'; player: PlayerId; choiceId: string; answer?: ChoiceAnswer };

export type ApplyResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; reason: string };

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

export type Trigger =
  | 'onPlay'
  | 'whenAttacking'
  | 'onBlock'
  | 'onKO'
  | 'whenOpponentAttacks'
  | 'activateMain'
  | 'trigger'
  | 'counterEvent'
  | 'mainEvent'
  | 'endOfTurn'
  | 'static';

/**
 * A filter over cards in one zone. `owner` is relative to the ability's
 * controller.
 *
 * `deckTop` is the only zone where `count` means anything: it takes the first
 * `count` cards of the deck rather than filtering the whole deck.
 */
export interface Selector {
  zone: 'field' | 'hand' | 'trash' | 'deckTop' | 'life';
  owner: 'you' | 'opponent' | 'any';
  category?: CardCategory[];
  colors?: Color[];
  types?: string[];
  costMax?: number;
  costMin?: number;
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

export type Cost =
  | { kind: 'restDon'; count: number }
  | { kind: 'returnDon'; count: number }
  | { kind: 'trashSelf' }
  | { kind: 'discardHand'; count: number };

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
  | { op: 'reveal'; as: string; from: Selector }
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
  affects?: Selector;
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

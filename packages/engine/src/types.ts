import type { Keyword, VarValue } from './abilities/dsl.js';
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
     * Whether the second damage of a Double Attack can win the game against a
     * player who had exactly 1 life card. Official Q&A says no (see README);
     * the flag exists because the Comprehensive Rules do not spell out the
     * mechanism, only the outcome.
     */
    doubleAttackCanWinFromOneLife: boolean;
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
      duration: 'endOfBattle' | 'endOfTurn';
      source: InstanceId;
    }
  | {
      id: string;
      target: InstanceId;
      kind: 'grantKeyword';
      keyword: Keyword;
      duration: 'endOfBattle' | 'endOfTurn';
      source: InstanceId;
    };

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
  kind: 'selectCards' | 'yesNo' | 'selectOption' | 'orderCards';
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
   */
  sink: { kind: 'var'; name: string } | { kind: 'optIn' } | { kind: 'cost' };
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
  | { kind: 'option'; index: number };

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

import { legalActions } from '@optcg/engine';
import type { GameState, InstanceId, PendingChoice, PlayerId } from '@optcg/engine';

/**
 * What the acting player can do with one card, derived purely from legalActions.
 * Components read these flags; nobody re-implements rule predicates.
 */
export interface CardAffordance {
  canPlay: boolean;
  /** True when every PLAY_CARD variant for this card demands a sacrifice. */
  playRequiresTrash: boolean;
  trashCandidates: readonly InstanceId[];
  canAttack: boolean;
  attackTargets: readonly InstanceId[];
  canReceiveDon: boolean;
  canBlock: boolean;
  canCounter: boolean;
  counterTargets: readonly InstanceId[];
  /** True when at least one ability of this card can be activated right now. */
  canActivate: boolean;
  /**
   * Ability ids offered by ACTIVATE_ABILITY for this card, in legalActions
   * order. A list rather than a boolean because a card may print more than one
   * activated ability, and the contextual menu offers one entry per id.
   */
  activatableAbilities: readonly string[];
  /**
   * PLAY_COUNTER_EVENT: a [Counter] Event activated from hand for its printed
   * cost. Deliberately NOT folded into `canCounter`/`counterTargets` — that pair
   * describes PLAY_COUNTER, whose action names its target. A [Counter] Event
   * carries no `target`; its effect picks its own through `pending`. Sharing the
   * target list would invent a target the action has no field for.
   */
  canPlayCounterEvent: boolean;
}

/**
 * The open choice, as much of it as the UI needs to build a legal answer.
 *
 * THE ARCHITECTURAL EXCEPTION, and the only one. Every other field on
 * `Affordances` is an index over `legalActions`. This one is copied out of
 * `state.pending`, because with a choice open `legalActions` returns a single
 * `ANSWER_CHOICE` marker with no payload — enumerating the valid answers would
 * mean enumerating subsets, and a "select 2 of 7" already has 21 of them.
 *
 * So the engine publishes the *shape* of a legal answer as data — candidates,
 * min, max, kind, prompt — and every client, this one and the random bot alike,
 * reads it from there. Confining the exception to one field of one object keeps
 * it checkable: nothing else in the client is allowed to open `state.pending`.
 *
 * See the engine README, "Choices are data, not enumeration", and
 * `packages/client/README.md`.
 */
export interface ChoiceView {
  id: string;
  /**
   * The engine's own union. Only `selectCards` and `yesNo` are ever produced —
   * `selectOption` and `orderCards` are vestigial in the type and pinned as
   * unproduced by `tests/choiceShapes.test.ts` — but narrowing here would make
   * the client silently wrong the day one of them comes back.
   */
  kind: PendingChoice['kind'];
  prompt: string;
  candidates: readonly InstanceId[];
  min: number;
  max: number;
}

export interface Affordances {
  byCard: Record<InstanceId, CardAffordance>;
  /** Non-null exactly while `global.mustAnswerChoice` — see ChoiceView. */
  pendingChoice: ChoiceView | null;
  global: {
    canEndTurn: boolean;
    canPass: boolean;
    canConcede: boolean;
    mustAnswerMulligan: boolean;
    /**
     * A choice is open and this player owns it. While true, every other
     * affordance is false by construction: `legalActions` returns exactly the
     * ANSWER_CHOICE marker plus CONCEDE, so nothing else can be indexed.
     *
     * ARCHITECTURAL EXCEPTION. This flag is the gate, not the answer space. The
     * shape of a legal answer — candidates, min, max, kind, prompt — is data in
     * `state.pending`, and reading it is the single place where the client takes
     * legality from the state instead of from `legalActions`. See
     * `pendingChoiceView` in `store/selectors.ts`, the engine README section
     * "Choices are data, not enumeration", and `packages/client/README.md`.
     */
    mustAnswerChoice: boolean;
  };
  whoActs: PlayerId;
}

const EMPTY_IDS: readonly InstanceId[] = Object.freeze([]);

const EMPTY_ABILITY_IDS: readonly string[] = Object.freeze([]);

export const EMPTY_AFFORDANCE: CardAffordance = Object.freeze({
  canPlay: false,
  playRequiresTrash: false,
  trashCandidates: EMPTY_IDS,
  canAttack: false,
  attackTargets: EMPTY_IDS,
  canReceiveDon: false,
  canBlock: false,
  canCounter: false,
  counterTargets: EMPTY_IDS,
  canActivate: false,
  activatableAbilities: EMPTY_ABILITY_IDS,
  canPlayCounterEvent: false,
});

/** Safe accessor so noUncheckedIndexedAccess never leaks undefined into the UI. */
export function cardAffordance(aff: Affordances, id: InstanceId): CardAffordance {
  return aff.byCard[id] ?? EMPTY_AFFORDANCE;
}

interface CardBuilder {
  canPlay: boolean;
  sawPlainPlay: boolean;
  trashCandidates: Set<InstanceId>;
  canAttack: boolean;
  attackTargets: Set<InstanceId>;
  canReceiveDon: boolean;
  canBlock: boolean;
  canCounter: boolean;
  counterTargets: Set<InstanceId>;
  /** Insertion-ordered, deduplicated: legalActions order is the menu order. */
  activatableAbilities: Set<string>;
  canPlayCounterEvent: boolean;
}

function builderFor(byCard: Map<InstanceId, CardBuilder>, id: InstanceId): CardBuilder {
  let builder = byCard.get(id);
  if (builder === undefined) {
    builder = {
      canPlay: false,
      sawPlainPlay: false,
      trashCandidates: new Set(),
      canAttack: false,
      attackTargets: new Set(),
      canReceiveDon: false,
      canBlock: false,
      canCounter: false,
      counterTargets: new Set(),
      activatableAbilities: new Set(),
      canPlayCounterEvent: false,
    };
    byCard.set(id, builder);
  }
  return builder;
}

/**
 * One pass over legalActions(state, whoActs), pure indexing. No rule
 * predicates: phase, battle step and costs are never inspected here.
 */
export function computeAffordances(state: GameState, whoActs: PlayerId): Affordances {
  const byCard = new Map<InstanceId, CardBuilder>();
  let canPass = false;
  let canEndTurn = false;
  let canConcede = false;
  let mustAnswerMulligan = false;
  let mustAnswerChoice = false;

  for (const action of legalActions(state, whoActs)) {
    switch (action.type) {
      case 'PLAY_CARD': {
        const builder = builderFor(byCard, action.instanceId);
        builder.canPlay = true;
        if (action.trashCharacter === undefined) {
          builder.sawPlainPlay = true;
        } else {
          builder.trashCandidates.add(action.trashCharacter);
        }
        break;
      }
      case 'ATTACH_DON': {
        builderFor(byCard, action.to).canReceiveDon = true;
        break;
      }
      case 'DECLARE_ATTACK': {
        const builder = builderFor(byCard, action.attacker);
        builder.canAttack = true;
        builder.attackTargets.add(action.target);
        break;
      }
      case 'DECLARE_BLOCK': {
        builderFor(byCard, action.blocker).canBlock = true;
        break;
      }
      case 'PLAY_COUNTER': {
        const builder = builderFor(byCard, action.instanceId);
        builder.canCounter = true;
        builder.counterTargets.add(action.target);
        break;
      }
      case 'PLAY_COUNTER_EVENT': {
        builderFor(byCard, action.instanceId).canPlayCounterEvent = true;
        break;
      }
      case 'ACTIVATE_ABILITY': {
        builderFor(byCard, action.instanceId).activatableAbilities.add(action.abilityId);
        break;
      }
      case 'ANSWER_CHOICE': {
        mustAnswerChoice = true;
        break;
      }
      case 'PASS': {
        canPass = true;
        break;
      }
      case 'END_TURN': {
        canEndTurn = true;
        break;
      }
      case 'CONCEDE': {
        canConcede = true;
        break;
      }
      case 'MULLIGAN': {
        mustAnswerMulligan = true;
        break;
      }
    }
  }

  const result: Record<InstanceId, CardAffordance> = {};
  for (const [id, builder] of byCard) {
    const trashCandidates = [...builder.trashCandidates];
    const activatableAbilities = [...builder.activatableAbilities];
    result[id] = {
      canPlay: builder.canPlay,
      playRequiresTrash: builder.canPlay && !builder.sawPlainPlay && trashCandidates.length > 0,
      trashCandidates,
      canAttack: builder.canAttack,
      attackTargets: [...builder.attackTargets],
      canReceiveDon: builder.canReceiveDon,
      canBlock: builder.canBlock,
      canCounter: builder.canCounter,
      counterTargets: [...builder.counterTargets],
      canActivate: activatableAbilities.length > 0,
      activatableAbilities,
      canPlayCounterEvent: builder.canPlayCounterEvent,
    };
  }

  // Read off the state, not off the list — see ChoiceView. Guarded by the
  // marker so it stays null for anyone who is not the one being asked.
  const pending = state.pending;
  const pendingChoice: ChoiceView | null =
    mustAnswerChoice && pending !== null
      ? {
          id: pending.id,
          kind: pending.kind,
          prompt: pending.prompt,
          candidates: [...pending.candidates],
          min: pending.min,
          max: pending.max,
        }
      : null;

  return {
    byCard: result,
    pendingChoice,
    global: { canEndTurn, canPass, canConcede, mustAnswerMulligan, mustAnswerChoice },
    whoActs,
  };
}

// Single-entry memo. Engine states are deeply frozen and structurally shared,
// so reference identity is an exact cache key.
let memoState: GameState | null = null;
let memoResult: Affordances | null = null;

/** Affordances for the player who acts now (state.priority), memoized. */
export function getAffordances(state: GameState): Affordances {
  if (memoState === state && memoResult !== null) {
    return memoResult;
  }
  memoState = state;
  memoResult = computeAffordances(state, state.priority);
  return memoResult;
}

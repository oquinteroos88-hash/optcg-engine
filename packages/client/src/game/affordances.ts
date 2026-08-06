import { legalActions } from '@optcg/engine';
import type { GameState, InstanceId, PlayerId } from '@optcg/engine';

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
}

export interface Affordances {
  byCard: Record<InstanceId, CardAffordance>;
  global: {
    canEndTurn: boolean;
    canPass: boolean;
    canConcede: boolean;
    mustAnswerMulligan: boolean;
  };
  whoActs: PlayerId;
}

const EMPTY_IDS: readonly InstanceId[] = Object.freeze([]);

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
    };
  }

  return {
    byCard: result,
    global: { canEndTurn, canPass, canConcede, mustAnswerMulligan },
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

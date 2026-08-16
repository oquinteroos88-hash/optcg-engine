import { legalActions, redactPending } from '@optcg/engine';
import type {
  Action,
  GameState,
  InstanceId,
  PendingChoice,
  PendingView,
  PlayerId,
} from '@optcg/engine';

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
   * The engine's own union, deliberately not narrowed — and the decision paid
   * for itself.
   *
   * This said "only `selectCards` and `yesNo` are ever produced; narrowing here
   * would make the client silently wrong the day one of them comes back". One
   * of them came back: `ST02-007` Bonney brought `orderCards` with it, the
   * overlay grew a branch, and nothing in this file had to change to let it.
   * `selectOption` is still unproduced and still not narrowed away, for the
   * same reason. `tests/choiceShapes.test.ts` measures which are live.
   */
  kind: PendingChoice['kind'];
  prompt: string;
  candidates: readonly InstanceId[];
  min: number;
  max: number;
  /**
   * How many faceless candidates a **blind** choice offers, or null.
   *
   * `OP01-038` Kanjuro has the opponent choose out of a hand they may not see
   * (CR 3-4-3, 8-4-4-2), so the view publishes a count and no identities, and
   * the answer is a list of handles rather than of ids. `candidates` is empty
   * exactly when this is set: there is nothing to name, which is the point.
   */
  blindHandles: number | null;
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
 * One pass over a list of legal actions, pure indexing. No rule predicates:
 * phase, battle step and costs are never inspected here.
 *
 * **It takes the list rather than the state, and that is the whole of what PR
 * #45 changed here.** The affordance contract has always been "index whatever
 * the engine offers"; what moved is where the offer comes from. Over a
 * network there is no `GameState` to run `legalActions` against — the client
 * holds a redacted view — so the list arrives on the wire and this function
 * indexes it exactly as it indexed the local one. Hot-seat calls
 * `getAffordances`, which produces the list locally and lands here too, so
 * both modes share one indexer and cannot drift.
 */
export function indexAffordances(
  actions: readonly Action[],
  whoActs: PlayerId,
  pending: PendingView | null,
): Affordances {
  const byCard = new Map<InstanceId, CardBuilder>();
  let canPass = false;
  let canEndTurn = false;
  let canConcede = false;
  let mustAnswerMulligan = false;
  let mustAnswerChoice = false;

  for (const action of actions) {
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

  // Read off the redacted `pending`, not off the list — see ChoiceView. The
  // marker guards it, so it stays null for anyone who is not the one asked;
  // an `other` audience is somebody else's question and never reaches here.
  const pendingChoice: ChoiceView | null =
    mustAnswerChoice && pending !== null && pending.audience !== 'other'
      ? pending.audience === 'chooserBlind'
        ? {
            id: pending.id,
            kind: pending.kind,
            prompt: pending.prompt,
            // Nothing to name: the whole point of a blind choice.
            candidates: EMPTY_IDS,
            min: pending.min,
            max: pending.max,
            blindHandles: pending.handleCount,
          }
        : {
            id: pending.id,
            kind: pending.kind,
            prompt: pending.prompt,
            candidates: [...pending.candidates],
            min: pending.min,
            max: pending.max,
            blindHandles: null,
          }
      : null;

  return {
    byCard: result,
    pendingChoice,
    global: { canEndTurn, canPass, canConcede, mustAnswerMulligan, mustAnswerChoice },
    whoActs,
  };
}

/**
 * The hot-seat path: produce the list locally, then index it.
 *
 * `pending` comes through `playerView` rather than off `state.pending`
 * directly, so the one thing the client reads from the state instead of from
 * `legalActions` is read through the same redaction a networked seat gets.
 * That is what keeps the two modes honest about a blind choice: hot-seat's
 * chooser sees handles too, because Kanjuro's opponent may not read that hand
 * across a shared table any more than across a wire.
 */
export function computeAffordances(state: GameState, whoActs: PlayerId): Affordances {
  return indexAffordances(legalActions(state, whoActs), whoActs, redactPending(state, whoActs));
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

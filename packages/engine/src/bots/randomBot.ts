import { legalActions } from '../legalActions.js';
import { nextInt } from '../rng.js';
import type { RngState } from '../rng.js';
import type { Action, ChoiceAnswer, GameState, InstanceId, PendingChoice, PlayerId } from '../types.js';

// Derived from the game seed so a bot run is reproducible without ever touching
// state.rng: the engine's stream must stay a pure function of the action log.
export function botRngFor(seed: number): RngState {
  return { seed: (seed ^ 0x9e3779b9) | 0, cursor: 0 };
}

/**
 * Uniform choice over legalActions with two deliberate biases:
 *
 * - CONCEDE is excluded. With concede in a uniform pool virtually every game
 *   ends by random concession within a few turns, which makes the endReason
 *   distribution meaningless and leaves the rules untested.
 * - END_TURN is taken only when nothing else remains, so turns actually spend
 *   resources and games progress toward a real ending.
 *
 * Returns null when the game offers no move (finished).
 */
/**
 * Builds a uniformly random valid answer to an open choice.
 *
 * `legalActions` deliberately does not enumerate answers — for a "select 2 of
 * 7" the subsets alone are 21 entries — so the bot reads the shape of a legal
 * answer out of `state.pending` instead, which is exactly what any other client
 * has to do.
 */
export function answerChoice(
  pending: PendingChoice,
  rng: RngState,
): { answer: ChoiceAnswer; rng: RngState } {
  switch (pending.kind) {
    case 'yesNo': {
      const draw = nextInt(rng, 2);
      return { answer: { kind: 'yesNo', value: draw.value === 1 }, rng: draw.rng };
    }
    case 'selectOption': {
      const draw = nextInt(rng, Math.max(1, pending.max));
      return { answer: { kind: 'option', index: draw.value }, rng: draw.rng };
    }
    case 'selectCards':
    case 'orderCards': {
      // A random cardinality in [min, max], then that many distinct candidates.
      const sizeDraw = nextInt(rng, pending.max - pending.min + 1);
      const size = pending.min + sizeDraw.value;
      let current = sizeDraw.rng;
      const pool: InstanceId[] = [...pending.candidates];
      const selected: InstanceId[] = [];
      for (let i = 0; i < size; i += 1) {
        const pick = nextInt(current, pool.length);
        current = pick.rng;
        const [taken] = pool.splice(pick.value, 1);
        if (taken === undefined) {
          throw new Error('Bot bug: ran out of candidates while answering a choice');
        }
        selected.push(taken);
      }
      return { answer: { kind: 'cards', selected }, rng: current };
    }
  }
}

export function chooseAction(
  state: GameState,
  player: PlayerId,
  rng: RngState,
): { action: Action; rng: RngState } | null {
  // An open choice leaves exactly one real move, and its payload is data rather
  // than an enumerated option.
  if (state.pending !== null && state.pending.player === player) {
    const pending = state.pending;
    const answered = answerChoice(pending, rng);
    return {
      action: {
        type: 'ANSWER_CHOICE',
        player,
        choiceId: pending.id,
        answer: answered.answer,
      },
      rng: answered.rng,
    };
  }
  const options = legalActions(state, player).filter((action) => action.type !== 'CONCEDE');
  if (options.length === 0) {
    return null;
  }
  const preferred = options.filter((action) => action.type !== 'END_TURN');
  const pool = preferred.length > 0 ? preferred : options;
  const draw = nextInt(rng, pool.length);
  const action = pool[draw.value];
  if (action === undefined) {
    throw new Error('Bot bug: index out of range while choosing an action');
  }
  return { action, rng: draw.rng };
}

import { legalActions } from '../legalActions.js';
import { nextInt } from '../rng.js';
import type { RngState } from '../rng.js';
import type { Action, GameState, PlayerId } from '../types.js';

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
export function chooseAction(
  state: GameState,
  player: PlayerId,
  rng: RngState,
): { action: Action; rng: RngState } | null {
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

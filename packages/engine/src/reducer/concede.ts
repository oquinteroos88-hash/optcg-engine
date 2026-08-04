import type { GameEvent } from '../events.js';
import { getOpponent } from '../selectors.js';
import type { GameState, PlayerId } from '../types.js';
import { finishGame } from './helpers.js';

// CONCEDE is the only priority-exempt action: legal from either player during
// mulligan or play. The structural gates (finished game, unknown player) have
// already run.
export function applyConcede(
  draft: GameState,
  action: { player: PlayerId },
  events: GameEvent[],
): void {
  finishGame(draft, getOpponent(action.player), 'concede', events);
}

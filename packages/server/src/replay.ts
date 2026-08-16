import type { Action, Decklist, GameState, PlayerId } from '@optcg/engine';
import { applyAction, createGame } from '@optcg/engine';

/**
 * `seed + action log = the match` — the phase-0 promise, now with an owner.
 *
 * The actions are replayed exactly as they were accepted, handle answers
 * included: a blind choice's handle order is derived from nothing but the
 * choice id and its candidates, both state, so the same handle resolves the
 * same card on every run. A rejected action here is not a game move gone
 * wrong — it is a corrupted log or a diverging engine, and both deserve a
 * throw, not a shrug.
 */
export function replayMatch(
  seed: number,
  decklists: Record<PlayerId, Decklist>,
  actions: readonly Action[],
): GameState {
  let state = createGame({ seed, decks: decklists, firstPlayer: 'p1' });
  for (const [index, action] of actions.entries()) {
    const result = applyAction(state, action);
    if (!result.ok) {
      throw new Error(
        `Replay diverged at action ${index} (${action.type}): ${result.reason}`,
      );
    }
    state = result.state;
  }
  return state;
}

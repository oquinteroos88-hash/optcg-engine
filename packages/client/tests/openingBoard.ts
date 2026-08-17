import { applyAction, createGame } from '@optcg/engine';
import type { Action, GameState } from '@optcg/engine';
import { registerStarterCards, starterDecklists, toEngineDecklist } from '@optcg/cards/starters';

/**
 * A real ST-01/ST-02 board, three actions deep.
 *
 * Built rather than searched for out of the playout corpus. What the suites
 * that use this need is real starter cards on a real board with a few lines of
 * log, and `firstStarterStateWhere` would run a four-hundred-step, ten-seed
 * playout to hand back the same thing. That cost is not theirs to add — they
 * share a CPU with `fullGame.test.ts`, whose five-second budget has no headroom
 * to lend, and which has gone over on CI once already for exactly this reason.
 *
 * It lives here rather than in `corpus.ts` on purpose: importing `corpus.ts`
 * pulls in the driver and the playout, which is the cost this avoids.
 */
export function openingBoard(seed = 82): GameState {
  registerStarterCards();
  const [st01, st02] = starterDecklists;
  if (st01 === undefined || st02 === undefined) {
    throw new Error('expected both starter decklists');
  }
  let state = createGame({
    seed,
    decks: { p1: toEngineDecklist(st01), p2: toEngineDecklist(st02) },
    firstPlayer: 'p1',
  });
  for (const action of [
    { type: 'MULLIGAN', player: 'p1', accept: false },
    { type: 'MULLIGAN', player: 'p2', accept: false },
  ] as Action[]) {
    const result = applyAction(state, action);
    if (!result.ok) {
      throw new Error(result.reason);
    }
    state = result.state;
  }
  return state;
}

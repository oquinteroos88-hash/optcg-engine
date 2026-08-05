import { applyAction, createGame, legalActions, nextInt } from '@optcg/engine';
import type { GameState } from '@optcg/engine';
import { GREEN_DECK, RED_DECK } from '@optcg/engine/testdata/decks';

/**
 * Seeded random playout mirroring the engine's (unexported) bot policy:
 * CONCEDE excluded, END_TURN only as last resort, rng derived from the game
 * seed so the corpus is reproducible. Returns every state visited, initial
 * state included.
 */
export function playout(seed: number, maxSteps: number): GameState[] {
  let state = createGame({ seed, decks: { p1: RED_DECK, p2: GREEN_DECK }, firstPlayer: 'p1' });
  let rng = { seed: (seed ^ 0x9e3779b9) | 0, cursor: 0 };
  const states: GameState[] = [state];

  for (let step = 0; step < maxSteps; step += 1) {
    const options = legalActions(state, state.priority).filter((a) => a.type !== 'CONCEDE');
    if (options.length === 0) {
      break; // finished
    }
    const preferred = options.filter((a) => a.type !== 'END_TURN');
    const pool = preferred.length > 0 ? preferred : options;
    const draw = nextInt(rng, pool.length);
    rng = draw.rng;
    const action = pool[draw.value];
    if (action === undefined) {
      throw new Error('driver bug: index out of range');
    }
    const result = applyAction(state, action);
    if (!result.ok) {
      throw new Error(`driver bug: legal action rejected (${result.reason})`);
    }
    state = result.state;
    states.push(state);
  }

  return states;
}

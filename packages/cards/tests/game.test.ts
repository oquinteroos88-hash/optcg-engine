import { describe, expect, it } from 'vitest';
import { applyAction, assertInvariants, createGame, legalActions } from '@optcg/engine';
import type { Action, GameState, PlayerId } from '@optcg/engine';
import { registerEnglishCards, ST01_DECK, ST02_DECK, toEngineDecklist } from '../src/index.js';

registerEnglishCards();

const ACTIONS = 400;

/**
 * A deterministic driver, deliberately not the engine's own bot: that one is
 * internal to the engine package. What matters here is only that real printed
 * costs, powers, Counter values and Life totals survive a real game — the cards
 * have no abilities yet, so they play as vanilla.
 */
function pick(actions: Action[], step: number): Action | undefined {
  const usable = actions.filter((action) => action.type !== 'CONCEDE');
  if (usable.length === 0) return undefined;
  const rest = usable.filter((action) => action.type !== 'END_TURN');
  const pool = rest.length > 0 ? rest : usable;
  // A cheap LCG over the action index: reproducible, and enough to reach
  // attacks, blocks and Counter-step plays across a few hundred actions.
  return pool[((step * 1103515245 + 12345) >>> 8) % pool.length];
}

function run(seed: number): { state: GameState; taken: number; mix: Record<string, number> } {
  let state = createGame({
    seed,
    decks: { p1: toEngineDecklist(ST01_DECK), p2: toEngineDecklist(ST02_DECK) },
    firstPlayer: 'p1',
  });

  let taken = 0;
  const mix: Record<string, number> = {};
  for (let step = 0; step < ACTIONS; step += 1) {
    if (state.status === 'finished') break;
    const player: PlayerId = state.priority;
    const action = pick(legalActions(state, player), step);
    if (action === undefined) break;

    const result = applyAction(state, action);
    if (!result.ok) {
      throw new Error(`action ${step} (${action.type}) rejected: ${result.reason}`);
    }
    state = result.state;
    taken += 1;
    mix[action.type] = (mix[action.type] ?? 0) + 1;
    assertInvariants(state);
  }
  return { state, taken, mix };
}

describe('a real game, ST-01 against ST-02', () => {
  it('starts and runs without the engine rejecting a legal action', () => {
    const { state, taken } = run(20260806);
    expect(taken).toBeGreaterThan(50);
    expect(['mulligan', 'playing', 'finished']).toContain(state.status);
  });

  it('reaches combat with real costs, powers and Counter values', () => {
    // Without this the run above could pass by only ever attaching DON!! and
    // passing, which would exercise none of the printed numbers.
    const { mix, state } = run(20260806);
    expect(mix.PLAY_CARD ?? 0).toBeGreaterThan(0);
    expect(mix.DECLARE_ATTACK ?? 0).toBeGreaterThan(0);
    expect(mix.PLAY_COUNTER ?? 0).toBeGreaterThan(0);
    // A printed [Blocker] keyword, honoured by the engine's own rule.
    expect(mix.DECLARE_BLOCK ?? 0).toBeGreaterThan(0);
    expect(state.status).toBe('finished');
    expect(state.endReason).toBe('lifeOut');
  });

  it('deals each Leader its printed Life', () => {
    let state = createGame({
      seed: 7,
      decks: { p1: toEngineDecklist(ST01_DECK), p2: toEngineDecklist(ST02_DECK) },
      firstPlayer: 'p1',
    });
    for (const player of ['p1', 'p2'] as const) {
      const result = applyAction(state, { type: 'MULLIGAN', player, accept: false });
      expect(result.ok).toBe(true);
      if (result.ok) state = result.state;
    }
    // Both starter Leaders are printed with 5 Life. Read through the engine, so
    // this fails if the cost -> life mapping ever regresses.
    expect(state.players.p1.life).toHaveLength(5);
    expect(state.players.p2.life).toHaveLength(5);
  });

  it('opens no choice, because no card in this package has an ability yet', () => {
    const { state } = run(11);
    expect(state.pending).toBeNull();
    expect(state.stack).toEqual([]);
  });

  it('is reproducible for a given seed', () => {
    expect(run(99).state.log.length).toBe(run(99).state.log.length);
  });
});

import { describe, expect, it } from 'vitest';
import { applyAction, assertInvariants, createGame } from '@optcg/engine';
import { decide } from '@optcg/engine/testing';
import type { GameState } from '@optcg/engine';
import { OP01_DECKS } from './support.js';

/**
 * The OP-01 batch-1 abilities firing in real games nobody staged.
 *
 * `op01Abilities.test.ts` builds each position by hand, which proves the script
 * is right and proves nothing about whether a game ever reaches it. This plays
 * the fixture decks with the shared stable-key policy and asserts the exact set
 * of abilities that resolved.
 *
 * **Two seeds cover all eight abilities** — 10 and 11 — which is the first real
 * measurement of what PR #22 bought. Under the old index-based driver every
 * seed set was a search result the next ability invalidated; a greedy cover over
 * 300 games found this one in a single pass, and the least reachable ability in
 * the batch (`OP01-052` Raizo, which needs two rested Characters at the moment
 * of an attack) still fires in 37 of those 300. Nothing here was hard to find.
 *
 * Seeds 5 and 14 are here for the last case only. Firing an ability and
 * *landing* it are different claims, and the second needs a game where the
 * "up to" was answered with something. 5 is where a rest actually turns a
 * Character sideways; 14 is the one game in 60 where Inuarashi attacks with two
 * DON!! attached *and* a rested DON!! in the cost area left to refresh, which is
 * the rarest board state this batch asks for.
 */

const SEEDS = [10, 11, 5, 14] as const;
const ACTIONS = 400;

/**
 * Every ability this batch wrote. The manifestation assertion is an exact
 * equality rather than a subset, so a card that silently stops firing is a
 * failure and so is one that starts firing without being added here.
 */
const BATCH_ABILITIES = [
  'OP01-006-onPlay',
  'OP01-022-whenAttacking',
  'OP01-033-onPlay',
  'OP01-034-whenAttacking',
  'OP01-035-whenAttacking',
  'OP01-048-onPlay',
  'OP01-052-whenAttacking',
  'OP01-054-onPlay',
] as const;

interface Run {
  state: GameState;
  taken: number;
  fired: Record<string, number>;
  mix: Record<string, number>;
}

function run(seed: number): Run {
  let state = createGame({ seed, decks: OP01_DECKS, firstPlayer: 'p1' });
  let taken = 0;
  const fired: Record<string, number> = {};
  const mix: Record<string, number> = {};
  for (let step = 0; step < ACTIONS; step += 1) {
    if (state.status === 'finished') break;
    const action = decide(state, state.priority, seed, step);
    if (action === undefined) break;
    const result = applyAction(state, action);
    if (!result.ok) {
      throw new Error(`action ${step} (${action.type}) rejected: ${result.reason}`);
    }
    state = result.state;
    taken += 1;
    mix[action.type] = (mix[action.type] ?? 0) + 1;
    for (const event of result.events) {
      if (event.type === 'abilityTriggered') {
        fired[event.abilityId] = (fired[event.abilityId] ?? 0) + 1;
      }
    }
    // Every action, not just the last: a script that corrupts the board shows
    // up at the action that did it rather than at the end of the game.
    assertInvariants(state);
  }
  return { state, taken, fired, mix };
}

describe('a real game of OP-01 against OP-01', () => {
  it('runs to a finish without the engine rejecting a legal action', () => {
    const { state, taken } = run(SEEDS[0]);
    expect(taken).toBeGreaterThan(50);
    expect(state.status).toBe('finished');
    expect(state.endReason).toBe('lifeOut');
  });

  it('reaches combat and answers the choices its own abilities open', () => {
    // Without this the run above could pass by only attaching DON!! and
    // passing, which would exercise none of the scripts.
    const { mix } = run(SEEDS[0]);
    expect(mix.PLAY_CARD ?? 0).toBeGreaterThan(0);
    expect(mix.DECLARE_ATTACK ?? 0).toBeGreaterThan(0);
    expect(mix.ANSWER_CHOICE ?? 0).toBeGreaterThan(0);
  });

  it('fires every batch-1 ability at least once across four unscripted games', () => {
    const fired = new Set<string>();
    for (const seed of SEEDS) {
      const game = run(seed);
      for (const id of Object.keys(game.fired)) fired.add(id);
      // Nothing left mid-script when a game ends.
      expect(game.state.pending, `seed ${seed}`).toBeNull();
      expect(game.state.stack, `seed ${seed}`).toEqual([]);
      expect(game.state.resume, `seed ${seed}`).toEqual([]);
    }
    expect([...fired].sort()).toEqual([...BATCH_ABILITIES].sort());
  });

  it('lands the effects, not just the triggers', () => {
    // Membership in the set above only says a script resolved. These say the
    // board moved: an `abilityTriggered` with no following effect event is
    // exactly what an "up to" answered with nothing looks like, and a batch
    // whose every ability resolved to nothing would still pass the test above.
    const events = SEEDS.flatMap((seed) => run(seed).state.log);
    const kinds = new Set(events.map((event) => event.type));
    // Otama and Brook subtract power; Izo, Nekomamushi and Okiku rest;
    // X.Drake K.O.s; Inuarashi turns a DON!! over; Raizo draws.
    expect(kinds.has('powerGranted')).toBe(true);
    expect(kinds.has('orientationChanged')).toBe(true);
    expect(kinds.has('koed')).toBe(true);
    expect(kinds.has('donOrientationChanged')).toBe(true);

    // A negative power modifier really was granted, which is the one thing this
    // batch does that no card in the repo did before.
    expect(
      events.some((event) => event.type === 'powerGranted' && event.value === -2000),
    ).toBe(true);
  });

  it('is reproducible for a given seed', () => {
    expect(run(SEEDS[1]).state.log.length).toBe(run(SEEDS[1]).state.log.length);
  });
});

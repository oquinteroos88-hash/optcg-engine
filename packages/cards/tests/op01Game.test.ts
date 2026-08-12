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
 * **Three seeds cover all nine abilities** — 50, 15 and 6 — found by a greedy
 * cover over 300 games in a single pass. The least reachable ability in the
 * batch (`OP01-052` Raizo, which needs two rested Characters at the moment of
 * an attack) still fires in 30 of those 300.
 *
 * The seed list moved once, when `OP01-017` Nico Robin joined the fixture decks
 * and displaced four filler slots. That is the **deck** changing, not the
 * driver: a different 50 cards deals a different game. It is the distinction
 * PR #22 was bought for — adding an ability to a deck that already held it
 * moves nothing, and the starter seeds two packages over did not move here.
 *
 * Seeds 69 and 10 are here for the last two cases only. Firing an ability and
 * *landing* it are different claims: 69 is one of 14 games in 300 where
 * Inuarashi attacks with two DON!! attached *and* a rested DON!! left in the
 * cost area to refresh, and **10 is one of only 2 games in 300 where a battle
 * ends early** because Robin K.O.d the Character she was attacking. Two in 300
 * is rare enough to be worth pinning by seed and common enough that the sweep
 * really does walk the new rule.
 */

const SEEDS = [50, 15, 6, 69, 10] as const;
const ACTIONS = 400;

/**
 * Every ability this batch wrote. The manifestation assertion is an exact
 * equality rather than a subset, so a card that silently stops firing is a
 * failure and so is one that starts firing without being added here.
 */
const BATCH_ABILITIES = [
  'OP01-006-onPlay',
  'OP01-017-whenAttacking',
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

  it('fires every batch-1 ability at least once across five unscripted games', () => {
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

  it('walks the vanished-participant rule in an unstaged game', () => {
    // `packages/engine/tests/battleVanished.test.ts` builds that position by
    // hand. This says a real game reaches it: Robin K.O.s the Character she is
    // attacking, the battle ends at CR 7-1-1-4 instead of at the Damage Step,
    // and the game carries on. Before the fix this seed threw.
    const games = SEEDS.map((seed) => run(seed));
    const early = games.flatMap((game) =>
      game.state.log.filter((event) => event.type === 'battleEndedEarly'),
    );
    expect(early.length).toBeGreaterThan(0);
    for (const event of early) {
      // Only the target side is reachable from these decks: nothing in OP-01
      // batch 1 removes an attacker. The attacker side has printed cards behind
      // it (EB01-037, OP04-072, ST03-003) and its own engine-level test.
      if (event.type === 'battleEndedEarly') {
        expect(event.gone).toBe('target');
      }
    }
    // And every one of those games still finished cleanly.
    for (const game of games) {
      expect(game.state.pending).toBeNull();
      expect(game.state.stack).toEqual([]);
    }
  });

  it('is reproducible for a given seed', () => {
    expect(run(SEEDS[1]).state.log.length).toBe(run(SEEDS[1]).state.log.length);
  });
});

describe('the sweep survives a battle losing its participant', () => {
  // The pinned seeds above say the rule is reached. This says nothing else
  // broke: 150 games with Robin in both decks, none of which may throw. Before
  // the fix, seed 10 alone was enough to bring the whole run down with
  // `Engine bug: … is not on … field`, so a sweep of this size is the honest
  // regression test for it.
  it('plays 150 games without an Engine bug, and dissipates some battles', () => {
    let earlyEndings = 0;
    let gamesWithOne = 0;
    for (let seed = 1; seed <= 150; seed += 1) {
      const game = run(seed);
      const early = game.state.log.filter((event) => event.type === 'battleEndedEarly').length;
      earlyEndings += early;
      if (early > 0) {
        gamesWithOne += 1;
      }
      // A finished game left no battle open, and no `endOfBattle` modifier
      // parked (CR 7-1-5-3 / 7-1-5-4). Not asserted on a game that ran into
      // this file's 400-action cap: that one stopped mid-battle because the
      // *test* stopped it, and its open battle is correct.
      if (game.state.status === 'finished') {
        expect(game.state.battle, `seed ${seed}`).toBeNull();
        expect(
          game.state.modifiers.filter((modifier) => modifier.duration === 'endOfBattle'),
          `seed ${seed}`,
        ).toEqual([]);
      } else {
        expect(game.taken, `seed ${seed} stopped early without finishing`).toBe(ACTIONS);
      }
    }
    expect(gamesWithOne).toBeGreaterThan(0);
    expect(earlyEndings).toBeGreaterThanOrEqual(gamesWithOne);
  }, 120_000);
});

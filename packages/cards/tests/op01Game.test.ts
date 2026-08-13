import { describe, expect, it } from 'vitest';
import { applyAction, assertInvariants, createGame, getPower, getPowerWithoutStatics } from '@optcg/engine';
import { decide } from '@optcg/engine/testing';
import type { GameState } from '@optcg/engine';
import { OP01_DECKS, OP01_ODEN_DECKS, OP01_ZORO_DECKS } from './support.js';

/**
 * The OP-01 batch-1 abilities firing in real games nobody staged.
 *
 * `op01Abilities.test.ts` builds each position by hand, which proves the script
 * is right and proves nothing about whether a game ever reaches it. This plays
 * the fixture decks with the shared stable-key policy and asserts the exact set
 * of abilities that resolved.
 *
 * **Four seeds cover every ability a real game can reach** — 54, 176, 286 and 9
 * — found by a greedy cover over 300 games in a single pass. Three more are
 * pinned for things a cover cannot express: 139 for Ashura Doji's static, which
 * fires no event and has to be read off the board; 158 for a battle that
 * actually ends early; 1 for a DON!! that actually turns over.
 *
 * Two abilities are genuinely rare here and worth naming so nobody widens the
 * set casually. `OP01-039` Killer's [On Block] wants a DON!! attached, a board
 * of three, and the driver choosing to block — 2 games in 500. Ashura Doji's
 * static wants a DON!! attached *and* two rested opponents at the same instant —
 * also 2 in 500. Both are real, both were found by search, and neither is
 * forced by a staged position.
 *
 * This file is the **red/green** corpus. Batch 3's blue and purple cards have
 * their own, in `op01BpGame.test.ts`, because a deck may only hold cards that
 * share a colour with its Leader.
 *
 * The seed list moves whenever the **decks** move — Robin joining in batch 1,
 * the Events joining in batch 2 — and that is not the driver drifting. A
 * different 50 cards deals a different game. The distinction PR #22 bought is
 * the other one: adding an ability to a deck that already held the card moves
 * nothing, and the starter seeds two packages over have never moved.
 */

const SEEDS = [199, 6, 70, 19, 42, 98, 117, 153, 292, 15] as const;
const ACTIONS = 400;

/**
 * Every ability a random game of these decks actually reaches, asserted as an
 * exact set: a card that silently stops firing fails here, and so does one that
 * starts firing without being listed.
 */
const BATCH_ABILITIES = [
  // Batch 3 — the two activated abilities, which are red/green.
  'OP01-003-main',
  'OP01-020-main',
  // Batch 1 — Characters.
  'OP01-006-onPlay',
  'OP01-007-onKO',
  'OP01-017-whenAttacking',
  'OP01-022-whenAttacking',
  'OP01-033-onPlay',
  'OP01-034-whenAttacking',
  'OP01-035-whenAttacking',
  'OP01-039-onBlock',
  'OP01-048-onPlay',
  'OP01-052-whenAttacking',
  'OP01-054-onPlay',
  // Batch 2 — the [Main] halves, and every [Trigger] half, from real damage.
  'OP01-026-counter',
  'OP01-026-trigger',
  'OP01-027-main',
  'OP01-028-counter',
  'OP01-028-trigger',
  'OP01-029-counter',
  'OP01-029-trigger',
  'OP01-056-main',
  'OP01-057-counter',
  'OP01-057-trigger',
  'OP01-058-counter',
  'OP01-058-trigger',
  // Batch 6 — the two red cards that put cards on the field.
  'OP01-009-trigger',
  'OP01-014-onBlock',
  // Batch 4 — `OP01-007` and `OP01-039` are here; `OP01-001` and `OP01-032` are
  // not and never can be. A `static` is **read**, never fired, so it emits no
  // `abilityTriggered` and cannot belong to a set of ability ids. Both are
  // affirmed the way the starter statics are: by catching the power they add on
  // a real board, below.
] as const;

/**
 * **Nothing is unreachable here any more.**
 *
 * Batches 2 and 3 shipped with all five `[Counter]` halves on an UNOBSERVED
 * list, and the reasoning was right: `PLAY_COUNTER_EVENT` is offered only when
 * the defender's **active** cost-area DON!! covers the printed cost
 * (CR 7-1-3-2-2), DON!! return to active only in their own Refresh Phase
 * (CR 6-2), and the driver attached every last one before ending its turn. Over
 * 7,921 Counter Steps the move was offered **zero** times.
 *
 * That was the policy, not the decks — which is why no fixture was ever bent
 * trying to fix it. The policy now declines to attach on 1 decision in 3
 * (`HOLD_DON_EVERY`), and every one of the five fires in ordinary play: 1 game
 * in 300 for `-026`, 5 for `-028`, 4 for `-029`, 1 for `-057`, 2 for `-058`.
 *
 * Kept as an empty constant rather than deleted, so the shape and the reasoning
 * are in front of the next reader who needs one.
 */
const UNREACHED_BY_RANDOM_PLAY: readonly string[] = [];

/** Did this card id end up above its without-statics power anywhere on the board? */
function sawStatic(state: GameState, cardId: string): boolean {
  for (const player of ['p1', 'p2'] as const) {
    for (const id of state.players[player].characters) {
      if (
        state.cards[id]?.cardId === cardId &&
        getPower(state, id) > getPowerWithoutStatics(state, id)
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Zoro buffs others, so it is read on the Characters of whoever leads with it. */
function zoroStaticIsLive(state: GameState): boolean {
  for (const player of ['p1', 'p2'] as const) {
    if (state.cards[state.players[player].leader]?.cardId !== 'OP01-001') continue;
    for (const id of state.players[player].characters) {
      if (getPower(state, id) > getPowerWithoutStatics(state, id)) return true;
    }
  }
  return false;
}

interface Run {
  state: GameState;
  taken: number;
  fired: Record<string, number>;
  mix: Record<string, number>;
  statics: Set<string>;
}

function run(seed: number): Run {
  let state = createGame({ seed, decks: OP01_DECKS, firstPlayer: 'p1' });
  let taken = 0;
  const fired: Record<string, number> = {};
  const mix: Record<string, number> = {};
  const statics = new Set<string>();
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
    if (sawStatic(state, 'OP01-032')) statics.add('OP01-032');
    // Every action, not just the last: a script that corrupts the board shows
    // up at the action that did it rather than at the end of the game.
    assertInvariants(state);
  }
  return { state, taken, fired, mix, statics };
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

  it('fires every reachable red/green ability across seven unscripted games', () => {
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

  it('manifests both batch-4 statics on a real board', () => {
    // A `static` has no event, so "did it happen" is a board reading: power
    // above the without-statics value, on the card the ability names.
    //
    // `OP01-032` Ashura Doji buffs **itself** and shows up in this corpus.
    // `OP01-001` Roronoa Zoro is a **Leader** and can only be live in a game it
    // is leading, so it needs its own deck — the mono-red fixture, below.
    const doji = SEEDS.some((seed) => run(seed).statics.has('OP01-032'));
    expect(doji).toBe(true);
  });

  it('manifests the Zoro Leader static, in the one deck that can lead with it', () => {
    // The first fixture whose Leader has a written ability, and the first
    // `static` in the repo with a selector audience: it buffs every Character
    // its controller has, and none of its own source.
    const seen = [1, 2, 3].some((seed) => {
      let state = createGame({ seed, decks: OP01_ZORO_DECKS, firstPlayer: 'p1' });
      for (let step = 0; step < ACTIONS; step += 1) {
        if (state.status === 'finished') break;
        const action = decide(state, state.priority, seed, step);
        if (action === undefined) break;
        const result = applyAction(state, action);
        if (!result.ok) {
          throw new Error(`action ${step} (${action.type}) rejected: ${result.reason}`);
        }
        state = result.state;
        if (zoroStaticIsLive(state)) {
          return true;
        }
      }
      return false;
    });
    expect(seen).toBe(true);
  });

  it('activates the Oden Leader, and pays its filtered price from a real hand', () => {
    // The second Leader in this repo with a written ability, and the first whose
    // price the player has to *choose*: "trash 1 {Land of Wano} type card from
    // your hand". `canPayCosts` counts matching cards, so it fires only in games
    // whose hand really holds the type — which is what the mono-green fixture is
    // built to guarantee and what this asserts rather than assumes.
    //
    // `OP01-059` BE-BENG!! pays the same price out of the same pool, so both of
    // this batch's green cards are measured here and not in the red/green pair.
    // Keeping them out of that pair is deliberate: putting BE-BENG!! into the Law
    // deck cost three 4000-power bodies, and with them the only route a random
    // red/green game had to the *attacker* side of CR 7-1-1-4.
    const ODEN_SEEDS = [177, 146, 178, 119];
    const fired = new Set<string>();
    for (const seed of ODEN_SEEDS) {
      let state = createGame({ seed, decks: OP01_ODEN_DECKS, firstPlayer: 'p1' });
      for (let step = 0; step < ACTIONS; step += 1) {
        if (state.status === 'finished') break;
        const action = decide(state, state.priority, seed, step);
        if (action === undefined) break;
        const result = applyAction(state, action);
        if (!result.ok) {
          throw new Error(`action ${step} (${action.type}) rejected: ${result.reason}`);
        }
        state = result.state;
        for (const event of result.events) {
          if (event.type === 'abilityTriggered') fired.add(event.abilityId);
        }
        assertInvariants(state);
      }
      expect(state.pending, `seed ${seed}`).toBeNull();
      expect(state.stack, `seed ${seed}`).toEqual([]);
      expect(state.resume, `seed ${seed}`).toEqual([]);
    }
    expect(fired.has('OP01-031-main')).toBe(true);
    expect(fired.has('OP01-059-main')).toBe(true);
  });

  it('reaches every [Trigger] half from real damage, not from a staged position', () => {
    // The sharper half of the claim above. A life card's [Trigger] resolves
    // inside the Damage Step, so reaching one means a game really attacked a
    // Leader, really won, and really turned that card over.
    const fired = new Set<string>();
    for (const seed of SEEDS) {
      for (const id of Object.keys(run(seed).fired)) fired.add(id);
    }
    for (const id of [
      'OP01-026-trigger',
      'OP01-028-trigger',
      'OP01-029-trigger',
      'OP01-057-trigger',
      'OP01-058-trigger',
    ]) {
      expect(fired, id).toContain(id);
    }
  });

  it('reaches every [Counter] half in ordinary play, and lists nothing as out of reach', () => {
    // The inverse of what batches 2 and 3 asserted. The absence was measured
    // and explained; the presence is measured the same way.
    const fired = new Set<string>();
    for (let seed = 1; seed <= 300; seed += 1) {
      for (const id of Object.keys(run(seed).fired)) fired.add(id);
    }
    for (const id of [
      'OP01-026-counter',
      'OP01-028-counter',
      'OP01-029-counter',
      'OP01-057-counter',
      'OP01-058-counter',
    ]) {
      expect(fired, id).toContain(id);
    }
    expect(UNREACHED_BY_RANDOM_PLAY).toEqual([]);
  }, 240_000);

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
    const sides = new Set<string>();
    for (const event of early) {
      if (event.type === 'battleEndedEarly') {
        // `both` would mean two participants left in one window, which nothing
        // printed can do yet — so the assertion is that each end names one side.
        expect(['attacker', 'target']).toContain(event.gone);
        sides.add(event.gone);
      }
    }
    // Batch 1 could only reach the **target** side, and said so: nothing it
    // wrote removed an attacker. `OP01-026` Red Hawk's [Counter] does — it K.O.s
    // an opponent Character with 4000 power or less, and the attacker is one —
    // and the DON!!-holding bias is what finally lets a random game pay for it.
    // So the attacker side of CR 7-1-1-4 is now walked by a printed card in
    // ordinary play, not only by the engine's synthetic test.
    expect(sides.has('attacker')).toBe(true);
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
  // broke: 200 games with Robin in both decks, none of which may throw. The
  // range grew with the decks — an early end is rare (1 game in 300 now that
  // batch 2 and 3 diluted the Characters), so the sweep has to be wide enough
  // to contain one. Before
  // the fix, seed 10 alone was enough to bring the whole run down with
  // `Engine bug: … is not on … field`, so a sweep of this size is the honest
  // regression test for it.
  it('plays 200 games without an Engine bug, and dissipates some battles', () => {
    let earlyEndings = 0;
    let gamesWithOne = 0;
    for (let seed = 1; seed <= 200; seed += 1) {
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

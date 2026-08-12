import { describe, expect, it } from 'vitest';
import { applyAction, assertInvariants, createGame, hasKeyword } from '@optcg/engine';
import { decide } from '@optcg/engine/testing';
import type { GameState } from '@optcg/engine';
import { OP01_BP_DECKS } from './support.js';

/**
 * The batch-3 blue and purple abilities, in real games of the **first legal
 * blue/purple decks this project has been able to build**.
 *
 * That sentence is the point of the file. `OP01-070` Mihawk was deferred in
 * batch 1 and `-086`, `-089`, `-117` in batch 2, all four for the same reason:
 * OP-01's blue and purple pools held only nine cards whose printed text the
 * engine already honoured, and nine distinct cards is 36 of the 50 a deck
 * needs. The wall was never about rules. Batch 3 wrote thirteen blue/purple
 * cards, the pool reached 22 distinct, and the deferred four walked in with the
 * rest — see `fixtures/op01Decks.ts` for the arithmetic.
 *
 * **Four seeds cover every ability a random game reaches** — 28, 153, 105 and
 * 5 — from a greedy cover over 300 games. Seeds 55 and 21 are added for the two
 * "did it land" cases.
 */

const SEEDS = [28, 153, 105, 5, 55, 21] as const;
const ACTIONS = 400;

/** Every blue/purple ability a random game of these decks reaches. */
const BATCH_3_BP_ABILITIES = [
  'OP01-070-onPlay',
  'OP01-078-whenAttacking',
  'OP01-078-onBlock',
  'OP01-079-onKO',
  'OP01-080-onKO',
  'OP01-086-trigger',
  'OP01-094-onPlay',
  'OP01-096-onPlay',
  'OP01-097-onPlay',
  'OP01-108-onKO',
  'OP01-111-onBlock',
  'OP01-117-main',
] as const;

/**
 * The two blue `[Counter]` halves, unreachable for the reason
 * `op01Game.test.ts` measures at length: the shared driver policy attaches every
 * active DON!! before ending its turn, so a defender never has the active
 * cost-area DON!! that `PLAY_COUNTER_EVENT` needs (CR 7-1-3-2-2). Not a deck
 * problem and not fixable by a fixture. `op01Batch3.test.ts` stages both
 * directly, including `OP01-089` ending a battle by bouncing the attacker.
 */
const UNREACHED_BY_RANDOM_PLAY = ['OP01-086-counter', 'OP01-089-counter'] as const;

/**
 * `OP01-068` Gecko Moria is absent from both lists on purpose: a `static` is
 * **read**, never fired, so it emits no `abilityTriggered` and can never appear
 * in a set of ability ids. It is affirmed the way the starter statics are — by
 * catching the granted keyword on the board during a real game.
 */
function moriaIsLive(state: GameState): boolean {
  for (const player of ['p1', 'p2'] as const) {
    for (const id of state.players[player].characters) {
      if (state.cards[id]?.cardId === 'OP01-068' && hasKeyword(state, id, 'doubleAttack')) {
        return true;
      }
    }
  }
  return false;
}

interface Run {
  state: GameState;
  taken: number;
  fired: Record<string, number>;
  mix: Record<string, number>;
  moriaSeen: boolean;
}

function run(seed: number): Run {
  let state = createGame({ seed, decks: OP01_BP_DECKS, firstPlayer: 'p1' });
  let taken = 0;
  let moriaSeen = false;
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
    moriaSeen ||= moriaIsLive(state);
    assertInvariants(state);
  }
  return { state, taken, fired, mix, moriaSeen };
}

describe('a real game of OP-01 blue/purple', () => {
  it('runs a whole game of decks that could not legally exist two batches ago', () => {
    const { state, taken } = run(SEEDS[0]);
    expect(taken).toBeGreaterThan(50);
    expect(state.status).toBe('finished');
    expect(state.pending).toBeNull();
    expect(state.stack).toEqual([]);
  });

  it('reaches combat and answers the choices its own abilities open', () => {
    const { mix } = run(SEEDS[0]);
    expect(mix.PLAY_CARD ?? 0).toBeGreaterThan(0);
    expect(mix.DECLARE_ATTACK ?? 0).toBeGreaterThan(0);
    expect(mix.ANSWER_CHOICE ?? 0).toBeGreaterThan(0);
  });

  it('fires every reachable blue/purple ability across six unscripted games', () => {
    const fired = new Set<string>();
    for (const seed of SEEDS) {
      const game = run(seed);
      for (const id of Object.keys(game.fired)) fired.add(id);
      expect(game.state.pending, `seed ${seed}`).toBeNull();
      expect(game.state.stack, `seed ${seed}`).toEqual([]);
      expect(game.state.resume, `seed ${seed}`).toEqual([]);
    }
    expect([...fired].sort()).toEqual([...BATCH_3_BP_ABILITIES].sort());
  });

  it('manifests the Gecko Moria static on a real board', () => {
    // Not "fired" — read. The keyword is on the card because the hand is wide
    // and it is that player's turn, and nothing was written to the state to put
    // it there.
    expect(SEEDS.some((seed) => run(seed).moriaSeen)).toBe(true);
  });

  it('lands the effects, not just the triggers', () => {
    const events = SEEDS.flatMap((seed) => run(seed).state.log);
    const kinds = new Set(events.map((event) => event.type));
    // Kaido, King and Kamazo K.O.; Sheep's Horn rests; Black Maria and Queen
    // move power; Mihawk and Overheat move cards between zones.
    expect(kinds.has('koed')).toBe(true);
    expect(kinds.has('orientationChanged')).toBe(true);
    expect(kinds.has('powerGranted')).toBe(true);
    // The DON!! −N cost really was paid, which is what separates these cards
    // from the ones that only look like them.
    expect(kinds.has('donReturnedToDeck')).toBe(true);
  });

  it('does not reach the [Counter] halves, and says so on purpose', () => {
    const fired = new Set<string>();
    for (let seed = 1; seed <= 60; seed += 1) {
      for (const id of Object.keys(run(seed).fired)) fired.add(id);
    }
    for (const id of UNREACHED_BY_RANDOM_PLAY) {
      expect(fired, `${id} became reachable — update the list and its reasoning`).not.toContain(id);
    }
    // Not vacuous: the same sweep reaches Overheat's other half.
    expect(fired.has('OP01-086-trigger')).toBe(true);
  }, 120_000);

  it('is reproducible for a given seed', () => {
    expect(run(SEEDS[1]).state.log.length).toBe(run(SEEDS[1]).state.log.length);
  });
});

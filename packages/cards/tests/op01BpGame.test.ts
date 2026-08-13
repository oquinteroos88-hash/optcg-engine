import { describe, expect, it } from 'vitest';
import { applyAction, assertInvariants, createGame, hasKeyword } from '@optcg/engine';
import { decide } from '@optcg/engine/testing';
import type { GameState } from '@optcg/engine';
import { OP01_BP_DECKS, OP01_DOFFY_DECKS } from './support.js';

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
 * **Six seeds cover every ability a random game reaches** — 54, 5, 44, 29, 45
 * and 88 — from a greedy cover over 300 games, and that now includes both
 * `[Counter]` halves, which batch 3 had to list as out of reach. Seed 2 is added
 * for the one "did it land" case a cover cannot express: a Character actually
 * turning sideways.
 */

const SEEDS = [249, 23, 63, 131, 24, 197, 92] as const;
const ACTIONS = 400;

/** Every blue/purple ability a random game of these decks reaches. */
const BATCH_3_BP_ABILITIES = [
  'OP01-070-onPlay',
  'OP01-078-whenAttacking',
  'OP01-078-onBlock',
  'OP01-079-onKO',
  'OP01-080-onKO',
  'OP01-086-counter',
  'OP01-086-trigger',
  'OP01-089-counter',
  'OP01-094-onPlay',
  'OP01-096-onPlay',
  'OP01-097-onPlay',
  'OP01-108-onKO',
  'OP01-111-onBlock',
  'OP01-117-main',
  // Batch 5 — the chosen discard, on the one blue card that pays one.
  'OP01-064-whenAttacking',
  // Batch 6 — the blue and purple cards that put cards on the field.
  'OP01-082-trigger',
  'OP01-087-counter',
  'OP01-087-trigger',
  'OP01-104-trigger',
  // Batch 8 - the permission bought with a DON!! handed back. Franky's static
  // twin, written by a script instead of read off the board.
  'OP01-112-main',
  // Batch 9 - looks at five, plays a {SMILE} out of them, buries the rest.
  // Both halves: the [Trigger] points at the [Main] and shares its list, so a
  // real game reaching it means real damage turned the Event over in the Life
  // area and the player took the [Trigger] instead of the card.
  'OP01-116-main',
  'OP01-116-trigger',
  // Batch 7 — the Leader that has been dealing these games since batch 3 with
  // its printed ability doing nothing. It fires in 183 games of 300.
  'OP01-062-onOwnEvent',
] as const;

/**
 * **Nothing is unreachable here any more.**
 *
 * Batch 3 shipped with `OP01-086-counter` and `OP01-089-counter` on an
 * UNOBSERVED list, because the driver attached every active DON!! before ending
 * its turn and a defender therefore could never pay for a `[Counter]` Event
 * (CR 7-1-3-2-2 against CR 6-2). That was a policy problem, not a deck one, and
 * the policy now declines to attach on 1 decision in 3 — see `HOLD_DON_EVERY`.
 *
 * Both halves fire in ordinary play now: `-086` in 7 games of 300, `-089` in 4.
 * The list is kept as an empty constant rather than deleted, so the next reader
 * who needs one has the shape and the reasoning in front of them.
 */
const UNREACHED_BY_RANDOM_PLAY: readonly string[] = [];

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

  it('fires every reachable blue/purple ability across seven unscripted games', () => {
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

  it('reaches both [Counter] halves in ordinary play, and lists nothing as out of reach', () => {
    // The inverse of the assertion this file shipped with. Batch 3 asserted
    // these two could *not* be reached and said why; the DON!!-holding bias
    // makes them reachable, so the assertion flips rather than disappearing.
    const fired = new Set<string>();
    for (let seed = 1; seed <= 120; seed += 1) {
      for (const id of Object.keys(run(seed).fired)) fired.add(id);
    }
    expect(fired.has('OP01-086-counter')).toBe(true);
    expect(fired.has('OP01-089-counter')).toBe(true);
    expect(UNREACHED_BY_RANDOM_PLAY).toEqual([]);
  }, 180_000);

  it('reveals and plays from the deck, in the one game Doflamingo can lead', () => {
    // The only card in the repo that plays from somewhere other than the hand,
    // and the only one that plays a card **rested** — CR 3-7-5's "unless
    // otherwise specified". It needs its own deck for the reason every Leader
    // ability does, and a *stocked* one for a reason no other Leader has: the
    // effect only fires on what the top card happens to be, so the fixture
    // carries eight {The Seven Warlords of the Sea} 4-drops to make the branch
    // reachable at all.
    //
    // OP01-071's two halves come along, because Doflamingo's is the only blue
    // deck that holds it at four copies: the [Trigger] plays it, and the
    // [On Play] it wakes then bottom-decks something.
    // 9 joined for batch 9: OP01-084 looks at five and buries the rest, and
    // this is the blue deck that holds the {Baroque Works} Events its search is
    // for. Its [DON!! x1] [When Attacking] gate is what makes it rare enough to
    // need a seed of its own.
    const DOFFY_SEEDS = [42, 1, 18, 88, 25, 9];
    const fired = new Set<string>();
    let restedArrivals = 0;
    for (const seed of DOFFY_SEEDS) {
      let state = createGame({ seed, decks: OP01_DOFFY_DECKS, firstPlayer: 'p1' });
      for (let step = 0; step < ACTIONS; step += 1) {
        if (state.status === 'finished') break;
        const action = decide(state, state.priority, seed, step);
        if (action === undefined) break;
        const result = applyAction(state, action);
        if (!result.ok) {
          throw new Error(`action ${step} (${action.type}) rejected: ${result.reason}`);
        }
        for (const event of result.events) {
          if (event.type === 'abilityTriggered') fired.add(event.abilityId);
        }
        state = result.state;
        for (const id of state.players.p1.characters) {
          const card = state.cards[id];
          if (card?.orientation === 'rested' && card.playedOnTurn === state.turn) {
            restedArrivals += 1;
          }
        }
        assertInvariants(state);
      }
      expect(state.pending, `seed ${seed}`).toBeNull();
      expect(state.stack, `seed ${seed}`).toEqual([]);
      expect(state.resume, `seed ${seed}`).toEqual([]);
    }
    expect(fired.has('OP01-060-whenAttacking')).toBe(true);
    expect(fired.has('OP01-071-trigger')).toBe(true);
    expect(fired.has('OP01-071-onPlay')).toBe(true);
    expect(fired.has('OP01-084-whenAttacking')).toBe(true);
    // And at least one of those arrivals really came down sideways.
    expect(restedArrivals).toBeGreaterThan(0);
  });

  it('is reproducible for a given seed', () => {
    expect(run(SEEDS[1]).state.log.length).toBe(run(SEEDS[1]).state.log.length);
  });
});

import { describe, expect, it } from 'vitest';
import {
  applyAction,
  assertInvariants,
  createGame,
  getPower,
  getPowerWithoutStatics,
  hasKeyword,
} from '@optcg/engine';
import { decide } from '@optcg/engine/testing';
import type { Action, GameState, PlayerId } from '@optcg/engine';
import { registerEnglishCards, ST01_DECK, ST02_DECK, toEngineDecklist } from '../src/index.js';

registerEnglishCards();

const ACTIONS = 400;

/**
 * The driver is `@optcg/engine/testing`'s shared policy — `decide` — rather
 * than a local one.
 *
 * It used to be a local LCG over the *index* into `legalActions`, and the cost
 * of that is written into this file's own history: seed 107 died the day
 * `ST01-017` gained an activatable ability, because a new action displaces
 * every action after it and every later decision in every game moves. The
 * policy now scores each action by a hash of its content, so an ability the
 * driver does not pick changes nothing.
 *
 * What matters here is unchanged: real printed costs, powers, Counter values
 * and Life totals surviving a real game, and the scripted effects firing and
 * resolving inside one.
 */

interface Run {
  state: GameState;
  taken: number;
  mix: Record<string, number>;
  /** Ability ids that resolved, with how many times each did. */
  fired: Record<string, number>;
  /**
   * Card ids of `static` abilities seen actually contributing during the game.
   * Continuous effects never emit an `abilityTriggered` event — they are read,
   * not fired — so "did it manifest" is a board reading, not an event count: a
   * power static shows up as getPower above the without-statics value, a keyword
   * static as a granted keyword the card does not print.
   */
  manifested: Set<string>;
}

/** Records any of the three self-targeting statics currently in effect. */
function recordManifestedStatics(state: GameState, into: Set<string>): void {
  for (const player of ['p1', 'p2'] as const) {
    const ps = state.players[player];
    for (const id of [ps.leader, ...ps.characters]) {
      const card = state.cards[id];
      if (card === undefined) continue;
      // ST-01/02 carry no foreign statics, so a card above its without-statics
      // power can only be lifting itself.
      if (
        (card.cardId === 'ST01-013' || card.cardId === 'ST02-003') &&
        getPower(state, id) > getPowerWithoutStatics(state, id)
      ) {
        into.add(card.cardId);
      }
      // Sanji prints no Rush, so a granted Rush is the static.
      if (card.cardId === 'ST01-004' && hasKeyword(state, id, 'rush')) {
        into.add(card.cardId);
      }
    }
  }
}

function run(seed: number): Run {
  let state = createGame({
    seed,
    decks: { p1: toEngineDecklist(ST01_DECK), p2: toEngineDecklist(ST02_DECK) },
    firstPlayer: 'p1',
  });

  let taken = 0;
  const mix: Record<string, number> = {};
  const fired: Record<string, number> = {};
  const manifested = new Set<string>();
  for (let step = 0; step < ACTIONS; step += 1) {
    if (state.status === 'finished') break;
    const player: PlayerId = state.priority;
    const action: Action | undefined = decide(state, player, seed, step);
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
    recordManifestedStatics(state, manifested);
    assertInvariants(state);
  }
  return { state, taken, mix, fired, manifested };
}

describe('a real game, ST-01 against ST-02', () => {
  it('starts and runs without the engine rejecting a legal action', () => {
    const { state, taken } = run(82);
    expect(taken).toBeGreaterThan(50);
    expect(['mulligan', 'playing', 'finished']).toContain(state.status);
  });

  it('reaches combat with real costs, powers and Counter values', () => {
    // Without this the run above could pass by only ever attaching DON!! and
    // passing, which would exercise none of the printed numbers.
    const { mix, state } = run(82);
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

  it('fires and manifests each ability at least once across five unscripted games', () => {
    // Which abilities a single game reaches is a matter of what gets drawn, so
    // one seed covers only some of them. These five between them reach every
    // scripted ability and every static in a real game nobody staged.
    //
    // - **82** is the broad one and the seed the tests above also use: a full
    //   game ending on Life, and the largest single-seed coverage in the search.
    // - **465** and **160** complete the cover. 160 is the expensive one: it is
    //   1 of only 4 seeds in 600 that fire `ST02-016` Repel, still the hardest
    //   ability in these decks to reach unprompted, and it fires `ST02-015`
    //   Scalpel too — so it is this set's answer to what seed 224 used to be.
    // - **9** and **8** are pinned by the two tests below and are kept in the
    //   set so the file has one seed list rather than three.
    //
    // These seeds are a search result over a *fixed driver*, not a property of
    // the cards. What changed with this PR is what "fixed" costs: the driver now
    // chooses by a hash of each action's content rather than by its index into
    // `legalActions`, so an ability it does not pick cannot move any other
    // decision. Adding a card no longer re-runs this search — which is the whole
    // reason seed 107 died for `ST01-017` and seed 224 replaced it.
    const SEEDS = [82, 465, 160, 9, 8];
    const fired = new Set<string>();
    const manifested = new Set<string>();
    for (const seed of SEEDS) {
      const game = run(seed);
      for (const id of Object.keys(game.fired)) fired.add(id);
      for (const id of game.manifested) manifested.add(id);
      // Nothing left mid-script when a game ends.
      expect(game.state.pending, `seed ${seed}`).toBeNull();
      expect(game.state.stack, `seed ${seed}`).toEqual([]);
      expect(game.state.resume, `seed ${seed}`).toEqual([]);
    }

    expect([...fired].sort()).toEqual([
      'ST01-001-main',
      'ST01-005-whenAttacking',
      'ST01-007-main',
      'ST01-011-onPlay',
      'ST01-014-trigger',
      'ST01-015-main',
      'ST01-015-trigger',
      'ST01-017-main',
      'ST02-008-whenAttacking',
      'ST02-009-onPlay',
      'ST02-013-endOfTurn',
      'ST02-015-counter',
      'ST02-015-trigger',
      'ST02-016-counter',
    ]);
    // The three self-targeting statics have no event to fire; they are affirmed
    // by having been read off the board while in effect during a real game.
    expect([...manifested].sort()).toEqual(['ST01-004', 'ST01-013', 'ST02-003']);
  });

  it('rests Thousand Sunny to pay, and the +1000 lands, in an unstaged game', () => {
    // Membership in the set above only says the script resolved. This says the
    // board moved, which is the claim worth making about a cost that spends the
    // source: in seed 9's game the Stage really turned sideways to pay, and the
    // power really went somewhere.
    const game = run(9);
    expect(game.fired['ST01-017-main']).toBeGreaterThan(0);

    const at = game.state.log.findIndex(
      (event) => event.type === 'abilityTriggered' && event.abilityId === 'ST01-017-main',
    );
    expect(at).toBeGreaterThan(0);

    // The cost is paid before the ability announces itself (CR 8-4-1-3 before
    // 8-4-1-4), so the event immediately before is the Stage resting.
    const paid = game.state.log[at - 1];
    const announced = game.state.log[at];
    expect(paid?.type).toBe('orientationChanged');
    if (paid?.type === 'orientationChanged' && announced?.type === 'abilityTriggered') {
      expect(paid.orientation).toBe('rested');
      expect(paid.instanceId).toBe(announced.source);
      expect(game.state.cards[paid.instanceId]?.cardId).toBe('ST01-017');
    }

    // And inside this ability's own window — up to whatever fires next — a
    // +1000 that lasts the turn was granted.
    const nextAbility = game.state.log.findIndex(
      (event, index) => index > at && event.type === 'abilityTriggered',
    );
    const window = game.state.log.slice(at, nextAbility === -1 ? undefined : nextAbility);
    expect(
      window.some(
        (event) =>
          event.type === 'powerGranted' && event.value === 1000 && event.duration === 'endOfTurn',
      ),
    ).toBe(true);
  });

  it('reaches the [Trigger] half of an event from a life card', () => {
    // Seed 8 turns a Gum-Gum Jet Pistol over as damage. That is the path that
    // has an event resolving from the hand rather than from a Main-phase play,
    // and it is worth naming rather than leaving inside a union. (Seed 5 under
    // the old index-based driver; re-searched once when the policy changed.)
    expect(run(8).fired['ST01-015-trigger']).toBeGreaterThan(0);
  });

  it('answers every choice its own abilities open', () => {
    const { mix } = run(82);
    expect(mix.ANSWER_CHOICE ?? 0).toBeGreaterThan(0);
  });

  it('is reproducible for a given seed', () => {
    expect(run(99).state.log.length).toBe(run(99).state.log.length);
  });
});

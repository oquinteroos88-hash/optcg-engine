import { describe, expect, it } from 'vitest';
import { applyAction, assertInvariants, createGame, legalActions } from '@optcg/engine';
import type { Action, ChoiceAnswer, GameState, PendingChoice, PlayerId } from '@optcg/engine';
import { registerEnglishCards, ST01_DECK, ST02_DECK, toEngineDecklist } from '../src/index.js';

registerEnglishCards();

const ACTIONS = 400;

/**
 * A deterministic driver, deliberately not the engine's own bot: that one is
 * internal to the engine package. What matters here is that real printed costs,
 * powers, Counter values and Life totals survive a real game — and, now that
 * some of these cards have scripts, that their effects fire and resolve inside
 * one.
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

/**
 * A valid answer to whatever is being asked.
 *
 * `legalActions` only emits a marker for ANSWER_CHOICE — the shape of a legal
 * answer is data in `state.pending` — so a driver has to read it, exactly as
 * any real client does. Always takes the maximum allowed, which is what makes
 * the abilities visible: an "up to 1" answered with nothing fires but does
 * nothing, and the empty case has its own tests.
 */
function answerFor(pending: PendingChoice, step: number): ChoiceAnswer {
  switch (pending.kind) {
    case 'yesNo':
      return { kind: 'yesNo', value: true };
    case 'selectOption':
      return { kind: 'option', index: 0 };
    case 'selectCards':
    case 'orderCards': {
      const offset = ((step * 2654435761) >>> 8) % Math.max(pending.candidates.length, 1);
      const rotated = [...pending.candidates.slice(offset), ...pending.candidates.slice(0, offset)];
      return { kind: 'cards', selected: rotated.slice(0, pending.max) };
    }
  }
}

interface Run {
  state: GameState;
  taken: number;
  mix: Record<string, number>;
  /** Ability ids that resolved, with how many times each did. */
  fired: Record<string, number>;
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
  for (let step = 0; step < ACTIONS; step += 1) {
    if (state.status === 'finished') break;
    const player: PlayerId = state.priority;
    const pending = state.pending;
    const action: Action | undefined =
      pending !== null && pending.player === player
        ? {
            type: 'ANSWER_CHOICE',
            player,
            choiceId: pending.id,
            answer: answerFor(pending, step),
          }
        : pick(legalActions(state, player), step);
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
    assertInvariants(state);
  }
  return { state, taken, mix, fired };
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

  it('fires each ability at least once across four unscripted games', () => {
    // Which abilities a single game reaches is a matter of what gets drawn, so
    // one seed covers only some of them. These seeds between them reach every
    // scripted ability in a real game nobody staged — including both halves of
    // Gum-Gum Jet Pistol and all three DON!!-givers, which recycle rested DON!!
    // the bots spent attacking. Seed 2 is the one that draws and plays Brook;
    // the original three never reached its [On Play].
    const SEEDS = [20260806, 5, 99, 2];
    const fired = new Set<string>();
    for (const seed of SEEDS) {
      const game = run(seed);
      for (const id of Object.keys(game.fired)) fired.add(id);
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
      'ST02-009-onPlay',
      'ST02-013-endOfTurn',
    ]);
  });

  it('reaches the [Trigger] half of an event from a life card', () => {
    // Seed 5 turns a Gum-Gum Jet Pistol over as damage. That is the path that
    // has an event resolving from the hand rather than from a Main-phase play,
    // and it is worth naming rather than leaving inside a union.
    expect(run(5).fired['ST01-015-trigger']).toBeGreaterThan(0);
  });

  it('answers every choice its own abilities open', () => {
    const { mix } = run(20260806);
    expect(mix.ANSWER_CHOICE ?? 0).toBeGreaterThan(0);
  });

  it('is reproducible for a given seed', () => {
    expect(run(99).state.log.length).toBe(run(99).state.log.length);
  });
});

import { applyAction, createGame } from '@optcg/engine';
import { decide } from '@optcg/engine/testing';
import type { Action, GameEvent, GameState } from '@optcg/engine';
import { GREEN_DECK, RED_DECK } from '@optcg/engine/testdata/decks';
// The browser-safe entry, not the package root: the root loads 1.5 MB of JSON
// through `node:fs`, which the jsdom suites cannot resolve. Same cards.
import { registerStarterCards, starterDecklists, toEngineDecklist } from '@optcg/cards/starters';

/**
 * Seeded playouts for the affordance corpus, driven by the engine's shared
 * policy (`@optcg/engine/testing`) rather than by a local copy of it.
 *
 * Both playouts here used to carry their own picker — one mirroring the engine
 * bot, one mirroring `packages/cards/tests/game.test.ts` — and both chose by
 * **index** into `legalActions`, so a new legal action displaced every action
 * after it and moved every later decision of every game. `testing/policy.ts`
 * documents what that cost and how the hash-of-content key fixes it.
 *
 * The `AnswerPolicy` two-pass is gone with it. It existed because a driver that
 * always took `max` never produced the empty selection that "up to N" prints on
 * most of these cards, and a policy that alternated diverted every trajectory
 * instead. The shared policy takes `max` by default and explores the rest of the
 * range on 1 decision in 8, so a single pass now visits both ends — with the
 * exploration rate chosen by measuring how many seeds still reach the rarest
 * abilities, not by taste. See `cardinalityFor`.
 */

/** Every state visited, initial state included. */
export function playout(seed: number, maxSteps: number): GameState[] {
  let state = createGame({ seed, decks: { p1: RED_DECK, p2: GREEN_DECK }, firstPlayer: 'p1' });
  const states: GameState[] = [state];

  for (let step = 0; step < maxSteps; step += 1) {
    const action = decide(state, state.priority, seed, step);
    if (action === undefined) {
      break; // finished
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

function starterDecks(): { p1: ReturnType<typeof toEngineDecklist>; p2: ReturnType<typeof toEngineDecklist> } {
  const [st01, st02] = starterDecklists;
  if (st01 === undefined || st02 === undefined) {
    throw new Error('the starter entry publishes fewer than two decklists');
  }
  return { p1: toEngineDecklist(st01), p2: toEngineDecklist(st02) };
}

/** One move of a starter playout: the position, the action, what it emitted. */
export interface PlayoutStep {
  before: GameState;
  action: Action;
  events: readonly GameEvent[];
  after: GameState;
}

/**
 * The same playout over the real starter decks, which is where the actions the
 * TEST decks cannot produce live.
 *
 * The TEST set has no abilities at all, so a corpus built only from it can
 * never observe `ACTIVATE_ABILITY`, `ANSWER_CHOICE` or `PLAY_COUNTER_EVENT` —
 * and "every legal action is reachable from an affordance" quietly degraded
 * into "every legal action the TEST decks produce". That is how
 * `PLAY_COUNTER_EVENT` landed in the engine without the round-trip noticing.
 */
export function starterPlayoutSteps(seed: number, maxSteps: number): PlayoutStep[] {
  const steps: PlayoutStep[] = [];
  runStarter(seed, maxSteps, (step) => steps.push(step));
  return steps;
}

function runStarter(seed: number, maxSteps: number, onStep: (step: PlayoutStep) => void): void {
  registerStarterCards();
  let state = createGame({ seed, decks: starterDecks(), firstPlayer: 'p1' });

  for (let step = 0; step < maxSteps; step += 1) {
    if (state.status === 'finished') {
      break;
    }
    const action = decide(state, state.priority, seed, step);
    if (action === undefined) {
      break;
    }
    const result = applyAction(state, action);
    if (!result.ok) {
      throw new Error(`driver bug: legal action rejected (${action.type}: ${result.reason})`);
    }
    onStep({ before: state, action, events: result.events, after: result.state });
    state = result.state;
  }
}

export function starterPlayout(seed: number, maxSteps: number): GameState[] {
  registerStarterCards();
  const initial = createGame({ seed, decks: starterDecks(), firstPlayer: 'p1' });
  // Every state visited, initial included.
  const states: GameState[] = [initial];
  runStarter(seed, maxSteps, (step) => states.push(step.after));
  return states;
}

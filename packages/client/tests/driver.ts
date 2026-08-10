import { applyAction, createGame, legalActions, nextInt } from '@optcg/engine';
import type { Action, ChoiceAnswer, GameEvent, GameState, PendingChoice } from '@optcg/engine';
import { GREEN_DECK, RED_DECK } from '@optcg/engine/testdata/decks';
// The browser-safe entry, not the package root: the root loads 1.5 MB of JSON
// through `node:fs`, which the jsdom suites cannot resolve. Same cards.
import { registerStarterCards, starterDecklists, toEngineDecklist } from '@optcg/cards/starters';

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

/**
 * The same playout over the real starter decks, which is where the actions the
 * TEST decks cannot produce live.
 *
 * The TEST set has no abilities at all, so a corpus built only from it can
 * never observe `ACTIVATE_ABILITY`, `ANSWER_CHOICE` or `PLAY_COUNTER_EVENT` —
 * and "every legal action is reachable from an affordance" quietly degraded
 * into "every legal action the TEST decks produce". That is how
 * `PLAY_COUNTER_EVENT` landed in the engine without the round-trip noticing.
 *
 * The action picker is a plain LCG over the index, deliberately the same shape
 * as `packages/cards/tests/game.test.ts`: the seeds that reach the rarer
 * abilities were searched against that policy, so keeping it identical inherits
 * their coverage instead of re-running the search.
 */
function pick(actions: Action[], step: number): Action | undefined {
  const usable = actions.filter((action) => action.type !== 'CONCEDE');
  if (usable.length === 0) {
    return undefined;
  }
  const rest = usable.filter((action) => action.type !== 'END_TURN');
  const pool = rest.length > 0 ? rest : usable;
  return pool[((step * 1103515245 + 12345) >>> 8) % pool.length];
}

/**
 * How much of an offered selection the driver takes.
 *
 * `max` is the policy the seeds above were searched against, and it is what
 * makes an effect visible: an "up to 1" answered with nothing fires and does
 * nothing. `min` is the other half of the space — with `min: 0` that is a
 * confirmable empty selection, which "up to" prints on 15 of the 26 cards with
 * text in these decks. The corpus runs both, because the choice UI has to
 * survive both and the affordance round-trip has to see the states each
 * produces. They are separate playouts rather than one alternating policy so
 * that `max` reproduces the searched trajectories exactly.
 */
export type AnswerPolicy = 'max' | 'min';

/** A legal answer read out of `pending`, exactly as the UI has to build one. */
function answerFor(pending: PendingChoice, step: number, policy: AnswerPolicy): ChoiceAnswer {
  switch (pending.kind) {
    case 'yesNo':
      return { kind: 'yesNo', value: policy === 'max' };
    case 'selectOption':
      return { kind: 'option', index: 0 };
    case 'selectCards':
    case 'orderCards': {
      const take = policy === 'max' ? pending.max : pending.min;
      const offset = ((step * 2654435761) >>> 8) % Math.max(pending.candidates.length, 1);
      const rotated = [...pending.candidates.slice(offset), ...pending.candidates.slice(0, offset)];
      return { kind: 'cards', selected: rotated.slice(0, take) };
    }
  }
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

export function starterPlayoutSteps(
  seed: number,
  maxSteps: number,
  policy: AnswerPolicy = 'max',
): PlayoutStep[] {
  const steps: PlayoutStep[] = [];
  runStarter(seed, maxSteps, policy, (step) => steps.push(step));
  return steps;
}

function runStarter(
  seed: number,
  maxSteps: number,
  policy: AnswerPolicy,
  onStep: (step: PlayoutStep) => void,
): void {
  registerStarterCards();
  let state = createGame({ seed, decks: starterDecks(), firstPlayer: 'p1' });

  for (let step = 0; step < maxSteps; step += 1) {
    if (state.status === 'finished') {
      break;
    }
    const player = state.priority;
    const pending = state.pending;
    const action: Action | undefined =
      pending !== null && pending.player === player
        ? {
            type: 'ANSWER_CHOICE',
            player,
            choiceId: pending.id,
            answer: answerFor(pending, step, policy),
          }
        : pick(legalActions(state, player), step);
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

export function starterPlayout(
  seed: number,
  maxSteps: number,
  policy: AnswerPolicy = 'max',
): GameState[] {
  registerStarterCards();
  const initial = createGame({ seed, decks: starterDecks(), firstPlayer: 'p1' });
  // Every state visited, initial included.
  const states: GameState[] = [initial];
  runStarter(seed, maxSteps, policy, (step) => states.push(step.after));
  return states;
}

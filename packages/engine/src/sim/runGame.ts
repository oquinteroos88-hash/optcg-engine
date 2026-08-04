import { deepStrictEqual } from 'node:assert';
import { applyAction } from '../applyAction.js';
import { botRngFor, chooseAction } from '../bots/randomBot.js';
import { createGame } from '../createGame.js';
import { assertInvariants, checkTurnLeak } from '../invariants.js';
import { GREEN_DECK, RED_DECK } from '../testdata/decks.js';
import type { Action, GameState, PlayerId } from '../types.js';

// Acceptance criterion 2: exceeding this is a flow bug, never bad luck.
export const TURN_LIMIT = 200;
// Backstop against a game that never terminates without burning turns.
export const ACTION_LIMIT = 10_000;

export interface GameStats {
  seed: number;
  turns: number;
  actions: number;
  winner: PlayerId | null;
  endReason: 'lifeOut' | 'deckOut' | 'concede' | null;
}

export interface GameFailure {
  seed: number;
  error: string;
  actionIndex: number;
  actions: Action[];
}

export type GameOutcome = { ok: true; stats: GameStats } | { ok: false; failure: GameFailure };

export interface RunOptions {
  // Full mode (the default) round-trips the state after every action, as the
  // acceptance criteria require. Fast mode samples instead, for quick dev loops.
  fast?: boolean;
}

const ROUND_TRIP_SAMPLE = 25;

function assertRoundTrip(state: GameState): void {
  deepStrictEqual(JSON.parse(JSON.stringify(state)) as GameState, state);
}

// Criteria 3, 5, 6 and 7 after every action. Criterion 7 lives inside
// assertInvariants (field limits).
function assertPerAction(state: GameState, index: number, fast: boolean): void {
  assertInvariants(state);
  const leaks = checkTurnLeak(state);
  if (leaks.length > 0) {
    throw new Error(`Turn leak:\n${leaks.join('\n')}`);
  }
  if (!fast || index % ROUND_TRIP_SAMPLE === 0) {
    assertRoundTrip(state);
  }
}

/**
 * Plays one bot-vs-bot game, asserting the acceptance criteria after every
 * action. Never throws: failures come back as data with the seed and the action
 * log needed to reproduce them.
 */
export function runGame(seed: number, options: RunOptions = {}): GameOutcome {
  const fast = options.fast ?? false;
  const actions: Action[] = [];
  let botRng = botRngFor(seed);
  let state = createGame({
    seed,
    decks: { p1: RED_DECK, p2: GREEN_DECK },
    firstPlayer: 'p1',
  });

  try {
    assertPerAction(state, 0, fast);
    while (state.status !== 'finished') {
      if (actions.length >= ACTION_LIMIT) {
        throw new Error(`Action limit reached (${ACTION_LIMIT}) without finishing`);
      }
      if (state.turn > TURN_LIMIT) {
        throw new Error(`Turn limit exceeded (${state.turn} > ${TURN_LIMIT})`);
      }

      const player = state.priority;
      const picked = chooseAction(state, player, botRng);
      if (picked === null) {
        throw new Error(`No legal action for ${player} in a live game`);
      }
      botRng = picked.rng;
      const action = picked.action;
      actions.push(action);

      const result = applyAction(state, action);
      if (!result.ok) {
        throw new Error(`Illegal action rejected with "${result.reason}"`);
      }

      // Purity: applying the same action to the same input must be reproducible.
      const repeat = applyAction(state, action);
      if (!repeat.ok) {
        throw new Error('Non-deterministic validation: second apply was rejected');
      }
      deepStrictEqual(repeat.state, result.state);

      state = result.state;
      assertPerAction(state, actions.length, fast);
    }

    // Criterion 4: the whole log replayed from scratch must land byte for byte
    // on the same state.
    const replayed = replay(seed, actions);
    deepStrictEqual(replayed, state);

    return {
      ok: true,
      stats: {
        seed,
        turns: state.turn,
        actions: actions.length,
        winner: state.winner,
        endReason: state.endReason,
      },
    };
  } catch (error) {
    return {
      ok: false,
      failure: {
        seed,
        error: error instanceof Error ? error.message : String(error),
        actionIndex: actions.length - 1,
        actions,
      },
    };
  }
}

export function replay(seed: number, actions: readonly Action[]): GameState {
  let state = createGame({
    seed,
    decks: { p1: RED_DECK, p2: GREEN_DECK },
    firstPlayer: 'p1',
  });
  for (const action of actions) {
    const result = applyAction(state, action);
    if (!result.ok) {
      throw new Error(`Replay diverged: "${result.reason}" for ${JSON.stringify(action)}`);
    }
    state = result.state;
  }
  return state;
}

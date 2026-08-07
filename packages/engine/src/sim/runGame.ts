import { deepStrictEqual } from 'node:assert';
import { applyAction } from '../applyAction.js';
import { botRngFor, chooseAction } from '../bots/randomBot.js';
import { createGame } from '../createGame.js';
import { assertInvariants, checkTurnLeak } from '../invariants.js';
import { ABIL_DECK } from '../testdata/abilityDecks.js';
import { GREEN_DECK, RED_DECK } from '../testdata/decks.js';
import type { Action, Decklist, GameState, PlayerId } from '../types.js';

// Acceptance criterion 2: exceeding this is a flow bug, never bad luck.
export const TURN_LIMIT = 200;
/**
 * Backstop against a game that never terminates without burning turns.
 *
 * `TURN_LIMIT` does not cover this on its own: an action that is always legal
 * and changes nothing — an ability whose targets have run out, say — repeats
 * forever *inside* one turn without ever advancing it. That is the failure mode
 * this number exists for, and the only one it has to be sized against.
 *
 * Sized from measurement, not from caution. Across 400 bot games (seeds 1..200
 * in each deck mode) the longest game took 424 actions: vanilla ran
 * p50 167 / p95 237 / max 301, abilities p50 216 / p95 363 / max 424. 1500 is
 * ~3.5x the worst observed game, so no legitimate game can reach it.
 *
 * The ceiling matters as much as the floor. The previous 10_000 was ~24x that
 * worst game, and a single looping seed cost ~66s to reach it — enough, on top
 * of the sweep's own runtime, to blow vitest's 120s timeout before the loop
 * reported anything. A timeout names no seed and prints no action log, which is
 * the silent failure this cap is supposed to prevent. A cap only helps if a
 * game hits it fast enough to still be reported.
 */
export const ACTION_LIMIT = 1_500;

export interface GameStats {
  seed: number;
  turns: number;
  actions: number;
  /** How many of those actions were answers to a choice the engine opened. */
  choices: number;
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
  /**
   * 'vanilla' plays the effect-free TEST decks; 'abilities' plays the ABIL set
   * on both sides, which is the only way the sweep ever reaches a PendingChoice.
   */
  decks?: DeckMode;
  /**
   * Overrides `ACTION_LIMIT` for one run. Exists so a test can drive a normal
   * game into the cap on purpose and check what comes back — the alternative is
   * a card that loops for real, which would have to live in the ABIL deck and
   * would hang every other sweep that uses it.
   */
  actionLimit?: number;
}

export type DeckMode = 'vanilla' | 'abilities';

function decksFor(mode: DeckMode): Record<PlayerId, Decklist> {
  return mode === 'abilities'
    ? { p1: ABIL_DECK, p2: ABIL_DECK }
    : { p1: RED_DECK, p2: GREEN_DECK };
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
  const deckMode = options.decks ?? 'vanilla';
  const actionLimit = options.actionLimit ?? ACTION_LIMIT;
  const actions: Action[] = [];
  let botRng = botRngFor(seed);
  let state = createGame({
    seed,
    decks: decksFor(deckMode),
    firstPlayer: 'p1',
  });

  try {
    assertPerAction(state, 0, fast);
    while (state.status !== 'finished') {
      if (actions.length >= actionLimit) {
        throw new Error(`Action limit reached (${actionLimit}) without finishing`);
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

    // No game may finish with an effect still half-resolved.
    if (state.stack.length > 0 || state.pending !== null || state.resume.length > 0) {
      throw new Error('Game finished with effects still queued');
    }

    // Criterion 4: the whole log replayed from scratch must land byte for byte
    // on the same state.
    const replayed = replay(seed, actions, deckMode);
    deepStrictEqual(replayed, state);

    return {
      ok: true,
      stats: {
        seed,
        turns: state.turn,
        actions: actions.length,
        choices: actions.filter((action) => action.type === 'ANSWER_CHOICE').length,
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

export function replay(
  seed: number,
  actions: readonly Action[],
  deckMode: DeckMode = 'vanilla',
): GameState {
  let state = createGame({
    seed,
    decks: decksFor(deckMode),
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

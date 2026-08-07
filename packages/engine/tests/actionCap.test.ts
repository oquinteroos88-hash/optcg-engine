import { describe, expect, it } from 'vitest';
import { ACTION_LIMIT, replay, runGame } from '../src/sim/runGame.js';

/**
 * The sweep's per-game action cap.
 *
 * `TURN_LIMIT` bounds how many turns a game may take, and misses the failure
 * that actually costs a CI run: an action that is always legal and changes
 * nothing repeats forever *inside* one turn, so the turn counter never moves.
 * The only thing standing between that and a hung job is this cap.
 *
 * A cap is worth exactly as much as the report it produces, so what is tested
 * here is the report — the seed and an action log that really does replay —
 * and the two-sided sizing: high enough that no real game reaches it, low
 * enough that a game which does hit it gets there in time to be reported
 * rather than killed by a test-runner timeout.
 */
describe('the sweep cannot run forever', () => {
  it('reports the seed and a replayable log when a game hits the cap', () => {
    // Driven into the cap on purpose with a tiny limit. A card that looped for
    // real would have to live in the ABIL deck, where it would hang every other
    // sweep that plays it.
    const outcome = runGame(7, { decks: 'abilities', fast: true, actionLimit: 25 });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.error).toContain('Action limit reached (25)');
    // The seed and the log are the whole point: without them the failure says
    // a game hung and gives you no way to see it happen again.
    expect(outcome.failure.seed).toBe(7);
    expect(outcome.failure.actions).toHaveLength(25);
    // And the log has to be a real repro, not just a record of the right length.
    expect(() => replay(7, outcome.failure.actions, 'abilities')).not.toThrow();
  });

  it('leaves a real game room to finish', { timeout: 60_000 }, () => {
    // The other half of the sizing. If someone ever lowers the cap into the
    // range a legitimate game occupies, the sweep starts failing on healthy
    // games and this fails first, with the measurement that says why.
    let longest = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      for (const decks of ['vanilla', 'abilities'] as const) {
        const outcome = runGame(seed, { decks, fast: true });
        expect(outcome.ok, `seed ${seed} (${decks})`).toBe(true);
        if (outcome.ok) longest = Math.max(longest, outcome.stats.actions);
      }
    }
    // Measured over 400 games (seeds 1..200, both deck modes) the worst was 424
    // actions. The cap is ~3.5x that; this asserts the headroom is still there.
    expect(longest).toBeLessThan(ACTION_LIMIT / 2);
  });
});

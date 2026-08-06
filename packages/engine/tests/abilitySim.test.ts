import { describe, expect, it } from 'vitest';
import { runGame } from '../src/sim/runGame.js';

/**
 * The random sweep, played with decks that actually have effects.
 *
 * The vanilla sweep can never open a PendingChoice, so it proves nothing about
 * the interpreter. This one does: every game runs the same per-action
 * assertions — invariants, turn leak, JSON round trip, apply purity, and a full
 * replay of the action log — while the bot answers real choices.
 */
describe('simulation with ability decks', () => {
  it('plays clean games and never leaves an effect hanging', { timeout: 120_000 }, () => {
    const failures: string[] = [];
    let choicesAnswered = 0;
    let games = 0;

    for (let seed = 1; seed <= 60; seed += 1) {
      const outcome = runGame(seed, { decks: 'abilities' });
      if (!outcome.ok) {
        failures.push(`seed ${outcome.failure.seed}: ${outcome.failure.error}`);
        continue;
      }
      games += 1;
      choicesAnswered += outcome.stats.choices;
    }

    expect(failures).toEqual([]);
    expect(games).toBe(60);
    // If this ever hit zero the sweep would be green for the wrong reason: it
    // would mean no effect ever suspended and the interpreter was never
    // exercised at all.
    expect(choicesAnswered).toBeGreaterThan(100);
  });
});

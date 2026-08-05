import { describe, expect, it } from 'vitest';
import { runGame } from '../src/sim/runGame.js';

// Coverage harness, not part of the normal suite: it exists only to drive the
// bot-vs-bot simulation under v8 instrumentation so we can see which rules
// branches the bots never reach. Run it through vitest.coverage.config.ts.
const GAMES = Number(process.env['OPTCG_COVERAGE_GAMES'] ?? 1000);

describe('simulation coverage sweep', () => {
  it(`runs ${GAMES} bot-vs-bot games`, () => {
    let completed = 0;
    const failures: string[] = [];
    for (let i = 0; i < GAMES; i += 1) {
      const outcome = runGame(1 + i);
      if (outcome.ok) {
        completed += 1;
      } else {
        failures.push(`seed ${outcome.failure.seed}: ${outcome.failure.error}`);
      }
    }
    expect(failures).toEqual([]);
    expect(completed).toBe(GAMES);
  });
});

import { describe, expect, it } from 'vitest';
import { ABIL_DECK } from '@optcg/engine/testdata/abilityDecks';
import {
  measureApplyAction,
  measureGrowth,
  measureServerCosts,
  recordGame,
  summarize,
} from '../bench/measure.js';

/**
 * The numbers in `docs/performance.md`, held. Each budget is the measurement
 * with stated air, never a target: a regression fails here before it reaches
 * a table, and a feature that earns the bytes moves the number in the same
 * commit, with the reason.
 *
 * The same functions the harness prints from, so the test and the document
 * cannot disagree about what was measured. Timing gets the widest margin —
 * a two-core CI runner under load is not this machine — bytes and ratios are
 * deterministic and get the tight one.
 */

const decks = { p1: ABIL_DECK, p2: ABIL_DECK };

/**
 * Measured p95 over ability seeds 1–3: 424–444µs across three runs after the
 * END_TURN fix (it was ~790µs before it, END_TURN being the tail). ×4,
 * rounded up to 2ms: a runner has to be four and a half times slower than
 * the reference machine, or the tail has to come back, before this fires.
 */
const APPLY_ACTION_P95_BUDGET_US = 2_000;

/** Measured on seed 6, the sweep's longest game: mean 12.1 KiB, max 23.1 KiB. ×1.5, rounded up. */
const UPDATE_MEAN_BUDGET_KIB = 19;
const UPDATE_MAX_BUDGET_KIB = 35;
/** Measured on seed 6 at game end: 70.5 KiB. ×1.5, rounded up. */
const REJOIN_BUDGET_KIB = 106;
/** Board state (game without its log) at the end over at action 50: measured ×1.01 on seed 6, ×1.04 on the longest game found. */
const BOARD_GROWTH_BOUND = 1.5;

const KIB = 1024;

describe('performance budgets', () => {
  it('applyAction p95 over ability seeds 1–3 stays under the budget', { timeout: 60_000 }, () => {
    const samples: number[] = [];
    for (const seed of [1, 2, 3]) {
      samples.push(...measureApplyAction(recordGame(seed, decks)));
    }
    const summary = summarize(samples);
    expect(summary.n).toBeGreaterThan(500);
    expect(summary.p95, `p95 ${summary.p95.toFixed(1)}µs over ${summary.n} actions`).toBeLessThan(
      APPLY_ACTION_P95_BUDGET_US,
    );
  });

  it('update and joined bytes on the longest sweep game stay under the budget', { timeout: 60_000 }, () => {
    const costs = measureServerCosts(recordGame(6, decks));
    const bytes = summarize(costs.updateBytes);
    expect(bytes.mean / KIB, `mean update ${(bytes.mean / KIB).toFixed(1)} KiB`).toBeLessThan(UPDATE_MEAN_BUDGET_KIB);
    expect(bytes.max / KIB, `max update ${(bytes.max / KIB).toFixed(1)} KiB`).toBeLessThan(UPDATE_MAX_BUDGET_KIB);
    const rejoin = Math.max(costs.rejoinBytes.p1, costs.rejoinBytes.p2);
    expect(rejoin / KIB, `joined ${(rejoin / KIB).toFixed(1)} KiB`).toBeLessThan(REJOIN_BUDGET_KIB);
  });

  it('the board does not grow with the game; only the histories do', { timeout: 60_000 }, () => {
    const points = measureGrowth(recordGame(6, decks), [50]);
    const [at50, end] = points;
    if (at50 === undefined || end === undefined || at50 === end) {
      throw new Error('expected a checkpoint at action 50 and one at the end');
    }
    const ratio = end.gameWithoutLog / at50.gameWithoutLog;
    expect(ratio, `board ×${ratio.toFixed(2)} from action 50 to ${end.action}`).toBeLessThan(BOARD_GROWTH_BOUND);
    // The histories are linear by design: a journal that stopped growing
    // would be a journal that stopped recording.
    expect(end.actions).toBeGreaterThan(at50.actions);
    expect(end.journal).toBeGreaterThan(at50.journal);
  });
});

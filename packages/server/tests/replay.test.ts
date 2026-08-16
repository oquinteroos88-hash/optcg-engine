import { deepStrictEqual } from 'node:assert';
import { describe, expect, it } from 'vitest';
import { ABIL_DECK } from '@optcg/engine/testdata/abilityDecks';
import { replayMatch } from '../src/replay.js';
import { driveMatch } from './helpers.js';

/**
 * `seed + action log = the match`, byte for byte. The sweep answers blind
 * choices **by handle**, so a green run here is also the proof the #43 brief
 * asked this PR to extract: the handle order's salt is derived from nothing
 * but state (the choice id and its candidates), because a salt with any
 * source of its own would make the replayed handle resolve a different card
 * and `deepStrictEqual` would say so.
 */

const decks = { p1: ABIL_DECK, p2: ABIL_DECK };

describe('replay', () => {
  it('reconstructs every sweep game byte for byte — handle answers and shuffles included', { timeout: 240_000 }, () => {
    let sawBlind = false;
    let sawShuffle = false;
    for (let seed = 1; seed <= 12; seed += 1) {
      const run = driveMatch(seed, decks);
      deepStrictEqual(replayMatch(seed, decks, run.match.actions), run.match.game);
      sawBlind = sawBlind || run.sawBlindChoice;
      sawShuffle = sawShuffle || run.sawShuffle;
    }
    // The two cases the brief names, asserted rather than hoped: a sweep that
    // reached neither would be green for the wrong reason.
    expect(sawBlind).toBe(true);
    expect(sawShuffle).toBe(true);
  });

  it('throws loudly on a corrupted log instead of shrugging', () => {
    const run = driveMatch(1, decks);
    const corrupted = [...run.match.actions];
    const first = corrupted[0];
    if (first?.type !== 'MULLIGAN') {
      throw new Error('expected the log to open with a mulligan decision');
    }
    corrupted[0] = { ...first, player: first.player === 'p1' ? 'p2' : 'p1' };
    expect(() => replayMatch(1, decks, corrupted)).toThrow(/Replay diverged at action 0/);
  });
});

import { describe, expect, it } from 'vitest';
import { applyAction } from '../src/index.js';
import type { Action } from '../src/index.js';
import { buildGame, run } from './helpers.js';

const SCRIPT: Action[] = [
  { type: 'MULLIGAN', player: 'p1', accept: true },
  { type: 'MULLIGAN', player: 'p2', accept: false },
  { type: 'END_TURN', player: 'p1' },
  { type: 'END_TURN', player: 'p2' },
  { type: 'END_TURN', player: 'p1' },
  { type: 'END_TURN', player: 'p2' },
];

describe('determinism', () => {
  it('same seed and same action list produce toEqual final states', () => {
    const a = run(buildGame(7), ...SCRIPT);
    const b = run(buildGame(7), ...SCRIPT);
    expect(b).toEqual(a);
  });

  it('applying the same action to the same state twice agrees exactly', () => {
    const game = buildGame(11);
    const first = applyAction(game, { type: 'MULLIGAN', player: 'p1', accept: true });
    const second = applyAction(game, { type: 'MULLIGAN', player: 'p1', accept: true });
    expect(second).toEqual(first);

    const main = run(buildGame(11), ...SCRIPT.slice(0, 2));
    const endA = applyAction(main, { type: 'END_TURN', player: 'p1' });
    const endB = applyAction(main, { type: 'END_TURN', player: 'p1' });
    expect(endB).toEqual(endA);
  });

  it('a different seed produces a different game', () => {
    const a = run(buildGame(7), ...SCRIPT);
    const b = run(buildGame(8), ...SCRIPT);
    expect(b.players.p1.hand).not.toEqual(a.players.p1.hand);
  });
});

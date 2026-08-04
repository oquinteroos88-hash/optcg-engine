import { describe, expect, it } from 'vitest';
import { applyAction } from '../src/index.js';
import type { Action } from '../src/index.js';
import { buildGame } from './helpers.js';

describe('serialization', () => {
  it('the created state survives a JSON round trip with toEqual equality', () => {
    const state = buildGame();
    const roundTripped = JSON.parse(JSON.stringify(state));
    expect(roundTripped).toEqual(state);
  });

  it('the serialized state never contains the text "undefined"', () => {
    const state = buildGame();
    expect(JSON.stringify(state)).not.toContain('undefined');
  });

  it('survives the round trip after every step of a scripted game', () => {
    let state = buildGame();
    const leader = state.players.p1.leader;
    const enemyLeader = state.players.p2.leader;
    const script: Action[] = [
      { type: 'MULLIGAN', player: 'p1', accept: false },
      { type: 'MULLIGAN', player: 'p2', accept: false },
      { type: 'ATTACH_DON', player: 'p1', to: leader, count: 1 },
      { type: 'END_TURN', player: 'p1' },
      // Turn 2: the second player may always attack; p1's leader holds +1000.
      { type: 'DECLARE_ATTACK', player: 'p2', attacker: enemyLeader, target: leader },
      { type: 'PASS', player: 'p1' },
      { type: 'PASS', player: 'p1' },
      { type: 'END_TURN', player: 'p2' },
    ];
    for (const action of script) {
      const result = applyAction(state, action);
      if (!result.ok) {
        throw new Error(`script step failed (${result.reason}): ${JSON.stringify(action)}`);
      }
      state = result.state;
      const json = JSON.stringify(state);
      expect(JSON.parse(json)).toEqual(state);
      expect(json).not.toContain('undefined');
    }
    expect(state.turn).toBe(3);
  });

  it('engine-returned state is deeply frozen: mutation throws', () => {
    const state = buildGame();
    expect(() => {
      (state as { turn: number }).turn = 99;
    }).toThrow(TypeError);
    expect(() => {
      state.players.p1.hand.push('p1-c99');
    }).toThrow(TypeError);
    expect(() => {
      (state.players.p2.don[0] as { location: unknown }).location = { kind: 'cost' };
    }).toThrow(TypeError);
  });
});

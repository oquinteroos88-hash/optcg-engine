import { beforeEach, describe, expect, it } from 'vitest';
import type { ViewEvent } from '@optcg/engine';
import { groupEvents, resetAnimGroupIds } from '../src/game/animQueue';

const drawn = (player: 'p1' | 'p2', instanceId: string): ViewEvent => ({
  type: 'cardDrawn',
  player,
  instanceId,
});

beforeEach(() => {
  resetAnimGroupIds();
});

describe('groupEvents', () => {
  it('assigns monotonically increasing ids (FIFO)', () => {
    const groups = groupEvents([
      drawn('p1', 'a'),
      { type: 'cardPlayed', player: 'p1', instanceId: 'b', cardId: 'TEST-001' },
      { type: 'koed', player: 'p2', instanceId: 'c' },
    ]);
    expect(groups.map((g) => g.id)).toEqual([1, 2, 3]);
  });

  it('merges consecutive draws by the same player into one group', () => {
    const groups = groupEvents([
      drawn('p1', 'a'),
      drawn('p1', 'b'),
      drawn('p1', 'c'),
      drawn('p1', 'd'),
      drawn('p1', 'e'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe('draw');
    expect(groups[0]?.durationMs).toBe(300);
    expect(groups[0]?.cardIds).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('splits draw groups when the player changes', () => {
    const groups = groupEvents([drawn('p1', 'a'), drawn('p2', 'b')]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.kind)).toEqual(['draw', 'draw']);
  });

  it('merges a donReturned/donGained run into one donMoved group', () => {
    const groups = groupEvents([
      { type: 'donReturned', player: 'p1', count: 2, rested: true },
      { type: 'donReturned', player: 'p1', count: 1, rested: false },
      { type: 'donReturned', player: 'p1', count: 1, rested: false },
      { type: 'donGained', player: 'p1', count: 2 },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe('donMoved');
    expect(groups[0]?.durationMs).toBe(300);
    expect(groups[0]?.events).toHaveLength(4);
  });

  it('merges adjacent turnEnded + turnStarted into one turn group', () => {
    const groups = groupEvents([
      { type: 'turnEnded', turn: 2, player: 'p1' },
      { type: 'turnStarted', turn: 3, player: 'p2' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe('turn');
    expect(groups[0]?.durationMs).toBe(200);
  });

  it('gives counterPlayed a shorter duration than koed', () => {
    const groups = groupEvents([
      { type: 'counterPlayed', player: 'p2', instanceId: 'h1', target: 'L2', value: 1000 },
      { type: 'koed', player: 'p2', instanceId: 'c1' },
    ]);
    expect(groups).toHaveLength(2);
    const counter = groups[0];
    const ko = groups[1];
    expect(counter?.durationMs).toBe(150);
    expect(ko?.durationMs).toBe(300);
    expect(counter !== undefined && ko !== undefined && counter.durationMs < ko.durationMs).toBe(true);
    expect(ko?.kind).toBe('battle');
  });

  it('drops zero-visual events entirely', () => {
    const groups = groupEvents([
      { type: 'gameStarted', firstPlayer: 'p1' },
      { type: 'lifeSet', player: 'p1', count: 5 },
      { type: 'mulliganTaken', player: 'p1', accepted: false },
      { type: 'mulliganTaken', player: 'p2', accepted: true },
    ]);
    expect(groups).toEqual([]);
  });

  it('preserves event order across interleaved groups', () => {
    const groups = groupEvents([
      drawn('p1', 'a'),
      { type: 'cardPlayed', player: 'p1', instanceId: 'b', cardId: 'TEST-001' },
      drawn('p1', 'c'),
      drawn('p1', 'd'),
      { type: 'battleResolved', attacker: 'x', target: 'y', outcome: 'ko' },
    ]);
    expect(groups.map((g) => g.kind)).toEqual(['draw', 'single', 'draw', 'battle']);
    expect(groups.map((g) => g.id)).toEqual([1, 2, 3, 4]);
    expect(groups[2]?.cardIds).toEqual(['c', 'd']);
    expect(groups[3]?.cardIds).toEqual(['x', 'y']);
  });

  it('collects highlight card ids per group', () => {
    const groups = groupEvents([
      { type: 'attackDeclared', player: 'p1', attacker: 'a1', target: 't1' },
      { type: 'donAttached', player: 'p1', to: 'L1', count: 1 },
      { type: 'lifeTaken', player: 'p2', instanceId: 'life1', remaining: 3 },
    ]);
    expect(groups[0]?.cardIds).toEqual(['a1', 't1']);
    expect(groups[1]?.cardIds).toEqual(['L1']);
    expect(groups[2]?.cardIds).toEqual(['life1']);
  });
});

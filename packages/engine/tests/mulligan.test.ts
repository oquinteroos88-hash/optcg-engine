import { describe, expect, it } from 'vitest';
import type { Action } from '../src/index.js';
import { applyFail, applyOk, buildGame, run } from './helpers.js';

const p1Accept: Action = { type: 'MULLIGAN', player: 'p1', accept: true };
const p1Decline: Action = { type: 'MULLIGAN', player: 'p1', accept: false };
const p2Accept: Action = { type: 'MULLIGAN', player: 'p2', accept: true };
const p2Decline: Action = { type: 'MULLIGAN', player: 'p2', accept: false };

describe('mulligan', () => {
  it('decisions are sequential: firstPlayer first, then the opponent', () => {
    const game = buildGame();
    expect(game.priority).toBe('p1');
    expect(applyFail(game, p2Decline)).toBe('notYourPriority');

    const afterP1 = run(game, p1Decline);
    expect(afterP1.status).toBe('mulligan');
    expect(afterP1.priority).toBe('p2');
    expect(applyFail(afterP1, p1Decline)).toBe('notYourPriority');

    const afterBoth = run(afterP1, p2Decline);
    expect(afterBoth.status).toBe('playing');
  });

  it('accepting redraws 5 from a reshuffled 50-card deck', () => {
    const game = buildGame();
    const originalHand = [...game.players.p1.hand];
    const { state, events } = applyOk(game, p1Accept);
    expect(state.players.p1.hand).toHaveLength(5);
    expect(state.players.p1.deck).toHaveLength(45);
    expect(state.players.p1.hand).not.toEqual(originalHand);
    expect(state.players.p1.hasMulliganed).toBe(true);
    expect(state.rng.cursor).toBe(98 + 49);
    expect(events).toEqual([{ type: 'mulliganTaken', player: 'p1', accepted: true }]);
  });

  it('declining keeps the hand and consumes no rng', () => {
    const game = buildGame();
    const originalHand = [...game.players.p1.hand];
    const { state, events } = applyOk(game, p1Decline);
    expect(state.players.p1.hand).toEqual(originalHand);
    expect(state.players.p1.hasMulliganed).toBe(false);
    expect(state.rng.cursor).toBe(98);
    expect(events).toEqual([{ type: 'mulliganTaken', player: 'p1', accepted: false }]);
  });

  it('consumes rng in decision order when both accept: 98 -> 147 -> 196', () => {
    const game = buildGame();
    const afterP1 = run(game, p1Accept);
    expect(afterP1.rng.cursor).toBe(147);
    const afterP2 = run(afterP1, p2Accept);
    expect(afterP2.rng.cursor).toBe(196 + 0); // second shuffle; turn 1 has no draw shuffle
    expect(afterP2.players.p2.hasMulliganed).toBe(true);
  });

  it('places life for both players only after both decide', () => {
    const game = buildGame();
    const afterP1 = run(game, p1Decline);
    expect(afterP1.players.p1.life).toHaveLength(0);
    expect(afterP1.players.p2.life).toHaveLength(0);

    const p1DeckBefore = [...afterP1.players.p1.deck];
    const p2DeckBefore = [...afterP1.players.p2.deck];
    const { state, events } = applyOk(afterP1, p2Decline);

    // TEST-L01 has Life 5, TEST-L02 has Life 4; life[0] = former deck top.
    expect(state.players.p1.life).toEqual(p1DeckBefore.slice(0, 5));
    expect(state.players.p2.life).toEqual(p2DeckBefore.slice(0, 4));
    expect(state.players.p2.deck).toEqual(p2DeckBefore.slice(4));
    expect(events).toEqual([
      { type: 'mulliganTaken', player: 'p2', accepted: false },
      { type: 'lifeSet', player: 'p1', count: 5 },
      { type: 'lifeSet', player: 'p2', count: 4 },
      { type: 'turnStarted', turn: 1, player: 'p1' },
      { type: 'donGained', player: 'p1', count: 1 },
    ]);
  });

  it('completing the mulligan starts turn 1 for the firstPlayer', () => {
    const state = run(buildGame(), p1Decline, p2Decline);
    expect(state.status).toBe('playing');
    expect(state.turn).toBe(1);
    expect(state.activePlayer).toBe('p1');
    expect(state.priority).toBe('p1');
    expect(state.phase).toBe('main');
    expect(state.battle).toBeNull();
  });

  it('is once-only structurally: wrongStatus once playing', () => {
    const state = run(buildGame(), p1Decline, p2Decline);
    expect(applyFail(state, p1Accept)).toBe('wrongStatus');
    expect(applyFail(state, p2Accept)).toBe('notYourPriority');
  });

  it('rejects non-mulligan actions during the mulligan', () => {
    const game = buildGame();
    expect(applyFail(game, { type: 'END_TURN', player: 'p1' })).toBe('wrongStatus');
    expect(applyFail(game, { type: 'PASS', player: 'p1' })).toBe('wrongStatus');
  });

  it('rejects malformed and unknown-player actions', () => {
    const game = buildGame();
    expect(applyFail(game, { type: 'BOGUS', player: 'p1' } as unknown as Action)).toBe(
      'malformedAction',
    );
    expect(applyFail(game, { type: 'MULLIGAN', player: 'p3', accept: true } as unknown as Action)).toBe(
      'unknownPlayer',
    );
    expect(applyFail(game, { type: 'MULLIGAN', player: 'p1', accept: 'yes' } as unknown as Action)).toBe(
      'malformedAction',
    );
  });

  it('respects a p2 firstPlayer for the decision order', () => {
    const game = buildGame(42, 'p2');
    expect(game.priority).toBe('p2');
    expect(applyFail(game, p1Decline)).toBe('notYourPriority');
    const state = run(game, p2Decline, p1Decline);
    expect(state.activePlayer).toBe('p2');
    expect(state.turn).toBe(1);
  });
});

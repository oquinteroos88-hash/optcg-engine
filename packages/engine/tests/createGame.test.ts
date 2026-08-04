import { describe, expect, it } from 'vitest';
import { createGame } from '../src/index.js';
import type { Decklist } from '../src/index.js';
import { GREEN_DECK, RED_DECK } from '../src/testdata/decks.js';
import { buildGame } from './helpers.js';

function opts(seed = 42) {
  return { seed, decks: { p1: RED_DECK, p2: GREEN_DECK }, firstPlayer: 'p1' as const };
}

describe('createGame', () => {
  it('sets up zones with correct sizes for both players', () => {
    const state = buildGame();
    for (const p of ['p1', 'p2'] as const) {
      const ps = state.players[p];
      expect(ps.hand).toHaveLength(5);
      expect(ps.deck).toHaveLength(45);
      expect(ps.life).toHaveLength(0);
      expect(ps.trash).toHaveLength(0);
      expect(ps.characters).toEqual([]);
      expect(ps.stage).toBeNull();
      expect(ps.don).toHaveLength(10);
      expect(ps.don.every((d) => d.location.kind === 'donDeck')).toBe(true);
      expect(ps.hasMulliganed).toBe(false);
    }
  });

  it('uses the documented id schemes: leader c0, deck c1..c50, don d0..d9', () => {
    const state = buildGame();
    for (const p of ['p1', 'p2'] as const) {
      const ps = state.players[p];
      expect(ps.leader).toBe(`${p}-c0`);
      const leader = state.cards[`${p}-c0`];
      expect(leader?.cardId).toBe(p === 'p1' ? 'TEST-L01' : 'TEST-L02');
      for (let i = 0; i <= 50; i += 1) {
        expect(state.cards[`${p}-c${i}`]).toBeDefined();
      }
      const zoneIds = [...ps.hand, ...ps.deck].sort();
      const expected = Array.from({ length: 50 }, (_, i) => `${p}-c${i + 1}`).sort();
      expect(zoneIds).toEqual(expected);
      expect(ps.don.map((d) => d.instanceId)).toEqual(
        Array.from({ length: 10 }, (_, i) => `${p}-d${i}`),
      );
    }
    expect(Object.keys(state.cards)).toHaveLength(102);
  });

  it('normalizes every instance and starts in mulligan with firstPlayer priority', () => {
    const state = buildGame(42, 'p2');
    expect(state.version).toBe(1);
    expect(state.matchId).toBe('optcg-42');
    expect(state.status).toBe('mulligan');
    expect(state.winner).toBeNull();
    expect(state.endReason).toBeNull();
    expect(state.turn).toBe(0);
    expect(state.activePlayer).toBe('p2');
    expect(state.firstPlayer).toBe('p2');
    expect(state.priority).toBe('p2');
    expect(state.battle).toBeNull();
    expect(state.modifiers).toEqual([]);
    expect(state.rules).toEqual({ firstPlayerCannotAttackTurnOne: true });
    expect(state.log).toEqual([{ type: 'gameStarted', matchId: 'optcg-42', firstPlayer: 'p2' }]);
    for (const card of Object.values(state.cards)) {
      expect(card.orientation).toBe('active');
      expect(card.attachedDon).toEqual([]);
      expect(card.playedOnTurn).toBeNull();
      expect(card.owner).toBe(card.controller);
    }
  });

  it('shuffles each deck with the state rng: p1 first, then p2, cursor 98', () => {
    const state = buildGame();
    expect(state.rng).toEqual({ seed: 42, cursor: 98 });
    const p1Order = [...state.players.p1.hand, ...state.players.p1.deck].map(
      (id) => state.cards[id]?.cardId,
    );
    expect(p1Order).not.toEqual(RED_DECK.cards);
    const differentSeed = buildGame(43);
    const p1OrderOther = [
      ...differentSeed.players.p1.hand,
      ...differentSeed.players.p1.deck,
    ].map((id) => differentSeed.cards[id]?.cardId);
    expect(p1OrderOther).not.toEqual(p1Order);
    const sameSeed = buildGame(42);
    expect(sameSeed).toEqual(state);
  });

  it('throws on malformed decklists', () => {
    const short: Decklist = { leader: RED_DECK.leader, cards: RED_DECK.cards.slice(0, 49) };
    expect(() => createGame({ ...opts(), decks: { p1: short, p2: GREEN_DECK } })).toThrow();

    const unknown: Decklist = {
      leader: RED_DECK.leader,
      cards: ['TEST-999', ...RED_DECK.cards.slice(1)],
    };
    expect(() => createGame({ ...opts(), decks: { p1: unknown, p2: GREEN_DECK } })).toThrow();

    const leaderInDeck: Decklist = {
      leader: RED_DECK.leader,
      cards: ['TEST-L02', ...RED_DECK.cards.slice(1)],
    };
    expect(() => createGame({ ...opts(), decks: { p1: leaderInDeck, p2: GREEN_DECK } })).toThrow();

    const nonLeaderLeader: Decklist = { leader: 'TEST-001', cards: RED_DECK.cards };
    expect(() =>
      createGame({ ...opts(), decks: { p1: nonLeaderLeader, p2: GREEN_DECK } }),
    ).toThrow();

    const unknownLeader: Decklist = { leader: 'TEST-998', cards: RED_DECK.cards };
    expect(() =>
      createGame({ ...opts(), decks: { p1: unknownLeader, p2: GREEN_DECK } }),
    ).toThrow();
  });
});

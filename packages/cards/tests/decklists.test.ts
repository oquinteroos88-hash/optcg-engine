import { describe, expect, it } from 'vitest';
import { findCard, ST01_DECK, ST02_DECK, toEngineDecklist, validateDecklist } from '../src/index.js';
import type { Decklist } from '../src/index.js';

const DECKS: Array<[string, Decklist]> = [
  ['ST-01', ST01_DECK],
  ['ST-02', ST02_DECK],
];

describe.each(DECKS)('%s', (_name, deck) => {
  it('is a legal deck', () => {
    // The list is transcribed by hand from the product. A failure here is a
    // transcription error to be corrected against the box — never a decklist
    // to be trimmed until the test passes.
    expect(validateDecklist(deck)).toEqual([]);
  });

  it('holds exactly 50 cards outside the Leader', () => {
    const total = deck.cards.reduce((sum, entry) => sum + entry.qty, 0);
    expect(total).toBe(50);
    expect(toEngineDecklist(deck).cards).toHaveLength(50);
  });

  it('never runs more than 4 copies of a card', () => {
    for (const entry of deck.cards) {
      expect(entry.qty, entry.cardId).toBeGreaterThanOrEqual(1);
      expect(entry.qty, entry.cardId).toBeLessThanOrEqual(4);
    }
  });

  it('resolves every id in the card set, and lists each one once', () => {
    const seen = new Set<string>();
    for (const entry of deck.cards) {
      expect(seen.has(entry.cardId), entry.cardId).toBe(false);
      seen.add(entry.cardId);
      expect(findCard(entry.cardId), entry.cardId).toBeDefined();
    }
    expect(findCard(deck.leader)?.category).toBe('leader');
  });

  it('shares a color with its Leader on every card', () => {
    const leader = findCard(deck.leader);
    expect(leader).toBeDefined();
    for (const entry of deck.cards) {
      const card = findCard(entry.cardId);
      expect(card?.colors.some((color) => leader?.colors.includes(color)), entry.cardId).toBe(true);
    }
  });

  it('holds no Leader in the main deck', () => {
    for (const entry of deck.cards) {
      expect(findCard(entry.cardId)?.category, entry.cardId).not.toBe('leader');
    }
  });
});

describe('validateDecklist', () => {
  // The validator is what stands between a mistyped list and a silently wrong
  // game, so it gets its own failing cases rather than only ever seeing decks
  // that pass.
  it('reports a deck that does not add up to 50', () => {
    const short: Decklist = { ...ST01_DECK, cards: ST01_DECK.cards.slice(0, 4) };
    expect(validateDecklist(short)).toContain('16 cards outside the Leader, expected exactly 50');
  });

  it('reports a fifth copy', () => {
    const tooMany: Decklist = {
      ...ST01_DECK,
      cards: [{ cardId: 'ST01-002', qty: 5 }, ...ST01_DECK.cards.slice(1)],
    };
    expect(validateDecklist(tooMany)).toContain(
      'ST01-002 appears 5 times, more than the 4 allowed',
    );
  });

  it('reports an off-color card', () => {
    const offColor: Decklist = {
      ...ST01_DECK,
      cards: [{ cardId: 'ST02-002', qty: 4 }, ...ST01_DECK.cards.slice(1)],
    };
    expect(validateDecklist(offColor).join('\n')).toContain('shares no color');
  });

  it('reports an id that is not in the set', () => {
    const unknown: Decklist = {
      ...ST01_DECK,
      cards: [{ cardId: 'ST01-999', qty: 4 }, ...ST01_DECK.cards.slice(1)],
    };
    expect(validateDecklist(unknown)).toContain('ST01-999 is not in the card set');
  });
});

describe('toEngineDecklist', () => {
  it('expands multiplicities into the flat list the engine takes', () => {
    const expanded = toEngineDecklist(ST01_DECK);
    expect(expanded.leader).toBe('ST01-001');
    expect(expanded.cards.filter((id) => id === 'ST01-002')).toHaveLength(4);
    expect(expanded.cards.filter((id) => id === 'ST01-017')).toHaveLength(2);
  });
});

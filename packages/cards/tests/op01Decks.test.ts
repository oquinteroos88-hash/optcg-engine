import { describe, expect, it } from 'vitest';
import { createGame } from '@optcg/engine';
import { registerEnglishCards, toEngineDecklist, validateDecklist } from '../src/index.js';
import { findCard } from '../src/cards.js';
import { OP01_TEST_DECKS } from './fixtures/op01Decks.js';

registerEnglishCards();

/**
 * The fixture decks are held to the same bar as the transcribed starter decks:
 * legal by `validateDecklist`, and buildable into a real game.
 *
 * A fixture that is subtly illegal fails somewhere else entirely — in a
 * manifestation test, several files away, as "this ability never fired".
 */
describe('the OP-01 test decks are legal', () => {
  for (const deck of OP01_TEST_DECKS) {
    it(`${deck.id} passes validateDecklist`, () => {
      expect(validateDecklist(deck)).toEqual([]);
    });

    it(`${deck.id} is 50 cards outside the Leader, at most 4 of each`, () => {
      const total = deck.cards.reduce((sum, entry) => sum + entry.qty, 0);
      expect(total).toBe(50);
      for (const entry of deck.cards) {
        expect(entry.qty, entry.cardId).toBeLessThanOrEqual(4);
      }
      expect(new Set(deck.cards.map((entry) => entry.cardId)).size).toBe(deck.cards.length);
    });

    it(`${deck.id} is built entirely from OP-01`, () => {
      // The point of the fixture. A stray starter card would make a
      // manifestation result mean something else.
      expect(deck.leader.startsWith('OP01-')).toBe(true);
      for (const entry of deck.cards) {
        expect(entry.cardId.startsWith('OP01-'), entry.cardId).toBe(true);
      }
    });

    it(`${deck.id} builds a real game`, () => {
      const engineDeck = toEngineDecklist(deck);
      const state = createGame({
        seed: 1,
        decks: { p1: engineDeck, p2: engineDeck },
        firstPlayer: 'p1',
      });
      expect(state.players.p1.hand).toHaveLength(5);
      // Both OP-01 Leaders in the fixtures print 5 Life, read through the engine.
      expect(state.players.p1.life.length + state.players.p1.deck.length).toBe(45);
    });
  }

  it('fills every non-batch slot with a card that has nothing to script', () => {
    // The rule the fixture comment states, asserted rather than trusted: filler
    // is vanilla or printed-keyword-only. A card whose ability a later batch
    // writes would silently change what these decks measure the day it lands.
    const BATCH = new Set([
      // Batch 1 — Characters.
      'OP01-006',
      'OP01-017',
      'OP01-022',
      'OP01-033',
      'OP01-034',
      'OP01-035',
      'OP01-048',
      'OP01-052',
      'OP01-054',
      // Batch 2 — Events.
      'OP01-026',
      'OP01-027',
      'OP01-028',
      'OP01-029',
      'OP01-056',
      'OP01-057',
      'OP01-058',
      // Batch 3 — activated, statics, [On K.O.], [On Block], blue/purple.
      'OP01-003',
      'OP01-020',
      'OP01-068',
      'OP01-070',
      'OP01-078',
      'OP01-079',
      'OP01-080',
      'OP01-086',
      'OP01-089',
      'OP01-094',
      'OP01-096',
      'OP01-097',
      'OP01-108',
      'OP01-111',
      'OP01-117',
      // Batch 4 — the residue that completed pile A.
      'OP01-001',
      'OP01-007',
      'OP01-032',
      'OP01-039',
      // Batch 5 — the cards a player-chosen payment freed.
      'OP01-031',
      'OP01-059',
      'OP01-064',
      // Batch 6 — the cards that put cards on the field.
      'OP01-009',
      'OP01-014',
      'OP01-037',
      'OP01-060',
      'OP01-071',
      'OP01-082',
      'OP01-087',
      'OP01-104',
      // Batch 7 — the two cards that watch what somebody else did.
      'OP01-004',
      'OP01-062',
    ]);
    const KEYWORD_ONLY = /^\[(Blocker|Rush|Banish|Double Attack)\]/;
    for (const deck of OP01_TEST_DECKS) {
      for (const entry of deck.cards) {
        if (BATCH.has(entry.cardId)) {
          continue;
        }
        const card = findCard(entry.cardId);
        expect(card, entry.cardId).toBeDefined();
        if (card === undefined) {
          continue;
        }
        expect(card.triggerText, entry.cardId).toBeNull();
        const lines = (card.effectText ?? '')
          .split('<br>')
          .map((line) => line.trim())
          .filter(Boolean);
        const inert = card.effectText === '-' || lines.every((line) => KEYWORD_ONLY.test(line));
        expect(inert, `${entry.cardId}: ${card.effectText}`).toBe(true);
      }
    }
  });
});

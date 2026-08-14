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
      // Batch 10 - add DON!! from the DON!! deck.
      'OP01-061',
      'OP01-093',
      'OP01-101',
      'OP01-106',
      'OP01-113',
      'OP01-115',
      'OP01-118',
      'OP01-119',
      // Batch 9 - look at the deck, keep one, bury the rest in order.
      'OP01-030',
      'OP01-041',
      'OP01-084',
      'OP01-116',
      // Batch 8 - modifiable legality.
      'OP01-021',
      'OP01-112',
      'OP01-120',
      // The starter-completion batch - the duration that outlives its turn.
      'OP01-085',
      // The top-or-bottom partition, the campaign's last capability.
      'OP01-073',
      'OP01-077',
      // The closing batch - the last eight OP-01 cards that can be written.
      // After these the set is 118 of 121; the three that remain are declared
      // rows, not a queue.
      'OP01-019',
      'OP01-051',
      'OP01-063',
      'OP01-067',
      'OP01-072',
      'OP01-083',
      'OP01-105',
      // The DON!! count condition and the two new cost families - eight cards
      // across three census rows.
      'OP01-008',
      'OP01-011',
      'OP01-013',
      'OP01-047',
      'OP01-055',
      'OP01-091',
      'OP01-095',
      'OP01-109',
      // The player-chosen discard instruction - the census's four, and the
      // last half of the deterministic-discard divergence.
      'OP01-038',
      'OP01-088',
      'OP01-102',
      'OP01-114',
      // Reference by name - the closing census's twelve.
      'OP01-005',
      'OP01-015',
      'OP01-016',
      'OP01-040',
      'OP01-042',
      'OP01-044',
      'OP01-046',
      'OP01-049',
      'OP01-050',
      'OP01-074',
      'OP01-090',
      'OP01-099',
    ]);
    /**
     * The one card in a fixture that is neither scripted nor inert, and the
     * exception is a finding rather than a convenience.
     *
     * `OP01-075` Pacifista prints "Under the rules of this game, you may have
     * any number of this card in your deck" above its `[Blocker]`. That is not a
     * keyword and it is not an ability — it is a **deck-construction** rule, the
     * only wall in `docs/op01-closing-census.md` that lives outside the DSL
     * entirely, and one `validateDecklist` does not honour: it enforces a flat
     * `MAX_COPIES = 4`, so a legal Pacifista deck is rejected by our own
     * validator today.
     *
     * It is in a fixture because `OP01-074`'s whole ability is "play up to 1
     * [Pacifista] from your hand", and a deck holding none would let that card
     * resolve into nothing forever while looking healthy. Four copies, which is
     * what the rule we implement allows.
     *
     * Listed separately from `BATCH` on purpose. `BATCH` means "an ability is
     * written for this card"; nothing is written for this one, and folding it in
     * there would hide a card with live printed text among cards whose text is
     * implemented.
     */
    const PRINTED_TEXT_THAT_IS_NOT_AN_ABILITY = new Set(['OP01-075']);
    const KEYWORD_ONLY = /^\[(Blocker|Rush|Banish|Double Attack)\]/;
    for (const deck of OP01_TEST_DECKS) {
      for (const entry of deck.cards) {
        if (BATCH.has(entry.cardId) || PRINTED_TEXT_THAT_IS_NOT_AN_ABILITY.has(entry.cardId)) {
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

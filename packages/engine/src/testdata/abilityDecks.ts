import type { CardId, Decklist } from '../types.js';
import { ABIL_CARDS } from './abilities.js'; // self-registers the ABIL set on import

/**
 * Decks built from the ABIL set, for tests and for the simulation sweep.
 *
 * Kept in their own module so that importing the default decks never pulls the
 * ability cards in: `testdata/decks.ts` has no path to this file, which is what
 * keeps a browser game free of choices.
 */

const PLAYABLE: CardId[] = ABIL_CARDS.filter((def) => def.category !== 'leader').map(
  (def) => def.cardId,
);

function buildAbilityDeck(): CardId[] {
  const cards: CardId[] = [];
  for (const cardId of PLAYABLE) {
    cards.push(cardId, cardId);
  }
  // Top up to 50 with the [Trigger] card, so life cards carrying one are common
  // enough for the sweep to reach that branch.
  while (cards.length < 50) {
    cards.push('ABIL-021');
  }
  if (cards.length !== 50) {
    throw new Error(`ability deck has ${cards.length} cards, expected 50`);
  }
  return cards;
}

export const ABIL_DECK: Decklist = { leader: 'ABIL-L01', cards: buildAbilityDeck() };

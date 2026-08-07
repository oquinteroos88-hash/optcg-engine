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

/**
 * The [Trigger] card, and the number of copies tests may stage into the life
 * area at once. `keywords.test.ts` places two `ABIL-021` life cards to prove a
 * [Trigger] fires from life, so the deck must carry at least this many — a
 * property that was previously true only by accident of the 25×2 doubling.
 */
const TRIGGER_CARD: CardId = 'ABIL-021';
const TRIGGER_COPIES_NEEDED = 2;

function buildAbilityDeck(): CardId[] {
  const cards: CardId[] = [];
  for (const cardId of PLAYABLE) {
    cards.push(cardId, cardId);
  }
  // Top up to 50 with the [Trigger] card, so life cards carrying one are common
  // enough for the sweep to reach that branch.
  while (cards.length < 50) {
    cards.push(TRIGGER_CARD);
  }
  if (cards.length !== 50) {
    throw new Error(`ability deck has ${cards.length} cards, expected 50`);
  }
  // Guarantee the staging property outright rather than leaning on the card
  // count: the next card added to the set must not silently starve it.
  const triggerCopies = cards.filter((id) => id === TRIGGER_CARD).length;
  if (triggerCopies < TRIGGER_COPIES_NEEDED) {
    throw new Error(
      `ability deck has ${triggerCopies} ${TRIGGER_CARD}, needs ${TRIGGER_COPIES_NEEDED} for life staging`,
    );
  }
  return cards;
}

export const ABIL_DECK: Decklist = { leader: 'ABIL-L01', cards: buildAbilityDeck() };

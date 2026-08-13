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

/**
 * Cards a staged position needs **two of at once**, and which therefore get
 * their second copy before any other card gets one.
 *
 * The list exists because the accident it replaces stopped being true. While
 * the set held 25 playable cards, two of each came to exactly 50 and every card
 * was paired for free; at 28 the deck can only afford 22 second copies, and
 * which cards got them was list order — that is, nothing. `ABIL-023`'s two
 * cases went red on the next card added, with a message about a deck rather
 * than about a keyword.
 *
 * So the requirement is written down and checked. A test that needs a pair and
 * is not named here fails loudly at the scenario, which is the same trade
 * `TRIGGER_COPIES_NEEDED` already made.
 */
const PAIRED: readonly CardId[] = ['ABIL-021', 'ABIL-022', 'ABIL-023'];

const DECK_SIZE = 50;

/**
 * One copy of every ABIL card, then second copies — `PAIRED` first — while
 * there is room, then the `[Trigger]` card to the deck limit.
 *
 * It used to be two of each and a top-up, which worked while the set happened to
 * hold exactly 25 playable cards and threw the moment it held 28. The order
 * matters and is not alphabetical luck: **every** card gets its first copy
 * before any card gets its second, so adding a card to the set can never push an
 * older one out of the deck entirely — which would take its whole ability out of
 * the simulation sweep without a single test naming it.
 */
function buildAbilityDeck(): CardId[] {
  const cards: CardId[] = [...PLAYABLE];
  for (const cardId of [...PAIRED, ...PLAYABLE]) {
    if (cards.length >= DECK_SIZE) {
      break;
    }
    if (cards.filter((id) => id === cardId).length >= 2) {
      continue;
    }
    cards.push(cardId);
  }
  // Top up to 50 with the [Trigger] card, so life cards carrying one are common
  // enough for the sweep to reach that branch.
  while (cards.length < DECK_SIZE) {
    cards.push(TRIGGER_CARD);
  }
  if (cards.length > DECK_SIZE) {
    throw new Error(`ability deck has ${cards.length} cards, expected ${DECK_SIZE}`);
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

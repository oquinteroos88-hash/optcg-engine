import { readFileSync } from 'node:fs';
import type { CardId, Decklist as EngineDecklist } from '@optcg/engine';
import { findCard } from './cards.js';
import type { Decklist } from './types.js';

const DECK_SIZE = 50;
const MAX_COPIES = 4;

/**
 * Checks a transcribed decklist against the deckbuilding rules.
 *
 * Returns the problems instead of throwing one at a time: a decklist is typed
 * by hand from the product, so when it is wrong it is usually wrong in more
 * than one place, and seeing all of it at once is what makes the transcription
 * fixable. Nothing here repairs a list — a deck that does not add up is a
 * transcription error, and quietly padding it to 50 would hide exactly the bug
 * this function exists to find.
 */
export function validateDecklist(deck: Decklist): string[] {
  const problems: string[] = [];
  const leader = findCard(deck.leader);

  if (leader === undefined) {
    problems.push(`leader ${deck.leader} is not in the card set`);
  } else if (leader.category !== 'leader') {
    problems.push(`leader ${deck.leader} is a ${leader.category}, not a Leader`);
  }

  const total = deck.cards.reduce((sum, entry) => sum + entry.qty, 0);
  if (total !== DECK_SIZE) {
    problems.push(`${total} cards outside the Leader, expected exactly ${DECK_SIZE}`);
  }

  const seen = new Set<CardId>();
  for (const { cardId, qty } of deck.cards) {
    if (seen.has(cardId)) problems.push(`${cardId} is listed more than once`);
    seen.add(cardId);

    if (!Number.isInteger(qty) || qty < 1) {
      problems.push(`${cardId} has an invalid quantity ${JSON.stringify(qty)}`);
    } else if (qty > MAX_COPIES) {
      problems.push(`${cardId} appears ${qty} times, more than the ${MAX_COPIES} allowed`);
    }

    const card = findCard(cardId);
    if (card === undefined) {
      problems.push(`${cardId} is not in the card set`);
      continue;
    }
    if (card.category === 'leader') {
      problems.push(`${cardId} is a Leader and cannot be in the main deck`);
    }
    // OPTCG deckbuilding: a card is legal when it shares a color with the
    // Leader — which for a two-color card means either of its colors.
    if (leader !== undefined && !card.colors.some((color) => leader.colors.includes(color))) {
      problems.push(
        `${cardId} is ${card.colors.join('/')}, which shares no color with the ${leader.colors.join('/')} Leader`,
      );
    }
  }

  return problems;
}

/** Expands the authored multiplicities into the flat 50 ids the engine takes. */
export function toEngineDecklist(deck: Decklist): EngineDecklist {
  const cards: CardId[] = [];
  for (const { cardId, qty } of deck.cards) {
    for (let i = 0; i < qty; i += 1) cards.push(cardId);
  }
  return { leader: deck.leader, cards };
}

function loadDecklist(file: string): Decklist {
  const deck = JSON.parse(
    readFileSync(new URL(`../data/decklists/${file}`, import.meta.url), 'utf8'),
  ) as Decklist;
  const problems = validateDecklist(deck);
  if (problems.length > 0) {
    throw new Error(`${file} is not a legal deck:\n  - ${problems.join('\n  - ')}`);
  }
  return Object.freeze(deck);
}

/** Starter Deck ST-01 "Straw Hat Crew". */
export const ST01_DECK: Decklist = loadDecklist('st01.json');

/** Starter Deck ST-02 "Worst Generation". */
export const ST02_DECK: Decklist = loadDecklist('st02.json');

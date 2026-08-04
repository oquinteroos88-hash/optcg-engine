import type { CardId, Decklist } from '../types.js';
import './cards.js'; // self-registers the TEST set on import

function copies(cardId: CardId, count: number): CardId[] {
  return Array.from({ length: count }, () => cardId);
}

// 4x10 characters + 4x2 events + 2x1 stage = 50 cards.
function buildDeck(leader: CardId, prefix: string): Decklist {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const cards: CardId[] = [];
  for (let i = 1; i <= 10; i += 1) {
    cards.push(...copies(`${prefix}${pad(i)}`, 4));
  }
  cards.push(...copies(`${prefix}11`, 4));
  cards.push(...copies(`${prefix}12`, 4));
  cards.push(...copies(`${prefix}13`, 2));
  return { leader, cards };
}

export const RED_DECK: Decklist = buildDeck('TEST-L01', 'TEST-0');
export const GREEN_DECK: Decklist = buildDeck('TEST-L02', 'TEST-1');

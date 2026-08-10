import type { CardId, Decklist as EngineDecklist } from '@optcg/engine';
import type { Decklist } from './types.js';

/**
 * Expands the authored multiplicities into the flat 50 ids the engine takes.
 *
 * Its own module because it is the one piece of `decklists.ts` a browser can
 * use: that file reads the decklist JSON with `node:fs`, and importing it to
 * get this function would drag a Node builtin into the client bundle. See
 * `starters.ts`.
 */
export function toEngineDecklist(deck: Decklist): EngineDecklist {
  const cards: CardId[] = [];
  for (const { cardId, qty } of deck.cards) {
    for (let i = 0; i < qty; i += 1) cards.push(cardId);
  }
  return { leader: deck.leader, cards };
}

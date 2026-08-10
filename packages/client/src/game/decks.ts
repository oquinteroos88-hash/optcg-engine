// Importing the engine test decks also registers the TEST card set as a side
// effect; keep this the client's single entry point for deck data.
import { GREEN_DECK, RED_DECK } from '@optcg/engine/testdata/decks';
import {
  registerStarterCards,
  starterDecklists,
  toEngineDecklist,
} from '@optcg/cards/starters';
import type { Decklist } from '@optcg/engine';

export interface DeckCatalogEntry {
  id: string;
  name: string;
  deck: Decklist;
  /** False for the TEST decks: vanilla cards, no printed text, no abilities. */
  real: boolean;
}

// The real cards have to be in the registry before a game built from them is
// created, and this module is the only place a deck comes from.
registerStarterCards();

const STARTER_ENTRIES: DeckCatalogEntry[] = starterDecklists.map((deck) => ({
  id: deck.id,
  name: `${deck.id} ${deck.name}`,
  deck: toEngineDecklist(deck),
  real: true,
}));

/**
 * Real decks first: they are what the client is for. The TEST decks stay
 * because every affordance test and the phase 1 click-routing suite are built
 * on them, and because a board of vanilla cards is the fastest way to tell a
 * rules bug apart from an ability bug.
 */
export const DECK_CATALOG: readonly DeckCatalogEntry[] = [
  ...STARTER_ENTRIES,
  { id: 'red', name: 'Rojo (TEST)', deck: RED_DECK, real: false },
  { id: 'green', name: 'Verde (TEST)', deck: GREEN_DECK, real: false },
];

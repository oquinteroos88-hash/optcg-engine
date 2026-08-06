// Importing the engine test decks also registers the TEST card set as a side
// effect; keep this the client's single entry point for deck data.
import { GREEN_DECK, RED_DECK } from '@optcg/engine/testdata/decks';
import type { Decklist } from '@optcg/engine';

export interface DeckCatalogEntry {
  id: string;
  name: string;
  deck: Decklist;
}

export const DECK_CATALOG: readonly DeckCatalogEntry[] = [
  { id: 'red', name: 'Red (TEST)', deck: RED_DECK },
  { id: 'green', name: 'Green (TEST)', deck: GREEN_DECK },
];

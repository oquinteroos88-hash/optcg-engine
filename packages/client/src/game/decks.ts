// Importing the engine test decks also registers the TEST card set as a side
// effect; keep this the client's single entry point for deck data.
import { GREEN_DECK, RED_DECK } from '@optcg/engine/testdata/decks';
import {
  registerStarterCards,
  starterDecklists,
  toEngineDecklist,
} from '@optcg/cards/starters';
import type { Decklist } from '@optcg/engine';
import type { Messages } from '../i18n';

export interface DeckCatalogEntry {
  id: string;
  /**
   * The product's own name — "ST-01 Straw Hat Crew" — and therefore not
   * translated: it is printed on the box in English, like every card name.
   * Empty for the TEST decks, which are this project's own and carry a
   * `nameKey` instead.
   */
  name: string;
  /** Set on the TEST decks: their name is UI copy, so it has one per language. */
  nameKey: 'testRed' | 'testGreen' | null;
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
  nameKey: null,
  deck: toEngineDecklist(deck),
  real: true,
}));

/** One deck's name, in the language it has one in. Product names have only one. */
export function deckName(entry: DeckCatalogEntry, m: Messages): string {
  return entry.nameKey === null ? entry.name : m.deck[entry.nameKey];
}

/**
 * Real decks first: they are what the client is for. The TEST decks stay
 * because every affordance test and the phase 1 click-routing suite are built
 * on them, and because a board of vanilla cards is the fastest way to tell a
 * rules bug apart from an ability bug.
 */
export const DECK_CATALOG: readonly DeckCatalogEntry[] = [
  ...STARTER_ENTRIES,
  { id: 'red', name: '', nameKey: 'testRed', deck: RED_DECK, real: false },
  { id: 'green', name: '', nameKey: 'testGreen', deck: GREEN_DECK, real: false },
];

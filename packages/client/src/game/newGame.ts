import { createGame } from '@optcg/engine';
import type { Decklist, GameState, PlayerId } from '@optcg/engine';
import { DECK_CATALOG } from './decks';

export interface SetupConfig {
  seed: number;
  deckIdP1: string;
  deckIdP2: string;
  firstPlayer: PlayerId;
}

function deckById(id: string): Decklist {
  const entry = DECK_CATALOG.find((candidate) => candidate.id === id);
  if (entry === undefined) {
    throw new Error(`unknown deck id: ${id}`);
  }
  return entry.deck;
}

/** The store's only way to start a game; keeps engine value imports in game/. */
export function createGameFromSetup(cfg: SetupConfig): GameState {
  return createGame({
    seed: cfg.seed,
    decks: { p1: deckById(cfg.deckIdP1), p2: deckById(cfg.deckIdP2) },
    firstPlayer: cfg.firstPlayer,
  });
}

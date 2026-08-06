import type { CardDefinition, CardId } from '@optcg/engine';

/**
 * A printed card as this package publishes it.
 *
 * Extends the engine's `CardDefinition` rather than replacing it: the engine
 * reads exactly the fields it already knows, and the extra ones are printed
 * data it has no opinion about. The extension is additive on purpose — the
 * engine must not learn where its cards came from.
 *
 * `effectText` and `triggerText` are the printed text, verbatim and unparsed.
 * Turning them into `Ability` scripts is a separate piece of work; storing the
 * text now means that work can be checked against the card instead of against
 * someone's memory of it.
 */
export interface EnglishCardDefinition extends CardDefinition {
  /**
   * Every printed color. `CardDefinition.color` carries the first one so the
   * engine's single-color field keeps working; deck legality reads this list,
   * because a two-color card is legal under either of its colors.
   */
  colors: readonly string[];
  /** Printed attributes ("Slash", "Strike"). Empty on Events and Stages. */
  attributes: readonly string[];
  types: readonly string[];
  effectText: string | null;
  triggerText: string | null;
}

export interface DeckEntry {
  cardId: CardId;
  qty: number;
}

/**
 * A decklist as printed on the product: multiplicities, not 50 repeated ids.
 *
 * The engine's own `Decklist` is the flat 50-card form it needs to build a
 * deck; `toEngineDecklist` expands this into that. Keeping the authored form
 * separate is what makes a transcription error visible — "4x Usopp" is
 * checkable against the box, fifty shuffled ids are not.
 */
export interface Decklist {
  /** Product code, "ST-01". */
  id: string;
  name: string;
  packId: string;
  leader: CardId;
  cards: readonly DeckEntry[];
}

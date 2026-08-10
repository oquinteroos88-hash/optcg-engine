import { findStarterCard } from '@optcg/cards/starters';
import type { CardId } from '@optcg/engine';

/**
 * The printed text of a card, for the player to read.
 *
 * The engine's `CardDefinition` carries no text at all — deliberately, it has
 * no use for it — so it comes from `@optcg/cards`. Through the `/starters`
 * entry rather than the main one, because the main entry reads 1.5 MB of JSON
 * with `node:fs` and this is a browser bundle.
 *
 * Undefined for the TEST cards, which print no text and are not in that set.
 * A vanilla card and an unknown one look the same here, and should: neither has
 * anything to show.
 */
export interface PrintedText {
  effectText: string | null;
  triggerText: string | null;
  types: readonly string[];
  attributes: readonly string[];
}

const NONE: PrintedText = Object.freeze({
  effectText: null,
  triggerText: null,
  types: Object.freeze([]),
  attributes: Object.freeze([]),
});

export function printedTextOf(cardId: CardId): PrintedText {
  const card = findStarterCard(cardId);
  if (card === undefined) {
    return NONE;
  }
  return {
    effectText: card.effectText,
    triggerText: card.triggerText,
    types: card.types,
    attributes: card.attributes,
  };
}

/** True when there is anything worth opening a text panel for. */
export function hasPrintedText(cardId: CardId): boolean {
  const text = printedTextOf(cardId);
  return text.effectText !== null || text.triggerText !== null;
}

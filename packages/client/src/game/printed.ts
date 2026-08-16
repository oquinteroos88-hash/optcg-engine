import { findStarterCard, findStarterTextEs } from '@optcg/cards/starters';
import type { CardId } from '@optcg/engine';
import type { Locale } from '../i18n/locale';

/**
 * The printed text of a card, for the player to read, in the language they read.
 *
 * The engine's `CardDefinition` carries no text at all — deliberately, it has
 * no use for it — so it comes from `@optcg/cards`. Through the `/starters`
 * entry rather than the main one, because the main entry reads 1.5 MB of JSON
 * with `node:fs` and this is a browser bundle.
 *
 * **The card's name is not in here, and that is the design.** Names stay
 * English everywhere: the art prints "Monkey.D.Luffy" and "Gum-Gum Jet Pistol",
 * and a child has to be able to match what the panel says against the picture.
 * The engine also resolves names by English string (PR #38), so a translated
 * name would be a rules change wearing a translation's clothes.
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
  /**
   * True when what is above is a translation rather than the printed English.
   *
   * The panel says so, quietly, because it is true and because there is no
   * official Spanish printing to mistake it for. False for English, and false
   * for a card with no text at all — there is nothing to have translated.
   */
  translated: boolean;
}

const NONE: PrintedText = Object.freeze({
  effectText: null,
  triggerText: null,
  types: Object.freeze([]),
  attributes: Object.freeze([]),
  translated: false,
});

/**
 * The dataset stores the printed text verbatim, and verbatim includes the three
 * `<br>` the official site uses to split a two-ability card. `@optcg/cards`
 * documents that text as unparsed and it should stay that way — turning it into
 * a line break is a display decision, so it is made here, once, where both the
 * tooltip and the preview panel read it.
 */
function lines(text: string | null): string | null {
  return text === null ? null : text.replace(/<br\s*\/?>/gi, '\n');
}

export function printedTextOf(cardId: CardId, locale: Locale): PrintedText {
  const card = findStarterCard(cardId);
  if (card === undefined) {
    return NONE;
  }
  // A card with no Spanish entry falls back to the English rather than to
  // nothing — but it cannot happen for a card that is on the board, because
  // `cards.es.json` covers all 155 and `packages/cards/tests/spanish.test.ts`
  // fails if that ever stops being true. The branch is here for the TEST-set
  // shape of the type, not as a translation policy.
  const spanish = locale === 'es' ? findStarterTextEs(cardId) : undefined;
  if (spanish !== undefined) {
    return {
      effectText: lines(spanish.effectText),
      triggerText: lines(spanish.triggerText),
      types: card.types,
      attributes: card.attributes,
      translated: true,
    };
  }
  return {
    effectText: lines(card.effectText),
    triggerText: lines(card.triggerText),
    types: card.types,
    attributes: card.attributes,
    translated: false,
  };
}

/** True when there is anything worth opening a text panel for. */
export function hasPrintedText(cardId: CardId, locale: Locale): boolean {
  const text = printedTextOf(cardId, locale);
  return text.effectText !== null || text.triggerText !== null;
}

import { readFileSync } from 'node:fs';
import type { CardId } from '@optcg/engine';
import { englishCards } from './cards.js';
import type { SpanishSource, SpanishText } from './spanish-types.js';

/**
 * The Spanish printed text, read from the committed JSON.
 *
 * **Presentation only.** Nothing in the engine, in `abilities.ts`, or in the
 * name-resolution guard of PR #38 reads a word of this: the scripts were
 * derived from the English `effectText` and match English strings. Translating
 * a card cannot change what it does, and this module has no way to make it.
 *
 * Read from disk for the same reason `cards.ts` is — JSON import attributes are
 * still a moving target, and this is data rather than a module. The browser
 * client does not come through here: the 34 starter texts it needs are emitted
 * into `starters.generated.ts`, which has no Node builtin in its import graph.
 */
const DATA_URL = new URL('../data/cards.es.json', import.meta.url);

export type { SpanishSource, SpanishText } from './spanish-types.js';

interface SpanishFile {
  translatedFrom: SpanishSource;
  cards: Record<string, SpanishText>;
}

function fail(message: string): never {
  throw new Error(`cards.es.json: ${message}`);
}

function load(): SpanishFile {
  const parsed = JSON.parse(readFileSync(DATA_URL, 'utf8')) as SpanishFile;
  const source = parsed.translatedFrom;
  if (typeof source?.commit !== 'string' || source.commit === '') {
    fail('no translatedFrom.commit — the revision of the English is not declared');
  }
  const known = new Set<CardId>(englishCards.map((card) => card.cardId));
  const entries = Object.entries(parsed.cards ?? {});
  if (entries.length === 0) {
    fail('no entries');
  }
  for (const [cardId, text] of entries) {
    // A typo here would otherwise attach to nothing and fail silently: the card
    // would simply show its English text, which is exactly what an untranslated
    // card looks like.
    if (!known.has(cardId)) {
      fail(`${cardId} is not a card in this set`);
    }
    if (typeof text.effectText !== 'string' || text.effectText === '') {
      fail(`${cardId}: missing effectText`);
    }
    if (text.triggerText !== null && typeof text.triggerText !== 'string') {
      fail(`${cardId}: triggerText must be a string or null`);
    }
  }
  return parsed;
}

const file = load();

/** The pin the translation inherits from `cards.en.json`. */
export const SPANISH_SOURCE: SpanishSource = Object.freeze(file.translatedFrom);

const byId = new Map<CardId, SpanishText>(
  Object.entries(file.cards).map(([cardId, text]) => [cardId, Object.freeze(text)]),
);

/** Undefined for a card with no translation — never a silent fallback to English. */
export function findSpanishText(cardId: CardId): SpanishText | undefined {
  return byId.get(cardId);
}

/** Every translated card id, so a coverage test can count them. */
export const spanishCardIds: readonly CardId[] = Object.freeze([...byId.keys()]);

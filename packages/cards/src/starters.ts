import { registerCardSet } from '@optcg/engine';
import type { CardId } from '@optcg/engine';
import { CARD_ABILITIES } from './abilities.js';
import { STARTER_CARDS, STARTER_DECKLISTS, STARTER_TEXT_ES } from './starters.generated.js';
import type { SpanishText } from './spanish-types.js';
import type { Decklist, EnglishCardDefinition } from './types.js';

/**
 * The two starter decks, for consumers that cannot read files.
 *
 * The package's main entry loads `data/cards.en.json` through `node:fs` — the
 * right call for 1.5 MB of data on Node, and unavailable in a browser bundle.
 * This entry serves the same cards from a generated module instead, so the
 * client can register a real card set without a Node builtin anywhere in its
 * import graph. Nothing here is a second source of truth:
 * `tests/starters.test.ts` pins the generated data against the JSON.
 *
 * Abilities are attached here rather than baked into the generated module, for
 * the same reason `cards.ts` attaches them: a script is code, not data.
 */
function withAbilities(card: EnglishCardDefinition): EnglishCardDefinition {
  const abilities = CARD_ABILITIES[card.cardId];
  return Object.freeze(abilities === undefined ? { ...card } : { ...card, abilities });
}

export const starterCards: readonly EnglishCardDefinition[] = Object.freeze(
  STARTER_CARDS.map(withAbilities),
);

const byId = new Map<CardId, EnglishCardDefinition>(
  starterCards.map((card) => [card.cardId, card]),
);

/** Printed data for a starter card, text included. Undefined outside ST-01/ST-02. */
export function findStarterCard(cardId: CardId): EnglishCardDefinition | undefined {
  return byId.get(cardId);
}

/**
 * The Spanish printed text for a starter card. Undefined outside ST-01/ST-02.
 *
 * **Presentation only, and a separate lookup on purpose.** It is not a field on
 * `EnglishCardDefinition` and never will be: the engine reads that type, the
 * scripts were derived from its English text, and a translated string that
 * could reach a rules decision is the one thing this whole layer exists to
 * prevent. The caller asks for a language; nothing asks it for one.
 */
export function findStarterTextEs(cardId: CardId): SpanishText | undefined {
  return STARTER_TEXT_ES[cardId];
}

/** Publishes the starter cards through the engine's registry. Idempotent. */
export function registerStarterCards(): void {
  registerCardSet(starterCards);
}

/** ST-01 "Straw Hat Crew" and ST-02 "Worst Generation", in product order. */
export const starterDecklists: readonly Decklist[] = STARTER_DECKLISTS;

export { toEngineDecklist } from './expand.js';
export type { SpanishText } from './spanish-types.js';
export type { Decklist, DeckEntry, EnglishCardDefinition } from './types.js';

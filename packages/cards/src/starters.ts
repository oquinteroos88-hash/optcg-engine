import { registerCardSet } from '@optcg/engine';
import type { CardId } from '@optcg/engine';
import { STARTER_ABILITIES } from './abilities.js';
import { STARTER_CARDS, STARTER_DECKLISTS } from './starters.generated.js';
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
  const abilities = STARTER_ABILITIES[card.cardId];
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

/** Publishes the starter cards through the engine's registry. Idempotent. */
export function registerStarterCards(): void {
  registerCardSet(starterCards);
}

/** ST-01 "Straw Hat Crew" and ST-02 "Worst Generation", in product order. */
export const starterDecklists: readonly Decklist[] = STARTER_DECKLISTS;

/**
 * Where each starter card's printed art lives upstream, read from the pinned
 * dataset by `scripts/gen-starter-images.ts`.
 *
 * Published here rather than on `CardDefinition`, which stays free of
 * presentation: an image address is not a rule. Only
 * `scripts/download-card-images.ts` consumes it; the client asks its own local
 * cache by card id and never touches these addresses.
 */
export { STARTER_IMAGE_URLS } from './starterImages.generated.js';

export { toEngineDecklist } from './expand.js';
export type { Decklist, DeckEntry, EnglishCardDefinition } from './types.js';

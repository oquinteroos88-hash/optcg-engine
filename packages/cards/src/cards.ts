import { readFileSync } from 'node:fs';
import { registerCardSet } from '@optcg/engine';
import type { CardId } from '@optcg/engine';
import { STARTER_ABILITIES } from './abilities.js';
import type { EnglishCardDefinition } from './types.js';

/**
 * The normalized set, read from the committed JSON.
 *
 * Read from disk rather than imported: JSON import attributes are still a
 * moving target across Node and bundler versions, and this file is 1.4 MB of
 * data, not a module. Nothing here touches the network — the JSON is committed,
 * and `scripts/ingest.ts` is the only thing that ever fetches anything.
 *
 * The path is relative to this module, so it resolves the same from `src/`
 * under vitest and from `dist/` after a build.
 */
const DATA_URL = new URL('../data/cards.en.json', import.meta.url);

const CATEGORIES = new Set(['leader', 'character', 'event', 'stage']);

function fail(cardId: string, message: string): never {
  throw new Error(`cards.en.json: ${cardId}: ${message}`);
}

/**
 * Validates one record against the shape the engine expects.
 *
 * The data is scrape-derived, so its shape is a claim rather than a guarantee —
 * and a bad record would otherwise surface much later as an odd power total in
 * the middle of a battle, where nothing points back at the JSON.
 */
function validate(card: EnglishCardDefinition, seen: Set<CardId>): void {
  const id = card.cardId;
  if (typeof id !== 'string' || id === '') fail(String(id), 'missing cardId');
  if (seen.has(id)) fail(id, 'duplicate cardId');
  if (id.includes('_')) fail(id, 'parallel printing leaked into the set');
  if (typeof card.name !== 'string' || card.name === '') fail(id, 'missing name');
  if (!CATEGORIES.has(card.category)) fail(id, `unknown category ${String(card.category)}`);

  for (const field of ['cost', 'power', 'life'] as const) {
    const value = card[field];
    if (!Number.isInteger(value) || value < 0) {
      fail(id, `${field} must be a non-negative integer, got ${JSON.stringify(value)}`);
    }
  }

  // Not `> 0`: a card with no printed Counter is null, and 0 is not a value the
  // printed card can carry. Encoding "no Counter" as 0 would make it look like
  // a legal Counter-step play worth nothing.
  if (card.counter !== null && (!Number.isInteger(card.counter) || card.counter <= 0)) {
    fail(id, `counter must be null or a positive integer, got ${JSON.stringify(card.counter)}`);
  }

  if (card.category === 'leader') {
    if (card.cost !== 0) fail(id, `a Leader has no cost, got ${card.cost}`);
    if (card.life < 1) fail(id, `a Leader needs Life, got ${card.life}`);
  } else if (card.life !== 0) {
    fail(id, `only Leaders have Life, got ${card.life}`);
  }

  if (!Array.isArray(card.colors) || card.colors.length === 0) fail(id, 'no colors');
  if (card.color !== card.colors[0]) fail(id, 'color is not the first printed color');
  if (!Array.isArray(card.types) || card.types.length === 0) fail(id, 'no types');
  if (!Array.isArray(card.attributes)) fail(id, 'attributes is not an array');
  if (!Array.isArray(card.keywords)) fail(id, 'keywords is not an array');
  // Characters and Leaders are the only cards that ever go to the field, and
  // both are printed with an attribute.
  if ((card.category === 'character' || card.category === 'leader') && card.attributes.length === 0) {
    fail(id, 'a Leader or Character with no attributes');
  }

  seen.add(id);
}

/**
 * Attaches the scripted effects to the definitions that have them.
 *
 * The printed data comes from JSON and the effects come from code, so they meet
 * here rather than in one literal the way the `TEST` and `ABIL` sets write
 * them. A card with no entry keeps no `abilities` key at all, which is what
 * `getAbilities` already treats as "vanilla".
 */
function withAbilities(card: EnglishCardDefinition): EnglishCardDefinition {
  const abilities = STARTER_ABILITIES[card.cardId];
  if (abilities === undefined) {
    return Object.freeze(card);
  }
  const ids = new Set(abilities.map((ability) => ability.id));
  if (ids.size !== abilities.length) {
    fail(card.cardId, 'two abilities share an id');
  }
  return Object.freeze({ ...card, abilities });
}

function load(): EnglishCardDefinition[] {
  const cards = JSON.parse(readFileSync(DATA_URL, 'utf8')) as EnglishCardDefinition[];
  if (!Array.isArray(cards) || cards.length === 0) {
    throw new Error('cards.en.json: expected a non-empty array');
  }
  const seen = new Set<CardId>();
  for (const card of cards) validate(card, seen);

  // A mistyped key in STARTER_ABILITIES would otherwise attach to nothing and
  // fail silently: the card would simply have no effect, which is exactly what
  // a vanilla card looks like.
  for (const cardId of Object.keys(STARTER_ABILITIES)) {
    if (!seen.has(cardId)) {
      throw new Error(`abilities.ts: ${cardId} is not a card in this set`);
    }
  }
  return cards.map(withAbilities);
}

/** Every English card, parallels excluded, sorted by card id. */
export const englishCards: readonly EnglishCardDefinition[] = Object.freeze(load());

const byId = new Map<CardId, EnglishCardDefinition>(
  englishCards.map((card) => [card.cardId, card]),
);

/** Lookup that does not go through the engine registry. */
export function findCard(cardId: CardId): EnglishCardDefinition | undefined {
  return byId.get(cardId);
}

/**
 * Publishes the set through the engine's public registry — the same door the
 * `TEST` and `ABIL` sets use. Idempotent: the registry is keyed by card id.
 */
export function registerEnglishCards(): void {
  registerCardSet(englishCards);
}

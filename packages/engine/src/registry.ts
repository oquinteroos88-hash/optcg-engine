import type { Ability } from './abilities/dsl.js';
import type { CardId } from './types.js';

export type CardCategory = 'leader' | 'character' | 'event' | 'stage';

// Static printed data. Lives outside GameState; the state stores only cardId.
export interface CardDefinition {
  cardId: CardId;
  name: string;
  category: CardCategory;
  color: string;
  cost: number; // leaders: 0
  power: number;
  /**
   * Printed Counter value, or null when the card has none (the printed "—").
   *
   * Not 0: a card without a Counter value cannot be played during the Counter
   * Step at all, which is a different statement from one that adds nothing.
   * Encoding the absence as 0 invites reading it as a legal play worth zero.
   */
  counter: number | null;
  life: number; // leaders only; 0 otherwise
  /**
   * Printed keywords in their printed spelling: 'Blocker', 'Rush',
   * 'Double Attack', 'Banish'. The DSL's `Keyword` uses lowercase identifiers;
   * `hasKeyword` is the only place the two spellings meet.
   */
  keywords: string[];
  /** Card types ("Straw Hat Crew"). Optional so Phase 0 definitions still compile. */
  types?: readonly string[];
  /** Card effects. Absent on every vanilla card. */
  abilities?: readonly Ability[];
}

const NO_ABILITIES: readonly Ability[] = Object.freeze([]);

/** Never returns undefined, so callers do not each repeat the empty check. */
export function getAbilities(cardId: CardId): readonly Ability[] {
  return getCardDef(cardId).abilities ?? NO_ABILITIES;
}

const registry = new Map<CardId, CardDefinition>();

export function registerCardSet(defs: readonly CardDefinition[]): void {
  for (const def of defs) {
    registry.set(def.cardId, def);
  }
}

export function getCardDef(cardId: CardId): CardDefinition {
  const def = registry.get(cardId);
  if (def === undefined) {
    throw new Error(`Unknown card id: ${cardId}`);
  }
  return def;
}

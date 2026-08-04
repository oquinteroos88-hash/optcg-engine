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
  counter: number;
  life: number; // leaders only; 0 otherwise
  keywords: string[]; // empty for every Phase 0 card
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

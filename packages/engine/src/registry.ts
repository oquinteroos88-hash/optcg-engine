import type { Ability } from './abilities/dsl.js';
import type { CardId } from './types.js';

export type CardCategory = 'leader' | 'character' | 'event' | 'stage';

// Static printed data. Lives outside GameState; the state stores only cardId.
export interface CardDefinition {
  cardId: CardId;
  name: string;
  category: CardCategory;
  color: string;
  /**
   * Every colour the card possesses, first printed colour first. Optional so
   * Phase 0 definitions still compile; absent means `[color]`.
   *
   * The engine needed the plural the day a card compared two cards' colours
   * (`OP01-002`). CR 2-3-5 is why it is a set rather than a primary plus
   * extras: "cards with multiple colors, such as red and green, are treated as
   * **a card of every color they possess**" — there is no principal colour in
   * the rules, only a printed order.
   *
   * **Every two-colour card in the game is a Leader** — 68 of them, and not one
   * Character, Event or Stage. So `color` alone was never wrong in practice;
   * it was wrong in principle, which is a different thing and the reason this
   * field exists now rather than the day it first mattered.
   */
  colors?: readonly string[];
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

/**
 * A [Counter] Event is an Event whose text is a [Counter] ability — one that
 * answers to the `counterEvent` trigger. This is the gate that distinguishes it
 * from a plain Main-phase Event (which must never be activatable in the Counter
 * Step), shared by `legalActions` and the Counter-Step reducer.
 */
export function isCounterEvent(cardId: CardId): boolean {
  return getAbilities(cardId).some((ability) => ability.trigger === 'counterEvent');
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

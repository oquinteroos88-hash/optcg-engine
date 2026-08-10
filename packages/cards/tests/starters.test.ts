import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getAbilities, getCardDef } from '@optcg/engine';
import { englishCards, ST01_DECK, ST02_DECK, toEngineDecklist } from '../src/index.js';
import {
  findStarterCard,
  registerStarterCards,
  starterCards,
  starterDecklists,
} from '../src/starters.js';
import type { EnglishCardDefinition } from '../src/types.js';

/**
 * `src/starters.generated.ts` exists so the browser client can register real
 * cards without `node:fs`. A second copy of the data is only acceptable while
 * it is provably the same data, so this is the pin: regenerate with
 * `pnpm --filter @optcg/cards run gen:starters` when it fails.
 *
 * Two things are checked separately on purpose — that the module carries the
 * right *set* of cards, and that each record is byte-identical to the JSON —
 * because a stale regeneration usually gets one of them right.
 */

/** The printed fields, with the code-attached abilities stripped back off. */
function printed(card: EnglishCardDefinition): Omit<EnglishCardDefinition, 'abilities'> {
  const { abilities: _abilities, ...rest } = card;
  return rest;
}

describe('the generated starter module matches the card set it was cut from', () => {
  const decks = [ST01_DECK, ST02_DECK];
  const needed = new Set<string>();
  for (const deck of decks) {
    needed.add(deck.leader);
    for (const entry of deck.cards) needed.add(entry.cardId);
  }

  it('carries exactly the cards the two decklists name', () => {
    expect(starterCards.map((card) => card.cardId).sort()).toEqual([...needed].sort());
  });

  it('reproduces every printed field of every card', () => {
    for (const card of starterCards) {
      const source = englishCards.find((candidate) => candidate.cardId === card.cardId);
      expect(source, card.cardId).toBeDefined();
      if (source !== undefined) {
        expect(printed(card), card.cardId).toEqual(printed(source));
      }
    }
  });

  it('reproduces both decklists', () => {
    expect(starterDecklists.map((deck) => deck.id)).toEqual(['ST-01', 'ST-02']);
    expect(starterDecklists[0]).toEqual(ST01_DECK);
    expect(starterDecklists[1]).toEqual(ST02_DECK);
    // And they still expand to a legal 50.
    for (const deck of starterDecklists) {
      expect(toEngineDecklist(deck).cards).toHaveLength(50);
    }
  });

  it('keeps the printed text, which is what the client shows a player', () => {
    // Not incidental: with real cards a player cannot play what they cannot
    // read, and this module is the client's only source for that text.
    const withText = starterCards.filter(
      (card) => card.effectText !== null || card.triggerText !== null,
    );
    expect(withText.length).toBeGreaterThan(20);
    expect(findStarterCard('ST01-015')?.triggerText).toBe(
      englishCards.find((card) => card.cardId === 'ST01-015')?.triggerText,
    );
  });

  it('registers into the engine with the same abilities the main entry attaches', () => {
    registerStarterCards();
    for (const card of starterCards) {
      expect(getCardDef(card.cardId).name).toBe(card.name);
      const source = englishCards.find((candidate) => candidate.cardId === card.cardId);
      expect(getAbilities(card.cardId).map((ability) => ability.id)).toEqual(
        (source?.abilities ?? []).map((ability) => ability.id),
      );
    }
  });

  it('reaches the engine registry without a Node builtin in its import graph', () => {
    // The whole point of the entry. `starters.ts` may import `abilities.ts`,
    // `expand.ts`, `types.ts` and the generated module — none of which touch fs.
    const sources = ['starters.ts', 'starters.generated.ts', 'abilities.ts', 'expand.ts'];
    const NODE_IMPORT = /^\s*(?:import|export)\b[^\n]*?from\s+['"]node:/;
    for (const file of sources) {
      const offenders = readSource(file)
        .split(/\r?\n/)
        .filter((line) => NODE_IMPORT.test(line));
      expect(offenders, file).toEqual([]);
    }
  });
});

function readSource(file: string): string {
  return readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
}

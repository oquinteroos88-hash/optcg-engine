import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { englishCards } from '../src/index.js';

/**
 * The upstream dataset describes every card twice: once in
 * `english/index/cards_by_id.json` and once in `english/cards/<pack>/<id>.json`.
 * The normalized set is built from the per-card files (they are the only ones
 * carrying the effect text); `data/source-index.en.json` is the projection of
 * the *other* file, committed alongside it.
 *
 * Comparing them is a lie detector for the source that costs nothing and needs
 * no knowledge of what the right answer is: if the two files disagree about a
 * card, the scrape contradicts itself, and that is worth failing over whether or
 * not we can say which side is correct. It also re-checks the normalization,
 * since every comparison runs the documented mapping backwards.
 */

interface IndexEntry {
  name: string;
  category: string;
  colors: string[];
  cost: number | null;
  power: number | null;
  counter: number | null;
  types: string[];
  attributes: string[];
}

const sourceIndex = JSON.parse(
  readFileSync(new URL('../data/source-index.en.json', import.meta.url), 'utf8'),
) as Record<string, IndexEntry>;

const CATEGORY: Record<string, string> = {
  Leader: 'leader',
  Character: 'character',
  Event: 'event',
  Stage: 'stage',
};

describe('the two source files, joined by card id', () => {
  it('cover exactly the same cards', () => {
    const normalized = englishCards.map((card) => card.cardId).sort();
    const indexed = Object.keys(sourceIndex).sort();
    // Reported, not filtered: an id present in one file and missing from the
    // other is information about the dataset, not noise to drop.
    expect(indexed.filter((id) => !normalized.includes(id))).toEqual([]);
    expect(normalized.filter((id) => !indexed.includes(id))).toEqual([]);
  });

  it('agree on every field they both carry', () => {
    const divergences: string[] = [];

    for (const card of englishCards) {
      const entry = sourceIndex[card.cardId];
      if (entry === undefined) continue;
      const note = (field: string, a: unknown, b: unknown): void => {
        divergences.push(
          `${card.cardId}.${field}: normalized ${JSON.stringify(a)} vs index ${JSON.stringify(b)}`,
        );
      };

      if (entry.name !== card.name) note('name', card.name, entry.name);
      if (CATEGORY[entry.category] !== card.category) {
        note('category', card.category, entry.category);
      }

      const colors = entry.colors.map((color) => color.toLowerCase());
      if (colors.join(',') !== card.colors.join(',')) note('colors', card.colors, entry.colors);

      // The one field the two sources encode differently on purpose: for a
      // Leader the source's `cost` is Life.
      const sourceCost = entry.cost ?? 0;
      if (card.category === 'leader') {
        if (sourceCost !== card.life) note('life', card.life, entry.cost);
        if (card.cost !== 0) note('cost', card.cost, 0);
      } else if (sourceCost !== card.cost) {
        note('cost', card.cost, entry.cost);
      }

      if ((entry.power ?? 0) !== card.power) note('power', card.power, entry.power);
      if (entry.counter !== card.counter) note('counter', card.counter, entry.counter);
      if (entry.types.join(',') !== card.types.join(',')) note('types', card.types, entry.types);
      if (entry.attributes.join(',') !== card.attributes.join(',')) {
        note('attributes', card.attributes, entry.attributes);
      }
    }

    expect(divergences).toEqual([]);
  });
});

describe('where a normalized zero came from', () => {
  // `power: 0` and `cost: 0` reach the engine from two different places, and the
  // difference is invisible once they are numbers. These pin the source side, so
  // a blind `?? 0` creeping back into the ingest fails here.
  it('never reads a power off an Event or a Stage — their 0 is the category rule', () => {
    const printed = englishCards
      .filter((card) => card.category === 'event' || card.category === 'stage')
      .filter((card) => sourceIndex[card.cardId]?.power !== null);
    expect(printed.map((card) => card.cardId)).toEqual([]);
  });

  it('never reads a Leader cost as 0 — a Leader without one is a source failure', () => {
    const missing = englishCards
      .filter((card) => card.category === 'leader')
      .filter((card) => sourceIndex[card.cardId]?.cost === null);
    expect(missing.map((card) => card.cardId)).toEqual([]);
  });
});

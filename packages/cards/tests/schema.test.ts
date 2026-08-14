import { describe, expect, it } from 'vitest';
import { englishCards } from '../src/index.js';

/**
 * Counts frozen against the pinned source commit. If the ingest is re-run
 * against a newer upstream dataset and these move, that is the point: a data
 * refresh should be a visible, reviewed change, not a silent one.
 */
const EXPECTED_TOTAL = 2665;
const EXPECTED_BY_CATEGORY = { leader: 136, character: 2089, event: 393, stage: 47 };

describe('the normalized set', () => {
  it('holds exactly the expected number of cards, by category', () => {
    expect(englishCards).toHaveLength(EXPECTED_TOTAL);

    const byCategory: Record<string, number> = {};
    for (const card of englishCards) {
      byCategory[card.category] = (byCategory[card.category] ?? 0) + 1;
    }
    expect(byCategory).toEqual(EXPECTED_BY_CATEGORY);
  });

  it('has a unique id for every card', () => {
    const ids = new Set(englishCards.map((card) => card.cardId));
    expect(ids.size).toBe(englishCards.length);
  });

  it('excludes parallel printings', () => {
    const parallels = englishCards.filter((card) => card.cardId.includes('_'));
    expect(parallels.map((card) => card.cardId)).toEqual([]);
  });

  it('fills every field the engine reads', () => {
    for (const card of englishCards) {
      expect(typeof card.name, card.cardId).toBe('string');
      expect(card.name.length, card.cardId).toBeGreaterThan(0);
      expect(['leader', 'character', 'event', 'stage'], card.cardId).toContain(card.category);
      expect(Number.isInteger(card.cost), card.cardId).toBe(true);
      expect(Number.isInteger(card.power), card.cardId).toBe(true);
      expect(card.cost, card.cardId).toBeGreaterThanOrEqual(0);
      expect(card.power, card.cardId).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(card.keywords), card.cardId).toBe(true);
    }
  });

  it('gives every card at least one color and one type', () => {
    for (const card of englishCards) {
      expect(card.colors.length, card.cardId).toBeGreaterThan(0);
      expect(card.types.length, card.cardId).toBeGreaterThan(0);
      expect(card.color, card.cardId).toBe(card.colors[0]);
    }
  });

  it('gives every Leader and Character an attribute, and no Event or Stage one', () => {
    for (const card of englishCards) {
      const onField = card.category === 'leader' || card.category === 'character';
      expect(card.attributes.length > 0, `${card.cardId} (${card.category})`).toBe(onField);
    }
  });

  it('keeps the printed effect and trigger as separate raw text', () => {
    for (const card of englishCards) {
      expect(card.effectText === null || typeof card.effectText === 'string', card.cardId).toBe(
        true,
      );
      expect(card.triggerText === null || typeof card.triggerText === 'string', card.cardId).toBe(
        true,
      );
      // The source ships them apart; concatenating them here would be a loss
      // the next PR (the ability scripts) could not undo.
      if (card.triggerText !== null) {
        expect(card.effectText ?? '', card.cardId).not.toContain(card.triggerText);
      }
    }
  });

  it('carries a script on exactly the cards that have one written', () => {
    // Everything else is vanilla as far as the engine is concerned. The list
    // grows one reviewed card at a time; an unexpected entry here means a
    // script attached to a card nobody meant to touch.
    const scripted = englishCards.filter((card) => card.abilities !== undefined);
    expect(scripted.map((card) => card.cardId).sort()).toEqual([
      // OP-01 pile A, complete; the forty-four pile-C cards a chosen payment,
      // putting cards into play, the two missing rules, modifiable legality,
      // ordering the cards you looked at, adding DON!! from the DON!! deck,
      // reference by name and the player-chosen discard instruction freed; and
      // the starter set.
      'OP01-001',
      'OP01-003',
      'OP01-004',
      'OP01-005',
      'OP01-006',
      'OP01-007',
      'OP01-009',
      'OP01-014',
      'OP01-015',
      'OP01-016',
      'OP01-017',
      'OP01-020',
      'OP01-021',
      'OP01-022',
      'OP01-026',
      'OP01-027',
      'OP01-028',
      'OP01-029',
      'OP01-030',
      'OP01-031',
      'OP01-032',
      'OP01-033',
      'OP01-034',
      'OP01-035',
      'OP01-037',
      'OP01-038',
      'OP01-039',
      'OP01-040',
      'OP01-041',
      'OP01-042',
      'OP01-044',
      'OP01-046',
      'OP01-048',
      'OP01-049',
      'OP01-050',
      'OP01-052',
      'OP01-054',
      'OP01-056',
      'OP01-057',
      'OP01-058',
      'OP01-059',
      'OP01-060',
      'OP01-061',
      'OP01-062',
      'OP01-064',
      'OP01-068',
      'OP01-070',
      'OP01-071',
      'OP01-073',
      'OP01-074',
      'OP01-077',
      'OP01-078',
      'OP01-079',
      'OP01-080',
      'OP01-082',
      'OP01-084',
      'OP01-085',
      'OP01-086',
      'OP01-087',
      'OP01-088',
      'OP01-089',
      'OP01-090',
      'OP01-093',
      'OP01-094',
      'OP01-096',
      'OP01-097',
      'OP01-099',
      'OP01-101',
      'OP01-102',
      'OP01-104',
      'OP01-106',
      'OP01-108',
      'OP01-111',
      'OP01-112',
      'OP01-113',
      'OP01-114',
      'OP01-115',
      'OP01-116',
      'OP01-117',
      'OP01-118',
      'OP01-119',
      'OP01-120',
      'ST01-001',
      'ST01-002',
      'ST01-004',
      'ST01-005',
      'ST01-007',
      'ST01-011',
      'ST01-012',
      'ST01-013',
      'ST01-014',
      'ST01-015',
      'ST01-016',
      'ST01-017',
      'ST02-001',
      'ST02-003',
      'ST02-005',
      'ST02-007',
      'ST02-008',
      'ST02-009',
      'ST02-013',
      'ST02-014',
      'ST02-015',
      'ST02-016',
      'ST02-017',
    ]);
  });
});

describe('the Leader rule', () => {
  it('gives every Leader Life and no cost', () => {
    const leaders = englishCards.filter((card) => card.category === 'leader');
    expect(leaders.length).toBe(EXPECTED_BY_CATEGORY.leader);
    for (const leader of leaders) {
      expect(leader.cost, leader.cardId).toBe(0);
      expect(leader.life, leader.cardId).toBeGreaterThan(0);
    }
  });

  it('gives no Life to anything that is not a Leader', () => {
    for (const card of englishCards) {
      if (card.category === 'leader') continue;
      expect(card.life, card.cardId).toBe(0);
    }
  });

  it('keeps Leader Life inside the printed range', () => {
    // The source stores Life in `cost`, so a mapping mistake would show up here
    // as a card with, say, 10 Life — a plausible cost, an impossible Life.
    for (const leader of englishCards.filter((card) => card.category === 'leader')) {
      expect(leader.life, leader.cardId).toBeGreaterThanOrEqual(2);
      expect(leader.life, leader.cardId).toBeLessThanOrEqual(6);
    }
  });
});

describe('printed keywords', () => {
  const KEYWORDS = ['Rush', 'Blocker', 'Double Attack', 'Banish'] as const;
  const lines = (card: { effectText: string | null }): string[] =>
    (card.effectText ?? '').split('<br>').map((line) => line.trim());

  it('only ever claims the four the engine implements', () => {
    for (const card of englishCards) {
      for (const keyword of card.keywords) {
        expect(KEYWORDS, card.cardId).toContain(keyword);
      }
    }
  });

  it('claims a keyword only where its tag opens an ability line', () => {
    for (const card of englishCards) {
      for (const keyword of card.keywords) {
        expect(
          lines(card).some((line) => line.startsWith(`[${keyword}]`)),
          `${card.cardId} claims ${keyword}`,
        ).toBe(true);
      }
    }
  });

  it('never claims a keyword the card only grants to something else', () => {
    // "this Character gains [Rush] during this turn" is an ability, and this
    // package ships no abilities. Reading the tag by presence rather than by
    // position handed out 194 keywords no card has printed, which is the bug
    // this locks shut.
    const wrong: string[] = [];
    for (const card of englishCards) {
      for (const keyword of KEYWORDS) {
        const opensALine = lines(card).some((line) => line.startsWith(`[${keyword}]`));
        if (!opensALine && card.keywords.includes(keyword)) {
          wrong.push(`${card.cardId} claims a granted ${keyword}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('holds the expected keyword counts', () => {
    const counts: Record<string, number> = {};
    for (const card of englishCards) {
      for (const keyword of card.keywords) counts[keyword] = (counts[keyword] ?? 0) + 1;
    }
    expect(counts).toEqual({ Rush: 20, Blocker: 270, 'Double Attack': 9, Banish: 8 });
  });
});

describe('Counter values', () => {
  it('are null or a positive integer, never 0 and never a string', () => {
    for (const card of englishCards) {
      if (card.counter === null) continue;
      expect(typeof card.counter, card.cardId).toBe('number');
      expect(Number.isInteger(card.counter), card.cardId).toBe(true);
      expect(card.counter, card.cardId).toBeGreaterThan(0);
    }
  });

  it('only ever printed 1000 or 2000', () => {
    const values = new Set(
      englishCards.map((card) => card.counter).filter((value) => value !== null),
    );
    expect([...values].sort((a, b) => a - b)).toEqual([1000, 2000]);
  });

  it('never appears on a Leader', () => {
    for (const leader of englishCards.filter((card) => card.category === 'leader')) {
      expect(leader.counter, leader.cardId).toBeNull();
    }
  });
});

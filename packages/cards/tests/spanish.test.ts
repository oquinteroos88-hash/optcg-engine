import { describe, expect, it } from 'vitest';
import { englishCards, findSpanishText, spanishCardIds, SPANISH_SOURCE } from '../src/index.js';
import { findStarterTextEs } from '../src/starters.js';

/**
 * The guards on `data/cards.es.json`.
 *
 * Three separate claims, because they fail for three different reasons:
 *
 * 1. **Every one of the 155 is translated.** A missing card must be a red test,
 *    never a silent fallback to English — a fallback is invisible, and the whole
 *    point of the file is that a Spanish-reading child can read every card.
 * 2. **Every entry names a card that exists.** A typo'd id would attach to
 *    nothing and look exactly like a card nobody translated.
 * 3. **The generated starter subset matches the JSON**, the same pin
 *    `starters.test.ts` keeps on the English.
 *
 * What is deliberately NOT checked: that the Spanish says the same thing as the
 * English. No test can check that, and pretending otherwise with a heuristic —
 * word counts, marker counts — would buy false confidence. `<br>` structure is
 * checked because it is structure, not meaning: the client splits on it.
 */

/** The two sets this project has scripted end to end. */
const TRANSLATED_SETS = /^(?:OP01|ST01|ST02)-/;

const target = englishCards.filter((card) => TRANSLATED_SETS.test(card.cardId));

describe('cards.es.json', () => {
  it('declares the revision of the English it was translated from', () => {
    // The English is pinned to a punk-records commit; the translation inherits
    // that pin, so re-ingesting at a newer commit is a change this file has to
    // be re-checked against rather than one that passes unnoticed.
    expect(SPANISH_SOURCE.repository).toBe('buhbbl/punk-records');
    expect(SPANISH_SOURCE.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(SPANISH_SOURCE.glossary).toBe('docs/i18n-glossary.md');
  });

  it('covers all 155 cards of OP-01, ST-01 and ST-02', () => {
    expect(target).toHaveLength(155);
    const missing = target.filter((card) => findSpanishText(card.cardId) === undefined);
    expect(missing.map((card) => card.cardId)).toEqual([]);
    expect(spanishCardIds).toHaveLength(155);
  });

  it('has no entry for a card that does not exist', () => {
    // `spanish.ts` throws at load on an unknown id, so reaching this line at all
    // is half the assertion; the other half is that nothing outside the three
    // sets crept in.
    const known = new Set(target.map((card) => card.cardId));
    expect(spanishCardIds.filter((id) => !known.has(id))).toEqual([]);
  });

  it('keeps the ability-line structure of the English', () => {
    // `<br>` is what the client splits a two-ability card on, so a dropped one
    // silently merges two abilities into one paragraph.
    const count = (text: string | null): number =>
      text === null ? 0 : (text.match(/<br>/g) ?? []).length;
    for (const card of target) {
      const es = findSpanishText(card.cardId);
      expect(es, card.cardId).toBeDefined();
      expect(count(es?.effectText ?? null), card.cardId).toBe(count(card.effectText));
    }
  });

  it('translates a [Trigger] exactly where the English prints one', () => {
    for (const card of target) {
      const es = findSpanishText(card.cardId);
      expect(es?.triggerText === null, card.cardId).toBe(card.triggerText === null);
    }
  });

  it('leaves card names, type names and attributes in English', () => {
    // The art prints them in English and the engine resolves names by English
    // string (PR #38). Every `[Name]`, `{Type}` and `＜Attribute＞` the English
    // carries has to survive the translation unchanged.
    const tokens = (text: string | null): string[] =>
      text === null ? [] : (text.match(/\[[^\]]+\]|\{[^}]+\}|＜[^＞]+＞/g) ?? []);
    const bracketed = (list: string[]): string[] => list.filter((t) => t.startsWith('{') || t.startsWith('＜'));
    for (const card of target) {
      const es = findSpanishText(card.cardId);
      expect(bracketed(tokens(es?.effectText ?? null)), card.cardId).toEqual(
        bracketed(tokens(card.effectText)),
      );
    }
  });

  it('uses one term per mechanic, as docs/i18n-glossary.md says', () => {
    // A spot-check of the decisions most likely to drift, not a proof. The
    // glossary is the contract; this is the tripwire on the four that recur on
    // dozens of cards.
    const all = spanishCardIds
      .map((id) => `${findSpanishText(id)?.effectText ?? ''}\n${findSpanishText(id)?.triggerText ?? ''}`)
      .join('\n');
    // Translated keywords, and nothing else standing in for them.
    expect(all).toContain('[Bloqueador]');
    expect(all).not.toContain('[Blocker]');
    expect(all).not.toContain('Defensor');
    expect(all).toContain('[Doble Ataque]');
    expect(all).not.toContain('[Double Attack]');
    expect(all).toContain('[Disparador]');
    expect(all).not.toContain('[Trigger]');
    // Kept keywords: the two the cards always explain right after them.
    expect(all).toContain('[Rush]');
    expect(all).toContain('[Banish]');
    // Timing markers.
    expect(all).not.toContain('[On Play]');
    expect(all).not.toContain('[When Attacking]');
    expect(all).not.toContain('[Counter]');
    // Orientation: `activar` is reserved for effects, never for untapping.
    expect(all).not.toContain('endereza');
    expect(all).not.toContain('descansa');
    // Neutral Spanish: no voseo anywhere.
    expect(all).not.toMatch(/\b(?:elegí|tocá|pasá|podés|tenés|devolvés|robás|mirá)\b/);
  });
});

describe('the generated starter Spanish text', () => {
  it('matches data/cards.es.json for every starter card', () => {
    const starters = target.filter((card) => /^ST0[12]-/.test(card.cardId));
    expect(starters).toHaveLength(34);
    for (const card of starters) {
      expect(findStarterTextEs(card.cardId), card.cardId).toEqual(findSpanishText(card.cardId));
    }
  });

  it('has nothing for a card outside the two starter decks', () => {
    expect(findStarterTextEs('OP01-001')).toBeUndefined();
  });
});

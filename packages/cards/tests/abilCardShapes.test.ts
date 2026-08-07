import { describe, expect, it } from 'vitest';
import { ABIL_CARDS } from '@optcg/engine/testdata/abilities';
import { englishCards } from '../src/index.js';

/**
 * The ABIL set may be synthetic, but it must not be *impossible*.
 *
 * The `counterEvent` trigger looked reachable for a year because ABIL-016 was an
 * Event with a printed Counter value AND a [Counter] ability — a combination no
 * printed card has (no real Event, Leader, or Stage carries a Counter value).
 * That invented shape stood in for a card the game actually prints and hid a
 * missing engine move.
 *
 * This guard pins the reachability-relevant printed fields — category and
 * whether a Counter value is printed — and asserts that every ABIL card's
 * combination has a real counterpart in `cards.en.json`. The set stays free to
 * be synthetic in its effects and its stat lines; it may not invent a
 * category/counter shape the game never prints. Re-introducing ABIL-016's old
 * shape (or any Event/Leader/Stage with a printed Counter) flips the list below
 * off empty and fails here, loudly, before anyone reads it as reachability.
 */

/** The printed fields that decide how a card enters the Counter Step. */
function shapeOf(card: { category: string; counter: number | null }): string {
  return `${card.category}|${card.counter !== null ? 'counter' : 'noCounter'}`;
}

describe('the ABIL set prints only shapes the real set also prints', () => {
  const realShapes = new Set(englishCards.map(shapeOf));

  it('has no Event, Leader, or Stage with a printed Counter value in the real set', () => {
    // The teeth of the guard: these are the shapes ABIL-016 used to fake.
    expect(realShapes.has('event|counter')).toBe(false);
    expect(realShapes.has('leader|counter')).toBe(false);
    expect(realShapes.has('stage|counter')).toBe(false);
    // And the shapes that legitimately exist, so the guard is not vacuous.
    expect(realShapes.has('event|noCounter')).toBe(true);
    expect(realShapes.has('character|counter')).toBe(true);
  });

  it('lists no ABIL card whose category/counter shape the real set never prints', () => {
    const unreal = ABIL_CARDS.filter((card) => !realShapes.has(shapeOf(card)))
      .map((card) => card.cardId)
      .sort();

    // Empty since ABIL-016 became a `counter: null` [Counter] Event. It was the
    // sole member while it carried `counter: 1000`.
    expect(unreal).toEqual([]);
  });
});

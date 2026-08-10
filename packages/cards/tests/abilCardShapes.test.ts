import { describe, expect, it } from 'vitest';
import { getAbilities } from '@optcg/engine';
import { ABIL_CARDS } from '@optcg/engine/testdata/abilities';
import { englishCards, registerEnglishCards } from '../src/index.js';

registerEnglishCards();

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

/**
 * `counterEvent` fires from two sites, and only one of them is reachable.
 *
 * `applyPlayCounterEvent` (PLAY_COUNTER_EVENT) is the live one — an Event
 * activated from hand for its printed cost. `applyPlayCounter` (PLAY_COUNTER)
 * also fires the trigger after discarding a card for its printed Counter value,
 * on the reasonable rule that a Counter card with an effect resolves it. No
 * printed card can take that path: the two shapes do not intersect anywhere in
 * the set.
 *
 * That is not a reason to delete the line. It is a reason to pin the fact, the
 * way the guard above pins ABIL-016's old shape: the day a card prints both, the
 * path stops being unreachable and this test says so out loud instead of the
 * behaviour appearing unannounced.
 */
describe('the PLAY_COUNTER firing site for counterEvent is unreachable', () => {
  const withCounterMarker = englishCards.filter(
    (card) =>
      (card.effectText ?? '').includes('[Counter]') ||
      (card.triggerText ?? '').includes('[Counter]'),
  );

  it('has no card with both a printed Counter value and a [Counter] ability', () => {
    // The measurement, over the whole set rather than the starter decks: 184
    // cards carry the marker, all of them Events, none with a Counter value.
    expect(withCounterMarker).toHaveLength(184);
    expect([...new Set(withCounterMarker.map((card) => card.category))]).toEqual(['event']);
    expect(withCounterMarker.filter((card) => card.counter !== null)).toEqual([]);
  });

  it('routes no registered card into the trigger through a printed Counter value', () => {
    // The same claim asked of the engine's own predicate rather than of the
    // text: a card is offered as a Counter Event when it has a `counterEvent`
    // ability, and is discardable for its value when `counter !== null`.
    const both = englishCards.filter(
      (card) =>
        card.counter !== null &&
        getAbilities(card.cardId).some((ability) => ability.trigger === 'counterEvent'),
    );
    expect(both.map((card) => card.cardId)).toEqual([]);
  });

  it('lets no ABIL card fake the combination either', () => {
    // ABIL-016 held exactly this shape once, which is what made the trigger look
    // reachable through PLAY_COUNTER while the real move was missing.
    const faking = ABIL_CARDS.filter(
      (card) =>
        card.counter !== null &&
        (card.abilities ?? []).some((ability) => ability.trigger === 'counterEvent'),
    );
    expect(faking.map((card) => card.cardId)).toEqual([]);
  });
});

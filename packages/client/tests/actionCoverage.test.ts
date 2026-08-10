import { describe, expect, it } from 'vitest';
import { legalActions } from '@optcg/engine';
import type { Action, GameState } from '@optcg/engine';
import { corpusStates, starterCorpusStates } from './corpus';

/**
 * The hole this closes.
 *
 * `affordances.backward.test.ts` claims that every legal action is reachable
 * through an affordance. It proves that over a corpus, and for a year that
 * corpus was built only from the TEST decks — which carry no abilities at all.
 * So the claim it actually verified was "every legal action *the TEST decks
 * produce*", and the gap was invisible: `PLAY_COUNTER_EVENT` was added to the
 * engine in PR #10 and the round-trip did not notice, because no TEST card is
 * a [Counter] Event and no corpus state could ever offer one.
 *
 * A backward test cannot report what it never saw. This one can: it enumerates
 * the `Action` union and states, per variant, whether the corpus observes it.
 * `OBSERVED` and `UNOBSERVED` together must be the whole union — checked at
 * compile time below — so a new action forces a decision at the moment it is
 * added, instead of silently joining the set nothing covers.
 */

/** Variants the corpus must offer at least once. */
const OBSERVED = [
  'MULLIGAN',
  'PLAY_CARD',
  'ATTACH_DON',
  'DECLARE_ATTACK',
  'DECLARE_BLOCK',
  'PLAY_COUNTER',
  'PLAY_COUNTER_EVENT',
  'PASS',
  'END_TURN',
  'CONCEDE',
  'ACTIVATE_ABILITY',
  'ANSWER_CHOICE',
] as const;

/**
 * Variants the corpus is known not to reach, each with the reason.
 *
 * Empty today, and that is the point of writing it down: every action the
 * engine can emit is exercised by the round-trip. An entry added here is an
 * admission that some affordance is unverified, and it has to be argued for.
 */
const UNOBSERVED: readonly Action['type'][] = [];

// Compile-time exhaustiveness. `Missing` is non-never when the engine grows an
// action nobody listed; `Extra` when a listed name is no longer an action.
type Listed = (typeof OBSERVED)[number] | (typeof UNOBSERVED)[number];
type Missing = Exclude<Action['type'], Listed>;
type Extra = Exclude<Listed, Action['type']>;
type Empty<T extends never> = T;
export type _NothingMissing = Empty<Missing>;
export type _NothingExtra = Empty<Extra>;

function observedTypes(states: readonly GameState[]): Set<Action['type']> {
  const seen = new Set<Action['type']>();
  for (const state of states) {
    // Always the perspective of the player who acts, which is the perspective
    // affordances are computed for.
    for (const action of legalActions(state, state.priority)) {
      seen.add(action.type);
    }
  }
  return seen;
}

describe('the affordance corpus covers the Action union', () => {
  const seen = observedTypes(corpusStates());

  it('offers every action listed as observed', { timeout: 240_000 }, () => {
    const missing = OBSERVED.filter((type) => !seen.has(type));
    expect(missing).toEqual([]);
  });

  it('offers none of the actions listed as unobserved', () => {
    const unexpected = UNOBSERVED.filter((type) => seen.has(type));
    expect(unexpected).toEqual([]);
  });

  it('sees nothing outside the two lists', () => {
    const listed = new Set<Action['type']>([...OBSERVED, ...UNOBSERVED]);
    expect([...seen].filter((type) => !listed.has(type)).sort()).toEqual([]);
  });
});

describe('the three ability-driven actions come from the starter decks alone', () => {
  // Naming which half of the corpus carries them: if someone drops the starter
  // playouts to make the suite faster, this fails with the reason attached
  // rather than leaving the backward test quietly weaker.
  it('sees them in the ST-01/ST-02 playouts', { timeout: 240_000 }, () => {
    const seen = observedTypes(starterCorpusStates());
    expect(seen.has('ACTIVATE_ABILITY')).toBe(true);
    expect(seen.has('ANSWER_CHOICE')).toBe(true);
    expect(seen.has('PLAY_COUNTER_EVENT')).toBe(true);
  });
});

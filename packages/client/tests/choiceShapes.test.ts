import { describe, expect, it } from 'vitest';
import { computeAffordances } from '../src/game/affordances';
import { starterCorpusStates } from './corpus';

/**
 * Which choices the UI actually has to render.
 *
 * `PendingChoice['kind']` lists four variants and the corpus now opens three.
 * `orderCards` came back with `ST02-007` Bonney, exactly as this test was
 * written to catch: it was the assertion that would go red first, and it did.
 * `selectOption` is still unproduced — no op writes one, no card asks for one,
 * and the overlay has no branch for it.
 *
 * The claim is about the whole system rather than about a type, which is why it
 * is measured rather than assumed.
 */
describe('the starter corpus opens only the two choice shapes the UI renders', () => {
  const states = starterCorpusStates();

  it('opens the three the overlay renders, and never selectOption', () => {
    const kinds = new Set(states.map((state) => state.pending?.kind).filter((k) => k !== undefined));
    expect([...kinds].sort()).toEqual(['orderCards', 'selectCards', 'yesNo']);
  });

  it('publishes a prompt and a well-formed cardinality on every one of them', () => {
    let seen = 0;
    for (const state of states) {
      const choice = computeAffordances(state, state.priority).pendingChoice;
      if (choice === null) {
        continue;
      }
      seen += 1;
      expect(choice.prompt).not.toBe('');
      expect(choice.min).toBeLessThanOrEqual(choice.max);
      expect(choice.max).toBeLessThanOrEqual(Math.max(choice.candidates.length, 1));
      expect(new Set(choice.candidates).size).toBe(choice.candidates.length);
      // Every candidate is a real card the board can render.
      for (const id of choice.candidates) {
        expect(state.cards[id]).toBeDefined();
      }
    }
    expect(seen).toBeGreaterThan(50);
  });

  it('opens "up to" selections — min 0 — which the overlay must let a player confirm empty', () => {
    const upTo = states.filter(
      (state) => state.pending?.kind === 'selectCards' && state.pending.min === 0,
    );
    expect(upTo.length).toBeGreaterThan(0);
  });
});

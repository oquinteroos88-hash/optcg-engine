import { describe, expect, it } from 'vitest';
import { computeAffordances } from '../src/game/affordances';
import { starterCorpusStates } from './corpus';

/**
 * Which choices the UI actually has to render.
 *
 * `PendingChoice['kind']` still lists four variants, but `selectOption` and
 * `orderCards` were removed from the engine's instruction set: nothing can open
 * one any more, and the phase 2C brief says not to build UI for them. That is a
 * claim about the whole system rather than about a type, so it is measured
 * rather than assumed — the day a card brings one back, the choice overlay has
 * no branch for it and this test says so first.
 */
describe('the starter corpus opens only the two choice shapes the UI renders', () => {
  const states = starterCorpusStates();

  it('never opens selectOption or orderCards', () => {
    const kinds = new Set(states.map((state) => state.pending?.kind).filter((k) => k !== undefined));
    expect([...kinds].sort()).toEqual(['selectCards', 'yesNo']);
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

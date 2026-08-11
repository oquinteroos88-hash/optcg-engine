import { describe, expect, it } from 'vitest';
import { starterCorpusStates } from './corpus';

/**
 * The one collision the fan could have had.
 *
 * `rested` is a 90deg rotation on the tile and the fan is a rotation on the
 * wrapper around it, so the two compose rather than fight — but only because
 * they are on different elements, and a future refactor that "simplifies" one
 * onto the other would silently produce a card lying at 95deg in someone's
 * hand.
 *
 * The stronger claim is that the position never arises at all: orientation is a
 * field property, and a card in hand is not on the field. That is a claim about
 * the engine rather than about the CSS, so it is measured over real games
 * rather than assumed from the type.
 */
describe('no card in a hand is ever rested', () => {
  it('holds across every state of the starter corpus', () => {
    const states = starterCorpusStates();
    let handCards = 0;
    const rested: string[] = [];
    for (const state of states) {
      for (const player of ['p1', 'p2'] as const) {
        for (const id of state.players[player].hand) {
          handCards += 1;
          if (state.cards[id]?.orientation === 'rested') {
            rested.push(`${id} (${state.cards[id]?.cardId ?? '?'})`);
          }
        }
      }
    }
    // Not vacuous: these are real hands from real games.
    expect(handCards).toBeGreaterThan(10_000);
    expect(rested).toEqual([]);
  });
});

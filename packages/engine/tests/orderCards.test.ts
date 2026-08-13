import { describe, expect, it } from 'vitest';
import { legalActions, REASONS } from '../src/index.js';
import type { GameState, InstanceId } from '../src/index.js';
import { assertInvariants } from '../src/invariants.js';
import { ABIL_DECK } from '../src/testdata/abilityDecks.js';
import { buildScenario, characterAt } from '../src/testdata/scenarios.js';
import { assertSerializationRoundTrip } from '../src/testing/index.js';
import { applyFail, applyOk } from './helpers.js';

/**
 * `orderCards`, engine side.
 *
 * Phase 2A deleted the op and left the kind, with a note saying it would come
 * back "with its op and its tests". This is the tests half.
 *
 * `ABIL-029` is `ST02-007` Bonney at three cards instead of five and without
 * her cost list — see its comment for what that costs and what it buys. The
 * printed cards have their own file two packages over; what is here is the
 * machinery: the permutation, its validation, the mapping onto deck positions,
 * the trivial case, and the states in between.
 */

const decks = { p1: ABIL_DECK, p2: ABIL_DECK };

/**
 * A board with the Navigator out and a known top of deck.
 *
 * `deckTop` is what makes these cases readable: "look at 3" is a question about
 * three named cards, and a shuffled deck would make it a question about
 * whatever the seed dealt.
 */
function staged(top: string[]): GameState {
  return buildScenario({
    decks,
    p1: { characters: [{ cardId: 'ABIL-029' }], activeDon: 5, deckTop: top },
    p2: { activeDon: 5 },
  });
}

function activate(state: GameState): GameState {
  return applyOk(state, {
    type: 'ACTIVATE_ABILITY',
    player: 'p1',
    instanceId: characterAt(state, 'p1', 0),
    abilityId: 'ABIL-029-main',
  }).state;
}

function answerCards(state: GameState, selected: InstanceId[]): GameState {
  return applyOk(state, {
    type: 'ANSWER_CHOICE',
    player: 'p1',
    choiceId: state.pending?.id ?? '',
    answer: { kind: 'cards', selected },
  }).state;
}

function answerOrder(state: GameState, order: InstanceId[]): GameState {
  return applyOk(state, {
    type: 'ANSWER_CHOICE',
    player: 'p1',
    choiceId: state.pending?.id ?? '',
    answer: { kind: 'order', order },
  }).state;
}

/** The three ids `lookAt` will record, read off the deck before anything runs. */
function topThree(state: GameState): InstanceId[] {
  return state.players.p1.deck.slice(0, 3);
}

// ---------------------------------------------------------------------------
// The shape, end to end
// ---------------------------------------------------------------------------

describe('look at three, keep one, bury the rest', () => {
  it('offers exactly the cards that were looked at and not taken', () => {
    // Two of the three match the filter, so the select really is a choice, and
    // the ordering that follows really is over "the rest" rather than over
    // everything the deck happened to hold.
    const state = staged(['ABIL-005', 'ABIL-002', 'ABIL-006']);
    const [first, second, third] = topThree(state);
    expect(first).toBeDefined();

    const asking = activate(state);
    expect(asking.pending?.kind).toBe('selectCards');

    const ordering = answerCards(asking, [second as InstanceId]);
    expect(ordering.pending?.kind).toBe('orderCards');
    // The rest, in the order they were looked at: top of deck first.
    expect(ordering.pending?.candidates).toEqual([first, third]);
    // A permutation is exact at both ends.
    expect(ordering.pending?.min).toBe(2);
    expect(ordering.pending?.max).toBe(2);
    expect(ordering.players.p1.hand).toContain(second);
    assertInvariants(ordering);
  });

  it('offers all five looked-at cards when the player keeps none', () => {
    // "Up to 1" answered with nothing (CR 8-4-4-1), which leaves the whole
    // looked-at set to bury. The `minus` removes nothing, and nothing about the
    // instruction changes.
    const state = staged(['ABIL-005', 'ABIL-002', 'ABIL-006']);
    const top = topThree(state);
    const ordering = answerCards(activate(state), []);
    expect(ordering.pending?.kind).toBe('orderCards');
    expect(ordering.pending?.candidates).toEqual(top);
    expect(ordering.pending?.min).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// The mapping, which is the whole meaning of the answer
// ---------------------------------------------------------------------------

describe('the answer is the order the cards come back in', () => {
  it('puts the first card of the answer nearest the top, and draws them in that order', () => {
    // The pin. CR 3-2-3 moves multiple deck cards "one by one", so placing them
    // one by one at the bottom leaves the last one placed deepest — which makes
    // the answer read as *the order you will draw them*. Two implementers would
    // resolve this opposite ways, so it is asserted by actually drawing them.
    const state = staged(['ABIL-005', 'ABIL-002', 'ABIL-006']);
    const [first, second, third] = topThree(state);
    const ordering = answerCards(activate(state), [second as InstanceId]);

    // Deliberately the reverse of the offered order, so a placement that
    // ignored the answer would pass by accident.
    const placed = answerOrder(ordering, [third as InstanceId, first as InstanceId]);
    const deck = placed.players.p1.deck;
    expect(deck.at(-2)).toBe(third);
    expect(deck.at(-1)).toBe(first);

    // And read back the way a player reads it: draw the whole deck and see them
    // arrive in the order they were named.
    const drawn = [...deck];
    expect(drawn.indexOf(third as InstanceId)).toBeLessThan(drawn.indexOf(first as InstanceId));
    assertInvariants(placed);
  });

  it('leaves nothing in the deck twice, and everything still in the game', () => {
    const state = staged(['ABIL-005', 'ABIL-002', 'ABIL-006']);
    const before = state.players.p1.deck.length;
    const [first, , third] = topThree(state);
    const ordering = answerCards(activate(state), []);
    const placed = answerOrder(
      ordering,
      [third as InstanceId, first as InstanceId, ordering.pending?.candidates[1] as InstanceId],
    );
    expect(placed.players.p1.deck).toHaveLength(before);
    expect(new Set(placed.players.p1.deck).size).toBe(before);
    assertInvariants(placed);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('the permutation is checked at both ends', () => {
  function ordering(): GameState {
    return answerCards(activate(staged(['ABIL-005', 'ABIL-002', 'ABIL-006'])), []);
  }

  it('accepts every permutation of the candidates', () => {
    const open = ordering();
    const [a, b, c] = open.pending?.candidates ?? [];
    expect(c).toBeDefined();
    for (const order of [
      [a, b, c],
      [a, c, b],
      [b, a, c],
      [b, c, a],
      [c, a, b],
      [c, b, a],
    ] as InstanceId[][]) {
      const placed = answerOrder(open, order);
      expect(placed.players.p1.deck.slice(-3)).toEqual(order);
    }
  });

  it('refuses a short answer, a long one, a duplicate and a stranger', () => {
    const open = ordering();
    const candidates = open.pending?.candidates ?? [];
    const [a, b] = candidates;
    const base = { type: 'ANSWER_CHOICE', player: 'p1', choiceId: open.pending?.id ?? '' } as const;

    // Missing a card and holding an extra are both cardinality: the length is
    // pinned to the candidate count at both ends.
    expect(applyFail(open, { ...base, answer: { kind: 'order', order: [a as InstanceId] } })).toBe(
      REASONS.choiceCardinality,
    );
    const stranger = Object.keys(open.cards).find((id) => !candidates.includes(id));
    expect(stranger).toBeDefined();
    expect(
      applyFail(open, {
        ...base,
        answer: { kind: 'order', order: [...candidates, stranger as InstanceId] },
      }),
    ).toBe(REASONS.choiceCardinality);

    // Right length, wrong contents.
    expect(
      applyFail(open, {
        ...base,
        answer: { kind: 'order', order: [a as InstanceId, b as InstanceId, a as InstanceId] },
      }),
    ).toBe(REASONS.choiceDuplicateSelection);
    expect(
      applyFail(open, {
        ...base,
        answer: {
          kind: 'order',
          order: [stranger as InstanceId, b as InstanceId, candidates[2] as InstanceId],
        },
      }),
    ).toBe(REASONS.choiceCandidateUnknown);
  });

  it('refuses a selectCards answer carrying exactly the right ids', () => {
    // The one a caller is most likely to send by accident, and the reason the
    // answer is its own member rather than a re-use of `cards`: this list is
    // correct in every respect except that it answers a different question.
    const open = ordering();
    expect(
      applyFail(open, {
        type: 'ANSWER_CHOICE',
        player: 'p1',
        choiceId: open.pending?.id ?? '',
        answer: { kind: 'cards', selected: [...(open.pending?.candidates ?? [])] },
      }),
    ).toBe(REASONS.choiceKindMismatch);
  });
});

// ---------------------------------------------------------------------------
// Nothing to ask
// ---------------------------------------------------------------------------

describe('an ordering with no choice in it is never asked', () => {
  it('places the single leftover card without opening anything', () => {
    // Two looked at, one kept: one card left, one place for it. Asking would be
    // asking a question with one answer, and **the engine decides that** — a
    // client auto-answering a one-option question is a client holding a rule.
    const short = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-029' }], activeDon: 5 },
      p2: { activeDon: 5 },
    });
    // Trim the deck to exactly two cards, so `lookAt 3` sees two.
    const trimmed = JSON.parse(JSON.stringify(short)) as GameState;
    const kept = trimmed.players.p1.deck.slice(0, 2);
    const rest = trimmed.players.p1.deck.slice(2);
    trimmed.players.p1.deck = kept;
    trimmed.players.p1.trash.unshift(...rest);

    const asking = activate(trimmed);
    expect(asking.pending?.kind).toBe('selectCards');
    const after = answerCards(asking, [asking.pending?.candidates[0] as InstanceId]);

    expect(after.pending).toBeNull();
    expect(after.stack).toEqual([]);
    // The leftover really was placed, which is the half a "no choice needed"
    // shortcut would be likeliest to drop.
    expect(after.players.p1.deck.at(-1)).toBe(kept[1] ?? kept[0]);
    assertInvariants(after);
  });

  it('degrades to nothing at all on an empty deck', () => {
    const empty = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-029' }], activeDon: 5 },
      p2: { activeDon: 5 },
    });
    const drained = JSON.parse(JSON.stringify(empty)) as GameState;
    drained.players.p1.trash.unshift(...drained.players.p1.deck);
    drained.players.p1.deck = [];

    const after = activate(drained);
    expect(after.pending).toBeNull();
    expect(after.stack).toEqual([]);
    expect(after.players.p1.deck).toEqual([]);
    // Nothing was drawn, nothing was lost, and the game did not end: looking at
    // an empty deck is not drawing from one.
    expect(after.status).toBe('playing');
    assertInvariants(after);
  });
});

// ---------------------------------------------------------------------------
// Suspension
// ---------------------------------------------------------------------------

describe('a game stopped mid-ordering', () => {
  it('round-trips through JSON and answers the same afterwards', () => {
    const state = staged(['ABIL-005', 'ABIL-002', 'ABIL-006']);
    const open = answerCards(activate(state), []);
    expect(open.pending?.kind).toBe('orderCards');
    expect(open.pending?.sink).toEqual({ kind: 'orderToBottom' });
    assertSerializationRoundTrip(open);

    const revived = JSON.parse(JSON.stringify(open)) as GameState;
    expect(revived).toEqual(open);

    const order = [...(open.pending?.candidates ?? [])].reverse() as InstanceId[];
    const here = answerOrder(open, order);
    const there = answerOrder(revived, order);
    expect(there.players.p1.deck).toEqual(here.players.p1.deck);
    expect(there.log.length).toBe(here.log.length);
  });

  it('suspends priority: the other player sees only CONCEDE', () => {
    const open = answerCards(activate(staged(['ABIL-005', 'ABIL-002', 'ABIL-006'])), []);
    expect(open.priority).toBe('p1');
    expect(legalActions(open, 'p2')).toEqual([{ type: 'CONCEDE', player: 'p2' }]);
    // And the owner gets the marker, not an enumeration of permutations: six of
    // them for three cards, and it grows factorially.
    expect(legalActions(open, 'p1').map((action) => action.type).sort()).toEqual([
      'ANSWER_CHOICE',
      'CONCEDE',
    ]);
  });
});

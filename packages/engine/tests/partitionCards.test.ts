import { describe, expect, it } from 'vitest';
import { applyAction, REASONS } from '../src/index.js';
import type { GameState, InstanceId } from '../src/index.js';
import { assertInvariants } from '../src/invariants.js';
import { ABIL_DECK } from '../src/testdata/abilityDecks.js';
import { buildScenario, characterAt } from '../src/testdata/scenarios.js';
import { assertSerializationRoundTrip } from '../src/testing/index.js';
import { applyFail, applyOk } from './helpers.js';

/**
 * The top-or-bottom partition — `orderCards`' sibling and the second mechanism
 * PR #32 found under one printed phrase.
 *
 * "Place them at the top **or** bottom of the deck in any order" is not "place
 * them at the bottom in any order" with a destination flag. A permutation says
 * *what order*; this says *which end* as well, and 35 cards in the full set ask
 * it — 27 with an explicit order clause and 8 whose window is a single card,
 * where there is nothing to order and the clause is simply left off.
 *
 * `ABIL-029` Navigator carries **both** kinds, which is deliberate: one source
 * that can open either is the only place the two can be watched not crossing.
 *
 * The rules this file pins:
 *
 * - **Both sides read as draw order.** CR 3-2-3 moves simultaneous cards "one by
 *   one", which fixes the bottom mapping — last placed is deepest — and leaves
 *   the top's open, because placing one by one onto the top would invert it. The
 *   answer names the arrangement instead, and every case below proves it by
 *   **drawing afterwards** rather than by reading `deck.slice`.
 * - **One card is still a question.** One permutation, two ends.
 * - **A short deck is not a special case**, which it was not for `lookAt`
 *   either (PR #32).
 */

const decks = { p1: ABIL_DECK, p2: ABIL_DECK };

/** The Navigator out, with a known top of deck. */
function staged(top: string[]): GameState {
  return buildScenario({
    decks,
    p1: { characters: [{ cardId: 'ABIL-029' }], activeDon: 5, deckTop: top },
    p2: { activeDon: 5 },
  });
}

function split(state: GameState): GameState {
  return applyOk(state, {
    type: 'ACTIVATE_ABILITY',
    player: 'p1',
    instanceId: characterAt(state, 'p1', 0),
    abilityId: 'ABIL-029-split',
  }).state;
}

function answer(state: GameState, top: InstanceId[], bottom: InstanceId[]): GameState {
  return applyOk(state, {
    type: 'ANSWER_CHOICE',
    player: 'p1',
    choiceId: state.pending?.id ?? '',
    answer: { kind: 'partition', top, bottom },
  }).state;
}

function refuse(state: GameState, top: InstanceId[], bottom: InstanceId[]): string {
  return applyFail(state, {
    type: 'ANSWER_CHOICE',
    player: 'p1',
    choiceId: state.pending?.id ?? '',
    answer: { kind: 'partition', top, bottom },
  });
}

/**
 * The Navigator's *other* ability, driven to the point where its ordering is
 * open: `ABIL-029-main` looks, offers a card to keep, and only then orders the
 * rest. Taking nothing is the shortest route to the permutation.
 */
function reachOrdering(): GameState {
  const base = staged(['ABIL-001', 'ABIL-002', 'ABIL-003']);
  const looked = applyOk(base, {
    type: 'ACTIVATE_ABILITY',
    player: 'p1',
    instanceId: characterAt(base, 'p1', 0),
    abilityId: 'ABIL-029-main',
  }).state;
  return applyOk(looked, {
    type: 'ANSWER_CHOICE',
    player: 'p1',
    choiceId: looked.pending?.id ?? '',
    answer: { kind: 'cards', selected: [] },
  }).state;
}

/** The first `count` cards p1 would draw, top first. */
function nextDraws(state: GameState, count: number): InstanceId[] {
  return state.players.p1.deck.slice(0, count);
}

/** The last `count` cards of p1's deck, deepest last. */
function deepest(state: GameState, count: number): InstanceId[] {
  return state.players.p1.deck.slice(-count);
}

describe('the partition asks, and asks about the whole window', () => {
  it('opens a partitionCards choice over every card looked at', () => {
    const state = staged(['ABIL-001', 'ABIL-002', 'ABIL-003']);
    const asked = split(state);
    const pending = asked.pending;

    expect(pending?.kind).toBe('partitionCards');
    expect(pending?.candidates).toEqual(state.players.p1.deck.slice(0, 3));
    // Every candidate must be placed, so the pair is the candidate count — the
    // same cardinality an ordering opens with, and what turns three cheap
    // properties into "exactly this multiset" in `validateAnswerChoice`.
    expect(pending?.min).toBe(3);
    expect(pending?.max).toBe(3);
    expect(asked.priority).toBe('p1');
    assertInvariants(asked);
  });

  it('asks even for a single card, because one card still has two ends', () => {
    // The one place this parts company with `orderToBottom`, which places a
    // lone card without asking: there the answer is unique, here it is not.
    const short = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-029' }], activeDon: 5 },
      p2: { activeDon: 5 },
    });
    const oneLeft = JSON.parse(JSON.stringify(short)) as GameState;
    const deck = oneLeft.players.p1.deck;
    // A one-card deck. `lookAt` yields what there is (CR 8-4-4-1), which is the
    // short-deck behaviour PR #32 settled — inherited here with no special case.
    oneLeft.players.p1.trash.unshift(...deck.slice(1));
    oneLeft.players.p1.deck = deck.slice(0, 1);

    const asked = split(oneLeft);
    expect(asked.pending?.kind).toBe('partitionCards');
    expect(asked.pending?.candidates).toHaveLength(1);
    expect(asked.pending?.min).toBe(1);
    assertInvariants(asked);
  });

  it('asks nothing and places nothing when the deck is empty', () => {
    const empty = JSON.parse(JSON.stringify(staged([]))) as GameState;
    empty.players.p1.trash.unshift(...empty.players.p1.deck);
    empty.players.p1.deck = [];

    const done = split(empty);
    expect(done.pending).toBeNull();
    expect(done.players.p1.deck).toEqual([]);
    assertInvariants(done);
  });
});

describe('the two mappings, pinned by drawing afterwards', () => {
  it('sends the top side to the front, first card drawn first', () => {
    const state = staged(['ABIL-001', 'ABIL-002', 'ABIL-003']);
    const asked = split(state);
    const [a, b, c] = asked.pending?.candidates ?? [];
    if (a === undefined || b === undefined || c === undefined) {
      throw new Error('expected three candidates');
    }

    // Deliberately not the order they came off the deck in: c, then a, then b.
    const done = answer(asked, [c, a, b], []);
    expect(nextDraws(done, 3)).toEqual([c, a, b]);
    assertInvariants(done);
  });

  it('sends the bottom side to the back, first card drawn first of those', () => {
    const state = staged(['ABIL-001', 'ABIL-002', 'ABIL-003']);
    const asked = split(state);
    const [a, b, c] = asked.pending?.candidates ?? [];
    if (a === undefined || b === undefined || c === undefined) {
      throw new Error('expected three candidates');
    }

    const done = answer(asked, [], [c, a, b]);
    // `bottom[0]` is the shallowest of the three, `bottom.at(-1)` the deepest
    // card in the game — CR 3-2-3 placed one by one, which is `orderToBottom`'s
    // rule and is unchanged here.
    expect(deepest(done, 3)).toEqual([c, a, b]);
    assertInvariants(done);
  });

  it('does not let the two sides disturb each other', () => {
    // The case a mapping read backwards passes and a mapping applied twice does
    // not: both ends receive cards in the same act, and each has to come out in
    // the order it was given without the other shifting it.
    const state = staged(['ABIL-001', 'ABIL-002', 'ABIL-003']);
    const asked = split(state);
    const [a, b, c] = asked.pending?.candidates ?? [];
    if (a === undefined || b === undefined || c === undefined) {
      throw new Error('expected three candidates');
    }
    const middle = state.players.p1.deck.slice(3);

    const done = answer(asked, [b, a], [c]);
    expect(nextDraws(done, 2)).toEqual([b, a]);
    expect(deepest(done, 1)).toEqual([c]);
    // And the cards nobody touched are still between them, in their old order.
    expect(done.players.p1.deck.slice(2, -1)).toEqual(middle);
    expect(done.players.p1.deck).toHaveLength(state.players.p1.deck.length);
    assertInvariants(done);
  });

  it('reports both sides in the log, in the order they were placed', () => {
    const state = staged(['ABIL-001', 'ABIL-002', 'ABIL-003']);
    const asked = split(state);
    const [a, b, c] = asked.pending?.candidates ?? [];
    if (a === undefined || b === undefined || c === undefined) {
      throw new Error('expected three candidates');
    }
    const done = answer(asked, [b], [c, a]);

    const event = done.log.find((entry) => entry.type === 'deckPartitioned');
    expect(event?.type).toBe('deckPartitioned');
    if (event?.type === 'deckPartitioned') {
      expect(event.player).toBe('p1');
      expect(event.top).toEqual([b]);
      expect(event.bottom).toEqual([c, a]);
    }
    // And never the ordering's event, which is a different sentence for a
    // different act — the reason it is a second event and not a wider first one.
    expect(done.log.some((entry) => entry.type === 'deckOrdered')).toBe(false);
  });
});

describe('validation refuses each way of breaking a partition, with its own reason', () => {
  function opened(): { state: GameState; ids: InstanceId[] } {
    const state = staged(['ABIL-001', 'ABIL-002', 'ABIL-003']);
    const asked = split(state);
    return { state: asked, ids: [...(asked.pending?.candidates ?? [])] };
  }

  it('rejects a card assigned to both sides', () => {
    const { state, ids } = opened();
    const [a, b, c] = ids;
    if (a === undefined || b === undefined || c === undefined) {
      throw new Error('expected three candidates');
    }
    // Total length is right and every id is a candidate; the only thing wrong is
    // that `a` is in both, which is what the shared `seen` set across the two
    // lists exists to catch.
    expect(refuse(state, [a, b], [a])).toBe(REASONS.choiceDuplicateSelection);
    void c;
  });

  it('rejects a card assigned to neither side', () => {
    const { state, ids } = opened();
    const [a, b] = ids;
    if (a === undefined || b === undefined) {
      throw new Error('expected three candidates');
    }
    expect(refuse(state, [a], [b])).toBe(REASONS.choiceCardinality);
    expect(refuse(state, [], [])).toBe(REASONS.choiceCardinality);
  });

  it('rejects an id that was never a candidate', () => {
    const { state, ids } = opened();
    const [a, b] = ids;
    if (a === undefined || b === undefined) {
      throw new Error('expected three candidates');
    }
    expect(refuse(state, [a], [b, 'p1-nope'])).toBe(REASONS.choiceCandidateUnknown);
  });

  it('rejects an ordering answering a partition, and a partition answering an ordering', () => {
    // The crossing the fifth answer member exists to make unspellable. Both
    // directions, because a shared member with a flag would have allowed both.
    const { state, ids } = opened();
    expect(
      applyFail(state, {
        type: 'ANSWER_CHOICE',
        player: 'p1',
        choiceId: state.pending?.id ?? '',
        answer: { kind: 'order', order: ids },
      }),
    ).toBe(REASONS.choiceKindMismatch);

    const afterSelect = reachOrdering();
    expect(afterSelect.pending?.kind).toBe('orderCards');
    expect(
      applyFail(afterSelect, {
        type: 'ANSWER_CHOICE',
        player: 'p1',
        choiceId: afterSelect.pending?.id ?? '',
        answer: { kind: 'partition', top: [], bottom: [...(afterSelect.pending?.candidates ?? [])] },
      }),
    ).toBe(REASONS.choiceKindMismatch);
  });

  it('rejects a payload that names no side at all', () => {
    // Structural, before the choice rules: an absent `top` is not "all to the
    // bottom", it is a partition that never said.
    const { state } = opened();
    const result = applyAction(state, {
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId: state.pending?.id ?? '',
      answer: { kind: 'partition', bottom: [] } as never,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(REASONS.malformedAction);
    }
  });
});

describe('a partition mid-flight', () => {
  it('survives a JSON round trip and answers the same afterwards', () => {
    const state = staged(['ABIL-001', 'ABIL-002', 'ABIL-003']);
    const asked = split(state);
    assertSerializationRoundTrip(asked);

    const revived = JSON.parse(JSON.stringify(asked)) as GameState;
    expect(revived).toEqual(asked);

    const [a, b, c] = revived.pending?.candidates ?? [];
    if (a === undefined || b === undefined || c === undefined) {
      throw new Error('expected three candidates');
    }
    const done = answer(revived, [c], [b, a]);
    expect(nextDraws(done, 1)).toEqual([c]);
    expect(deepest(done, 2)).toEqual([b, a]);
    assertSerializationRoundTrip(done);
  });

  it('holds priority and blocks every other action until it is answered', () => {
    const state = staged(['ABIL-001', 'ABIL-002', 'ABIL-003']);
    const asked = split(state);
    expect(asked.priority).toBe('p1');
    expect(applyFail(asked, { type: 'END_TURN', player: 'p1' })).toBe(REASONS.choicePending);
    expect(applyFail(asked, { type: 'PASS', player: 'p1' })).toBe(REASONS.choicePending);
  });

  it('lets the game be conceded out from under it', () => {
    // The one action that outranks an open choice, and the reason it is checked:
    // a player must never be trapped inside a question.
    const asked = split(staged(['ABIL-001', 'ABIL-002', 'ABIL-003']));
    const conceded = applyOk(asked, { type: 'CONCEDE', player: 'p1' }).state;
    expect(conceded.status).toBe('finished');
    expect(conceded.winner).toBe('p2');
    expect(conceded.pending).toBeNull();
    expect(conceded.stack).toEqual([]);
    assertInvariants(conceded);
  });
});

describe('the two kinds coexist without crossing', () => {
  it('the same card opens an ordering or a partition, and each behaves as its own', () => {
    // `ABIL-029` carries both. This is the property the whole fifth-member
    // argument rests on: the two questions come from one source and neither
    // answer is legal for the other.
    const base = staged(['ABIL-001', 'ABIL-002', 'ABIL-003']);

    const partitionOpen = split(base);
    expect(partitionOpen.pending?.kind).toBe('partitionCards');

    const orderOpen = reachOrdering();
    expect(orderOpen.pending?.kind).toBe('orderCards');

    // The ordering still places at the bottom only, and still reads as draw
    // order — PR #32's behaviour untouched by the sibling arriving beside it.
    const ids = [...(orderOpen.pending?.candidates ?? [])];
    const [x, y, z] = ids;
    if (x === undefined || y === undefined || z === undefined) {
      throw new Error('expected three candidates');
    }
    const ordered = applyOk(orderOpen, {
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId: orderOpen.pending?.id ?? '',
      answer: { kind: 'order', order: [z, x, y] },
    }).state;
    expect(deepest(ordered, 3)).toEqual([z, x, y]);
    expect(ordered.log.some((entry) => entry.type === 'deckOrdered')).toBe(true);
    expect(ordered.log.some((entry) => entry.type === 'deckPartitioned')).toBe(false);
  });
});

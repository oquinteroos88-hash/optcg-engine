import { describe, expect, it } from 'vitest';
import type { GameState, InstanceId } from '@optcg/engine';
import {
  answer,
  applyOk,
  assertSettled,
  characterAt,
  handCard,
  op01DoflamingoScenario,
  op01KaidoScenario,
  op01OdenScenario,
  op01ZoroScenario,
  starterScenario,
} from './support.js';

/**
 * Batch 9 — look at the top of the deck, keep one, bury the rest in order.
 *
 * One printed sentence and five cards. The machinery is pinned in
 * `packages/engine/tests/orderCards.test.ts` on `ABIL-029`; these are the cards,
 * each staged from the fixture deck whose contents its search is actually for —
 * `OP01-041` looks for {Land of Wano} and the Oden deck is built out of them, so
 * staging it anywhere else would test a search that finds nothing.
 */

/** Answers a `selectCards`, then the ordering it opens, in one call. */
function keepThenBury(
  state: GameState,
  keep: InstanceId[],
  order?: (candidates: readonly InstanceId[]) => InstanceId[],
): GameState {
  expect(state.pending?.kind).toBe('selectCards');
  const ordering = answer(state, state.pending?.player ?? 'p1', { kind: 'cards', selected: keep });
  if (ordering.pending === null) {
    // One card left or none: the engine places without asking.
    return ordering;
  }
  expect(ordering.pending.kind).toBe('orderCards');
  const candidates = ordering.pending.candidates;
  return answer(ordering, ordering.pending.player, {
    kind: 'order',
    order: order === undefined ? [...candidates] : order(candidates),
  });
}

// ---------------------------------------------------------------------------
// ST02-007 — the card this mechanism was named after
// ---------------------------------------------------------------------------

describe('ST02-007 Jewelry Bonney — the last starter card either inventory carried as missing', () => {
  function staged(top: string[]): GameState {
    // ST-02 is p2's deck, so p2 is the one who can activate it, and
    // `firstPlayer` is what decides who holds priority in a staged position.
    return starterScenario({
      firstPlayer: 'p2',
      p2: { characters: [{ cardId: 'ST02-007' }], activeDon: 4, deckTop: top },
      p1: { activeDon: 4 },
    });
  }

  it('pays both printed costs, takes the {Supernovas} card, and buries the other four', () => {
    // ST02-014 X.Drake is the only {Supernovas} in the window: ST02-002 Vito is
    // {Firetank Pirates} and ST02-012 is {Minks}/{Heart Pirates}. Half the ST-02
    // deck carries the type, so the window is chosen rather than dealt.
    const state = staged(['ST02-002', 'ST02-014', 'ST02-012', 'ST02-002', 'ST02-012']);
    const bonney = characterAt(state, 'p2', 0);
    const looked = state.players.p2.deck.slice(0, 5);
    const target = looked[1];

    const asking = applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p2',
      instanceId: bonney,
      abilityId: 'ST02-007-main',
    }).state;

    // ➀ is `restDon 1` and "You may rest this Character" is `restSelf`, paid in
    // printed order (CR 8-3-1-1) before the script runs (CR 8-4-1-3).
    expect(asking.cards[bonney]?.orientation).toBe('rested');
    expect(asking.players.p2.don.filter((d) => d.location.kind === 'cost' && d.location.orientation === 'rested')).toHaveLength(1);
    expect(asking.pending?.candidates).toEqual([target]);

    const done = keepThenBury(asking, [target as InstanceId]);
    expect(done.players.p2.hand).toContain(target);
    // The other four are at the bottom, in the order the answer gave.
    expect(done.players.p2.deck.slice(-4)).toEqual(looked.filter((id) => id !== target));
    assertSettled(done);
  });

  it('buries all five when the search finds nothing to take', () => {
    // No {Supernovas} on top, so the select has no candidates at all and never
    // suspends — rule 3 of the interpreter — and the ordering gets all five.
    const state = staged(['ST02-002', 'ST02-012', 'ST02-002', 'ST02-012', 'ST02-002']);
    const bonney = characterAt(state, 'p2', 0);
    const looked = state.players.p2.deck.slice(0, 5);

    const ordering = applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p2',
      instanceId: bonney,
      abilityId: 'ST02-007-main',
    }).state;
    expect(ordering.pending?.kind).toBe('orderCards');
    expect(ordering.pending?.candidates).toEqual(looked);

    // Reversed, so a placement that ignored the answer would pass by accident.
    const reversed = [...looked].reverse();
    const done = answer(ordering, 'p2', { kind: 'order', order: reversed });
    expect(done.players.p2.deck.slice(-5)).toEqual(reversed);
    expect(done.players.p2.hand).not.toContain(looked[0]);
    assertSettled(done);
  });

  it('may decline the card it found, and still orders what it looked at', () => {
    // CR 8-4-4-1: "up to" may take 0. CR 8-4-4-2 goes further and lets a player
    // decline a secret-area choice even when a card qualifies.
    const state = staged(['ST02-014', 'ST02-002', 'ST02-012', 'ST02-002', 'ST02-012']);
    const bonney = characterAt(state, 'p2', 0);
    const looked = state.players.p2.deck.slice(0, 5);
    const asking = applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p2',
      instanceId: bonney,
      abilityId: 'ST02-007-main',
    }).state;

    const done = keepThenBury(asking, []);
    expect(done.players.p2.deck.slice(-5)).toEqual(looked);
    expect(done.players.p2.hand).not.toContain(looked[0]);
    assertSettled(done);
  });

  it('looks at what there is when the deck is shorter than five', () => {
    const state = staged(['ST02-002', 'ST02-014', 'ST02-012']);
    const trimmed = JSON.parse(JSON.stringify(state)) as GameState;
    const kept = trimmed.players.p2.deck.slice(0, 3);
    trimmed.players.p2.trash.unshift(...trimmed.players.p2.deck.slice(3));
    trimmed.players.p2.deck = kept;

    const bonney = characterAt(trimmed, 'p2', 0);
    const asking = applyOk(trimmed, {
      type: 'ACTIVATE_ABILITY',
      player: 'p2',
      instanceId: bonney,
      abilityId: 'ST02-007-main',
    }).state;

    const done = keepThenBury(asking, [kept[1] as InstanceId]);
    expect(done.players.p2.hand).toContain(kept[1]);
    expect(done.players.p2.deck).toHaveLength(2);
    assertSettled(done);
  });
});

// ---------------------------------------------------------------------------
// The four OP-01 cards
// ---------------------------------------------------------------------------

describe('OP01-041 Kouzuki Momonosuke — Bonney with one type changed', () => {
  it('finds a {Land of Wano} card among the five and buries the rest', () => {
    const state = op01OdenScenario({
      p1: {
        characters: [{ cardId: 'OP01-041' }],
        activeDon: 4,
        // OP01-053 Wire is {Kid Pirates}; the rest are {Land of Wano}.
        deckTop: ['OP01-053', 'OP01-036', 'OP01-043', 'OP01-045', 'OP01-053'],
      },
      p2: { activeDon: 4 },
    });
    const looked = state.players.p1.deck.slice(0, 5);
    const asking = applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: characterAt(state, 'p1', 0),
      abilityId: 'OP01-041-main',
    }).state;

    // Wire is filtered out at both ends of the window, and OP01-045 Jean Bart
    // is {Heart Pirates} rather than {Land of Wano} — so two of the five match.
    expect(asking.pending?.candidates).toEqual([looked[1], looked[2]]);
    const done = keepThenBury(asking, [looked[2] as InstanceId]);
    expect(done.players.p1.hand).toContain(looked[2]);
    expect(done.players.p1.deck.slice(-4)).toEqual(looked.filter((id) => id !== looked[2]));
    assertSettled(done);
  });
});

describe('OP01-030 In Two Years!! — an Event whose [Trigger] shares the [Main]', () => {
  it('runs the same list from the hand', () => {
    const state = op01ZoroScenario({
      p1: {
        activeDon: 4,
        hand: ['OP01-030'],
        clearHand: true,
        // OP01-017 Nico Robin and OP01-022 Brook are {Straw Hat Crew}; the
        // other three are not, and OP01-026 Red Hawk is {Straw Hat Crew} but an
        // Event, which the printed category filter refuses.
        deckTop: ['OP01-010', 'OP01-017', 'OP01-026', 'OP01-022', 'OP01-023'],
      },
      p2: { activeDon: 4 },
    });
    const looked = state.players.p1.deck.slice(0, 5);
    const asking = applyOk(state, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: handCard(state, 'p1', 'OP01-030'),
    }).state;

    expect(asking.pending?.candidates).toEqual([looked[1], looked[3]]);
    const done = keepThenBury(asking, [looked[1] as InstanceId]);
    expect(done.players.p1.hand).toContain(looked[1]);
    expect(done.players.p1.deck.slice(-4)).toEqual(looked.filter((id) => id !== looked[1]));
    assertSettled(done);
  });
});

describe('OP01-084 Mr.2.Bon.Kurei — the one that filters on a category too', () => {
  it('takes only a {Baroque Works} Event, not a {Baroque Works} Character', () => {
    const state = op01DoflamingoScenario({
      p1: {
        characters: [{ cardId: 'OP01-084', attachedDon: 1 }],
        activeDon: 4,
        // OP01-079 is a {Baroque Works} *Character*; OP01-087 is the Event.
        deckTop: ['OP01-079', 'OP01-087', 'OP01-066', 'OP01-081', 'OP01-076'],
      },
      p2: { characters: [{ cardId: 'OP01-076', orientation: 'rested' }], activeDon: 4 },
    });
    const looked = state.players.p1.deck.slice(0, 5);
    const attacking = applyOk(state, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(state, 'p1', 0),
      target: characterAt(state, 'p2', 0),
    }).state;

    // The Character is {Baroque Works} and is still not a candidate.
    expect(attacking.pending?.candidates).toEqual([looked[1]]);
    const done = keepThenBury(attacking, [looked[1] as InstanceId]);
    expect(done.players.p1.hand).toContain(looked[1]);
    assertSettled(done);
  });
});

describe('OP01-116 Artificial Devil Fruit SMILE — plays what it finds, out of the deck', () => {
  it('puts a {SMILE} Character on the field and buries the four it passed over', () => {
    // The second half of a card the inventory listed under two gaps: batch 6
    // built playing from the deck, and this batch buries the rest.
    const state = op01KaidoScenario({
      p1: {
        activeDon: 4,
        hand: ['OP01-116'],
        clearHand: true,
        // OP01-104 Speed is a {SMILE} Character costing 2; OP01-107 Babanuki is
        // {SMILE} too but costs 5, which the printed cost gate refuses.
        deckTop: ['OP01-107', 'OP01-104', 'OP01-066', 'OP01-081', 'OP01-076'],
      },
      p2: { activeDon: 4 },
    });
    const looked = state.players.p1.deck.slice(0, 5);
    const asking = applyOk(state, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: handCard(state, 'p1', 'OP01-116'),
    }).state;

    expect(asking.pending?.candidates).toEqual([looked[1]]);
    const done = keepThenBury(asking, [looked[1] as InstanceId]);

    // On the field, not in hand — and summoning-sick, because an effect that
    // puts a card down still played it (CR 3-7-4).
    expect(done.players.p1.characters).toContain(looked[1]);
    expect(done.players.p1.hand).not.toContain(looked[1]);
    expect(done.cards[looked[1] as InstanceId]?.playedOnTurn).toBe(done.turn);
    expect(done.players.p1.deck.slice(-4)).toEqual(looked.filter((id) => id !== looked[1]));
    assertSettled(done);
  });
});

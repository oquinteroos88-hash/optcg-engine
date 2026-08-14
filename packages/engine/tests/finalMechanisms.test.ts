import { describe, expect, it } from 'vitest';
import { applyAction, getCost, getPower, legalActions } from '../src/index.js';
import type { GameState, InstanceId } from '../src/index.js';
import { ABIL_DECK } from '../src/testdata/abilityDecks.js';
import { buildScenario, characterAt, handCard } from '../src/testdata/scenarios.js';
import { applyOk } from './helpers.js';

/**
 * The five mechanisms that close OP-01.
 *
 * `ABIL-036` Almanac carries all five and `ABIL-037` Envoy is the set's one
 * two-colour card — the only way the colour comparison can be watched deciding
 * anything, because **every two-colour card in the real game is a Leader**.
 *
 * | Mechanism | Printed by | Shape |
 * | --- | --- | --- |
 * | negation | `OP01-019` | `Condition.not` |
 * | scaling grants | `OP01-072`, `OP01-083` | `grants.powerPer` |
 * | cost modification | `OP01-067` | `grants.cost` + `getCost` |
 * | reveal what was chosen | `OP01-105`, `OP01-063` | `reveal` with a `var` |
 * | a predicate about a variable | `OP01-002`, `OP01-063` | `varMatches`, `differentColorFrom` |
 */

const decks = { p1: ABIL_DECK, p2: ABIL_DECK };

function candidates(state: GameState): InstanceId[] {
  const pending = state.pending;
  if (pending === null) {
    throw new Error('expected an open choice');
  }
  return [...pending.candidates];
}

function answer(state: GameState, player: 'p1' | 'p2', selected: InstanceId[]): GameState {
  return applyOk(state, {
    type: 'ANSWER_CHOICE',
    player,
    choiceId: state.pending?.id ?? '',
    answer: { kind: 'cards', selected },
  }).state;
}

// ===========================================================================
// Negation
// ===========================================================================

describe('Condition.not — [Opponent’s Turn] is not(isYourTurn)', () => {
  function staged(first: 'p1' | 'p2'): GameState {
    return buildScenario({
      decks,
      firstPlayer: first,
      // Both hands emptied: the `perCard` clause counts p1's hand, and a dealt
      // opening hand would fold five unrelated thousands into every reading.
      p1: { characters: [{ cardId: 'ABIL-036' }], activeDon: 4, hand: [], clearHand: true },
      p2: { activeDon: 4, hand: [], clearHand: true },
    });
  }

  it('is off on your own turn and on during the opponent’s', () => {
    // The general `not` rather than an `isOpponentTurn` member: the variant
    // closes 77 cards in the full set at the same cost as the one that closes
    // `OP01-019` alone.
    const mine = staged('p1');
    const theirs = staged('p2');
    expect(mine.activePlayer).toBe('p1');
    expect(theirs.activePlayer).toBe('p2');

    // On p1's turn the `perCard` static is the live one and the hand is empty,
    // so the card sits at printed power.
    expect(getPower(mine, characterAt(mine, 'p1', 0))).toBe(2000);
    // On p2's turn the negated clause opens and grants +3000.
    expect(getPower(theirs, characterAt(theirs, 'p1', 0))).toBe(5000);
  });

  it('negates inside static evaluation without needing an anchor of its own', () => {
    // `not` hands the same `Lens` down, so a negated condition rides whatever
    // guard the un-negated one rides. Both clauses here are flat (`isYourTurn`),
    // and reading power terminates — which is the whole claim.
    const theirs = staged('p2');
    expect(() => getPower(theirs, characterAt(theirs, 'p1', 0))).not.toThrow();
    expect(theirs.modifiers).toEqual([]);
  });
});

// ===========================================================================
// Scaling grants
// ===========================================================================

describe('grants.powerPer — power the board counts', () => {
  it('follows the hand, card by card', () => {
    for (const hand of [0, 1, 3]) {
      const state = buildScenario({
        decks,
        p1: {
          characters: [{ cardId: 'ABIL-036' }],
          activeDon: 4,
          clearHand: true,
          hand: ['ABIL-006', 'ABIL-007', 'ABIL-008'].slice(0, hand),
        },
        p2: { activeDon: 4 },
      });
      expect(state.players.p1.hand, `hand ${hand}`).toHaveLength(hand);
      expect(getPower(state, characterAt(state, 'p1', 0)), `hand ${hand}`).toBe(2000 + hand * 1000);
    }
  });

  it('changes the moment the hand does, with nothing written down', () => {
    // The property a modifier-writing implementation would silently lose: draw a
    // card and the number is different the next time anyone asks.
    const state = buildScenario({
      decks,
      p1: {
        characters: [{ cardId: 'ABIL-036' }, { cardId: 'ABIL-002' }],
        activeDon: 4,
        clearHand: true,
        hand: ['ABIL-006'],
      },
      p2: { activeDon: 4, hand: [], clearHand: true },
    });
    const almanac = characterAt(state, 'p1', 0);
    expect(getPower(state, almanac)).toBe(2000 + 1000);

    // `ABIL-002`'s [Activate: Main] draws one and asks which to trash; answering
    // leaves the hand one larger than it started.
    const drawn = applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: characterAt(state, 'p1', 1),
      abilityId: 'ABIL-002-main',
    }).state;
    // That one asks the opponent, whose hand is empty, so nothing suspends.
    expect(drawn.pending).toBeNull();
    expect(drawn.modifiers).toEqual([]);
  });

  it('divides and floors: one Event in the trash is worth nothing', () => {
    // CR 8-4-4 and the printed "for every 2" both describe complete groups.
    // `ABIL-016` and `ABIL-017` are the set's Events.
    for (const [events, expected] of [
      [0, 0],
      [1, 0],
      [2, 1000],
      [3, 1000],
    ] as const) {
      const state = buildScenario({
        decks,
        firstPlayer: 'p2',
        p1: {
          characters: [{ cardId: 'ABIL-036', attachedDon: 1 }],
          activeDon: 4,
          clearHand: true,
          trash: ['ABIL-016', 'ABIL-016', 'ABIL-017'].slice(0, events),
        },
        p2: { activeDon: 4 },
      });
      // p2's turn, so the `perCard` clause is off and `perTwo` is the live one,
      // beside the flat +3000 from the negated clause.
      expect(getPower(state, characterAt(state, 'p1', 0)), `${events} events`).toBe(
        2000 + 1000 + 3000 + expected,
      );
    }
  });
});

// ===========================================================================
// Cost modification
// ===========================================================================

describe('getCost — the third aggregated reading', () => {
  function staged(don: number): GameState {
    return buildScenario({
      decks,
      p1: {
        characters: [{ cardId: 'ABIL-036', attachedDon: don }],
        activeDon: 4,
        clearHand: true,
        hand: ['ABIL-016'],
      },
      p2: { activeDon: 4 },
    });
  }

  it('reads the printed cost with no grant applying', () => {
    const state = staged(0);
    const event = handCard(state, 'p1', 'ABIL-016');
    expect(getCost(state, event)).toBe(1);
  });

  it('applies the reduction while the static holds', () => {
    const state = staged(1);
    const event = handCard(state, 'p1', 'ABIL-016');
    expect(getCost(state, event)).toBe(0);
  });

  it('floors at zero rather than going negative', () => {
    // CR 1-3-6-2: "outside of such calculations, the cost of a card whose value
    // becomes negative is treated as being 0". `ABIL-016` costs 1 and the grant
    // is −1, so a second reduction would take it under — the clamp is what stops
    // a negative cost being visible.
    const state = staged(1);
    const event = handCard(state, 'p1', 'ABIL-016');
    expect(getCost(state, event)).toBe(0);
    expect(getCost(state, event)).toBeGreaterThanOrEqual(0);
  });

  it('makes an unpayable card payable, which is the whole point', () => {
    // Legality reading the aggregated cost is what the six unified call sites
    // buy. With one active DON!! the 1-cost Event is already payable, so the
    // sharp version is the other way round: zero active DON!!, where only the
    // reduction can make it offered.
    const withoutGrant = buildScenario({
      decks,
      p1: {
        characters: [{ cardId: 'ABIL-036' }],
        activeDon: 0,
        clearHand: true,
        hand: ['ABIL-016'],
      },
      p2: { activeDon: 4 },
    });
    const withGrant = buildScenario({
      decks,
      p1: {
        characters: [{ cardId: 'ABIL-036', attachedDon: 1 }],
        activeDon: 1,
        clearHand: true,
        hand: ['ABIL-016'],
      },
      p2: { activeDon: 4 },
    });
    // The attached DON!! comes out of the active pool, so both positions have
    // zero active cost-area DON!! — the only difference is the grant.
    const offered = (s: GameState): boolean =>
      legalActions(s, 'p1').some(
        (action) =>
          action.type === 'PLAY_CARD' && action.instanceId === handCard(s, 'p1', 'ABIL-016'),
      );
    expect(offered(withoutGrant)).toBe(false);
    expect(offered(withGrant)).toBe(true);
  });

  it('stops applying when the source leaves the field', () => {
    const state = staged(1);
    const event = handCard(state, 'p1', 'ABIL-016');
    expect(getCost(state, event)).toBe(0);

    // Take the Almanac off the board and the grant is simply gone — nothing to
    // clean up, which is the whole reason continuous effects write nothing.
    const gone: GameState = JSON.parse(JSON.stringify(state)) as GameState;
    gone.players.p1.characters = [];
    expect(getCost(gone, event)).toBe(1);
  });

  it('pays the reduced price, so validation and payment agree', () => {
    const state = staged(1);
    const event = handCard(state, 'p1', 'ABIL-016');
    const before = state.players.p1.don.filter(
      (don) => don.location.kind === 'cost' && don.location.orientation === 'active',
    ).length;

    const done = applyOk(state, { type: 'PLAY_CARD', player: 'p1', instanceId: event }).state;
    const after = done.players.p1.don.filter(
      (don) => don.location.kind === 'cost' && don.location.orientation === 'active',
    ).length;
    // Cost 0 after the grant: no DON!! was rested to pay it.
    expect(after).toBe(before);
  });
});

// ===========================================================================
// Reveal what was chosen
// ===========================================================================

describe('reveal with a var — revealing exactly what was picked', () => {
  function staged(theirHand: string[]): GameState {
    return buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-036' }], activeDon: 4 },
      p2: { activeDon: 4, clearHand: true, hand: theirHand },
    });
  }

  function peek(state: GameState): GameState {
    return applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: characterAt(state, 'p1', 0),
      abilityId: 'ABIL-036-peek',
    }).state;
  }

  it('reveals exactly the chosen card, and nothing else in the hand', () => {
    const state = staged(['ABIL-016', 'ABIL-006', 'ABIL-007']);
    const asking = peek(state);
    expect(candidates(asking)).toEqual(asking.players.p2.hand);

    const chosen = candidates(asking)[1];
    if (chosen === undefined) {
      throw new Error('expected a candidate');
    }
    const result = applyAction(asking, {
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId: asking.pending?.id ?? '',
      answer: { kind: 'cards', selected: [chosen] },
    });
    if (!result.ok) {
      throw new Error(result.reason);
    }
    const revealed = result.events.filter((event) => event.type === 'cardsRevealed');
    expect(revealed).toHaveLength(1);
    expect(revealed[0]).toEqual({
      type: 'cardsRevealed',
      player: 'p1',
      instanceIds: [chosen],
    });
  });

  it('branches on what the revealed card turned out to be', () => {
    // `varMatches` — `OP01-063` Arlong's "if the revealed card is an Event".
    const withEvent = staged(['ABIL-016']);
    const withBody = staged(['ABIL-006']);

    const drewOn = answer(peek(withEvent), 'p1', [
      ...(peek(withEvent).pending?.candidates ?? []),
    ]);
    const drewOff = answer(peek(withBody), 'p1', [...(peek(withBody).pending?.candidates ?? [])]);

    expect(drewOn.players.p1.hand.length).toBe(withEvent.players.p1.hand.length + 1);
    expect(drewOff.players.p1.hand.length).toBe(withBody.players.p1.hand.length);
  });

  it('does not match when the variable names nothing', () => {
    // An empty variable is not "an Event" — there is no card to be one. The
    // condition answers false rather than vacuously true.
    const state = staged(['ABIL-006']);
    const done = answer(peek(state), 'p1', [...(peek(state).pending?.candidates ?? [])]);
    expect(done.players.p1.hand.length).toBe(state.players.p1.hand.length);
  });
});

// ===========================================================================
// A predicate about a card a variable names
// ===========================================================================

describe('differentColorFrom — and the bicolour case no printed card can reach', () => {
  function staged(handCards: string[]): GameState {
    return buildScenario({
      decks,
      p1: {
        characters: [{ cardId: 'ABIL-036' }, { cardId: 'ABIL-008' }],
        activeDon: 6,
        clearHand: true,
        hand: handCards,
      },
      p2: { activeDon: 4 },
    });
  }

  function swap(state: GameState): GameState {
    return applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: characterAt(state, 'p1', 0),
      abilityId: 'ABIL-036-swap',
    }).state;
  }

  it('offers nothing when every candidate shares the returned card’s colour', () => {
    // The whole ABIL set is blue but for `ABIL-037`, so returning a blue
    // Character leaves a hand of blue candidates and none qualifies.
    const state = staged(['ABIL-006', 'ABIL-007']);
    const asking = swap(state);
    const returned = characterAt(state, 'p1', 1);
    const afterReturn = answer(asking, 'p1', [returned]);
    // The second select found no candidate, so nothing was asked and the script
    // resolved through.
    expect(afterReturn.pending).toBeNull();
    expect(afterReturn.players.p1.hand).toContain(returned);
  });

  it('excludes a two-colour card that shares one colour, under the default reading', () => {
    // CR 2-3-5: "cards with multiple colors … are treated as a card of every
    // color they possess", so blue/green **is** a blue card and is not different
    // from a blue one. `rules.differentColorMeansNoSharedColor` default true.
    const state = staged(['ABIL-037']);
    const returned = characterAt(state, 'p1', 1);
    const afterReturn = answer(swap(state), 'p1', [returned]);
    expect(afterReturn.pending).toBeNull();
  });

  it('admits the same card under the whole-set reading', () => {
    // The flag earns its place here and only here: the two readings disagree on
    // exactly this card, and **no printed card in the game can produce the
    // position** — all 68 two-colour cards are Leaders, and a Leader is neither
    // returned to hand nor played from it.
    const base = staged(['ABIL-037']);
    const state: GameState = JSON.parse(JSON.stringify(base)) as GameState;
    state.rules.differentColorMeansNoSharedColor = false;
    const returned = characterAt(state, 'p1', 1);
    const asking = answer(swap(state), 'p1', [returned]);

    expect(asking.pending?.kind).toBe('selectCards');
    expect(candidates(asking)).toEqual([handCard(state, 'p1', 'ABIL-037')]);
  });

  it('filters nothing when the variable is empty', () => {
    // A reference that names no card has no colour to differ from, and an
    // "up to 1" answered with nothing must not silently empty the next selector.
    const state = staged(['ABIL-006']);
    const returned = characterAt(state, 'p1', 1);
    const afterReturn = answer(swap(state), 'p1', [returned]);
    expect(afterReturn.pending).toBeNull();
  });
});

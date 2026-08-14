import { describe, expect, it } from 'vitest';
import { applyAction, getPower, legalActions, REASONS } from '../src/index.js';
import type { GameState, InstanceId } from '../src/index.js';
import { assertInvariants } from '../src/invariants.js';
import { ABIL_DECK } from '../src/testdata/abilityDecks.js';
import { buildScenario, characterAt } from '../src/testdata/scenarios.js';
import { applyFail, applyOk } from './helpers.js';

/**
 * The DON!! count condition and the four costs that arrived with it.
 *
 * `ABIL-035` Paymaster carries all six shapes so the engine owns them without
 * the card package. Five of its abilities are `[Activate: Main]`, which is what
 * keeps the rest of the suite from tripping over them.
 *
 * The batch's rules, each pinned by a case below:
 *
 * - **"On your field" is the cost area plus what is given.** CR 3-1-2 collects
 *   the Leader, Character, Stage and cost areas under "the field"; CR 6-5-5-1
 *   leaves a given DON!! on the card it was given to. CR 4-4-2 makes given DON!!
 *   "neither active nor rested", so nothing filters on orientation.
 * - **A life cost takes the top card and fires no `[Trigger]`.** CR 3-10-2 for
 *   the top; CR 2-11-1 and CR 4-6-3 for the `[Trigger]`, which exists only for a
 *   card added to hand *on taking damage*.
 * - **Paying your last Life card is legal.** CR 1-2-1-1-1 makes the defeat
 *   condition "0 Life cards **and** your Leader takes damage".
 * - **A cost that removes its own source still resolves**, behind
 *   `rules.selfReturnResolvesEffect` — CR 8-1-3-1-3 against CR 8-3-1-3-1.
 */

const decks = { p1: ABIL_DECK, p2: ABIL_DECK };

function activate(state: GameState, abilityId: string, index = 0): GameState {
  return applyOk(state, {
    type: 'ACTIVATE_ABILITY',
    player: 'p1',
    instanceId: characterAt(state, 'p1', index),
    abilityId,
  }).state;
}

function refuse(state: GameState, abilityId: string, index = 0): string {
  return applyFail(state, {
    type: 'ACTIVATE_ABILITY',
    player: 'p1',
    instanceId: characterAt(state, 'p1', index),
    abilityId,
  });
}

function answer(state: GameState, selected: InstanceId[]): GameState {
  return applyOk(state, {
    type: 'ANSWER_CHOICE',
    player: 'p1',
    choiceId: state.pending?.id ?? '',
    answer: { kind: 'cards', selected },
  }).state;
}

function candidates(state: GameState): InstanceId[] {
  const pending = state.pending;
  if (pending === null) {
    throw new Error('expected an open choice');
  }
  return [...pending.candidates];
}

/** Every DON!! not still in the DON!! deck — the reading under test. */
function onField(state: GameState, player: 'p1' | 'p2' = 'p1'): number {
  return state.players[player].don.filter((don) => don.location.kind !== 'donDeck').length;
}

// ===========================================================================
// The DON!! count condition
// ===========================================================================

describe('donOnField counts the cost area and what has been given', () => {
  it('counts active and rested cost-area DON!! alike', () => {
    // The printed sentence says "DON!! cards on your field", not "active DON!!".
    const state = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-035' }], activeDon: 5, restedDon: 3 },
      p2: { activeDon: 3 },
    });
    expect(onField(state)).toBe(8);
    // The gate is min 8, so 8 opens it.
    expect(activate(state, 'ABIL-035-count').players.p1.hand.length).toBeGreaterThan(
      state.players.p1.hand.length,
    );
  });

  it('counts a given DON!!, which has no orientation at all', () => {
    // CR 4-4-2: "given DON!! cards are neither active nor rested". A count that
    // filtered on orientation could not see them, which is the opposite of what
    // the cards mean — so this position has 8 on the field with one of them
    // attached, and the gate opens.
    const state = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-035', attachedDon: 1 }], activeDon: 8 },
      p2: { activeDon: 3 },
    });
    const attached = state.players.p1.don.filter((don) => don.location.kind === 'attached');
    expect(attached).toHaveLength(1);
    expect(onField(state)).toBe(8);
    expect(activate(state, 'ABIL-035-count').pending).toBeNull();
  });

  it('does not count DON!! still in the DON!! deck', () => {
    const state = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-035' }], activeDon: 7 },
      p2: { activeDon: 3 },
    });
    expect(onField(state)).toBe(7);
    expect(state.players.p1.don.filter((don) => don.location.kind === 'donDeck')).toHaveLength(3);
    expect(refuse(state, 'ABIL-035-count')).toBe(REASONS.abilityConditionUnmet);
  });

  it('is off at 7 and on at 8, which is the whole of the boundary', () => {
    for (const [don, open] of [
      [7, false],
      [8, true],
    ] as const) {
      const state = buildScenario({
        decks,
        p1: { characters: [{ cardId: 'ABIL-035' }], activeDon: don },
        p2: { activeDon: 3 },
      });
      expect(onField(state), `${don} DON!!`).toBe(don);
      const offered = legalActions(state, 'p1').some(
        (action) => action.type === 'ACTIVATE_ABILITY' && action.abilityId === 'ABIL-035-count',
      );
      expect(offered, `${don} DON!!`).toBe(open);
    }
  });

  it('reaches ten, which is every DON!! a player has', () => {
    // CR 5-1-2 gives each player a 10-card DON!! deck, so "10 DON!! cards on your
    // field" is all of them deployed. `OP01-091` King asks for exactly this, and
    // the engine's own conservation invariant is what makes 10 the ceiling.
    const state = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-035' }], activeDon: 10 },
      p2: { activeDon: 3 },
    });
    expect(onField(state)).toBe(10);
    expect(state.players.p1.don).toHaveLength(10);
    assertInvariants(state);
  });
});

describe('a static gated on the DON!! count', () => {
  function staged(don: number): GameState {
    return buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-035' }], activeDon: don },
      p2: { activeDon: 3 },
    });
  }

  it('turns the buff on above the line and off below it', () => {
    const off = staged(7);
    const on = staged(8);
    expect(getPower(off, characterAt(off, 'p1', 0))).toBe(2000);
    expect(getPower(on, characterAt(on, 'p1', 0))).toBe(3000);
  });

  it('writes no modifier either way, which is what makes it continuous', () => {
    const on = staged(8);
    expect(on.modifiers).toEqual([]);
    expect(getPower(on, characterAt(on, 'p1', 0))).toBe(3000);
  });

  it('is evaluated inside static evaluation without re-entering anything', () => {
    // The condition reads `DonCard.location` and nothing else. DON!! carry no
    // abilities, so there is no static to walk and no `Lens` anchor needed —
    // unlike a power or keyword filter, which is why those two are anchored and
    // this is not. Reading power is the exercise: it runs `forEachStatic`, which
    // evaluates this condition, and it terminates.
    const on = staged(8);
    expect(() => getPower(on, characterAt(on, 'p1', 0))).not.toThrow();
    // And the DON!! themselves are inert: none of them is a card with abilities.
    for (const don of on.players.p1.don) {
      expect(on.cards[don.instanceId]).toBeUndefined();
    }
  });

  it('follows the count down when a DON!! is spent', () => {
    // Continuous means re-read, not recorded. Paying a cost that returns DON!!
    // to the deck drops the count under the line and the buff is simply gone.
    const state = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-035' }, { cardId: 'ABIL-010' }], activeDon: 8 },
      p2: { characters: [{ cardId: 'ABIL-005' }], activeDon: 3 },
    });
    const paymaster = characterAt(state, 'p1', 0);
    expect(getPower(state, paymaster)).toBe(3000);

    // `ABIL-010`'s `returnDon` cost sends one DON!! back to the DON!! deck —
    // the one move that takes a DON!! off the field entirely.
    const asking = applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: characterAt(state, 'p1', 1),
      abilityId: 'ABIL-010-main',
    }).state;
    const spent = answer(asking, [characterAt(state, 'p2', 0)]);

    expect(onField(spent)).toBe(7);
    expect(getPower(spent, paymaster)).toBe(2000);
    expect(spent.modifiers).toEqual([]);
  });
});

// ===========================================================================
// bottomDeckHand — a hand card under the deck, not into the trash
// ===========================================================================

describe('bottomDeckHand puts the chosen card under the deck', () => {
  function staged(): GameState {
    return buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-035' }], activeDon: 4 },
      p2: { activeDon: 4 },
    });
  }

  it('offers the whole hand and takes exactly one', () => {
    const state = staged();
    const asking = activate(state, 'ABIL-035-bottomDeck');
    expect(candidates(asking)).toEqual(asking.players.p1.hand);
    expect(asking.pending?.min).toBe(1);
    expect(asking.pending?.max).toBe(1);
  });

  it('moves it to the deck rather than the trash, and a later draw proves where', () => {
    // The distinction from `discardHand` is the whole point: a card under the
    // deck is a card its owner can draw again. Verified by drawing the deck down
    // to it rather than by reading `deck.at(-1)`.
    const state = staged();
    const asking = activate(state, 'ABIL-035-bottomDeck');
    const buried = candidates(asking)[0];
    if (buried === undefined) {
      throw new Error('expected a candidate');
    }
    const paid = answer(asking, [buried]);

    expect(paid.players.p1.trash).not.toContain(buried);
    expect(paid.players.p1.deck.at(-1)).toBe(buried);
    // The script drew one, so the hand is the same size minus the buried card
    // plus the draw.
    expect(paid.players.p1.hand).not.toContain(buried);
    expect(paid.pending).toBeNull();
  });

  it('is a decision: two answers bury two different cards', () => {
    const asking = activate(staged(), 'ABIL-035-bottomDeck');
    const [first, second] = candidates(asking);
    if (first === undefined || second === undefined) {
      throw new Error('expected at least two candidates');
    }
    expect(answer(asking, [first]).players.p1.deck.at(-1)).toBe(first);
    expect(answer(asking, [second]).players.p1.deck.at(-1)).toBe(second);
  });

  it('is not offered with an empty hand', () => {
    const state = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-035' }], activeDon: 4, hand: [], clearHand: true },
      p2: { activeDon: 4 },
    });
    expect(state.players.p1.hand).toEqual([]);
    const offered = legalActions(state, 'p1').some(
      (action) => action.type === 'ACTIVATE_ABILITY' && action.abilityId === 'ABIL-035-bottomDeck',
    );
    expect(offered).toBe(false);
  });
});

// ===========================================================================
// returnCharacters — and the source is a candidate
// ===========================================================================

describe('returnCharacters returns one of your own Characters to hand', () => {
  function staged(): GameState {
    return buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-035' }, { cardId: 'ABIL-008' }], activeDon: 4 },
      p2: { characters: [{ cardId: 'ABIL-005' }], activeDon: 4 },
    });
  }

  it('offers your Characters and never the opponent’s', () => {
    // "To **your** hand" is what says whose. `ZoneRef` carries no owner because a
    // card always returns to its own owner's zone, so an opponent's Character
    // would land in the opponent's hand and contradict the printed sentence.
    const state = staged();
    const asking = activate(state, 'ABIL-035-return');
    expect(candidates(asking)).toEqual(state.players.p1.characters);
    expect(candidates(asking)).not.toContain(characterAt(state, 'p2', 0));
  });

  it('includes the source itself, because nothing in the text excludes it', () => {
    const state = staged();
    const asking = activate(state, 'ABIL-035-return');
    expect(candidates(asking)).toContain(characterAt(state, 'p1', 0));
  });

  it('returns the chosen Character to hand and off the field', () => {
    const state = staged();
    const other = characterAt(state, 'p1', 1);
    const asking = activate(state, 'ABIL-035-return');
    const paid = answer(asking, [other]);

    expect(paid.players.p1.hand).toContain(other);
    expect(paid.players.p1.characters).not.toContain(other);
    expect(paid.pending).toBeNull();
  });

  it('still resolves the effect when it paid with its own source', () => {
    // `rules.selfReturnResolvesEffect`, default true. CR 8-3-1-3-1 describes a
    // payment happening after the effect has been "activated", and this engine
    // has run scripts from off the field since PR #27 (`[On K.O.]` resolves from
    // the trash). The alternative reading — CR 8-1-3-1-3 against CR 8-4-1's
    // ordering — would make a cost the card offers and no player can ever take.
    const state = staged();
    const source = characterAt(state, 'p1', 0);
    const handBefore = state.players.p1.hand.length;
    const asking = activate(state, 'ABIL-035-return');
    const paid = answer(asking, [source]);

    expect(paid.players.p1.characters).not.toContain(source);
    // The Paymaster itself, plus the card the script drew.
    expect(paid.players.p1.hand).toContain(source);
    expect(paid.players.p1.hand).toHaveLength(handBefore + 2);
    expect(paid.pending).toBeNull();
    assertInvariants(paid);
  });

  it('drops the effect instead when the flag is turned off', () => {
    const base = staged();
    const state: GameState = JSON.parse(JSON.stringify(base)) as GameState;
    state.rules.selfReturnResolvesEffect = false;
    const source = characterAt(state, 'p1', 0);
    const handBefore = state.players.p1.hand.length;

    const asking = activate(state, 'ABIL-035-return');
    const paid = answer(asking, [source]);

    // Paid — the cost is never taken back — and nothing drawn.
    expect(paid.players.p1.characters).not.toContain(source);
    expect(paid.players.p1.hand).toHaveLength(handBefore + 1);
    expect(paid.stack).toEqual([]);
  });

  it('is not offered with an empty board', () => {
    const state = buildScenario({
      decks,
      p1: { hand: ['ABIL-035'], clearHand: true, activeDon: 4 },
      p2: { activeDon: 4 },
    });
    expect(state.players.p1.characters).toEqual([]);
    expect(
      legalActions(state, 'p1').some(
        (action) => action.type === 'ACTIVATE_ABILITY' && action.abilityId === 'ABIL-035-return',
      ),
    ).toBe(false);
  });
});

// ===========================================================================
// restCharacters — two of yours, active only
// ===========================================================================

describe('restCharacters rests two of your active Characters', () => {
  function staged(active: number, rested = 0): GameState {
    // Distinct bodies rather than N copies of one card: how many second copies
    // the ABIL deck can afford falls every time the set grows, and a position
    // that needs two of the *same* card is a position the next card added can
    // break. These are singles, so the deck always has them.
    const spare = ['ABIL-004', 'ABIL-006', 'ABIL-007', 'ABIL-008'] as const;
    const rests = ['ABIL-010', 'ABIL-012', 'ABIL-014'] as const;
    const characters = [
      { cardId: 'ABIL-035' as const },
      ...spare.slice(0, active - 1).map((cardId) => ({ cardId })),
      ...rests.slice(0, rested).map((cardId) => ({ cardId, orientation: 'rested' as const })),
    ];
    return buildScenario({
      decks,
      // Life named so the bodies below are always available: the deal can
      // otherwise take one, and `takeFromDeck` does not reach the Life area.
      p1: {
        characters,
        activeDon: 4,
        lifeCards: ['ABIL-017', 'ABIL-019', 'ABIL-020', 'ABIL-025', 'ABIL-026'],
      },
      p2: { activeDon: 4 },
    });
  }

  it('offers only active Characters', () => {
    const state = staged(2, 1);
    const asking = activate(state, 'ABIL-035-rest');
    const rested = state.players.p1.characters.filter(
      (id) => state.cards[id]?.orientation === 'rested',
    );
    expect(rested).toHaveLength(1);
    for (const id of rested) {
      expect(candidates(asking)).not.toContain(id);
    }
    expect(candidates(asking)).toHaveLength(2);
  });

  it('rests both of them, source included when it is chosen', () => {
    const state = staged(2);
    const both = [...state.players.p1.characters];
    const asking = activate(state, 'ABIL-035-rest');
    const paid = answer(asking, both);

    for (const id of both) {
      expect(paid.cards[id]?.orientation).toBe('rested');
    }
    expect(paid.pending).toBeNull();
  });

  it('is not offered with only one active Character', () => {
    // CR 8-3-1-3: "if it is not possible to pay some or all of the activation
    // cost, the activation cost to activate the effect cannot be paid at all."
    // There is no partial payment, so the ability never reaches legalActions.
    const state = staged(1, 2);
    expect(
      legalActions(state, 'p1').some(
        (action) => action.type === 'ACTIVATE_ABILITY' && action.abilityId === 'ABIL-035-rest',
      ),
    ).toBe(false);
    expect(refuse(state, 'ABIL-035-rest')).toBe(REASONS.abilityCostUnpayable);
  });

  it('takes exactly two — an answer of one is refused', () => {
    const state = staged(3);
    const asking = activate(state, 'ABIL-035-rest');
    const only = candidates(asking)[0];
    if (only === undefined) {
      throw new Error('expected a candidate');
    }
    expect(
      applyFail(asking, {
        type: 'ANSWER_CHOICE',
        player: 'p1',
        choiceId: asking.pending?.id ?? '',
        answer: { kind: 'cards', selected: [only] },
      }),
    ).toBe(REASONS.choiceCardinality);
  });
});

// ===========================================================================
// lifeToHand — the top card, no choice, no [Trigger]
// ===========================================================================

describe('lifeToHand takes the top Life card into the hand', () => {
  function staged(life: number): GameState {
    return buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-035' }], activeDon: 4, life },
      p2: { activeDon: 4 },
    });
  }

  it('asks nothing at all, because CR 3-10-2 already chose', () => {
    // "When moving a card from their Life area to another area, a player must
    // select the card at the top of their Life cards unless otherwise
    // specified." The only cost in this batch that does not suspend.
    const state = staged(3);
    const done = activate(state, 'ABIL-035-life');
    expect(done.pending).toBeNull();
  });

  it('takes the top card and no other', () => {
    const state = staged(3);
    const top = state.players.p1.life[0];
    const rest = state.players.p1.life.slice(1);
    if (top === undefined) {
      throw new Error('expected a life card');
    }
    const done = activate(state, 'ABIL-035-life');

    expect(done.players.p1.hand).toContain(top);
    expect(done.players.p1.life).toEqual(rest);
  });

  it('fires no [Trigger], even when the card taken has one', () => {
    // CR 2-11-1: `[Trigger]` is "an effect that can be activated **instead of
    // the player adding the card from their Life area to their hand on taking
    // damage**", and CR 4-6-3 offers it only during the damage procedure of CR
    // 4-6-2. A payment is not damage. `ABIL-021` is the set's `[Trigger]` card,
    // staged on top so the case is not vacuous.
    const state = buildScenario({
      decks,
      p1: {
        characters: [{ cardId: 'ABIL-035' }],
        activeDon: 4,
        lifeCards: ['ABIL-021', 'ABIL-021'],
      },
      p2: { activeDon: 4 },
    });
    const top = state.players.p1.life[0];
    if (top === undefined) {
      throw new Error('expected a life card');
    }
    const result = applyAction(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: characterAt(state, 'p1', 0),
      abilityId: 'ABIL-035-life',
    });
    if (!result.ok) {
      throw new Error(result.reason);
    }

    expect(result.state.players.p1.hand).toContain(top);
    // No yes/no offer, and no trigger ability resolved.
    expect(result.state.pending).toBeNull();
    expect(
      result.events.some(
        (event) => event.type === 'abilityTriggered' && event.abilityId.endsWith('-trigger'),
      ),
    ).toBe(false);
    // PR #29's declared divergence — a life card with no zone while its
    // `[Trigger]` resolves — needs a `[Trigger]` to resolve, and none did.
    assertInvariants(result.state);
  });

  it('may be paid down to zero Life, and the game continues', () => {
    // CR 1-2-1-1-1: the defeat condition is "0 Life cards **and** your Leader
    // takes damage". Reaching zero is not itself a condition.
    const state = staged(1);
    expect(state.players.p1.life).toHaveLength(1);
    const done = activate(state, 'ABIL-035-life');

    expect(done.players.p1.life).toEqual([]);
    expect(done.status).not.toBe('finished');
    assertInvariants(done);
  });

  it('is not offered with no Life cards at all', () => {
    const state = staged(0);
    expect(state.players.p1.life).toEqual([]);
    expect(
      legalActions(state, 'p1').some(
        (action) => action.type === 'ACTIVATE_ABILITY' && action.abilityId === 'ABIL-035-life',
      ),
    ).toBe(false);
  });

  it('leaves the next card on top for the damage that follows', () => {
    // The cost and the damage step read the same stack, and this is the case
    // where that matters: the payment takes the top card, so the *next* damage
    // takes what is now on top. Nothing caches a life card, and the two routes
    // into the Life area — CR 3-10-2's "top unless otherwise specified" and CR
    // 4-6-2-1's "1 card from the top" — are the same top.
    const state = buildScenario({
      decks,
      p1: {
        characters: [{ cardId: 'ABIL-035' }],
        activeDon: 4,
        lifeCards: ['ABIL-006', 'ABIL-007', 'ABIL-010'],
      },
      p2: { activeDon: 4 },
    });
    const [first, second] = state.players.p1.life;
    if (first === undefined || second === undefined) {
      throw new Error('expected a staged life area');
    }

    const paid = applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: characterAt(state, 'p1', 0),
      abilityId: 'ABIL-035-life',
    }).state;
    expect(paid.players.p1.hand).toContain(first);
    expect(paid.players.p1.life[0]).toBe(second);
  });
});

// ===========================================================================
// The payment machinery, unchanged from PR #28
// ===========================================================================

describe('a suspended payment behaves the way PR #28 pinned it', () => {
  function asking(): GameState {
    const state = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-035' }, { cardId: 'ABIL-008' }], activeDon: 4 },
      p2: { activeDon: 4 },
    });
    return activate(state, 'ABIL-035-return');
  }

  it('holds priority with the payer and offers them only the answer', () => {
    const open = asking();
    expect(open.priority).toBe('p1');
    expect(legalActions(open, 'p1').map((action) => action.type)).toEqual([
      'ANSWER_CHOICE',
      'CONCEDE',
    ]);
    expect(legalActions(open, 'p2')).toEqual([{ type: 'CONCEDE', player: 'p2' }]);
  });

  it('round-trips mid-payment and answers identically', () => {
    // `costsPaid` still points at the cost that suspended, which is what let the
    // answer handler learn *which* price it is paying without the sink growing a
    // field. A serialized state is never halfway through one cost.
    const open = asking();
    expect(open.stack[0]?.costsPaid).toBe(0);
    expect(open.pending?.sink).toEqual({ kind: 'cost' });

    const rehydrated = JSON.parse(JSON.stringify(open)) as GameState;
    expect(rehydrated).toEqual(open);
    const chosen = candidates(open)[1];
    if (chosen === undefined) {
      throw new Error('expected a candidate');
    }
    expect(answer(rehydrated, [chosen])).toEqual(answer(open, [chosen]));
  });

  it('spends [Once Per Turn] when the payment starts, not when it finishes', () => {
    // CR 10-2-13-5, unchanged and re-checked because four more costs now suspend
    // between the charge and the resolution.
    const open = asking();
    const source = characterAt(open, 'p1', 0);
    expect(open.cards[source]?.usedThisTurn).toContain('ABIL-035-return');
  });
});

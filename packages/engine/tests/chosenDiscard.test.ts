import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, REASONS } from '../src/index.js';
import type { GameState, InstanceId, PlayerId } from '../src/index.js';
import { assertInvariants } from '../src/invariants.js';
import { ABIL_DECK } from '../src/testdata/abilityDecks.js';
import { buildScenario, characterAt, handCard } from '../src/testdata/scenarios.js';
import { applyFail, applyOk } from './helpers.js';

/**
 * The chosen discard — the instruction half of the project's oldest divergence.
 *
 * Phase 2A took from the front of the hand and wrote the debt down. PR #28
 * bought the **cost** half (`Cost.discardHand`). This is the other half, and
 * with it the divergence is closed rather than halved: there is no deterministic
 * discard left in the DSL, because no printed card in the game means "trash the
 * leftmost card in your hand".
 *
 * **Two `PlayerRef`s, not one, and that is the whole design.** Three printed
 * shapes exist:
 *
 * - "trash N cards from your hand" — chooser and owner are the controller (142
 *   cards in the set)
 * - "your opponent trashes N cards from their hand" — both are the opponent (21)
 * - "your opponent **chooses** N cards from **your** hand" — they are opposite
 *   (**1**: `OP01-038` Kanjuro, the only card in the entire game)
 *
 * A single "whose hand" field would say the first two and make the third
 * unspellable. `ABIL-002` carries all three so the engine owns the shape without
 * the card package.
 *
 * **This is the first script in the engine that asks the other player anything.**
 * Every other `openChoice` call site passes `item.controller`; the `discardHand`
 * cost of PR #28 resolves its candidates with `owner: 'you'` hardcoded and opens
 * to the controller too. Choices have gone to the *non-turn* player since Phase
 * 2A — a life card's `[Trigger]` belongs to the damaged player — but never to the
 * ability's opponent. Nothing underneath needed changing, which is the finding:
 * `openChoice` already moves priority, `checkEffectShape` already asserts the two
 * agree, and `validateAnswerChoice` already refuses everyone else.
 */

const decks = { p1: ABIL_DECK, p2: ABIL_DECK };

function answer(state: GameState, player: PlayerId, selected: InstanceId[]): GameState {
  return applyOk(state, {
    type: 'ANSWER_CHOICE',
    player,
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

// ---------------------------------------------------------------------------
// chooser === owner === you — "trash 1 card from your hand"
// ---------------------------------------------------------------------------

describe('ABIL-002 [On Play] — the controller picks out of their own hand', () => {
  function staged(): GameState {
    return buildScenario({ decks, p1: { activeDon: 3, hand: ['ABIL-002'] }, p2: { activeDon: 3 } });
  }

  it('offers the controller their whole hand and nobody else’s', () => {
    const state = staged();
    const asking = applyOk(state, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: handCard(state, 'p1', 'ABIL-002'),
    }).state;

    expect(asking.pending?.player).toBe('p1');
    expect(asking.pending?.kind).toBe('selectCards');
    expect(candidates(asking)).toEqual(asking.players.p1.hand);
  });

  it('asks for exactly one, because no printed form of this says "may"', () => {
    const state = staged();
    const asking = applyOk(state, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: handCard(state, 'p1', 'ABIL-002'),
    }).state;
    expect(asking.pending?.min).toBe(1);
    expect(asking.pending?.max).toBe(1);
    // CR 8-4-4-1 lets a player choose 0 only where the count is "up to"; this
    // sentence names a number, so an empty answer is not a legal move.
    expect(
      applyFail(asking, {
        type: 'ANSWER_CHOICE',
        player: 'p1',
        choiceId: asking.pending?.id ?? '',
        answer: { kind: 'cards', selected: [] },
      }),
    ).toBe(REASONS.choiceCardinality);
  });
});

// ---------------------------------------------------------------------------
// chooser === owner === opponent — "your opponent trashes 1 card"
// ---------------------------------------------------------------------------

describe('ABIL-002 [Activate: Main] — the opponent picks out of their own hand', () => {
  function staged(): GameState {
    return buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-002' }], activeDon: 4 },
      p2: { activeDon: 4 },
    });
  }

  function activate(state: GameState): GameState {
    return applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: characterAt(state, 'p1', 0),
      abilityId: 'ABIL-002-main',
    }).state;
  }

  it('opens the choice to p2, over p2’s hand', () => {
    const state = staged();
    const asking = activate(state);
    expect(asking.pending?.player).toBe('p2');
    expect(candidates(asking)).toEqual(asking.players.p2.hand);
  });

  it('moves priority to the chooser, which the invariant already required', () => {
    const asking = activate(staged());
    expect(asking.priority).toBe('p2');
    // `checkEffectShape` asserts `priority === pending.player`; running the
    // invariants here says the new call site honours a rule that predates it.
    assertInvariants(asking);
  });

  it('trashes from p2’s hand into p2’s trash', () => {
    const state = staged();
    const asking = activate(state);
    const chosen = candidates(asking)[1] ?? candidates(asking)[0];
    if (chosen === undefined) {
      throw new Error('expected a candidate');
    }
    const done = answer(asking, 'p2', [chosen]);

    expect(done.players.p2.trash).toContain(chosen);
    expect(done.players.p2.hand).not.toContain(chosen);
    expect(done.players.p1.trash).not.toContain(chosen);
    expect(done.pending).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// chooser !== owner — Kanjuro's shape, and the reason there are two fields
// ---------------------------------------------------------------------------

describe('ABIL-002 [On K.O.] — the opponent picks out of the controller’s hand', () => {
  /**
   * p2 owns the Scavenger; p1 kills it. The ability's controller is p2, so
   * `owner: 'you'` is p2's hand and `chooser: 'opponent'` is p1 — the player who
   * controls nothing about this effect.
   */
  function killIt(): GameState {
    const state = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-012' }], activeDon: 4 },
      p2: { characters: [{ cardId: 'ABIL-002', orientation: 'rested' }], activeDon: 4 },
    });
    let next = applyOk(state, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(state, 'p1', 0),
      target: characterAt(state, 'p2', 0),
    }).state;
    next = applyOk(next, { type: 'PASS', player: 'p2' }).state;
    return applyOk(next, { type: 'PASS', player: 'p2' }).state;
  }

  it('asks the player who did not control the effect', () => {
    const asking = killIt();
    expect(asking.pending?.player).toBe('p1');
  });

  it('offers the *other* player’s hand as the candidates', () => {
    // The composition the instruction had to make and neither half could make
    // alone: candidates out of the owner's hand, question addressed to somebody
    // else. Both readings come from the instruction; neither is invented.
    const asking = killIt();
    expect(candidates(asking)).toEqual(asking.players.p2.hand);
    expect(candidates(asking)).not.toEqual(asking.players.p1.hand);
  });

  it('takes the card out of the owner’s hand, not the chooser’s', () => {
    const asking = killIt();
    const chosen = candidates(asking)[0];
    if (chosen === undefined) {
      throw new Error('expected a candidate');
    }
    const p1HandBefore = [...asking.players.p1.hand];
    const done = answer(asking, 'p1', [chosen]);

    expect(done.players.p2.trash).toContain(chosen);
    expect(done.players.p2.hand).not.toContain(chosen);
    expect(done.players.p1.hand).toEqual(p1HandBefore);
  });

  it('names the owner in the event, never the chooser', () => {
    // `cardDiscarded.player` has meant "whose hand this left" since Phase 0, and
    // the four cards in the full set that watch a discard all read "when a card
    // is trashed from **your** hand" — a fact about the owner. A chooser-keyed
    // event would tell every future observer the wrong story.
    const asking = killIt();
    const chosen = candidates(asking)[0];
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
    const discarded = result.events.filter((event) => event.type === 'cardDiscarded');
    expect(discarded).toEqual([{ type: 'cardDiscarded', player: 'p2', instanceId: chosen }]);
  });

  it('is a real decision: two answers, two different states', () => {
    // Without this the word "chosen" is a comment. The same open choice answered
    // two ways puts two different cards in the trash — which the deterministic
    // op it replaces could not do, by construction.
    const asking = killIt();
    const [first, second] = candidates(asking);
    if (first === undefined || second === undefined) {
      throw new Error('expected at least two candidates');
    }
    expect(answer(asking, 'p1', [first]).players.p2.trash).toContain(first);
    expect(answer(asking, 'p1', [second]).players.p2.trash).toContain(second);
    expect(answer(asking, 'p1', [first]).players.p2.trash).not.toContain(second);
  });
});

// ---------------------------------------------------------------------------
// Suspended priority, across the table
// ---------------------------------------------------------------------------

describe('while the opponent is choosing, the controller has one move', () => {
  it('leaves the controller exactly [CONCEDE]', () => {
    // The rule is `legalActions`' universal gate — the non-priority player gets
    // exactly CONCEDE — and this is the first time a player's *own* card can put
    // them behind it. Nothing about the gate is new; the route to it is.
    const state = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-002' }], activeDon: 4 },
      p2: { activeDon: 4 },
    });
    const asking = applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: characterAt(state, 'p1', 0),
      abilityId: 'ABIL-002-main',
    }).state;

    expect(legalActions(asking, 'p1')).toEqual([{ type: 'CONCEDE', player: 'p1' }]);
    // And the chooser gets the marker plus a concede, which is what every open
    // choice has always offered its owner.
    expect(legalActions(asking, 'p2').map((action) => action.type)).toEqual([
      'ANSWER_CHOICE',
      'CONCEDE',
    ]);
  });

  it('refuses an answer from the controller, and on priority rather than on ownership', () => {
    const state = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-002' }], activeDon: 4 },
      p2: { activeDon: 4 },
    });
    const asking = applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: characterAt(state, 'p1', 0),
      abilityId: 'ABIL-002-main',
    }).state;
    const theirs = asking.pending?.candidates[0];
    if (theirs === undefined) {
      throw new Error('expected a candidate');
    }
    // `notYourPriority`, not `notYourChoice`, and the order is the honest one:
    // `openChoice` moved priority to the chooser, so the controller is stopped
    // by the universal gate before the choice's own ownership check is reached.
    // `notYourChoice` stays reachable for the case it was written for — an
    // answer aimed at a choice that is not the open one.
    expect(
      applyFail(asking, {
        type: 'ANSWER_CHOICE',
        player: 'p1',
        choiceId: asking.pending?.id ?? '',
        answer: { kind: 'cards', selected: [theirs] },
      }),
    ).toBe(REASONS.notYourPriority);
  });
});

// ---------------------------------------------------------------------------
// Serialization, with the non-controller holding the question
// ---------------------------------------------------------------------------

describe('a choice held by the non-controller survives a JSON round trip', () => {
  function killIt(): GameState {
    const state = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-012' }], activeDon: 4 },
      p2: { characters: [{ cardId: 'ABIL-002', orientation: 'rested' }], activeDon: 4 },
    });
    let next = applyOk(state, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(state, 'p1', 0),
      target: characterAt(state, 'p2', 0),
    }).state;
    next = applyOk(next, { type: 'PASS', player: 'p2' }).state;
    return applyOk(next, { type: 'PASS', player: 'p2' }).state;
  }

  it('round-trips the pending choice, its owner and its sink', () => {
    const asking = killIt();
    const rehydrated = JSON.parse(JSON.stringify(asking)) as GameState;
    expect(rehydrated).toEqual(asking);
    expect(rehydrated.pending?.player).toBe('p1');
    expect(rehydrated.pending?.sink).toEqual({ kind: 'discard', owner: 'p2' });
  });

  it('answers the same after rehydrating as before', () => {
    // The sink carries the owner, so the rehydrated state needs nothing looked
    // up again — which is the property that makes a suspended effect a piece of
    // data rather than a paused function.
    const asking = killIt();
    const chosen = candidates(asking)[0];
    if (chosen === undefined) {
      throw new Error('expected a candidate');
    }
    const rehydrated = JSON.parse(JSON.stringify(asking)) as GameState;

    const direct = answer(asking, 'p1', [chosen]);
    const afterTrip = answer(rehydrated, 'p1', [chosen]);
    expect(afterTrip).toEqual(direct);
  });
});

// ---------------------------------------------------------------------------
// An empty hand
// ---------------------------------------------------------------------------

describe('a discard with nothing to discard', () => {
  it('asks nothing and changes nothing', () => {
    // CR 1-3-2 performs "as many of the actions as possible", which for a
    // discard against an empty hand is none. An unanswerable choice would be a
    // game that cannot continue, so the instruction resolves to a no-op the way
    // every other instruction with no candidates does.
    const state = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-002' }], activeDon: 4 },
      p2: { activeDon: 4, hand: [], clearHand: true },
    });
    expect(state.players.p2.hand).toEqual([]);

    const result = applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: characterAt(state, 'p1', 0),
      abilityId: 'ABIL-002-main',
    });

    expect(result.state.pending).toBeNull();
    expect(result.state.players.p2.trash).toEqual([]);
    expect(result.events.some((event) => event.type === 'cardDiscarded')).toBe(false);
    // The ability still fired — it is the *instruction* that found nothing, and
    // a script that resolves to nothing is not a script that failed.
    expect(result.events.some((event) => event.type === 'abilityTriggered')).toBe(true);
    // Priority never left the controller, because no question was asked.
    expect(result.state.priority).toBe('p1');
  });

  it('takes what there is when the hand is shorter than the count', () => {
    // The same rule read the other way. `ABIL-002` asks for one and a one-card
    // hand has exactly one answer, so the clamp is exercised at its boundary.
    const state = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-002' }], activeDon: 4 },
      p2: { activeDon: 4, hand: ['ABIL-008'], clearHand: true },
    });
    const asking = applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: characterAt(state, 'p1', 0),
      abilityId: 'ABIL-002-main',
    }).state;

    expect(candidates(asking)).toHaveLength(1);
    expect(asking.pending?.min).toBe(1);
    const only = candidates(asking)[0];
    if (only === undefined) {
      throw new Error('expected a candidate');
    }
    const done = answer(asking, 'p2', [only]);
    expect(done.players.p2.hand).toEqual([]);
    expect(done.players.p2.trash).toEqual([only]);
  });
});

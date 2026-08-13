import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, REASONS } from '../src/index.js';
import type { Action, GameState, InstanceId } from '../src/index.js';
import { assertInvariants } from '../src/invariants.js';
import { assertSerializationRoundTrip } from '../src/testing/index.js';
import { ABIL_DECK } from '../src/testdata/abilityDecks.js';
import { buildScenario, characterAt } from '../src/testdata/scenarios.js';
import { applyFail, applyOk } from './helpers.js';

/**
 * Costs the player pays a *choice* for.
 *
 * `discardHand` used to take from the front of the hand, and the engine README
 * called that out as "the one divergence that deletes a real player decision".
 * The decision is back, and it arrives through the mechanism the interpreter
 * already had rather than a second one: a cursor in plain data, a `PendingChoice`
 * that names where its answer goes, and the rule that the suspending step never
 * advances the cursor — the answer does.
 *
 * Four rules were read off the Comprehensive Rules v1.2.0 before any of this was
 * written, and each has a case below.
 *
 * - **Where the choice happens.** CR 8-4-1-2 specifies *the effect* to be
 *   activated; CR 8-4-1-3 is where you "determine the activation costs and pay
 *   all activation costs". Determining is the choosing, so the suspension point
 *   is inside the payment step, after the effect is already specified.
 * - **There is no cancelling.** CR 8-3-1-4 puts the decline *before* payment
 *   ("the player can choose not to pay the activation cost; however, this will
 *   mean the effect cannot be activated"), and CR 8-3-1-3-1 handles the only
 *   mid-payment case there is — becoming *unable* to pay — by paying as much as
 *   possible and not resolving. Regret is not in the rules, so `ANSWER_CHOICE`
 *   needs no cancel form.
 * - **Multiple costs are ordered by the card, not the player.** CR 8-3-1-1: the
 *   actions of one activation cost are "carried out in order starting from the
 *   text closest to the top".
 * - **The condition is not re-checked after payment.** CR 8-4-1-1 checks, then
 *   8-4-1-3 pays, then 8-4-1-4 activates. A payment that falsifies the condition
 *   it fired on does not un-fire the ability.
 */

const decks = { p1: ABIL_DECK, p2: ABIL_DECK };

function assertSettled(state: GameState): void {
  expect(state.pending).toBeNull();
  expect(state.stack).toEqual([]);
  expect(state.resume).toEqual([]);
  assertInvariants(state);
}

function openChoice(state: GameState): NonNullable<GameState['pending']> {
  const pending = state.pending;
  if (pending === null) {
    throw new Error('expected a choice to be open');
  }
  return pending;
}

function answer(state: GameState, selected: readonly InstanceId[]): GameState {
  const pending = openChoice(state);
  return applyOk(state, {
    type: 'ANSWER_CHOICE',
    player: pending.player,
    choiceId: pending.id,
    answer: { kind: 'cards', selected: [...selected] },
  }).state;
}

function handIds(state: GameState, player: 'p1' | 'p2' = 'p1'): InstanceId[] {
  return [...state.players[player].hand];
}

function cardIdOf(state: GameState, id: InstanceId): string {
  const card = state.cards[id];
  if (card === undefined) {
    throw new Error(`missing instance ${id}`);
  }
  return card.cardId;
}

/** p1 holds the Gambler plus two distinct, distinguishable cards. */
function gamblerInHand(extra: readonly string[] = ['ABIL-005', 'ABIL-008']): GameState {
  return buildScenario({
    decks,
    p1: {
      clearHand: true,
      activeDon: 6,
      characters: [{ cardId: 'ABIL-002' }],
      hand: [...extra, 'ABIL-020'],
    },
  });
}

function playGambler(state: GameState): GameState {
  const gambler = state.players.p1.hand.at(-1);
  if (gambler === undefined) {
    throw new Error('p1 has an empty hand');
  }
  return applyOk(state, { type: 'PLAY_CARD', player: 'p1', instanceId: gambler }).state;
}

/** The Gambler on the field, with a hand the caller controls. */
function gamblerOnField(hand: readonly string[]): GameState {
  return buildScenario({
    decks,
    p1: {
      clearHand: true,
      activeDon: 6,
      characters: [{ cardId: 'ABIL-020' }],
      hand: [...hand],
    },
  });
}

function activate(state: GameState, abilityId: string): Action {
  return {
    type: 'ACTIVATE_ABILITY',
    player: 'p1',
    instanceId: characterAt(state, 'p1', 0),
    abilityId,
  };
}

function offers(state: GameState, abilityId: string): boolean {
  return legalActions(state, 'p1').some(
    (action) => action.type === 'ACTIVATE_ABILITY' && action.abilityId === abilityId,
  );
}

describe('the discard cost asks which card', () => {
  it('opens a choice over the whole hand instead of eating the front of it', () => {
    const staged = gamblerInHand();
    const before = handIds(staged).slice(0, 2);

    const paying = playGambler(staged);

    const pending = openChoice(paying);
    expect(pending.player).toBe('p1');
    expect(pending.kind).toBe('selectCards');
    expect(pending.candidates).toEqual(before);
    // A price is exact. CR 8-3-1-3: what cannot be paid in part cannot be paid
    // at all, so there is no "up to" here — min and max are both the count.
    expect(pending.min).toBe(1);
    expect(pending.max).toBe(1);
    // Nothing has been spent yet. The cost that opened the choice did not move
    // the payment cursor, so the serialized state is stopped *before* a cost,
    // never halfway through one.
    expect(paying.players.p1.trash).toEqual([]);
    expect(paying.stack.at(-1)?.costsPaid).toBe(0);
  });

  it('lets the player pick, and the resulting state depends on the pick', () => {
    // The case the whole PR exists for: two different cards, two different
    // outcomes. Under the old front-of-hand rule these two runs were identical.
    const staged = gamblerInHand();
    const [first, second] = handIds(staged);
    if (first === undefined || second === undefined) {
      throw new Error('staging bug: the hand is too small');
    }

    const keepingSecond = answer(playGambler(staged), [first]);
    const keepingFirst = answer(playGambler(staged), [second]);

    expect(keepingSecond.players.p1.trash).toEqual([first]);
    expect(keepingFirst.players.p1.trash).toEqual([second]);
    expect(keepingSecond.players.p1.hand).toContain(second);
    expect(keepingFirst.players.p1.hand).toContain(first);
    // And the two hands really are different cards, not two copies of one.
    expect(cardIdOf(keepingSecond, second)).not.toBe(cardIdOf(keepingFirst, first));
    assertSettled(keepingSecond);
    assertSettled(keepingFirst);
  });

  it('runs the script only after the payment lands', () => {
    const staged = gamblerInHand();
    const paying = playGambler(staged);
    const handWhilePaying = paying.players.p1.hand.length;

    const done = answer(paying, [handIds(paying)[0] as InstanceId]);

    // −1 discarded by the cost, +1 drawn by the script (CR 8-4-1-3 before
    // 8-4-1-5), and the draw did not happen while the choice was open.
    expect(paying.players.p1.trash).toEqual([]);
    expect(done.players.p1.hand).toHaveLength(handWhilePaying - 1 + 1);
    expect(done.log.some((event) => event.type === 'cardDiscarded')).toBe(true);
    assertSettled(done);
  });

  it('still refuses to fire when the hand cannot pay', () => {
    const staged = buildScenario({
      decks,
      p1: { clearHand: true, activeDon: 5, characters: [{ cardId: 'ABIL-002' }], hand: ['ABIL-020'] },
    });
    const gambler = staged.players.p1.hand.at(-1) as InstanceId;

    const done = applyOk(staged, { type: 'PLAY_CARD', player: 'p1', instanceId: gambler }).state;

    // The card itself was the whole hand, so paying leaves nothing to discard —
    // and an unpayable cost means the ability never fires (CR 8-3-1-3), which is
    // the behaviour that predates this change and must survive it.
    expect(done.players.p1.hand).toEqual([]);
    expect(done.players.p1.trash).toEqual([]);
    assertSettled(done);
  });
});

describe('a suspended payment survives serialization', () => {
  it('round-trips a state whose open choice is a cost', () => {
    const paying = playGambler(gamblerInHand());
    expect(openChoice(paying).sink).toEqual({ kind: 'cost' });

    // deepStrictEqual, not toEqual: it separates `{ a: undefined }` from `{}`,
    // which is how a closure or an explicit-undefined field would show up.
    assertSerializationRoundTrip(paying);
    expect(JSON.parse(JSON.stringify(paying))).toEqual(paying);
  });

  it('answers the same way after a round trip as before one', () => {
    const paying = playGambler(gamblerInHand());
    const chosen = handIds(paying)[1] as InstanceId;

    const live = answer(paying, [chosen]);
    const rehydrated = answer(JSON.parse(JSON.stringify(paying)) as GameState, [chosen]);

    // The whole state, not a summary: there is nowhere for a continuation to
    // hide if the two are structurally identical.
    expect(rehydrated).toEqual(live);
    assertSettled(rehydrated);
  });
});

describe('a suspended payment suspends priority', () => {
  it('leaves the other player exactly [CONCEDE]', () => {
    const paying = playGambler(gamblerInHand());

    expect(paying.priority).toBe('p1');
    expect(legalActions(paying, 'p2')).toEqual([{ type: 'CONCEDE', player: 'p2' }]);
    // And the paying player is answering, not playing on.
    expect(legalActions(paying, 'p1').map((action) => action.type)).toEqual([
      'ANSWER_CHOICE',
      'CONCEDE',
    ]);
  });

  it('rejects an answer from the wrong player', () => {
    const paying = playGambler(gamblerInHand());
    const pending = openChoice(paying);
    expect(
      applyFail(paying, {
        type: 'ANSWER_CHOICE',
        player: 'p2',
        choiceId: pending.id,
        answer: { kind: 'cards', selected: [pending.candidates[0] as InstanceId] },
      }),
      // `notYourPriority`, not `notYourChoice`: opening the choice moved
      // priority to the payer, so the wrong player is stopped by the universal
      // gate before the choice-specific one is ever consulted.
    ).toBe(REASONS.notYourPriority);
  });

  it('rejects a payment that is short, long, or names a card outside the hand', () => {
    const paying = playGambler(gamblerInHand());
    const pending = openChoice(paying);
    const send = (selected: InstanceId[]): string =>
      applyFail(paying, {
        type: 'ANSWER_CHOICE',
        player: 'p1',
        choiceId: pending.id,
        answer: { kind: 'cards', selected },
      });

    expect(send([])).toBe(REASONS.choiceCardinality);
    expect(send([...pending.candidates])).toBe(REASONS.choiceCardinality);
    expect(send([characterAt(paying, 'p1', 0)])).toBe(REASONS.choiceCandidateUnknown);
  });
});

describe('a filtered discard cost', () => {
  const CHEAP = 'ABIL-020-cheap';

  it('offers only the cards the filter matches', () => {
    // ABIL-005 costs 3, ABIL-008 costs 2, ABIL-011 costs 2. The filter is
    // costMax 2, so exactly two of the three may pay.
    const staged = gamblerOnField(['ABIL-005', 'ABIL-008', 'ABIL-011']);
    const [expensive, cheapA, cheapB] = handIds(staged);

    const paying = applyOk(staged, activate(staged, CHEAP)).state;

    expect(openChoice(paying).candidates).toEqual([cheapA, cheapB]);
    expect(openChoice(paying).candidates).not.toContain(expensive);
  });

  it('is not offered at all when no card in hand matches', () => {
    // `canPayCosts` counts *matching* cards, so the gate lands in
    // `legalActions` and not only in `applyAction` — the same property the
    // `restSelf` cost has.
    const nothingCheap = gamblerOnField(['ABIL-005', 'ABIL-007']);
    expect(offers(nothingCheap, CHEAP)).toBe(false);
    expect(applyFail(nothingCheap, activate(nothingCheap, CHEAP))).toBe(
      REASONS.abilityCostUnpayable,
    );

    const oneCheap = gamblerOnField(['ABIL-005', 'ABIL-008']);
    expect(offers(oneCheap, CHEAP)).toBe(true);
  });

  it('names the filter in the prompt it shows', () => {
    const paying = applyOk(
      gamblerOnField(['ABIL-008', 'ABIL-011']),
      activate(gamblerOnField(['ABIL-008', 'ABIL-011']), CHEAP),
    ).state;
    expect(openChoice(paying).prompt).toBe('Trash 1 card from your hand');
  });
});

describe('two costs on one ability', () => {
  const MAIN = 'ABIL-020-main';

  it('pays them in the order the card prints, DON!! first', () => {
    // CR 8-3-1-1 — "in order starting from the text closest to the top". The
    // player is never asked which cost to pay first, only which card pays the
    // one that has a choice in it.
    const staged = gamblerOnField(['ABIL-005', 'ABIL-008']);
    const restedBefore = staged.players.p1.don.filter(
      (don) => don.location.kind === 'cost' && don.location.orientation === 'rested',
    ).length;

    const paying = applyOk(staged, activate(staged, MAIN)).state;

    const restedWhilePaying = paying.players.p1.don.filter(
      (don) => don.location.kind === 'cost' && don.location.orientation === 'rested',
    ).length;
    // The DON!! are already spent when the discard opens its choice: the first
    // cost is complete and the second has not started.
    expect(restedWhilePaying).toBe(restedBefore + 2);
    expect(paying.stack.at(-1)?.costsPaid).toBe(1);
    expect(openChoice(paying).sink).toEqual({ kind: 'cost' });

    const done = answer(paying, [handIds(paying)[0] as InstanceId]);
    expect(done.players.p1.trash).toHaveLength(1);
    assertSettled(done);
  });

  it('is not offered when either half of the price is out of reach', () => {
    const noDon = buildScenario({
      decks,
      p1: { clearHand: true, activeDon: 1, characters: [{ cardId: 'ABIL-020' }], hand: ['ABIL-008'] },
    });
    expect(offers(noDon, MAIN)).toBe(false);

    const noHand = buildScenario({
      decks,
      p1: { clearHand: true, activeDon: 6, characters: [{ cardId: 'ABIL-020' }] },
    });
    expect(offers(noHand, MAIN)).toBe(false);
  });

  it('spends the [Once Per Turn] use as payment starts, not when it finishes', () => {
    // CR 10-2-13-5: a [Once Per Turn] effect whose payment breaks down partway
    // may not be activated again that turn, "even if the effect following that
    // activation cost did not resolve as a result". Charging the use only after
    // the last cost would hand it back to a player who stopped halfway.
    const staged = gamblerOnField(['ABIL-005', 'ABIL-008']);
    const source = characterAt(staged, 'p1', 0);

    const paying = applyOk(staged, activate(staged, MAIN)).state;

    expect(paying.cards[source]?.usedThisTurn).toContain(MAIN);
  });
});

describe('the condition is checked before the payment, and not again after', () => {
  const BRINK = 'ABIL-020-brink';

  it('resolves even though paying falsifies the condition it fired on', () => {
    // ABIL-020-brink needs two cards in hand and then spends both. CR 8-4-1
    // checks conditions at 8-4-1-1 and pays at 8-4-1-3; nothing looks again.
    const staged = gamblerOnField(['ABIL-005', 'ABIL-008']);
    expect(offers(staged, BRINK)).toBe(true);

    const paying = applyOk(staged, activate(staged, BRINK)).state;
    const pending = openChoice(paying);
    expect(pending.min).toBe(2);
    expect(pending.max).toBe(2);

    const done = answer(paying, pending.candidates);

    // Both cards paid, and the draw still happened: the hand is 0 − 2 + 1.
    expect(done.players.p1.trash).toHaveLength(2);
    expect(done.players.p1.hand).toHaveLength(1);
    expect(
      done.log.some(
        (event) => event.type === 'abilityTriggered' && event.abilityId === BRINK,
      ),
    ).toBe(true);
    assertSettled(done);
  });

  it('is not offered with only one card in hand', () => {
    expect(offers(gamblerOnField(['ABIL-008']), BRINK)).toBe(false);
  });
});

describe('nothing is left hanging', () => {
  it('walks a whole payment through applyAction with invariants after every step', () => {
    let state: GameState = gamblerInHand();
    const steps: Action[] = [];
    const gambler = state.players.p1.hand.at(-1) as InstanceId;
    steps.push({ type: 'PLAY_CARD', player: 'p1', instanceId: gambler });

    for (const action of steps) {
      const result = applyAction(state, action);
      if (!result.ok) {
        throw new Error(`unexpected rejection: ${result.reason}`);
      }
      state = result.state;
      assertInvariants(state);
      assertSerializationRoundTrip(state);
    }

    const pending = openChoice(state);
    const result = applyAction(state, {
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId: pending.id,
      answer: { kind: 'cards', selected: [pending.candidates[0] as InstanceId] },
    });
    if (!result.ok) {
      throw new Error(`unexpected rejection: ${result.reason}`);
    }
    assertInvariants(result.state);
    assertSerializationRoundTrip(result.state);
    assertSettled(result.state);
  });
});

import { describe, expect, it } from 'vitest';
import { getPower, legalActions } from '../src/index.js';
import type { Action, GameState, InstanceId } from '../src/index.js';
import { ABIL_DECK } from '../src/testdata/abilityDecks.js';
import { buildScenario, characterAt } from '../src/testdata/scenarios.js';
import { applyFail, applyOk } from './helpers.js';

/**
 * Activating a [Counter] Event from hand during the Counter Step (CR 7-1-3-2-2).
 *
 * The move the engine did not have: the attacked player pays the Event's
 * printed cost with active cost-area DON!!, trashes it, and its [Counter] effect
 * resolves. `ABIL-016 Desperate Parry` is the vehicle — a cost-1 Event whose
 * whole text adds +2000 to the battle target for the battle. The suspension and
 * `select` cases live in the cards package on a real Counter Event that opens a
 * choice; here the plain mechanics get pinned on the synthetic set.
 */

const decks = { p1: ABIL_DECK, p2: ABIL_DECK };

/** Nothing is left half-resolved and the state is still sound. */
function assertSettled(state: GameState): void {
  expect(state.pending).toBeNull();
  expect(state.stack).toEqual([]);
  expect(state.resume).toEqual([]);
}

function counterEventActions(state: GameState, player: 'p1' | 'p2'): Action[] {
  return legalActions(state, player).filter((action) => action.type === 'PLAY_COUNTER_EVENT');
}

function handOf(state: GameState, player: 'p1' | 'p2', cardId: string): InstanceId {
  const id = state.players[player].hand.find((instanceId) => state.cards[instanceId]?.cardId === cardId);
  if (id === undefined) {
    throw new Error(`test setup: ${player} has no ${cardId} in hand`);
  }
  return id;
}

/**
 * p1 attacks p2's leader with ABIL-005 (4000, Rush) and passes to the Counter
 * Step. p2 defends and holds `hand` with `activeDon` active cost-area DON!!.
 */
function toCounterStep(hand: string[], activeDon: number): GameState {
  const staged = buildScenario({
    decks,
    turn: 3,
    p1: { characters: [{ cardId: 'ABIL-005' }] },
    // clearHand so the defender's hand is exactly `hand`: the dealt opening hand
    // can itself contain an ABIL-016, which would make the offer counts noise.
    p2: { hand, activeDon, clearHand: true },
  });
  const attacking = applyOk(staged, {
    type: 'DECLARE_ATTACK',
    player: 'p1',
    attacker: characterAt(staged, 'p1', 0),
    target: staged.players.p2.leader,
  }).state;
  return applyOk(attacking, { type: 'PASS', player: 'p2' }).state;
}

describe('PLAY_COUNTER_EVENT — only the defender, only in the Counter Step', () => {
  it('offers a payable Counter Event to the defender at the Counter Step', () => {
    const counterStep = toCounterStep(['ABIL-016'], 1);
    const card = handOf(counterStep, 'p2', 'ABIL-016');

    const offered = counterEventActions(counterStep, 'p2');
    expect(offered).toEqual([{ type: 'PLAY_COUNTER_EVENT', player: 'p2', instanceId: card }]);
  });

  it('never offers it to the attacker, who has no priority in the Counter Step', () => {
    // ABIL-016 sits in the attacker's hand too, with DON!! to spare.
    const staged = buildScenario({
      decks,
      turn: 3,
      p1: { characters: [{ cardId: 'ABIL-005' }], hand: ['ABIL-016'], activeDon: 3, clearHand: true },
      p2: { hand: ['ABIL-016'], activeDon: 1, clearHand: true },
    });
    const attackerCard = handOf(staged, 'p1', 'ABIL-016');
    const attacking = applyOk(staged, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(staged, 'p1', 0),
      target: staged.players.p2.leader,
    }).state;
    const counterStep = applyOk(attacking, { type: 'PASS', player: 'p2' }).state;

    // The attacker is not the priority player, so the engine offers it nothing
    // but conceding, and rejects the play outright.
    expect(legalActions(counterStep, 'p1')).toEqual([{ type: 'CONCEDE', player: 'p1' }]);
    expect(
      applyFail(counterStep, { type: 'PLAY_COUNTER_EVENT', player: 'p1', instanceId: attackerCard }),
    ).toBe('notYourPriority');
  });

  it('is not a Main-phase play: not offered with the battle closed, and rejected', () => {
    const main = buildScenario({
      decks,
      turn: 3,
      p1: { hand: ['ABIL-016'], activeDon: 3, clearHand: true },
    });
    const card = handOf(main, 'p1', 'ABIL-016');

    expect(counterEventActions(main, 'p1')).toEqual([]);
    expect(applyFail(main, { type: 'PLAY_COUNTER_EVENT', player: 'p1', instanceId: card })).toBe(
      'noBattle',
    );
  });

  it('is not a Block-step play: not offered before the defender passes to counter', () => {
    const staged = buildScenario({
      decks,
      turn: 3,
      p1: { characters: [{ cardId: 'ABIL-005' }] },
      p2: { hand: ['ABIL-016'], activeDon: 1, clearHand: true },
    });
    const card = handOf(staged, 'p2', 'ABIL-016');
    const blockStep = applyOk(staged, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(staged, 'p1', 0),
      target: staged.players.p2.leader,
    }).state;
    expect(blockStep.battle?.step).toBe('block');

    expect(counterEventActions(blockStep, 'p2')).toEqual([]);
    expect(applyFail(blockStep, { type: 'PLAY_COUNTER_EVENT', player: 'p2', instanceId: card })).toBe(
      'wrongBattleStep',
    );
  });
});

describe('PLAY_COUNTER_EVENT — the cost is real', () => {
  it('is neither offered nor accepted when the printed cost cannot be paid', () => {
    const counterStep = toCounterStep(['ABIL-016'], 0); // cost 1, no active DON!!
    const card = handOf(counterStep, 'p2', 'ABIL-016');

    expect(counterEventActions(counterStep, 'p2')).toEqual([]);
    expect(
      applyFail(counterStep, { type: 'PLAY_COUNTER_EVENT', player: 'p2', instanceId: card }),
    ).toBe('notEnoughDon');
  });

  it('rests the cost DON!! when paid, and buffs the battle target', () => {
    const counterStep = toCounterStep(['ABIL-016'], 1);
    const card = handOf(counterStep, 'p2', 'ABIL-016');
    const leader = counterStep.players.p2.leader;

    const countered = applyOk(counterStep, {
      type: 'PLAY_COUNTER_EVENT',
      player: 'p2',
      instanceId: card,
    }).state;

    // 5000 leader + 2000 from the effect; the one active DON!! is now rested.
    expect(getPower(countered, leader)).toBe(7000);
    const activeCostDon = countered.players.p2.don.filter(
      (don) => don.location.kind === 'cost' && don.location.orientation === 'active',
    );
    expect(activeCostDon).toEqual([]);
    expect(countered.players.p2.trash[0]).toBe(card);
    assertSettled(countered);
  });
});

describe('PLAY_COUNTER_EVENT — several in one battle', () => {
  it('stacks two Counter Events, and PASS still closes the step', () => {
    const counterStep = toCounterStep(['ABIL-016', 'ABIL-016'], 2);
    const first = counterStep.players.p2.hand.filter(
      (id) => counterStep.cards[id]?.cardId === 'ABIL-016',
    );
    expect(first).toHaveLength(2);
    const leader = counterStep.players.p2.leader;

    const afterFirst = applyOk(counterStep, {
      type: 'PLAY_COUNTER_EVENT',
      player: 'p2',
      instanceId: first[0] as InstanceId,
    }).state;
    // Priority stays with the defender: a second Counter Event is still offered.
    expect(counterEventActions(afterFirst, 'p2')).toHaveLength(1);

    const afterSecond = applyOk(afterFirst, {
      type: 'PLAY_COUNTER_EVENT',
      player: 'p2',
      instanceId: first[1] as InstanceId,
    }).state;

    // Both effects are live at once: 5000 + 2000 + 2000.
    expect(getPower(afterSecond, leader)).toBe(9000);
    expect(afterSecond.players.p2.trash.slice(0, 2).sort()).toEqual([...first].sort());
    assertSettled(afterSecond);

    // PASS resolves the battle and the endOfBattle buffs expire together.
    const resolved = applyOk(afterSecond, { type: 'PASS', player: 'p2' }).state;
    expect(resolved.battle).toBeNull();
    expect(getPower(resolved, leader)).toBe(5000);
    expect(resolved.modifiers).toEqual([]);
    assertSettled(resolved);
  });
});

describe('PLAY_COUNTER_EVENT — the buff lasts the battle', () => {
  it('expires the Counter Event power when the battle resolves', () => {
    const counterStep = toCounterStep(['ABIL-016'], 1);
    const card = handOf(counterStep, 'p2', 'ABIL-016');
    const leader = counterStep.players.p2.leader;

    const countered = applyOk(counterStep, {
      type: 'PLAY_COUNTER_EVENT',
      player: 'p2',
      instanceId: card,
    }).state;
    expect(getPower(countered, leader)).toBe(7000);
    expect(countered.modifiers.some((mod) => mod.duration === 'endOfBattle')).toBe(true);

    // The attacker (4000) now loses to the buffed 7000 leader; either way the
    // endOfBattle modifier is gone once the battle is closed.
    const resolved = applyOk(countered, { type: 'PASS', player: 'p2' }).state;
    expect(resolved.battle).toBeNull();
    expect(getPower(resolved, leader)).toBe(5000);
    expect(resolved.modifiers).toEqual([]);
    assertSettled(resolved);
  });
});

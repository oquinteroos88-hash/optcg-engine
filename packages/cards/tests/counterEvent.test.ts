import { describe, expect, it } from 'vitest';
import { getPower, legalActions } from '@optcg/engine';
import type { GameState, InstanceId } from '@optcg/engine';
import { characterAt, handCard } from '@optcg/engine/testdata/scenarios';
import { answer, applyOk, assertSettled, firedIds, starterScenario } from './support.js';
import { englishCards } from '../src/index.js';

/**
 * Activating a [Counter] Event from hand — ST01-014 Guard Point.
 *
 * This file used to pin the *absence* of the move: every `[Counter]` ability in
 * the game is on an Event, no Event carries a printed Counter value, and the
 * engine only knew how to discard a counter-valued card. Guard Point's
 * `[Counter]` half was therefore unreachable and left unwritten.
 *
 * The engine now has PLAY_COUNTER_EVENT (CR 7-1-3-2-2): pay the Event's cost,
 * trash it, resolve its effect. So the alarm is inverted — Guard Point is
 * offered and it works — and the one fact that has not changed stays pinned: no
 * real card mixes a printed Counter value with a [Counter] ability.
 */

/** Both counter moves in one hand, at the Counter Step, defended by p1. */
function counterStep(p1Hand: string[], activeDon: number): GameState {
  const staged = starterScenario({
    firstPlayer: 'p2',
    p1: { hand: p1Hand, activeDon, clearHand: true },
    // Koby, 6000, outmuscles the 5000 Leader with no DON!! attached.
    p2: { characters: [{ cardId: 'ST02-006' }] },
  });
  const afterAttack = applyOk(staged, {
    type: 'DECLARE_ATTACK',
    player: 'p2',
    attacker: characterAt(staged, 'p2', 0),
    target: staged.players.p1.leader,
  }).state;
  return applyOk(afterAttack, { type: 'PASS', player: 'p1' }).state;
}

function counterEventTargets(state: GameState, player: 'p1' | 'p2'): InstanceId[] {
  return legalActions(state, player)
    .filter((action) => action.type === 'PLAY_COUNTER_EVENT')
    .map((action) => (action.type === 'PLAY_COUNTER_EVENT' ? action.instanceId : ''));
}

function plainCounterTargets(state: GameState, player: 'p1' | 'p2'): InstanceId[] {
  return legalActions(state, player)
    .filter((action) => action.type === 'PLAY_COUNTER')
    .map((action) => (action.type === 'PLAY_COUNTER' ? action.instanceId : ''));
}

describe('the printed-value and Counter-Event moves are distinct', () => {
  it('no card in the set mixes a [Counter] ability with a printed Counter value', () => {
    const counterCards = englishCards.filter((card) =>
      [card.effectText, card.triggerText].some((text) => text?.includes('[Counter]') === true),
    );

    expect(counterCards.length).toBeGreaterThan(0);
    // Every [Counter] ability is on an Event, and none of them prints a value:
    // that is exactly why activating one is a play (PLAY_COUNTER_EVENT) and not
    // a discard for a printed amount (PLAY_COUNTER).
    expect(counterCards.every((card) => card.category === 'event')).toBe(true);
    expect(counterCards.filter((card) => card.counter !== null)).toEqual([]);
  });

  it('offers Guard Point as a Counter Event and Karoo as a printed counter, never crossed', () => {
    const staged = counterStep(['ST01-014', 'ST01-003'], 1);
    const guardPoint = handCard(staged, 'p1', 'ST01-014');
    const karoo = handCard(staged, 'p1', 'ST01-003');
    expect(staged.battle?.step).toBe('counter');

    const asCounterEvent = counterEventTargets(staged, 'p1');
    const asPrintedCounter = plainCounterTargets(staged, 'p1');

    // Guard Point is a Counter Event; Karoo is discarded for its printed value.
    // Each move offers its own card and not the other's.
    expect(asCounterEvent).toContain(guardPoint);
    expect(asCounterEvent).not.toContain(karoo);
    expect(asPrintedCounter).toContain(karoo);
    expect(asPrintedCounter).not.toContain(guardPoint);
  });
});

describe('Guard Point [Counter] gives +3000 for the battle', () => {
  it('buffs the chosen ally and expires when the battle resolves', () => {
    const staged = counterStep(['ST01-014'], 1);
    const guardPoint = handCard(staged, 'p1', 'ST01-014');
    const leader = staged.players.p1.leader;
    const basePower = getPower(staged, leader);

    const asking = applyOk(staged, {
      type: 'PLAY_COUNTER_EVENT',
      player: 'p1',
      instanceId: guardPoint,
    }).state;
    const buffed = answer(asking, 'p1', { kind: 'cards', selected: [leader] });

    expect(getPower(buffed, leader)).toBe(basePower + 3000);
    assertSettled(buffed);

    // endOfBattle, exactly like a counter played for its value: gone once the
    // battle closes.
    const resolved = applyOk(buffed, { type: 'PASS', player: 'p1' }).state;
    expect(resolved.battle).toBeNull();
    expect(getPower(resolved, leader)).toBe(basePower);
    expect(resolved.modifiers).toEqual([]);
    assertSettled(resolved);
  });
});

describe('Guard Point suspends inside the battle', () => {
  it('opens a choice with the battle still open, and survives serialization', () => {
    const staged = counterStep(['ST01-014'], 1);
    const guardPoint = handCard(staged, 'p1', 'ST01-014');

    const asking = applyOk(staged, {
      type: 'PLAY_COUNTER_EVENT',
      player: 'p1',
      instanceId: guardPoint,
    }).state;

    // The novel combination: a battle in progress AND a suspended choice.
    expect(asking.battle?.step).toBe('counter');
    expect(asking.pending?.kind).toBe('selectCards');
    expect(asking.pending?.player).toBe('p1');
    // pay -> trash -> activate: the card is already in the trash when its own
    // effect opens the choice.
    expect(asking.players.p1.trash[0]).toBe(guardPoint);
    expect(asking.players.p1.hand).not.toContain(guardPoint);

    // The whole suspended-mid-battle state round-trips through JSON untouched.
    const rehydrated = JSON.parse(JSON.stringify(asking)) as GameState;
    expect(rehydrated).toEqual(asking);

    // The player who is not being asked has exactly one move: concede.
    expect(legalActions(asking, 'p2')).toEqual([{ type: 'CONCEDE', player: 'p2' }]);

    // Answering after rehydration lands on the same result as answering the
    // in-memory state — the interpreter cannot tell the two apart.
    const leader = asking.players.p1.leader;
    const fromMemory = answer(asking, 'p1', { kind: 'cards', selected: [leader] });
    const fromDisk = answer(rehydrated, 'p1', { kind: 'cards', selected: [leader] });
    expect(fromDisk).toEqual(fromMemory);
    assertSettled(fromMemory);
  });
});

describe('Guard Point in a real battle', () => {
  it('saves the Leader from an attack that would otherwise take a life', () => {
    const staged = counterStep(['ST01-014'], 1);
    const guardPoint = handCard(staged, 'p1', 'ST01-014');
    const leader = staged.players.p1.leader;
    const lifeBefore = staged.players.p1.life.length;

    const asking = applyOk(staged, {
      type: 'PLAY_COUNTER_EVENT',
      player: 'p1',
      instanceId: guardPoint,
    });
    const buffed = answer(asking.state, 'p1', { kind: 'cards', selected: [leader] });
    // The [Counter] effect actually resolved in this line of play.
    expect(firedIds(asking.events)).toContain('ST01-014-counter');

    // Buffed to 8000, the Leader now outlasts Koby's 6000: no damage, no life
    // lost — the play changed the outcome, it did not merely happen.
    const resolved = applyOk(buffed, { type: 'PASS', player: 'p1' });
    const resolvedState = resolved.state;
    expect(resolvedState.battle).toBeNull();
    expect(resolvedState.players.p1.life.length).toBe(lifeBefore);
    expect(
      resolved.events.some(
        (event) => event.type === 'battleResolved' && event.outcome === 'noEffect',
      ),
    ).toBe(true);
    assertSettled(resolvedState);
  });
});

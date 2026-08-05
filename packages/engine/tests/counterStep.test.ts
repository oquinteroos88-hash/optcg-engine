import { describe, expect, it } from 'vitest';
import { applyAction, getPower, legalActions } from '../src/index.js';
import type { GameState, InstanceId } from '../src/index.js';
import { buildScenario, characterAt, handCard } from '../src/testdata/scenarios.js';
import { applyFail, applyOk, run } from './helpers.js';

// Targeted tests for the calculation implementations get wrong most often:
// the attacker wins ties. Random bots do reach ties, but they cannot be made
// to reach a specific one, so these positions are built directly.
//
// Card stats used here (see testdata/cards.ts):
//   TEST-006 / TEST-106  character  power 5000  counter 1000
//   TEST-005 / TEST-105  character  power 4000  counter 2000
//   TEST-001 / TEST-101  character  power 2000  counter 1000
//   TEST-004 / TEST-104  character  power 2000  counter 2000
//   TEST-009 / TEST-109  character  power 9000  counter 0
//   Both leaders         power 5000, life 5 (p1) / 4 (p2)

/** p1 attacker vs a p2 defender, with the given counter cards in p2's hand. */
function battlefield(opts: {
  attacker: string;
  attackerDon?: number;
  defender: string;
  counters: string[];
}): { state: GameState; attacker: InstanceId; defender: InstanceId } {
  const state = buildScenario({
    p1: {
      activeDon: opts.attackerDon ?? 0,
      characters: [
        {
          cardId: opts.attacker,
          ...(opts.attackerDon === undefined ? {} : { attachedDon: opts.attackerDon }),
        },
      ],
    },
    p2: {
      clearHand: true,
      characters: [{ cardId: opts.defender, orientation: 'rested' }],
      hand: opts.counters,
    },
  });
  return { state, attacker: characterAt(state, 'p1', 0), defender: characterAt(state, 'p2', 0) };
}

describe('A. counter step and the tie', () => {
  it('A1: 5000 attacker vs 4000 character countered to exactly 5000 — tie, character is KO', () => {
    const { state, attacker, defender } = battlefield({
      attacker: 'TEST-006', // 5000
      defender: 'TEST-105', // 4000
      counters: ['TEST-101'], // counter 1000
    });
    const counter = handCard(state, 'p2', 'TEST-101');

    const countered = run(
      state,
      { type: 'DECLARE_ATTACK', player: 'p1', attacker, target: defender },
      { type: 'PASS', player: 'p2' },
      { type: 'PLAY_COUNTER', player: 'p2', instanceId: counter, target: defender },
    );
    expect(getPower(countered, defender)).toBe(5000);
    expect(getPower(countered, attacker)).toBe(5000);

    const resolved = run(countered, { type: 'PASS', player: 'p2' });
    expect(resolved.players.p2.characters).not.toContain(defender);
    expect(resolved.players.p2.trash[0]).toBe(defender);
  });

  it('A2: 5000 attacker vs 4000 character countered to 6000 — defender survives', () => {
    const { state, attacker, defender } = battlefield({
      attacker: 'TEST-006', // 5000
      defender: 'TEST-105', // 4000
      counters: ['TEST-104'], // counter 2000
    });
    const counter = handCard(state, 'p2', 'TEST-104');

    const countered = run(
      state,
      { type: 'DECLARE_ATTACK', player: 'p1', attacker, target: defender },
      { type: 'PASS', player: 'p2' },
      { type: 'PLAY_COUNTER', player: 'p2', instanceId: counter, target: defender },
    );
    expect(getPower(countered, defender)).toBe(6000);

    const { state: resolved, events } = applyOk(countered, { type: 'PASS', player: 'p2' });
    expect(resolved.players.p2.characters).toContain(defender);
    expect(resolved.players.p2.trash).toEqual([counter]); // only the spent counter
    expect(events).toContainEqual({
      type: 'battleResolved',
      attacker,
      target: defender,
      outcome: 'noEffect',
    });
  });

  it('A3: 5000 attacker vs the 5000 leader — tie, the leader loses a life card', () => {
    const state = buildScenario({
      p1: { characters: [{ cardId: 'TEST-006' }] }, // 5000
    });
    const attacker = characterAt(state, 'p1', 0);
    const leader = state.players.p2.leader;
    expect(getPower(state, leader)).toBe(5000);

    const lifeBefore = state.players.p2.life.length;
    const topLife = state.players.p2.life[0];
    const resolved = run(
      state,
      { type: 'DECLARE_ATTACK', player: 'p1', attacker, target: leader },
      { type: 'PASS', player: 'p2' },
      { type: 'PASS', player: 'p2' },
    );

    expect(resolved.players.p2.life).toHaveLength(lifeBefore - 1);
    expect(resolved.players.p2.hand).toContain(topLife);
    expect(resolved.status).toBe('playing');
  });

  it('A4: attached DON!! and counter both land — 6000 vs 6000 ties, character is KO', () => {
    const { state, attacker, defender } = battlefield({
      attacker: 'TEST-006', // 5000 base
      attackerDon: 1, // +1000 => 6000
      defender: 'TEST-106', // 5000 base
      counters: ['TEST-101'], // counter 1000 => 6000
    });
    expect(getPower(state, attacker)).toBe(6000);
    const counter = handCard(state, 'p2', 'TEST-101');

    const countered = run(
      state,
      { type: 'DECLARE_ATTACK', player: 'p1', attacker, target: defender },
      { type: 'PASS', player: 'p2' },
      { type: 'PLAY_COUNTER', player: 'p2', instanceId: counter, target: defender },
    );
    // Both sides at 6000: attached DON!! and counter modifiers are summed the
    // same way, so the tie is real and the attacker takes it.
    expect(getPower(countered, attacker)).toBe(6000);
    expect(getPower(countered, defender)).toBe(6000);

    const resolved = run(countered, { type: 'PASS', player: 'p2' });
    expect(resolved.players.p2.characters).not.toContain(defender);
    expect(resolved.players.p2.trash[0]).toBe(defender);
  });

  it('A5: a counter on a non-battling character leaves the battle unchanged', () => {
    const state = buildScenario({
      p1: { characters: [{ cardId: 'TEST-006' }] }, // 5000 attacker
      p2: {
        clearHand: true,
        characters: [
          { cardId: 'TEST-105', orientation: 'rested' }, // 4000, the target
          { cardId: 'TEST-101', orientation: 'rested' }, // 2000, bystander
        ],
        hand: ['TEST-104'], // counter 2000
      },
    });
    const attacker = characterAt(state, 'p1', 0);
    const defender = characterAt(state, 'p2', 0);
    const bystander = characterAt(state, 'p2', 1);
    const counter = handCard(state, 'p2', 'TEST-104');

    const countered = run(
      state,
      { type: 'DECLARE_ATTACK', player: 'p1', attacker, target: defender },
      { type: 'PASS', player: 'p2' },
      { type: 'PLAY_COUNTER', player: 'p2', instanceId: counter, target: bystander },
    );
    // The bystander gains the power; the actual defender does not.
    expect(getPower(countered, bystander)).toBe(4000); // 2000 + 2000
    expect(getPower(countered, defender)).toBe(4000); // unchanged base

    const resolved = run(countered, { type: 'PASS', player: 'p2' });
    // 5000 vs 4000: the battle resolves as if no counter had been played.
    expect(resolved.players.p2.characters).not.toContain(defender);
    expect(resolved.players.p2.characters).toContain(bystander);
    expect(getPower(resolved, bystander)).toBe(2000); // modifier expired
  });

  it('A6: the counter modifier expires when the battle ends', () => {
    const { state, attacker, defender } = battlefield({
      attacker: 'TEST-006',
      defender: 'TEST-105',
      counters: ['TEST-104'], // 2000 => survives at 6000
    });
    const counter = handCard(state, 'p2', 'TEST-104');

    const resolved = run(
      state,
      { type: 'DECLARE_ATTACK', player: 'p1', attacker, target: defender },
      { type: 'PASS', player: 'p2' },
      { type: 'PLAY_COUNTER', player: 'p2', instanceId: counter, target: defender },
      { type: 'PASS', player: 'p2' },
    );
    expect(resolved.players.p2.characters).toContain(defender);
    expect(resolved.modifiers).toEqual([]);
    expect(getPower(resolved, defender)).toBe(4000); // back to printed power
  });

  it('A7: a card on the field cannot be used as a counter', () => {
    const state = buildScenario({
      p1: { characters: [{ cardId: 'TEST-006' }] },
      p2: {
        clearHand: true,
        characters: [
          { cardId: 'TEST-105', orientation: 'rested' },
          { cardId: 'TEST-101', orientation: 'rested' }, // on field, has counter 1000
        ],
      },
    });
    const attacker = characterAt(state, 'p1', 0);
    const defender = characterAt(state, 'p2', 0);
    const onField = characterAt(state, 'p2', 1);

    const counterStep = run(
      state,
      { type: 'DECLARE_ATTACK', player: 'p1', attacker, target: defender },
      { type: 'PASS', player: 'p2' },
    );
    const offered = legalActions(counterStep, 'p2');
    expect(offered.filter((action) => action.type === 'PLAY_COUNTER')).toEqual([]);
    expect(
      applyFail(counterStep, {
        type: 'PLAY_COUNTER',
        player: 'p2',
        instanceId: onField,
        target: defender,
      }),
    ).toBe('cardNotInHand');
  });

  // A card with no printed Counter value cannot be played in the Counter Step.
  // That is a different statement from a card that would add zero: the absence
  // of a value is not a value. `counter: null` encodes it so the two cannot be
  // confused, and the engine rejects the play outright rather than accepting a
  // no-op.
  it('A8: a card with no Counter value cannot be played as a counter', () => {
    const { state, attacker, defender } = battlefield({
      attacker: 'TEST-006', // 5000
      defender: 'TEST-105', // 4000
      counters: ['TEST-109'], // counter: null
    });
    const counterless = handCard(state, 'p2', 'TEST-109');

    const counterStep = run(
      state,
      { type: 'DECLARE_ATTACK', player: 'p1', attacker, target: defender },
      { type: 'PASS', player: 'p2' },
    );

    // It is not offered as an affordance...
    const offered = legalActions(counterStep, 'p2').filter(
      (action) => action.type === 'PLAY_COUNTER',
    );
    expect(offered).toEqual([]);

    // ...and applyAction rejects it independently, without assuming the caller
    // consulted legalActions.
    const result = applyAction(counterStep, {
      type: 'PLAY_COUNTER',
      player: 'p2',
      instanceId: counterless,
      target: defender,
    });
    expect(result).toEqual({ ok: false, reason: 'noCounterValue' });

    // The defender's power is untouched: nothing was spent, nothing was added.
    expect(getPower(counterStep, defender)).toBe(4000);
    expect(counterStep.players.p2.hand).toContain(counterless);
  });
});

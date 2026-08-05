import { describe, expect, it } from 'vitest';
import { getPower } from '../src/index.js';
import type { GameState } from '../src/index.js';
import {
  advanceToMain,
  applyFail,
  applyOk,
  buildGame,
  cloneWith,
  draftHandCard,
  draftPutCharacter,
  run,
} from './helpers.js';

// p1 turn 3 with attackers; p2 with a rested 5000 target, one active bystander
// character, and known counter cards in hand.
function counterSetup(): {
  state: GameState;
  attacker5000: string;
  attacker6000: string;
  attacker7000: string;
  defenderChar: string;
  bystander: string;
  counter1000: string;
  counter2000: string;
  counterless: string;
} {
  const main = advanceToMain(buildGame());
  const ids = {} as Record<string, string>;
  const state = cloneWith(main, (draft) => {
    draft.turn = 3;
    ids['attacker5000'] = draftPutCharacter(draft, 'p1', 'TEST-006');
    ids['attacker6000'] = draftPutCharacter(draft, 'p1', 'TEST-007');
    ids['attacker7000'] = draftPutCharacter(draft, 'p1', 'TEST-008');
    ids['defenderChar'] = draftPutCharacter(draft, 'p2', 'TEST-106', { orientation: 'rested' });
    ids['bystander'] = draftPutCharacter(draft, 'p2', 'TEST-103', { orientation: 'active' });
    ids['counter1000'] = draftHandCard(draft, 'p2', 'TEST-101'); // counter 1000
    ids['counter2000'] = draftHandCard(draft, 'p2', 'TEST-104'); // counter 2000
    ids['counterless'] = draftHandCard(draft, 'p2', 'TEST-108'); // counter: null
  });
  return {
    state,
    attacker5000: ids['attacker5000']!,
    attacker6000: ids['attacker6000']!,
    attacker7000: ids['attacker7000']!,
    defenderChar: ids['defenderChar']!,
    bystander: ids['bystander']!,
    counter1000: ids['counter1000']!,
    counter2000: ids['counter2000']!,
    counterless: ids['counterless']!,
  };
}

function toCounterStep(state: GameState, attacker: string, target: string): GameState {
  return run(
    state,
    { type: 'DECLARE_ATTACK', player: 'p1', attacker, target },
    { type: 'PASS', player: 'p2' },
  );
}

describe('counters', () => {
  it('M6: a counter from hand adds power and flips the outcome', () => {
    const setup = counterSetup();
    const step = toCounterStep(setup.state, setup.attacker5000, setup.defenderChar);
    const { state: countered, events } = applyOk(step, {
      type: 'PLAY_COUNTER',
      player: 'p2',
      instanceId: setup.counter1000,
      target: setup.defenderChar,
    });
    expect(events).toEqual([
      {
        type: 'counterPlayed',
        player: 'p2',
        instanceId: setup.counter1000,
        target: setup.defenderChar,
        value: 1000,
      },
    ]);
    expect(countered.players.p2.trash[0]).toBe(setup.counter1000);
    expect(countered.players.p2.hand).not.toContain(setup.counter1000);
    expect(getPower(countered, setup.defenderChar)).toBe(6000);
    expect(countered.modifiers).toHaveLength(1);

    // 5000 vs 6000: the attack now fails; the defender survives.
    const resolved = run(countered, { type: 'PASS', player: 'p2' });
    expect(resolved.players.p2.characters).toContain(setup.defenderChar);
    expect(resolved.log.at(-1)).toEqual({
      type: 'battleResolved',
      attacker: setup.attacker5000,
      target: setup.defenderChar,
      outcome: 'noEffect',
    });
    expect(resolved.modifiers).toEqual([]);
    expect(getPower(resolved, setup.defenderChar)).toBe(5000);
  });

  it('a tie after countering still loses: attacker wins ties', () => {
    const setup = counterSetup();
    const step = toCounterStep(setup.state, setup.attacker6000, setup.defenderChar);
    const resolved = run(
      step,
      {
        type: 'PLAY_COUNTER',
        player: 'p2',
        instanceId: setup.counter1000,
        target: setup.defenderChar,
      },
      { type: 'PASS', player: 'p2' },
    );
    // 6000 vs 5000 + 1000 = 6000: attacker wins, KO.
    expect(resolved.players.p2.characters).not.toContain(setup.defenderChar);
    expect(resolved.players.p2.trash).toContain(setup.defenderChar);
  });

  it('counters stack across multiple PLAY_COUNTER actions', () => {
    const setup = counterSetup();
    const step = toCounterStep(setup.state, setup.attacker7000, setup.defenderChar);
    const countered = run(
      step,
      {
        type: 'PLAY_COUNTER',
        player: 'p2',
        instanceId: setup.counter1000,
        target: setup.defenderChar,
      },
      {
        type: 'PLAY_COUNTER',
        player: 'p2',
        instanceId: setup.counter2000,
        target: setup.defenderChar,
      },
    );
    expect(getPower(countered, setup.defenderChar)).toBe(8000);
    expect(countered.modifiers).toHaveLength(2);
    // 7000 vs 8000: survives.
    const resolved = run(countered, { type: 'PASS', player: 'p2' });
    expect(resolved.players.p2.characters).toContain(setup.defenderChar);
    expect(resolved.modifiers).toEqual([]);
  });

  it('may target any own leader or character, even outside the battle', () => {
    const setup = counterSetup();
    const step = toCounterStep(setup.state, setup.attacker5000, setup.defenderChar);
    const countered = run(step, {
      type: 'PLAY_COUNTER',
      player: 'p2',
      instanceId: setup.counter1000,
      target: setup.bystander,
    });
    expect(getPower(countered, setup.bystander)).toBe(4000);
    // The battle target is unchanged, so the KO still happens...
    const resolved = run(countered, { type: 'PASS', player: 'p2' });
    expect(resolved.players.p2.characters).not.toContain(setup.defenderChar);
    // ...and the parked modifier is cleared with the battle.
    expect(resolved.modifiers).toEqual([]);
    expect(getPower(resolved, setup.bystander)).toBe(3000);
  });

  it('a counter on the defending leader can save life', () => {
    const setup = counterSetup();
    const p2Leader = setup.state.players.p2.leader;
    const step = toCounterStep(setup.state, setup.attacker5000, p2Leader);
    const lifeBefore = setup.state.players.p2.life.length;
    const resolved = run(
      step,
      { type: 'PLAY_COUNTER', player: 'p2', instanceId: setup.counter1000, target: p2Leader },
      { type: 'PASS', player: 'p2' },
    );
    expect(resolved.players.p2.life).toHaveLength(lifeBefore);
    expect(resolved.log.at(-1)).toEqual({
      type: 'battleResolved',
      attacker: setup.attacker5000,
      target: p2Leader,
      outcome: 'noEffect',
    });
  });

  it('a second battle in the same turn starts clean after counters', () => {
    const setup = counterSetup();
    const step = toCounterStep(setup.state, setup.attacker5000, setup.defenderChar);
    const afterFirst = run(
      step,
      {
        type: 'PLAY_COUNTER',
        player: 'p2',
        instanceId: setup.counter1000,
        target: setup.defenderChar,
      },
      { type: 'PASS', player: 'p2' },
    );
    expect(afterFirst.modifiers).toEqual([]);
    // Second battle: 9000-free board, 7000 vs bare 5000 now.
    const second = run(
      afterFirst,
      {
        type: 'DECLARE_ATTACK',
        player: 'p1',
        attacker: setup.attacker7000,
        target: setup.defenderChar,
      },
      { type: 'PASS', player: 'p2' },
      { type: 'PASS', player: 'p2' },
    );
    expect(second.players.p2.characters).not.toContain(setup.defenderChar);
  });

  it('rejects counter-less cards, foreign targets, and cards not in hand', () => {
    const setup = counterSetup();
    const step = toCounterStep(setup.state, setup.attacker5000, setup.defenderChar);
    expect(
      applyFail(step, {
        type: 'PLAY_COUNTER',
        player: 'p2',
        instanceId: setup.counterless,
        target: setup.defenderChar,
      }),
    ).toBe('noCounterValue');
    expect(
      applyFail(step, {
        type: 'PLAY_COUNTER',
        player: 'p2',
        instanceId: setup.counter1000,
        target: setup.attacker5000, // enemy card
      }),
    ).toBe('invalidCounterTarget');
    expect(
      applyFail(step, {
        type: 'PLAY_COUNTER',
        player: 'p2',
        instanceId: setup.counter1000,
        target: setup.counter2000, // own card but in hand
      }),
    ).toBe('invalidCounterTarget');
    expect(
      applyFail(step, {
        type: 'PLAY_COUNTER',
        player: 'p2',
        instanceId: step.players.p2.deck[0]!,
        target: setup.defenderChar,
      }),
    ).toBe('cardNotInHand');
  });
});

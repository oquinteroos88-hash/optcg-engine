import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import {
  advanceToMain,
  applyFail,
  applyOk,
  buildGame,
  cloneWith,
  draftAttachDon,
  draftPutCharacter,
  run,
} from './helpers.js';

// p1 at their turn 3 main (attack flag no longer binds): one 5000 and one 9000
// attacker on p1's board, one rested 5000 character on p2's board.
function combatSetup(): {
  state: GameState;
  attacker: string;
  bigAttacker: string;
  defenderChar: string;
} {
  const main = advanceToMain(buildGame());
  let attacker!: string;
  let bigAttacker!: string;
  let defenderChar!: string;
  const state = cloneWith(main, (draft) => {
    draft.turn = 3;
    attacker = draftPutCharacter(draft, 'p1', 'TEST-006'); // 5000
    bigAttacker = draftPutCharacter(draft, 'p1', 'TEST-009'); // 9000
    defenderChar = draftPutCharacter(draft, 'p2', 'TEST-106', { orientation: 'rested' }); // 5000
  });
  return { state, attacker, bigAttacker, defenderChar };
}

describe('combat: FSM walk', () => {
  it('declare -> block pass -> counter pass -> resolve, with priority handoffs', () => {
    const { state, attacker, defenderChar } = combatSetup();
    const declared = applyOk(state, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker,
      target: defenderChar,
    });
    expect(declared.state.battle).toEqual({
      step: 'block',
      attacker,
      target: defenderChar,
      originalTarget: defenderChar,
      wasBlocked: false,
    });
    expect(declared.state.cards[attacker]?.orientation).toBe('rested');
    expect(declared.state.priority).toBe('p2');
    expect(declared.events).toEqual([
      { type: 'attackDeclared', player: 'p1', attacker, target: defenderChar },
    ]);

    const blockPassed = applyOk(declared.state, { type: 'PASS', player: 'p2' });
    expect(blockPassed.state.battle?.step).toBe('counter');
    expect(blockPassed.state.priority).toBe('p2');
    expect(blockPassed.events).toEqual([]);

    // M1: 5000 vs 5000 — the attacker wins the tie, the character is KO'd.
    const resolved = applyOk(blockPassed.state, { type: 'PASS', player: 'p2' });
    expect(resolved.state.battle).toBeNull();
    expect(resolved.state.priority).toBe('p1');
    expect(resolved.state.players.p2.characters).not.toContain(defenderChar);
    expect(resolved.state.players.p2.trash[0]).toBe(defenderChar);
    expect(resolved.state.cards[defenderChar]?.orientation).toBe('active');
    expect(resolved.state.cards[defenderChar]?.playedOnTurn).toBeNull();
    expect(resolved.events).toEqual([
      { type: 'battleResolved', attacker, target: defenderChar, outcome: 'ko' },
      { type: 'koed', player: 'p2', instanceId: defenderChar },
    ]);
  });

  it('M1: a leader-vs-leader tie deals life damage (attacker wins ties)', () => {
    const { state } = combatSetup();
    const p1Leader = state.players.p1.leader;
    const p2Leader = state.players.p2.leader;
    const lifeBefore = [...state.players.p2.life];
    const inBattle = run(
      state,
      { type: 'DECLARE_ATTACK', player: 'p1', attacker: p1Leader, target: p2Leader },
      { type: 'PASS', player: 'p2' },
    );
    const { state: after, events } = applyOk(inBattle, { type: 'PASS', player: 'p2' });
    expect(after.status).toBe('playing');
    expect(after.players.p2.life).toEqual(lifeBefore.slice(1));
    expect(after.players.p2.hand).toContain(lifeBefore[0]);
    expect(events).toEqual([
      { type: 'battleResolved', attacker: p1Leader, target: p2Leader, outcome: 'lifeDamage' },
      { type: 'lifeTaken', player: 'p2', instanceId: lifeBefore[0]!, remaining: 3 },
    ]);
  });

  it('a losing attack has no effect: damage is never bidirectional', () => {
    const { state, attacker } = combatSetup();
    let tank!: string;
    const staged = cloneWith(state, (draft) => {
      tank = draftPutCharacter(draft, 'p2', 'TEST-107', { orientation: 'rested' }); // 6000
    });
    const after = run(
      staged,
      { type: 'DECLARE_ATTACK', player: 'p1', attacker, target: tank },
      { type: 'PASS', player: 'p2' },
      { type: 'PASS', player: 'p2' },
    );
    expect(after.players.p2.characters).toContain(tank);
    expect(after.players.p1.characters).toContain(attacker);
    expect(after.cards[attacker]?.orientation).toBe('rested'); // spent, not damaged
    expect(after.battle).toBeNull();
    expect(after.log.at(-1)).toEqual({
      type: 'battleResolved',
      attacker,
      target: tank,
      outcome: 'noEffect',
    });
  });

  it('M5: a KO returns attached DON to the owner cost area rested, ready next refresh', () => {
    const { state, bigAttacker, defenderChar } = combatSetup();
    const staged = cloneWith(state, (draft) => {
      draftAttachDon(draft, 'p2', 0, defenderChar);
      draftAttachDon(draft, 'p2', 1, defenderChar);
    });
    // 9000 vs 5000 + 2000 attached = 7000: still a KO.
    const inBattle = run(
      staged,
      { type: 'DECLARE_ATTACK', player: 'p1', attacker: bigAttacker, target: defenderChar },
      { type: 'PASS', player: 'p2' },
    );
    const { state: after, events } = applyOk(inBattle, { type: 'PASS', player: 'p2' });
    expect(after.players.p2.trash[0]).toBe(defenderChar);
    expect(after.cards[defenderChar]?.attachedDon).toEqual([]);
    expect(after.players.p2.don[0]?.location).toEqual({ kind: 'cost', orientation: 'rested' });
    expect(after.players.p2.don[1]?.location).toEqual({ kind: 'cost', orientation: 'rested' });
    expect(events).toEqual([
      { type: 'battleResolved', attacker: bigAttacker, target: defenderChar, outcome: 'ko' },
      { type: 'donReturned', player: 'p2', count: 2, rested: true },
      { type: 'koed', player: 'p2', instanceId: defenderChar },
    ]);
    // Next p2 refresh turns them active again.
    const p2Turn = run(after, { type: 'END_TURN', player: 'p1' });
    expect(p2Turn.players.p2.don[0]?.location).toEqual({ kind: 'cost', orientation: 'active' });
    expect(p2Turn.players.p2.don[1]?.location).toEqual({ kind: 'cost', orientation: 'active' });
  });
});

describe('combat: attack validation', () => {
  it('M2: attacking an ACTIVE character is illegal', () => {
    const { state, attacker } = combatSetup();
    let activeChar!: string;
    const staged = cloneWith(state, (draft) => {
      activeChar = draftPutCharacter(draft, 'p2', 'TEST-103', { orientation: 'active' });
    });
    expect(
      applyFail(staged, { type: 'DECLARE_ATTACK', player: 'p1', attacker, target: activeChar }),
    ).toBe('targetNotRested');
  });

  it('the enemy leader is attackable regardless of orientation', () => {
    const { state, attacker } = combatSetup();
    const leader = state.players.p2.leader;
    const declare = { type: 'DECLARE_ATTACK', player: 'p1', attacker, target: leader } as const;

    // Active leader: the rested-only restriction applies to characters, not leaders.
    expect(state.cards[leader]?.orientation).toBe('active');
    expect(run(state, declare).battle?.target).toBe(leader);

    // Rested leader: still a legal target.
    const restedLeader = cloneWith(state, (draft) => {
      const card = draft.cards[leader];
      if (card === undefined) {
        throw new Error('missing leader instance');
      }
      card.orientation = 'rested';
    });
    expect(run(restedLeader, declare).battle?.target).toBe(leader);
  });

  it('a character cannot attack the turn it was played', () => {
    const { state } = combatSetup();
    let fresh!: string;
    const staged = cloneWith(state, (draft) => {
      fresh = draftPutCharacter(draft, 'p1', 'TEST-003', { playedOnTurn: 3 });
    });
    expect(
      applyFail(staged, {
        type: 'DECLARE_ATTACK',
        player: 'p1',
        attacker: fresh,
        target: staged.players.p2.leader,
      }),
    ).toBe('cannotAttackYet');
  });

  it('first-turn flag: default forbids p1 on turn 1, flag off allows, p2 turn 2 always legal', () => {
    const main = advanceToMain(buildGame());
    const p1Leader = main.players.p1.leader;
    const p2Leader = main.players.p2.leader;
    expect(
      applyFail(main, { type: 'DECLARE_ATTACK', player: 'p1', attacker: p1Leader, target: p2Leader }),
    ).toBe('firstTurnAttackForbidden');

    const flagOff = cloneWith(main, (draft) => {
      draft.rules.firstPlayerCannotAttackTurnOne = false;
    });
    const allowed = run(flagOff, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: p1Leader,
      target: p2Leader,
    });
    expect(allowed.battle?.step).toBe('block');

    const turn2 = run(main, { type: 'END_TURN', player: 'p1' });
    const p2Attack = run(turn2, {
      type: 'DECLARE_ATTACK',
      player: 'p2',
      attacker: p2Leader,
      target: p1Leader,
    });
    expect(p2Attack.battle?.step).toBe('block');
  });

  it('rejects invalid or rested attackers and invalid targets', () => {
    const { state, attacker, defenderChar } = combatSetup();
    const p2Leader = state.players.p2.leader;
    expect(
      applyFail(state, {
        type: 'DECLARE_ATTACK',
        player: 'p1',
        attacker: defenderChar, // enemy character
        target: p2Leader,
      }),
    ).toBe('invalidAttacker');
    expect(
      applyFail(state, {
        type: 'DECLARE_ATTACK',
        player: 'p1',
        attacker: state.players.p1.hand[0]!,
        target: p2Leader,
      }),
    ).toBe('invalidAttacker');
    const restedAttacker = cloneWith(state, (draft) => {
      draft.cards[attacker]!.orientation = 'rested';
    });
    expect(
      applyFail(restedAttacker, {
        type: 'DECLARE_ATTACK',
        player: 'p1',
        attacker,
        target: p2Leader,
      }),
    ).toBe('attackerNotActive');
    expect(
      applyFail(state, {
        type: 'DECLARE_ATTACK',
        player: 'p1',
        attacker,
        target: state.players.p1.leader, // own leader
      }),
    ).toBe('invalidTarget');
    expect(
      applyFail(state, { type: 'DECLARE_ATTACK', player: 'p1', attacker, target: 'nope' }),
    ).toBe('invalidTarget');
  });

  it('rejects a second DECLARE_ATTACK while a battle is open', () => {
    const { state, attacker, bigAttacker } = combatSetup();
    const inBattle = run(state, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker,
      target: state.players.p2.leader,
    });
    // The attacker no longer holds priority mid-battle.
    expect(
      applyFail(inBattle, {
        type: 'DECLARE_ATTACK',
        player: 'p1',
        attacker: bigAttacker,
        target: inBattle.players.p2.leader,
      }),
    ).toBe('notYourPriority');
  });
});

describe('combat: block step', () => {
  it('DECLARE_BLOCK always fails with notABlocker in Phase 0', () => {
    const { state, attacker, defenderChar } = combatSetup();
    let freshBlocker!: string;
    const staged = cloneWith(state, (draft) => {
      freshBlocker = draftPutCharacter(draft, 'p2', 'TEST-104', { orientation: 'active' });
    });
    const inBattle = run(staged, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker,
      target: defenderChar,
    });
    expect(applyFail(inBattle, { type: 'DECLARE_BLOCK', player: 'p2', blocker: freshBlocker })).toBe(
      'notABlocker',
    );
  });

  it('rejects non-character blockers and wrong-step or no-battle blocks', () => {
    const { state, attacker, defenderChar } = combatSetup();
    expect(
      applyFail(state, { type: 'DECLARE_BLOCK', player: 'p1', blocker: state.players.p1.leader }),
    ).toBe('noBattle');
    expect(applyFail(state, { type: 'PASS', player: 'p1' })).toBe('noBattle');

    const inBattle = run(state, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker,
      target: defenderChar,
    });
    expect(
      applyFail(inBattle, { type: 'DECLARE_BLOCK', player: 'p2', blocker: inBattle.players.p2.leader }),
    ).toBe('invalidBlocker');
    expect(applyFail(inBattle, { type: 'DECLARE_BLOCK', player: 'p2', blocker: attacker })).toBe(
      'invalidBlocker',
    );
    expect(
      applyFail(inBattle, {
        type: 'PLAY_COUNTER',
        player: 'p2',
        instanceId: inBattle.players.p2.hand[0]!,
        target: inBattle.players.p2.leader,
      }),
    ).toBe('wrongBattleStep');

    const counterStep = run(inBattle, { type: 'PASS', player: 'p2' });
    expect(
      applyFail(counterStep, { type: 'DECLARE_BLOCK', player: 'p2', blocker: defenderChar }),
    ).toBe('wrongBattleStep');
  });
});

import { describe, expect, it } from 'vitest';
import { getPower } from '../src/index.js';
import type { Action, GameState } from '../src/index.js';
import { advanceToMain, applyFail, applyOk, buildGame, cloneWith, run } from './helpers.js';

function costCount(state: GameState, player: 'p1' | 'p2'): number {
  return state.players[player].don.filter((don) => don.location.kind === 'cost').length;
}

function donDeckCount(state: GameState, player: 'p1' | 'p2'): number {
  return state.players[player].don.filter((don) => don.location.kind === 'donDeck').length;
}

const endTurn = (player: 'p1' | 'p2'): Action => ({ type: 'END_TURN', player });

describe('don: gain schedule', () => {
  it('M4: firstPlayer gains 1,2,2,2,2,1,0 to exhaustion; the cap is never exceeded', () => {
    let state = advanceToMain(buildGame());
    const p1CostByTurn: number[] = [costCount(state, 'p1')];
    for (let i = 0; i < 6; i += 1) {
      state = run(state, endTurn('p1'), endTurn('p2'));
      p1CostByTurn.push(costCount(state, 'p1'));
    }
    // p1's turns are 1,3,5,7,9,11,13: cost area 1,3,5,7,9,10,10.
    expect(p1CostByTurn).toEqual([1, 3, 5, 7, 9, 10, 10]);
    expect(donDeckCount(state, 'p1')).toBe(0);
    expect(state.turn).toBe(13);
  });

  it('M4: the second player gains 2 per turn and stops at 10', () => {
    let state = advanceToMain(buildGame());
    state = run(state, endTurn('p1'));
    const p2CostByTurn: number[] = [costCount(state, 'p2')];
    for (let i = 0; i < 5; i += 1) {
      state = run(state, endTurn('p2'), endTurn('p1'));
      p2CostByTurn.push(costCount(state, 'p2'));
    }
    // p2's turns are 2,4,6,8,10,12: cost area 2,4,6,8,10,10.
    expect(p2CostByTurn).toEqual([2, 4, 6, 8, 10, 10]);
    expect(donDeckCount(state, 'p2')).toBe(0);
  });

  it('the cap holds when attached DON return at refresh', () => {
    // Walk p1 to 10 DON in the cost area, attach 3, cycle a full round:
    // refresh returns them and the DON step must gain 0 (cap + empty DON deck).
    let state = advanceToMain(buildGame());
    for (let i = 0; i < 5; i += 1) {
      state = run(state, endTurn('p1'), endTurn('p2'));
    }
    expect(costCount(state, 'p1')).toBe(10);
    const leader = state.players.p1.leader;
    state = run(state, { type: 'ATTACH_DON', player: 'p1', to: leader, count: 3 });
    expect(costCount(state, 'p1')).toBe(7);
    state = run(state, endTurn('p1'), endTurn('p2'));
    expect(costCount(state, 'p1')).toBe(10);
    expect(state.cards[leader]?.attachedDon).toEqual([]);
  });
});

describe('don: ATTACH_DON', () => {
  it('attaches the first K active DON in array order and grants +1000 each', () => {
    const main = advanceToMain(buildGame());
    const turn3 = run(main, endTurn('p1'), endTurn('p2'));
    const leader = turn3.players.p1.leader;
    const { state, events } = applyOk(turn3, {
      type: 'ATTACH_DON',
      player: 'p1',
      to: leader,
      count: 2,
    });
    expect(state.cards[leader]?.attachedDon).toEqual(['p1-d0', 'p1-d1']);
    expect(state.players.p1.don[0]?.location).toEqual({ kind: 'attached', to: leader });
    expect(state.players.p1.don[1]?.location).toEqual({ kind: 'attached', to: leader });
    expect(state.players.p1.don[2]?.location).toEqual({ kind: 'cost', orientation: 'active' });
    expect(getPower(state, leader)).toBe(7000);
    expect(events).toEqual([{ type: 'donAttached', player: 'p1', to: leader, count: 2 }]);
  });

  it('the +1000 persists through the whole opponent turn and drops at refresh', () => {
    const main = advanceToMain(buildGame());
    const leader = main.players.p1.leader;
    const attached = run(main, { type: 'ATTACH_DON', player: 'p1', to: leader, count: 1 });
    expect(getPower(attached, leader)).toBe(6000);
    const opponentTurn = run(attached, endTurn('p1'));
    expect(getPower(opponentTurn, leader)).toBe(6000);
    const backToP1 = run(opponentTurn, endTurn('p2'));
    expect(getPower(backToP1, leader)).toBe(5000);
    expect(costCount(backToP1, 'p1')).toBe(3);
  });

  it('rejects bad counts, bad targets, and overdraws', () => {
    const main = advanceToMain(buildGame());
    const leader = main.players.p1.leader;
    expect(applyFail(main, { type: 'ATTACH_DON', player: 'p1', to: leader, count: 0 })).toBe(
      'invalidCount',
    );
    expect(applyFail(main, { type: 'ATTACH_DON', player: 'p1', to: leader, count: -1 })).toBe(
      'invalidCount',
    );
    expect(applyFail(main, { type: 'ATTACH_DON', player: 'p1', to: leader, count: 1.5 })).toBe(
      'invalidCount',
    );
    const enemyLeader = main.players.p2.leader;
    expect(applyFail(main, { type: 'ATTACH_DON', player: 'p1', to: enemyLeader, count: 1 })).toBe(
      'invalidAttachTarget',
    );
    const handCard = main.players.p1.hand[0]!;
    expect(applyFail(main, { type: 'ATTACH_DON', player: 'p1', to: handCard, count: 1 })).toBe(
      'invalidAttachTarget',
    );
    expect(applyFail(main, { type: 'ATTACH_DON', player: 'p1', to: leader, count: 2 })).toBe(
      'notEnoughActiveDon', // only 1 DON on turn 1
    );
  });

  it('cannot attach to a stage', () => {
    const main = advanceToMain(buildGame());
    let stageId!: string;
    const staged = cloneWith(main, (draft) => {
      stageId = draft.players.p1.deck.find((id) => draft.cards[id]?.cardId === 'TEST-013')!;
      draft.players.p1.deck = draft.players.p1.deck.filter((id) => id !== stageId);
      draft.players.p1.stage = stageId;
      draft.cards[stageId]!.playedOnTurn = 1;
    });
    expect(applyFail(staged, { type: 'ATTACH_DON', player: 'p1', to: stageId, count: 1 })).toBe(
      'invalidAttachTarget',
    );
  });

  it('is illegal while a battle is open', () => {
    const main = advanceToMain(buildGame());
    const withBattle = cloneWith(main, (draft) => {
      draft.battle = {
        step: 'counter',
        attacker: draft.players.p1.leader,
        target: draft.players.p2.leader,
        originalTarget: draft.players.p2.leader,
        wasBlocked: false,
      };
      draft.cards[draft.players.p1.leader]!.orientation = 'rested';
      draft.priority = 'p2';
      draftSetCostDonForBattle(draft);
    });
    // Defender holds priority: their attach hits the battle gate.
    expect(
      applyFail(withBattle, {
        type: 'ATTACH_DON',
        player: 'p2',
        to: withBattle.players.p2.leader,
        count: 1,
      }),
    ).toBe('battleInProgress');
    // The attacker is not the priority holder mid-battle.
    expect(
      applyFail(withBattle, {
        type: 'ATTACH_DON',
        player: 'p1',
        to: withBattle.players.p1.leader,
        count: 1,
      }),
    ).toBe('notYourPriority');
  });
});

function draftSetCostDonForBattle(draft: GameState): void {
  draft.players.p2.don[0]!.location = { kind: 'cost', orientation: 'active' };
}

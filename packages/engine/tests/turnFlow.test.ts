import { describe, expect, it } from 'vitest';
import { getPower } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { advanceToMain, applyFail, applyOk, buildGame, cloneWith, run } from './helpers.js';

function costDon(state: GameState, player: 'p1' | 'p2'): { active: number; rested: number } {
  let active = 0;
  let rested = 0;
  for (const don of state.players[player].don) {
    if (don.location.kind === 'cost') {
      if (don.location.orientation === 'active') active += 1;
      else rested += 1;
    }
  }
  return { active, rested };
}

describe('turnFlow', () => {
  it('M3: firstPlayer turn 1 has no draw and exactly 1 DON', () => {
    const state = advanceToMain(buildGame());
    expect(state.turn).toBe(1);
    expect(state.players.p1.hand).toHaveLength(5);
    expect(state.players.p1.deck).toHaveLength(40); // 45 - 5 life, no draw
    expect(costDon(state, 'p1')).toEqual({ active: 1, rested: 0 });
    expect(costDon(state, 'p2')).toEqual({ active: 0, rested: 0 });
  });

  it('M3: the opponent draws and gains 2 DON on turn 2', () => {
    const state = advanceToMain(buildGame());
    const { state: turn2, events } = applyOk(state, { type: 'END_TURN', player: 'p1' });
    expect(turn2.turn).toBe(2);
    expect(turn2.activePlayer).toBe('p2');
    expect(turn2.priority).toBe('p2');
    expect(turn2.phase).toBe('main');
    expect(turn2.players.p2.hand).toHaveLength(6);
    expect(turn2.players.p2.deck).toHaveLength(40); // 45 - 4 life - 1 draw
    expect(costDon(turn2, 'p2')).toEqual({ active: 2, rested: 0 });
    const drawn = turn2.players.p2.hand[5];
    expect(events).toEqual([
      { type: 'turnEnded', turn: 1, player: 'p1' },
      { type: 'turnStarted', turn: 2, player: 'p2' },
      { type: 'cardDrawn', player: 'p2', instanceId: drawn },
      { type: 'donGained', player: 'p2', count: 2 },
    ]);
  });

  it('turns alternate with a global counter: p1 gets 1, 3, 5...', () => {
    const state = run(
      advanceToMain(buildGame()),
      { type: 'END_TURN', player: 'p1' },
      { type: 'END_TURN', player: 'p2' },
    );
    expect(state.turn).toBe(3);
    expect(state.activePlayer).toBe('p1');
    expect(state.players.p1.hand).toHaveLength(6); // first draw for p1
    expect(costDon(state, 'p1')).toEqual({ active: 3, rested: 0 });
  });

  it('refresh returns attached DON to the cost area active, at the owner refresh', () => {
    const main = advanceToMain(buildGame());
    const leader = main.players.p1.leader;
    const staged = cloneWith(main, (draft) => {
      draft.players.p1.don[0]!.location = { kind: 'attached', to: leader };
      draft.cards[leader]!.attachedDon.push('p1-d0');
    });
    expect(getPower(staged, leader)).toBe(6000);

    const duringOpponentTurn = run(staged, { type: 'END_TURN', player: 'p1' });
    // The +1000 persists through the whole opponent turn.
    expect(duringOpponentTurn.players.p1.don[0]!.location).toEqual({ kind: 'attached', to: leader });
    expect(getPower(duringOpponentTurn, leader)).toBe(6000);

    const { state: afterRefresh, events } = applyOk(duringOpponentTurn, {
      type: 'END_TURN',
      player: 'p2',
    });
    expect(afterRefresh.players.p1.don[0]!.location).toEqual({
      kind: 'cost',
      orientation: 'active',
    });
    expect(afterRefresh.cards[leader]!.attachedDon).toEqual([]);
    expect(getPower(afterRefresh, leader)).toBe(5000);
    expect(events).toContainEqual({ type: 'donReturned', player: 'p1', count: 1, rested: false });
  });

  it('refresh turns rested cost DON and rested field cards active', () => {
    const main = advanceToMain(buildGame());
    const leader = main.players.p1.leader;
    const staged = cloneWith(main, (draft) => {
      draft.players.p1.don[0]!.location = { kind: 'cost', orientation: 'rested' };
      draft.cards[leader]!.orientation = 'rested';
    });
    const backAround = run(
      staged,
      { type: 'END_TURN', player: 'p1' },
      { type: 'END_TURN', player: 'p2' },
    );
    expect(backAround.players.p1.don[0]!.location).toEqual({ kind: 'cost', orientation: 'active' });
    expect(backAround.cards[leader]!.orientation).toBe('active');
  });

  it('rejects END_TURN while a battle is open, and from the non-priority player', () => {
    const main = advanceToMain(buildGame());
    const withBattle = cloneWith(main, (draft) => {
      draft.battle = {
        step: 'block',
        attacker: draft.players.p1.leader,
        target: draft.players.p2.leader,
        originalTarget: draft.players.p2.leader,
        wasBlocked: false,
      };
      draft.cards[draft.players.p1.leader]!.orientation = 'rested';
      draft.priority = 'p2';
    });
    expect(applyFail(withBattle, { type: 'END_TURN', player: 'p2' })).toBe('battleInProgress');
    expect(applyFail(withBattle, { type: 'END_TURN', player: 'p1' })).toBe('notYourPriority');
  });

  it('expires injected endOfTurn modifiers when the turn ends', () => {
    const main = advanceToMain(buildGame());
    const leader = main.players.p1.leader;
    const staged = cloneWith(main, (draft) => {
      draft.modifiers.push({
        id: 'test-mod',
        target: leader,
        kind: 'power',
        value: 1000,
        duration: 'endOfTurn',
        source: leader,
      });
    });
    expect(getPower(staged, leader)).toBe(6000);
    const after = run(staged, { type: 'END_TURN', player: 'p1' });
    expect(after.modifiers).toEqual([]);
    expect(getPower(after, leader)).toBe(5000);
  });
});

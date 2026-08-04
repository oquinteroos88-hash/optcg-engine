import { describe, expect, it } from 'vitest';
import { applyAction, checkTurnLeak, legalActions } from '../src/index.js';
import type { Action, GameState, PlayerId } from '../src/index.js';
import {
  advanceToMain,
  applyOk,
  buildGame,
  cloneWith,
  draftHandCard,
  draftPutCharacter,
  draftSetCostDon,
  run,
} from './helpers.js';

function ofType(actions: Action[], type: Action['type']): Action[] {
  return actions.filter((a) => a.type === type);
}

// A staged mid-game state exercising every enumeration branch at once.
function richMain(): {
  state: GameState;
  ids: { veteran: string; fresh: string; cheap: string; expensive: string; restedEnemy: string };
} {
  const main = advanceToMain(buildGame());
  const ids = {} as Record<string, string>;
  const state = cloneWith(main, (draft) => {
    draft.turn = 3;
    draftSetCostDon(draft, 'p1', 2);
    ids['veteran'] = draftPutCharacter(draft, 'p1', 'TEST-005'); // can attack
    ids['fresh'] = draftPutCharacter(draft, 'p1', 'TEST-003', { playedOnTurn: 3 }); // cannot
    ids['cheap'] = draftHandCard(draft, 'p1', 'TEST-001'); // cost 1, affordable
    ids['expensive'] = draftHandCard(draft, 'p1', 'TEST-010'); // cost 10, not affordable
    ids['restedEnemy'] = draftPutCharacter(draft, 'p2', 'TEST-101', { orientation: 'rested' });
    draftPutCharacter(draft, 'p2', 'TEST-103', { orientation: 'active' }); // not targetable
  });
  return {
    state,
    ids: {
      veteran: ids['veteran']!,
      fresh: ids['fresh']!,
      cheap: ids['cheap']!,
      expensive: ids['expensive']!,
      restedEnemy: ids['restedEnemy']!,
    },
  };
}

describe('legalActions: matrix', () => {
  it('mulligan: priority player gets both MULLIGAN variants plus CONCEDE; waiter gets [CONCEDE]', () => {
    const game = buildGame();
    expect(legalActions(game, 'p1')).toEqual([
      { type: 'MULLIGAN', player: 'p1', accept: true },
      { type: 'MULLIGAN', player: 'p1', accept: false },
      { type: 'CONCEDE', player: 'p1' },
    ]);
    expect(legalActions(game, 'p2')).toEqual([{ type: 'CONCEDE', player: 'p2' }]);
  });

  it('main: enumerates affordable plays, attach counts, legal attacks, END_TURN, CONCEDE last', () => {
    const { state, ids } = richMain();
    const actions = legalActions(state, 'p1');

    const plays = ofType(actions, 'PLAY_CARD') as Array<Action & { type: 'PLAY_CARD' }>;
    expect(plays.map((a) => a.instanceId)).toContain(ids.cheap);
    expect(plays.map((a) => a.instanceId)).not.toContain(ids.expensive);

    const attaches = ofType(actions, 'ATTACH_DON') as Array<Action & { type: 'ATTACH_DON' }>;
    const leader = state.players.p1.leader;
    // 2 active DON: counts 1..2 on leader and each of the 2 characters.
    expect(attaches).toHaveLength(6);
    expect(attaches.filter((a) => a.to === leader).map((a) => a.count)).toEqual([1, 2]);

    const attacks = ofType(actions, 'DECLARE_ATTACK') as Array<Action & { type: 'DECLARE_ATTACK' }>;
    const enemyLeader = state.players.p2.leader;
    // Attackers: leader + veteran (fresh is excluded). Targets: enemy leader +
    // the rested enemy character (the active one is excluded). 2 x 2 = 4.
    expect(attacks).toHaveLength(4);
    for (const attack of attacks) {
      expect([leader, ids.veteran]).toContain(attack.attacker);
      expect([enemyLeader, ids.restedEnemy]).toContain(attack.target);
    }

    expect(ofType(actions, 'END_TURN')).toHaveLength(1);
    expect(actions.at(-1)).toEqual({ type: 'CONCEDE', player: 'p1' });
    expect(ofType(actions, 'PASS')).toHaveLength(0);
    expect(ofType(actions, 'MULLIGAN')).toHaveLength(0);
  });

  it('main turn 1 with the flag on: no attacks for the firstPlayer', () => {
    const main = advanceToMain(buildGame());
    expect(ofType(legalActions(main, 'p1'), 'DECLARE_ATTACK')).toHaveLength(0);
    const flagOff = cloneWith(main, (draft) => {
      draft.rules.firstPlayerCannotAttackTurnOne = false;
    });
    // Sole attacker is the leader; sole target is the enemy leader.
    expect(ofType(legalActions(flagOff, 'p1'), 'DECLARE_ATTACK')).toEqual([
      {
        type: 'DECLARE_ATTACK',
        player: 'p1',
        attacker: flagOff.players.p1.leader,
        target: flagOff.players.p2.leader,
      },
    ]);
  });

  it('block step: defender gets PASS + CONCEDE (no blockers in Phase 0); attacker side [CONCEDE]', () => {
    const { state, ids } = richMain();
    const inBattle = run(state, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: ids.veteran,
      target: ids.restedEnemy,
    });
    expect(legalActions(inBattle, 'p2')).toEqual([
      { type: 'PASS', player: 'p2' },
      { type: 'CONCEDE', player: 'p2' },
    ]);
    expect(legalActions(inBattle, 'p1')).toEqual([{ type: 'CONCEDE', player: 'p1' }]);
  });

  it('counter step: PASS + one PLAY_COUNTER per counter card x own leader/characters + CONCEDE', () => {
    const { state, ids } = richMain();
    let counterCard!: string;
    const staged = cloneWith(state, (draft) => {
      // Clear the hand for exact counting by returning it to the deck, so card
      // conservation keeps holding.
      draft.players.p2.deck.push(...draft.players.p2.hand);
      draft.players.p2.hand = [];
      counterCard = draftHandCard(draft, 'p2', 'TEST-104'); // counter 2000
      draftHandCard(draft, 'p2', 'TEST-108'); // counter 0, excluded
    });
    const counterStep = run(
      staged,
      { type: 'DECLARE_ATTACK', player: 'p1', attacker: ids.veteran, target: ids.restedEnemy },
      { type: 'PASS', player: 'p2' },
    );
    const actions = legalActions(counterStep, 'p2');
    const p2Leader = counterStep.players.p2.leader;
    const p2Chars = counterStep.players.p2.characters;
    expect(actions[0]).toEqual({ type: 'PASS', player: 'p2' });
    const counters = ofType(actions, 'PLAY_COUNTER') as Array<Action & { type: 'PLAY_COUNTER' }>;
    expect(counters).toHaveLength(1 + p2Chars.length); // leader + 2 characters
    for (const counter of counters) {
      expect(counter.instanceId).toBe(counterCard);
      expect([p2Leader, ...p2Chars]).toContain(counter.target);
    }
    expect(actions.at(-1)).toEqual({ type: 'CONCEDE', player: 'p2' });
  });

  it('turn leak: non-priority player always gets exactly [CONCEDE] while live', () => {
    const main = advanceToMain(buildGame());
    expect(legalActions(main, 'p2')).toEqual([{ type: 'CONCEDE', player: 'p2' }]);
    const midMulligan = run(buildGame(), { type: 'MULLIGAN', player: 'p1', accept: false });
    expect(legalActions(midMulligan, 'p1')).toEqual([{ type: 'CONCEDE', player: 'p1' }]);
    expect(checkTurnLeak(main)).toEqual([]);
    expect(checkTurnLeak(midMulligan)).toEqual([]);
  });
});

describe('legalActions: emitted actions all validate', () => {
  function scriptedStates(): GameState[] {
    const states: GameState[] = [];
    const game = buildGame();
    states.push(game);
    states.push(run(game, { type: 'MULLIGAN', player: 'p1', accept: true }));
    const main = advanceToMain(game);
    states.push(main);
    const { state: rich, ids } = richMain();
    states.push(rich);
    const inBattle = run(rich, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: ids.veteran,
      target: ids.restedEnemy,
    });
    states.push(inBattle);
    const counterStep = run(inBattle, { type: 'PASS', player: 'p2' });
    states.push(counterStep);
    // Full board: 5 characters and a playable 6th in hand.
    const fullBoard = cloneWith(main, (draft) => {
      draftSetCostDon(draft, 'p1', 4);
      for (const cardId of ['TEST-001', 'TEST-002', 'TEST-003', 'TEST-004', 'TEST-005']) {
        draftPutCharacter(draft, 'p1', cardId);
      }
      draftHandCard(draft, 'p1', 'TEST-006');
    });
    states.push(fullBoard);
    states.push(applyOk(main, { type: 'CONCEDE', player: 'p1' }).state);
    return states;
  }

  it('every emitted action validates ok for both players across scripted states', () => {
    let checked = 0;
    for (const state of scriptedStates()) {
      for (const player of ['p1', 'p2'] as PlayerId[]) {
        for (const action of legalActions(state, player)) {
          const result = applyAction(state, action);
          if (!result.ok) {
            throw new Error(
              `emitted action failed validation (${result.reason}): ${JSON.stringify(action)}`,
            );
          }
          checked += 1;
        }
      }
      expect(checkTurnLeak(state)).toEqual([]);
    }
    expect(checked).toBeGreaterThan(50);
  });
});

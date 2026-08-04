import { describe, expect, it } from 'vitest';
import { legalActions } from '../src/index.js';
import type { Action, GameState } from '../src/index.js';
import {
  advanceToMain,
  applyFail,
  applyOk,
  buildGame,
  cloneWith,
  draftAttachDon,
  draftHandCard,
  draftPutCharacter,
  draftSetCostDon,
  run,
} from './helpers.js';

const BOARD = ['TEST-001', 'TEST-002', 'TEST-003', 'TEST-004', 'TEST-005'] as const;

// p1 at turn 1 main with a full board, 5 active DON, and a cost-1 character in hand.
function fullBoard(): { state: GameState; newcomer: string; board: string[] } {
  const main = advanceToMain(buildGame());
  let newcomer!: string;
  const board: string[] = [];
  const state = cloneWith(main, (draft) => {
    draftSetCostDon(draft, 'p1', 5);
    for (const cardId of BOARD) {
      board.push(draftPutCharacter(draft, 'p1', cardId));
    }
    newcomer = draftHandCard(draft, 'p1', 'TEST-001');
  });
  return { state, newcomer, board };
}

describe('fieldLimits: 6th character', () => {
  it('M7: playing a 6th character without a trash choice fails', () => {
    const { state, newcomer } = fullBoard();
    expect(applyFail(state, { type: 'PLAY_CARD', player: 'p1', instanceId: newcomer })).toBe(
      'trashChoiceRequired',
    );
  });

  it('M7: with a trash choice the discard is not a KO and DON return rested', () => {
    const { state, newcomer, board } = fullBoard();
    const victim = board[2]!;
    const staged = cloneWith(state, (draft) => {
      draftAttachDon(draft, 'p1', 4, victim); // d4 was cost-active
    });
    const { state: after, events } = applyOk(staged, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: newcomer,
      trashCharacter: victim,
    });
    expect(after.players.p1.characters).toHaveLength(5);
    expect(after.players.p1.characters).toContain(newcomer);
    expect(after.players.p1.characters).not.toContain(victim);
    expect(after.players.p1.trash[0]).toBe(victim);
    // Normalized off-field, and its DON came back rested.
    expect(after.cards[victim]?.attachedDon).toEqual([]);
    expect(after.cards[victim]?.playedOnTurn).toBeNull();
    expect(after.players.p1.don[4]?.location).toEqual({ kind: 'cost', orientation: 'rested' });
    expect(events.some((e) => e.type === 'koed')).toBe(false);
    expect(events).toEqual([
      { type: 'donPaid', player: 'p1', count: 1 },
      { type: 'donReturned', player: 'p1', count: 1, rested: true },
      { type: 'characterTrashedForRoom', player: 'p1', instanceId: victim },
      { type: 'cardPlayed', player: 'p1', instanceId: newcomer, cardId: 'TEST-001' },
    ]);
  });

  it('rejects a trash choice when the board is not full', () => {
    const main = advanceToMain(buildGame());
    let id!: string;
    let onBoard!: string;
    const staged = cloneWith(main, (draft) => {
      draftSetCostDon(draft, 'p1', 3);
      onBoard = draftPutCharacter(draft, 'p1', 'TEST-001');
      id = draftHandCard(draft, 'p1', 'TEST-003');
    });
    expect(
      applyFail(staged, {
        type: 'PLAY_CARD',
        player: 'p1',
        instanceId: id,
        trashCharacter: onBoard,
      }),
    ).toBe('trashChoiceNotAllowed');
  });

  it('rejects a trash choice on non-character cards even with a full board', () => {
    const { state, board } = fullBoard();
    let eventCard!: string;
    const staged = cloneWith(state, (draft) => {
      eventCard = draftHandCard(draft, 'p1', 'TEST-011');
    });
    expect(
      applyFail(staged, {
        type: 'PLAY_CARD',
        player: 'p1',
        instanceId: eventCard,
        trashCharacter: board[0]!,
      }),
    ).toBe('trashChoiceNotAllowed');
  });

  it('rejects trash choices that are not own board characters', () => {
    const { state, newcomer } = fullBoard();
    const withEnemy = cloneWith(state, (draft) => {
      draftPutCharacter(draft, 'p2', 'TEST-101');
    });
    const enemyChar = withEnemy.players.p2.characters[0]!;
    expect(
      applyFail(withEnemy, {
        type: 'PLAY_CARD',
        player: 'p1',
        instanceId: newcomer,
        trashCharacter: enemyChar,
      }),
    ).toBe('invalidTrashChoice');
    expect(
      applyFail(withEnemy, {
        type: 'PLAY_CARD',
        player: 'p1',
        instanceId: newcomer,
        trashCharacter: withEnemy.players.p1.leader,
      }),
    ).toBe('invalidTrashChoice');
    expect(
      applyFail(withEnemy, {
        type: 'PLAY_CARD',
        player: 'p1',
        instanceId: newcomer,
        trashCharacter: 'nope',
      }),
    ).toBe('invalidTrashChoice');
  });

  it('M7: legalActions emits one variant per trashable character on a full board', () => {
    const { state, newcomer, board } = fullBoard();
    const plays = legalActions(state, 'p1').filter(
      (a): a is Action & { type: 'PLAY_CARD' } =>
        a.type === 'PLAY_CARD' && a.instanceId === newcomer,
    );
    expect(plays).toHaveLength(5);
    expect(plays.map((a) => a.trashCharacter)).toEqual(board);
  });

  it('legalActions emits a single variant without trashCharacter when there is room', () => {
    const main = advanceToMain(buildGame());
    let id!: string;
    const staged = cloneWith(main, (draft) => {
      id = draftHandCard(draft, 'p1', 'TEST-001');
    });
    const plays = legalActions(staged, 'p1').filter(
      (a): a is Action & { type: 'PLAY_CARD' } => a.type === 'PLAY_CARD' && a.instanceId === id,
    );
    expect(plays).toHaveLength(1);
    expect('trashCharacter' in plays[0]!).toBe(false);
  });

  it('characters never exceed 5 through a play-and-trash cycle', () => {
    const { state, newcomer, board } = fullBoard();
    const after = run(state, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: newcomer,
      trashCharacter: board[0]!,
    });
    expect(after.players.p1.characters).toHaveLength(5);
  });
});

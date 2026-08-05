import { describe, expect, it } from 'vitest';
import { legalActions } from '../src/index.js';
import type { Action, GameState } from '../src/index.js';
import { buildScenario, characterAt, handCard } from '../src/testdata/scenarios.js';
import { applyOk, run } from './helpers.js';

// The full-board branch is reached once per ~1000 simulated games: bots spend
// DON!! attaching rather than filling the board, so this position has to be
// built rather than played toward.
//
// Note on the shape of the play: PLAY_CARD carries an optional
// `trashCharacter`, so the choice of which character leaves is the player's and
// is named in the action. It is required exactly when the board is full. See
// the README section on field limits.

const FULL_BOARD = [
  { cardId: 'TEST-001' },
  { cardId: 'TEST-003' },
  { cardId: 'TEST-004' },
  { cardId: 'TEST-005' },
  { cardId: 'TEST-006' },
] as const;

function fullBoard(opts: { activeDon: number; hand: string[]; attachedDonOnFirst?: number }): GameState {
  const characters = FULL_BOARD.map((spec, index) =>
    index === 0 && opts.attachedDonOnFirst !== undefined
      ? { ...spec, attachedDon: opts.attachedDonOnFirst }
      : { ...spec },
  );
  return buildScenario({
    p1: { clearHand: true, activeDon: opts.activeDon, characters, hand: opts.hand },
  });
}

function playCards(actions: Action[]): Array<Action & { type: 'PLAY_CARD' }> {
  return actions.filter((action): action is Action & { type: 'PLAY_CARD' } => action.type === 'PLAY_CARD');
}

describe('B. sixth character', () => {
  it('B1: with a full board and enough DON!!, playing a character is legal', () => {
    const affordable = fullBoard({ activeDon: 2, hand: ['TEST-003'] }); // cost 2
    expect(affordable.players.p1.characters).toHaveLength(5);
    const offered = playCards(legalActions(affordable, 'p1'));

    // The play is not blocked: one legal variant per character that could leave.
    expect(offered).toHaveLength(5);
    expect(new Set(offered.map((action) => action.trashCharacter))).toEqual(
      new Set(affordable.players.p1.characters),
    );
    for (const action of offered) {
      const result = applyOk(affordable, action);
      expect(result.state.players.p1.characters).toHaveLength(5);
    }
  });

  it('B2: resolving the play leaves exactly 5 characters, never 6 in any observable state', () => {
    const state = fullBoard({ activeDon: 2, hand: ['TEST-003'] });
    const newcomer = handCard(state, 'p1', 'TEST-003');
    const leaving = characterAt(state, 'p1', 2);

    const after = run(state, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: newcomer,
      trashCharacter: leaving,
    });

    expect(after.players.p1.characters).toHaveLength(5);
    expect(after.players.p1.characters).toContain(newcomer);
    expect(after.players.p1.characters).not.toContain(leaving);
    expect(after.players.p1.trash[0]).toBe(leaving);
  });

  it('B3: the character sent to the trash is NOT a KO', () => {
    const state = fullBoard({ activeDon: 2, hand: ['TEST-003'] });
    const newcomer = handCard(state, 'p1', 'TEST-003');
    const leaving = characterAt(state, 'p1', 0);

    const { events } = applyOk(state, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: newcomer,
      trashCharacter: leaving,
    });

    // The distinction decides whether [On K.O.] triggers fire in phase 2.
    expect(events.some((event) => event.type === 'koed')).toBe(false);
    expect(events).toContainEqual({
      type: 'characterTrashedForRoom',
      player: 'p1',
      instanceId: leaving,
    });
  });

  it('B4: DON!! attached to the discarded character return to the cost area RESTED', () => {
    // 2 DON!! attached to the character that will leave, 1 left to pay the cost.
    const state = fullBoard({ activeDon: 3, hand: ['TEST-001'], attachedDonOnFirst: 2 });
    const leaving = characterAt(state, 'p1', 0);
    const newcomer = handCard(state, 'p1', 'TEST-001');
    const attached = [...(state.cards[leaving]?.attachedDon ?? [])];
    expect(attached).toHaveLength(2);

    const after = run(state, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: newcomer,
      trashCharacter: leaving,
    });

    const locations = attached.map(
      (id) => after.players.p1.don.find((don) => don.instanceId === id)?.location,
    );
    expect(locations).toEqual([
      { kind: 'cost', orientation: 'rested' },
      { kind: 'cost', orientation: 'rested' },
    ]);
    expect(after.cards[leaving]?.attachedDon).toEqual([]);
  });

  it('B5: with a full board and not enough DON!!, no PLAY_CARD is offered', () => {
    const state = fullBoard({ activeDon: 1, hand: ['TEST-010'] }); // cost 10
    expect(playCards(legalActions(state, 'p1'))).toEqual([]);

    // Contrast: the same board with enough DON!! does offer the play, so the
    // empty result above is about cost, not about the board being full.
    const affordable = fullBoard({ activeDon: 10, hand: ['TEST-010'] });
    expect(playCards(legalActions(affordable, 'p1'))).toHaveLength(5);
  });
});

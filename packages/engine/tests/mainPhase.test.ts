import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import {
  advanceToMain,
  applyFail,
  applyOk,
  buildGame,
  cloneWith,
  draftAttachDon,
  draftHandCard,
  draftSetCostDon,
  run,
} from './helpers.js';

function donLocations(state: GameState, player: 'p1' | 'p2'): string[] {
  return state.players[player].don.map((don) =>
    don.location.kind === 'cost' ? `cost-${don.location.orientation}` : don.location.kind,
  );
}

describe('mainPhase: PLAY_CARD', () => {
  it('pays by resting the first K active cost DON in array order', () => {
    const main = advanceToMain(buildGame());
    let id!: string;
    const staged = cloneWith(main, (draft) => {
      draftSetCostDon(draft, 'p1', 3);
      id = draftHandCard(draft, 'p1', 'TEST-003'); // cost 2 character
    });
    const { state, events } = applyOk(staged, { type: 'PLAY_CARD', player: 'p1', instanceId: id });
    expect(donLocations(state, 'p1').slice(0, 3)).toEqual([
      'cost-rested',
      'cost-rested',
      'cost-active',
    ]);
    expect(state.players.p1.characters).toContain(id);
    expect(state.cards[id]?.orientation).toBe('active');
    expect(state.cards[id]?.playedOnTurn).toBe(1);
    expect(state.players.p1.hand).not.toContain(id);
    expect(events).toEqual([
      { type: 'donPaid', player: 'p1', count: 2 },
      { type: 'cardPlayed', player: 'p1', instanceId: id, cardId: 'TEST-003' },
    ]);
  });

  it('payment skips already-rested DON: first active in array order pays', () => {
    const main = advanceToMain(buildGame());
    let id!: string;
    const staged = cloneWith(main, (draft) => {
      draftSetCostDon(draft, 'p1', 3);
      draft.players.p1.don[0]!.location = { kind: 'cost', orientation: 'rested' };
      id = draftHandCard(draft, 'p1', 'TEST-001'); // cost 1
    });
    const { state } = applyOk(staged, { type: 'PLAY_CARD', player: 'p1', instanceId: id });
    // d0 was pre-rested; the payment rested d1; d2 stays active.
    expect(donLocations(state, 'p1').slice(0, 3)).toEqual([
      'cost-rested',
      'cost-rested',
      'cost-active',
    ]);
  });

  it('a new stage replaces the old one, which goes to trash[0] normalized', () => {
    const main = advanceToMain(buildGame());
    let oldStage!: string;
    let newStage!: string;
    const staged = cloneWith(main, (draft) => {
      draftSetCostDon(draft, 'p1', 3);
      oldStage = draftHandCard(draft, 'p1', 'TEST-013');
      newStage = draftHandCard(draft, 'p1', 'TEST-013');
      // move the first copy from hand onto the field
      draft.players.p1.hand = draft.players.p1.hand.filter((id) => id !== oldStage);
      draft.players.p1.stage = oldStage;
      draft.cards[oldStage]!.playedOnTurn = 1;
    });
    const { state, events } = applyOk(staged, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: newStage,
    });
    expect(state.players.p1.stage).toBe(newStage);
    expect(state.players.p1.trash[0]).toBe(oldStage);
    expect(state.cards[oldStage]?.playedOnTurn).toBeNull();
    expect(state.cards[oldStage]?.orientation).toBe('active');
    expect(state.cards[newStage]?.playedOnTurn).toBe(1);
    expect(events).toEqual([
      { type: 'donPaid', player: 'p1', count: 2 },
      { type: 'stageReplaced', player: 'p1', oldStage, newStage },
      { type: 'cardPlayed', player: 'p1', instanceId: newStage, cardId: 'TEST-013' },
    ]);
    expect(events.some((e) => e.type === 'koed')).toBe(false);
  });

  // Stage replacement is the third path through leaveField; KO and
  // trash-for-room are pinned elsewhere. All three must return DON rested.
  it('a replaced stage returns its attached DON to the cost area rested', () => {
    const main = advanceToMain(buildGame());
    let oldStage!: string;
    let newStage!: string;
    const staged = cloneWith(main, (draft) => {
      draftSetCostDon(draft, 'p1', 5);
      oldStage = draftHandCard(draft, 'p1', 'TEST-013');
      newStage = draftHandCard(draft, 'p1', 'TEST-013');
      draft.players.p1.hand = draft.players.p1.hand.filter((id) => id !== oldStage);
      draft.players.p1.stage = oldStage;
      // Attach two of the five active DON to the stage about to be replaced.
      draftAttachDon(draft, 'p1', 0, oldStage);
      draftAttachDon(draft, 'p1', 1, oldStage);
    });

    const { state } = applyOk(staged, { type: 'PLAY_CARD', player: 'p1', instanceId: newStage });

    const returned = ['p1-d0', 'p1-d1'].map(
      (id) => state.players.p1.don.find((don) => don.instanceId === id)?.location,
    );
    expect(returned).toEqual([
      { kind: 'cost', orientation: 'rested' },
      { kind: 'cost', orientation: 'rested' },
    ]);
    expect(state.cards[oldStage]?.attachedDon).toEqual([]);
  });

  it('events go to trash after being played', () => {
    const main = advanceToMain(buildGame());
    let id!: string;
    const staged = cloneWith(main, (draft) => {
      id = draftHandCard(draft, 'p1', 'TEST-011'); // cost 1 event
    });
    const { state, events } = applyOk(staged, { type: 'PLAY_CARD', player: 'p1', instanceId: id });
    expect(state.players.p1.trash[0]).toBe(id);
    expect(state.players.p1.characters).not.toContain(id);
    expect(state.cards[id]?.playedOnTurn).toBeNull();
    expect(events).toEqual([
      { type: 'donPaid', player: 'p1', count: 1 },
      { type: 'cardPlayed', player: 'p1', instanceId: id, cardId: 'TEST-011' },
    ]);
  });

  it('rejects unaffordable cards with notEnoughDon', () => {
    const main = advanceToMain(buildGame());
    let id!: string;
    const staged = cloneWith(main, (draft) => {
      id = draftHandCard(draft, 'p1', 'TEST-006'); // cost 4, only 1 DON on turn 1
    });
    expect(applyFail(staged, { type: 'PLAY_CARD', player: 'p1', instanceId: id })).toBe(
      'notEnoughDon',
    );
  });

  it('rejects cards that are not in hand with cardNotInHand', () => {
    const main = advanceToMain(buildGame());
    const deckCard = main.players.p1.deck[0]!;
    expect(applyFail(main, { type: 'PLAY_CARD', player: 'p1', instanceId: deckCard })).toBe(
      'cardNotInHand',
    );
    const opponentCard = main.players.p2.hand[0]!;
    expect(applyFail(main, { type: 'PLAY_CARD', player: 'p1', instanceId: opponentCard })).toBe(
      'cardNotInHand',
    );
    expect(applyFail(main, { type: 'PLAY_CARD', player: 'p1', instanceId: 'nope' })).toBe(
      'cardNotInHand',
    );
  });

  it('rejects a leader smuggled into hand with unplayableCategory', () => {
    // Deliberately corrupt state: validation is pure, so the reason code is
    // still pinned even though this state breaks conservation.
    const main = advanceToMain(buildGame());
    const staged = cloneWith(main, (draft) => {
      draft.players.p1.hand.push(draft.players.p1.leader);
    });
    expect(
      applyFail(staged, { type: 'PLAY_CARD', player: 'p1', instanceId: staged.players.p1.leader }),
    ).toBe('unplayableCategory');
  });

  it('is only legal for the active player in main with no battle', () => {
    const main = advanceToMain(buildGame());
    const p2Card = main.players.p2.hand[0]!;
    expect(applyFail(main, { type: 'PLAY_CARD', player: 'p2', instanceId: p2Card })).toBe(
      'notYourPriority',
    );
  });
});

describe('mainPhase: turn interaction', () => {
  it('a played character keeps playedOnTurn across turns', () => {
    const main = advanceToMain(buildGame());
    let id!: string;
    const staged = cloneWith(main, (draft) => {
      draftSetCostDon(draft, 'p1', 2);
      id = draftHandCard(draft, 'p1', 'TEST-003');
    });
    const played = run(
      staged,
      { type: 'PLAY_CARD', player: 'p1', instanceId: id },
      { type: 'END_TURN', player: 'p1' },
      { type: 'END_TURN', player: 'p2' },
    );
    expect(played.turn).toBe(3);
    expect(played.cards[id]?.playedOnTurn).toBe(1);
    expect(played.cards[id]?.orientation).toBe('active');
  });
});

import { describe, expect, it } from 'vitest';
import { applyAction, legalActions } from '../src/index.js';
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

// p1 at their turn 3 main with p2 reduced to `lifeCount` life cards (excess
// moved to the bottom of p2's deck to preserve conservation).
function lethalSetup(lifeCount: number): GameState {
  const main = advanceToMain(buildGame());
  return cloneWith(main, (draft) => {
    draft.turn = 3;
    const ps = draft.players.p2;
    while (ps.life.length > lifeCount) {
      ps.deck.push(ps.life.pop() as string);
    }
  });
}

describe('winConditions: deckOut', () => {
  it('M9: fires during the END_TURN transition, never reaching main', () => {
    const main = advanceToMain(buildGame());
    const staged = cloneWith(main, (draft) => {
      draft.players.p2.trash.push(...draft.players.p2.deck);
      draft.players.p2.deck = [];
    });
    const { state, events } = applyOk(staged, { type: 'END_TURN', player: 'p1' });
    expect(state.status).toBe('finished');
    expect(state.winner).toBe('p1');
    expect(state.endReason).toBe('deckOut');
    expect(state.turn).toBe(2);
    // The transition stops at the would-be draw: no draw, no DON gain.
    expect(events).toEqual([
      { type: 'turnEnded', turn: 1, player: 'p1' },
      { type: 'turnStarted', turn: 2, player: 'p2' },
      { type: 'gameEnded', winner: 'p1', endReason: 'deckOut' },
    ]);
  });

  it('M9: the firstPlayer skips the turn-1 draw, so an empty deck deck-outs only on their next draw', () => {
    // p1 sits at turn 1 main with an empty deck: no deck-out happened (draw was
    // skipped). p2 draws fine on turn 2; p1 deck-outs at the turn 3 draw.
    const main = advanceToMain(buildGame());
    const staged = cloneWith(main, (draft) => {
      draft.players.p1.trash.push(...draft.players.p1.deck);
      draft.players.p1.deck = [];
    });
    expect(staged.status).toBe('playing');
    const turn2 = run(staged, { type: 'END_TURN', player: 'p1' });
    expect(turn2.status).toBe('playing');
    const { state: turn3 } = applyOk(turn2, { type: 'END_TURN', player: 'p2' });
    expect(turn3.status).toBe('finished');
    expect(turn3.winner).toBe('p2');
    expect(turn3.endReason).toBe('deckOut');
    expect(turn3.turn).toBe(3);
  });
});

describe('winConditions: lifeOut', () => {
  it('M8: a leader hit at 0 life ends the game with lifeOut', () => {
    const state = lethalSetup(0);
    const p1Leader = state.players.p1.leader;
    const p2Leader = state.players.p2.leader;
    const inBattle = run(
      state,
      { type: 'DECLARE_ATTACK', player: 'p1', attacker: p1Leader, target: p2Leader },
      { type: 'PASS', player: 'p2' },
    );
    const { state: after, events } = applyOk(inBattle, { type: 'PASS', player: 'p2' });
    expect(after.status).toBe('finished');
    expect(after.winner).toBe('p1');
    expect(after.endReason).toBe('lifeOut');
    expect(after.battle).toBeNull();
    expect(after.modifiers).toEqual([]);
    expect(events).toEqual([
      { type: 'battleResolved', attacker: p1Leader, target: p2Leader, outcome: 'lifeDamage' },
      { type: 'gameEnded', winner: 'p1', endReason: 'lifeOut' },
    ]);
    expect(legalActions(after, 'p1')).toEqual([]);
    expect(legalActions(after, 'p2')).toEqual([]);
  });

  it('M8 contrast: at 1 life the card goes to hand and the game continues', () => {
    const state = lethalSetup(1);
    const p1Leader = state.players.p1.leader;
    const p2Leader = state.players.p2.leader;
    const lastLife = state.players.p2.life[0]!;
    const after = run(
      state,
      { type: 'DECLARE_ATTACK', player: 'p1', attacker: p1Leader, target: p2Leader },
      { type: 'PASS', player: 'p2' },
      { type: 'PASS', player: 'p2' },
    );
    expect(after.status).toBe('playing');
    expect(after.players.p2.life).toEqual([]);
    expect(after.players.p2.hand).toContain(lastLife);
    expect(after.log.at(-1)).toEqual({
      type: 'lifeTaken',
      player: 'p2',
      instanceId: lastLife,
      remaining: 0,
    });
  });

  it('clears endOfBattle modifiers parked on bystanders when lifeOut ends the game', () => {
    let bystander!: string;
    let counterCard!: string;
    const base = lethalSetup(0);
    const state = cloneWith(base, (draft) => {
      bystander = draftPutCharacter(draft, 'p2', 'TEST-103');
      counterCard = draftHandCard(draft, 'p2', 'TEST-101');
    });
    const p1Leader = state.players.p1.leader;
    const p2Leader = state.players.p2.leader;
    const after = run(
      state,
      { type: 'DECLARE_ATTACK', player: 'p1', attacker: p1Leader, target: p2Leader },
      { type: 'PASS', player: 'p2' },
      { type: 'PLAY_COUNTER', player: 'p2', instanceId: counterCard, target: bystander },
      { type: 'PASS', player: 'p2' },
    );
    expect(after.status).toBe('finished');
    expect(after.endReason).toBe('lifeOut');
    expect(after.modifiers).toEqual([]);
  });
});

describe('winConditions: concede', () => {
  it('is legal during the mulligan, even for the non-priority player', () => {
    const game = buildGame();
    const { state } = applyOk(game, { type: 'CONCEDE', player: 'p2' });
    expect(state.status).toBe('finished');
    expect(state.winner).toBe('p1');
    expect(state.endReason).toBe('concede');
  });

  it('is legal in main phase for either player', () => {
    const main = advanceToMain(buildGame());
    const byActive = applyOk(main, { type: 'CONCEDE', player: 'p1' }).state;
    expect(byActive.winner).toBe('p2');
    expect(byActive.endReason).toBe('concede');
    const byInactive = applyOk(main, { type: 'CONCEDE', player: 'p2' }).state;
    expect(byInactive.winner).toBe('p1');
    expect(byInactive.endReason).toBe('concede');
  });

  it('is legal mid-battle for the non-priority attacker', () => {
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
    });
    const { state, events } = applyOk(withBattle, { type: 'CONCEDE', player: 'p1' });
    expect(state.status).toBe('finished');
    expect(state.winner).toBe('p2');
    expect(state.endReason).toBe('concede');
    expect(events).toEqual([{ type: 'gameEnded', winner: 'p2', endReason: 'concede' }]);
  });
});

describe('winConditions: finished games are inert', () => {
  it('legalActions is empty for both players and every action returns gameFinished', () => {
    const finished = applyOk(buildGame(), { type: 'CONCEDE', player: 'p1' }).state;
    expect(legalActions(finished, 'p1')).toEqual([]);
    expect(legalActions(finished, 'p2')).toEqual([]);
    expect(applyFail(finished, { type: 'END_TURN', player: 'p2' })).toBe('gameFinished');
    expect(applyFail(finished, { type: 'CONCEDE', player: 'p2' })).toBe('gameFinished');
    expect(applyFail(finished, { type: 'MULLIGAN', player: 'p1', accept: true })).toBe(
      'gameFinished',
    );
    const malformed = applyAction(finished, { type: 'NOPE', player: 'p1' } as never);
    expect(malformed).toEqual({ ok: false, reason: 'gameFinished' });
  });
});

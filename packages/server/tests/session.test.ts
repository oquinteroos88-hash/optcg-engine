import { describe, expect, it } from 'vitest';
import { REASONS } from '@optcg/engine';
import type { GameState } from '@optcg/engine';
import { ABIL_DECK } from '@optcg/engine/testdata/abilityDecks';
import { buildScenario, characterAt } from '@optcg/engine/testdata/scenarios';
import { createMatch, handleAction } from '../src/session.js';
import { driveMatch, matchFromGame, runActions } from './helpers.js';

/**
 * The session without a network: pure functions over plain data, every game
 * answer the engine's. Nothing here mocks anything, because there is nothing
 * to mock — that is the point of the layer.
 */

const decks = { p1: ABIL_DECK, p2: ABIL_DECK };

describe('createMatch', () => {
  it('opens with the engine setup and a journal entry both seats can read', () => {
    const match = createMatch(7, decks);
    expect(match.game.status).toBe('mulligan');
    expect(match.actions).toEqual([]);
    for (const seat of ['p1', 'p2'] as const) {
      const first = match.seats[seat].journal[0];
      expect(first?.some((event) => event.type === 'gameStarted')).toBe(true);
      // The setup's gameStarted is redacted like everything else: no matchId,
      // because the matchId embeds the seed.
      expect(JSON.stringify(first)).not.toContain('matchId');
    }
  });
});

describe('acting in turn', () => {
  it('accepts a legal action, records it, and emits one update per seat', () => {
    const match = createMatch(7, decks);
    const first = match.game.priority;
    const result = handleAction(match, first, { type: 'MULLIGAN', player: first, accept: false });
    if (!result.ok) {
      throw new Error(result.reason);
    }
    expect(result.match.actions).toEqual([{ type: 'MULLIGAN', player: first, accept: false }]);
    for (const seat of ['p1', 'p2'] as const) {
      expect(result.emitted[seat].type).toBe('update');
      expect(result.emitted[seat].view.viewer).toBe(seat);
      expect(result.emitted[seat].events.some((event) => event.type === 'mulliganTaken')).toBe(true);
      // The journal grew by exactly the emitted events — same objects, not a
      // re-derivation.
      expect(result.match.seats[seat].journal.at(-1)).toBe(result.emitted[seat].events);
    }
  });

  it('returns the engine reason verbatim when the wrong seat acts', () => {
    const match = createMatch(7, decks);
    const bystander = match.game.priority === 'p1' ? 'p2' : 'p1';
    const result = handleAction(match, bystander, {
      type: 'MULLIGAN',
      player: bystander,
      accept: false,
    });
    expect(result).toEqual({ ok: false, reason: REASONS.notYourPriority });
  });
});

describe('the affordances travel', () => {
  it('gives the acting seat its list and the waiting seat exactly [CONCEDE]', () => {
    const match = createMatch(7, decks);
    const first = match.game.priority;
    const waiting = first === 'p1' ? 'p2' : 'p1';
    const result = handleAction(match, first, { type: 'MULLIGAN', player: first, accept: false });
    if (!result.ok) {
      throw new Error(result.reason);
    }
    // Whoever holds priority now has real moves; the other seat holds the one
    // action CR 1-2-3 never takes away. Both come off `legalActions`, so the
    // server invents neither.
    const acting = result.match.game.priority;
    expect(result.emitted[acting].actions.length).toBeGreaterThan(1);
    expect(result.emitted[acting === 'p1' ? 'p2' : 'p1'].actions).toEqual([
      { type: 'CONCEDE', player: acting === 'p1' ? 'p2' : 'p1' },
    ]);
    expect(waiting).toBeDefined();
  });

  it('round-trips: every offered action is accepted, over a whole game', { timeout: 240_000 }, () => {
    // The client's affordance round-trip, run where the affordances now come
    // from — the wire. An offered action the engine then refuses would be a
    // board showing a button that does nothing.
    for (let seed = 1; seed <= 3; seed += 1) {
      const run = driveMatch(seed, decks, { checkOffered: true });
      expect(run.offeredChecked).toBeGreaterThan(0);
      expect(run.offeredRejected).toEqual([]);
    }
  });
});

describe('the cross-choice, by handle, through the session', () => {
  /** The #43 staging: p1 kills p2's Scavenger, whose [On K.O.] has p1 choose
   * from p2's hand — the one blind choice in the game. */
  function stagedKill(): GameState {
    return buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-012' }], activeDon: 4 },
      p2: { characters: [{ cardId: 'ABIL-002', orientation: 'rested' }], activeDon: 4 },
    });
  }

  it('flows attack → blind choice → handle answer, and the trash tells the chooser', () => {
    const game = stagedKill();
    const attacked = runActions(matchFromGame(game), [
      {
        seat: 'p1',
        action: {
          type: 'DECLARE_ATTACK',
          player: 'p1',
          attacker: characterAt(game, 'p1', 0),
          target: characterAt(game, 'p2', 0),
        },
      },
      { seat: 'p2', action: { type: 'PASS', player: 'p2' } },
      { seat: 'p2', action: { type: 'PASS', player: 'p2' } },
    ]);

    const match = attacked.match;
    expect(match.game.pending?.blind).toBe(true);
    // The opening emission showed the chooser handles, never identities.
    const chooserUpdate = attacked.emitted.at(-1)?.p1;
    if (chooserUpdate?.view.pending?.audience !== 'chooserBlind') {
      throw new Error('expected the chooser to see a blind pending');
    }
    const handleCount = chooserUpdate.view.pending.handleCount;
    expect(handleCount).toBe(match.game.players.p2.hand.length);

    const answered = handleAction(match, 'p1', {
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId: match.game.pending?.id ?? '',
      answer: { kind: 'handles', selected: [0] },
    });
    if (!answered.ok) {
      throw new Error(answered.reason);
    }
    // The trashed card is public now (the trash is an open area), so both
    // seats' events name it — the chooser learns what their blind pick was
    // the way a table would show it.
    for (const seat of ['p1', 'p2'] as const) {
      const discarded = answered.emitted[seat].events.find(
        (event) => event.type === 'cardDiscarded',
      );
      if (discarded?.type !== 'cardDiscarded') {
        throw new Error(`expected ${seat} to see the discard`);
      }
      expect(discarded.player).toBe('p2');
      expect(discarded.instanceId).not.toBeNull();
    }
    expect(answered.match.game.pending).toBeNull();
    // The action log keeps the handle answer exactly as it arrived.
    expect(answered.match.actions.at(-1)).toEqual({
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId: match.game.pending?.id,
      answer: { kind: 'handles', selected: [0] },
    });
  });

  it('hands a bad handle back to the actor with the engine reason', () => {
    const game = stagedKill();
    const attacked = runActions(matchFromGame(game), [
      {
        seat: 'p1',
        action: {
          type: 'DECLARE_ATTACK',
          player: 'p1',
          attacker: characterAt(game, 'p1', 0),
          target: characterAt(game, 'p2', 0),
        },
      },
      { seat: 'p2', action: { type: 'PASS', player: 'p2' } },
      { seat: 'p2', action: { type: 'PASS', player: 'p2' } },
    ]);
    const result = handleAction(attacked.match, 'p1', {
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId: attacked.match.game.pending?.id ?? '',
      answer: { kind: 'handles', selected: [99] },
    });
    expect(result).toEqual({ ok: false, reason: REASONS.choiceHandleOutOfRange });
  });
});

describe('concede and the end of the game', () => {
  it('accepts CONCEDE from the seat without priority — CR 1-2-3', () => {
    // "Either player may concede at any point during a game." The engine owns
    // the rule; the session only proves it routes an out-of-priority action
    // the engine accepts.
    const match = createMatch(7, decks);
    const bystander = match.game.priority === 'p1' ? 'p2' : 'p1';
    const result = handleAction(match, bystander, { type: 'CONCEDE', player: bystander });
    if (!result.ok) {
      throw new Error(result.reason);
    }
    expect(result.match.game.status).toBe('finished');
    expect(result.match.game.winner).toBe(match.game.priority);
    for (const seat of ['p1', 'p2'] as const) {
      expect(result.emitted[seat].events.some((event) => event.type === 'gameEnded')).toBe(true);
    }
  });

  it('rejects anything after the end with the engine reason', () => {
    const match = createMatch(7, decks);
    const conceded = handleAction(match, 'p1', { type: 'CONCEDE', player: 'p1' });
    if (!conceded.ok) {
      throw new Error(conceded.reason);
    }
    const after = handleAction(conceded.match, 'p2', { type: 'END_TURN', player: 'p2' });
    expect(after).toEqual({ ok: false, reason: REASONS.gameFinished });
  });
});

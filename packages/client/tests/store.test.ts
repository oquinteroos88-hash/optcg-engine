import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPower } from '@optcg/engine';
import type { GameState, PlayerId } from '@optcg/engine';
import { characterAt } from '@optcg/engine/testdata/scenarios';
import { getAffordances } from '../src/game/affordances';
import { useStore } from '../src/store/store';
import { counterStepScenario, mainPhaseWithAttacker } from './corpus';

const SETUP = { seed: 42, deckIdP1: 'red', deckIdP2: 'green', firstPlayer: 'p1' as PlayerId };

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  useStore.getState().newGame(SETUP);
});

afterEach(() => {
  errorSpy.mockRestore();
  useStore.getState().toSetup();
});

/** Runs the animation queue to completion the way AnimationDriver would. */
function drainQueue(): void {
  for (let guard = 0; guard < 100; guard += 1) {
    const head = useStore.getState().animQueue[0];
    if (head === undefined) {
      return;
    }
    useStore.getState().animTick(head.id);
  }
  throw new Error('queue did not drain');
}

function mustGameState(): NonNullable<ReturnType<typeof useStore.getState>['gameState']> {
  const gameState = useStore.getState().gameState;
  if (gameState === null) {
    throw new Error('no game state');
  }
  return gameState;
}

describe('store.newGame', () => {
  it('starts a game in the playing screen with idle mode and an empty queue', () => {
    const s = useStore.getState();
    expect(s.screen).toBe('playing');
    expect(s.setup).toEqual(SETUP);
    expect(mustGameState().status).toBe('mulligan');
    expect(s.ui.mode).toEqual({ kind: 'idle' });
    expect(s.animQueue).toEqual([]);
  });
});

describe('store.dispatch', () => {
  it('logs a UI bug and leaves the state untouched on an illegal action', () => {
    const before = mustGameState();
    // END_TURN is illegal during the mulligan.
    useStore.getState().dispatch({ type: 'END_TURN', player: 'p1' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toBe('UI bug: illegal action');
    expect(useStore.getState().gameState).toBe(before);
    expect(useStore.getState().animQueue).toEqual([]);
  });

  it('advances the state and queues animation groups on a legal action', () => {
    useStore.getState().dispatch({ type: 'MULLIGAN', player: 'p1', accept: false });
    // mulliganTaken is zero-visual, so this action produces no groups.
    expect(useStore.getState().animQueue).toEqual([]);
    expect(mustGameState().priority).toBe('p2');

    useStore.getState().dispatch({ type: 'MULLIGAN', player: 'p2', accept: false });
    expect(mustGameState().status).toBe('playing');
    // The turn transition draws and gains DON, which do animate.
    expect(useStore.getState().animQueue.length).toBeGreaterThan(0);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('store.uiEvent', () => {
  function reachMainPhase(): void {
    useStore.getState().dispatch({ type: 'MULLIGAN', player: 'p1', accept: false });
    useStore.getState().dispatch({ type: 'MULLIGAN', player: 'p2', accept: false });
    drainQueue();
  }

  it('is a no-op while the animation queue holds input', () => {
    useStore.getState().dispatch({ type: 'MULLIGAN', player: 'p1', accept: false });
    useStore.getState().dispatch({ type: 'MULLIGAN', player: 'p2', accept: false });
    expect(useStore.getState().animQueue.length).toBeGreaterThan(0);

    const before = mustGameState();
    useStore.getState().uiEvent({ kind: 'clickDonArea' });
    expect(useStore.getState().ui.mode).toEqual({ kind: 'idle' });
    expect(useStore.getState().gameState).toBe(before);
  });

  it('drives DON attachment end to end without any illegal action', () => {
    reachMainPhase();
    const state = mustGameState();
    const leader = state.players[state.activePlayer].leader;
    expect(getAffordances(state).byCard[leader]?.canReceiveDon).toBe(true);

    useStore.getState().uiEvent({ kind: 'clickDonArea' });
    expect(useStore.getState().ui.mode).toEqual({ kind: 'attachingDon', owner: 'p1' });

    useStore.getState().uiEvent({ kind: 'clickFieldCard', instanceId: leader, mine: true });
    expect(useStore.getState().ui.mode).toEqual({ kind: 'idle' });
    expect(mustGameState().cards[leader]?.attachedDon).toHaveLength(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('escape returns to idle without dispatching anything', () => {
    reachMainPhase();
    useStore.getState().uiEvent({ kind: 'clickDonArea' });
    expect(useStore.getState().ui.mode).toEqual({ kind: 'attachingDon', owner: 'p1' });

    const before = mustGameState();
    useStore.getState().uiEvent({ kind: 'escape' });
    expect(useStore.getState().ui.mode).toEqual({ kind: 'idle' });
    expect(useStore.getState().gameState).toBe(before);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('ignores clicks that match no affordance', () => {
    reachMainPhase();
    const before = mustGameState();
    useStore.getState().uiEvent({ kind: 'clickFieldCard', instanceId: 'nope', mine: true });
    expect(useStore.getState().ui.mode).toEqual({ kind: 'idle' });
    expect(useStore.getState().gameState).toBe(before);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('mode ownership across a turn change', () => {
  function reachMainPhase(): void {
    useStore.getState().answerMulligan(false);
    useStore.getState().answerMulligan(false);
    drainQueue();
  }

  // Regression: attachingDon carries no instance id, so before mode ownership
  // existed it survived END_TURN and the next player arrived with their own
  // cards already pulsing as DON!! targets.
  it('drops attachingDon when the turn passes to the other player', () => {
    reachMainPhase();
    const first = mustGameState().priority;

    useStore.getState().uiEvent({ kind: 'clickDonArea' });
    expect(useStore.getState().ui.mode).toEqual({ kind: 'attachingDon', owner: first });

    useStore.getState().endTurn();

    const after = mustGameState();
    expect(after.priority).not.toBe(first);
    // The new player must start from a clean board, not in DON-targeting mode.
    expect(useStore.getState().ui.mode).toEqual({ kind: 'idle' });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('lets the DON area click cancel attachingDon', () => {
    reachMainPhase();
    useStore.getState().uiEvent({ kind: 'clickDonArea' });
    expect(useStore.getState().ui.mode.kind).toBe('attachingDon');

    const before = mustGameState();
    useStore.getState().uiEvent({ kind: 'clickDonArea' });
    expect(useStore.getState().ui.mode).toEqual({ kind: 'idle' });
    expect(useStore.getState().gameState).toBe(before);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('store global actions', () => {
  it('endTurn advances the turn and passes control', () => {
    useStore.getState().dispatch({ type: 'MULLIGAN', player: 'p1', accept: false });
    useStore.getState().dispatch({ type: 'MULLIGAN', player: 'p2', accept: false });
    drainQueue();
    const before = mustGameState();

    useStore.getState().endTurn();
    const after = mustGameState();
    expect(after.turn).toBe(before.turn + 1);
    expect(after.activePlayer).not.toBe(before.activePlayer);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('concede finishes the game for the opponent', () => {
    useStore.getState().concede();
    const state = mustGameState();
    expect(state.status).toBe('finished');
    expect(state.endReason).toBe('concede');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('refuses a global action whose affordance flag is false', () => {
    // PASS is battle-only, so it is illegal in the main phase.
    useStore.getState().answerMulligan(false);
    useStore.getState().answerMulligan(false);
    drainQueue();
    expect(getAffordances(mustGameState()).global.canPass).toBe(false);

    const before = mustGameState();
    useStore.getState().pass();
    // Guarded in the store: nothing dispatched, so no illegal action was logged.
    expect(useStore.getState().gameState).toBe(before);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('refuses answerMulligan once the mulligan is over', () => {
    useStore.getState().answerMulligan(false);
    useStore.getState().answerMulligan(false);
    drainQueue();
    expect(getAffordances(mustGameState()).global.mustAnswerMulligan).toBe(false);

    const before = mustGameState();
    useStore.getState().answerMulligan(true);
    expect(useStore.getState().gameState).toBe(before);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('toggleVeil flips the opponent-hand veil', () => {
    expect(useStore.getState().ui.veilOpponentHand).toBe(false);
    useStore.getState().toggleVeil();
    expect(useStore.getState().ui.veilOpponentHand).toBe(true);
    useStore.getState().toggleVeil();
    expect(useStore.getState().ui.veilOpponentHand).toBe(false);
  });
});

describe('store.answerMulligan', () => {
  it('asks each player in priority order and starts turn 1 after both answer', () => {
    // First decision belongs to the first player.
    expect(mustGameState().priority).toBe('p1');
    expect(getAffordances(mustGameState()).global.mustAnswerMulligan).toBe(true);

    useStore.getState().answerMulligan(false);
    // Priority moved: the overlay now renders the other player's hand.
    const afterFirst = mustGameState();
    expect(afterFirst.status).toBe('mulligan');
    expect(afterFirst.priority).toBe('p2');
    expect(getAffordances(afterFirst).global.mustAnswerMulligan).toBe(true);

    useStore.getState().answerMulligan(true);
    const afterSecond = mustGameState();
    expect(afterSecond.status).toBe('playing');
    expect(getAffordances(afterSecond).global.mustAnswerMulligan).toBe(false);
    expect(afterSecond.turn).toBe(1);
    // Life was placed for both sides by the second answer.
    expect(afterSecond.players.p1.life.length).toBeGreaterThan(0);
    expect(afterSecond.players.p2.life.length).toBeGreaterThan(0);
    // The accepted mulligan redrew that player's hand.
    expect(afterSecond.players.p2.hasMulliganed).toBe(true);
    expect(afterSecond.players.p1.hasMulliganed).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('battle interaction through the store', () => {
  /** Loads a prepared position directly; the store has no other injection path. */
  function loadState(state: GameState): void {
    useStore.setState({ screen: 'playing', gameState: state, animQueue: [] });
  }

  it('declares an attack, counters, and shows live power that resets on resolution', () => {
    // counterStepScenario already scripted the attack + the defender's PASS.
    const { state, counterCard } = counterStepScenario();
    loadState(state);
    const battleBefore = mustGameState().battle;
    if (battleBefore === null) {
      throw new Error('expected an open battle');
    }
    expect(battleBefore.step).toBe('counter');
    expect(mustGameState().priority).toBe('p2');

    const targetId = battleBefore.target;
    const basePower = getPower(mustGameState(), targetId);

    // Defender picks a counter card, confirms it, then picks its target. The
    // confirm is the hand's, not the counter step's: nothing leaves a hand on
    // one click any more.
    useStore.getState().uiEvent({ kind: 'clickHandCard', instanceId: counterCard });
    expect(useStore.getState().ui.mode).toEqual({
      kind: 'cardMenu',
      owner: 'p2',
      card: counterCard,
    });
    useStore.getState().uiEvent({ kind: 'chooseMenuOption', index: 0 });
    expect(useStore.getState().ui.mode).toEqual({ kind: 'countering', owner: 'p2', counterCard });

    useStore.getState().uiEvent({ kind: 'clickFieldCard', instanceId: targetId, mine: true });
    expect(useStore.getState().ui.mode).toEqual({ kind: 'idle' });

    // Live power moved immediately — the overlay reads exactly this.
    const boosted = getPower(mustGameState(), targetId);
    expect(boosted).toBeGreaterThan(basePower);
    expect(mustGameState().battle?.step).toBe('counter');

    // The counter queued an animation group, which blocks input until it drains.
    expect(useStore.getState().animQueue.length).toBeGreaterThan(0);
    drainQueue();

    // Resolving the battle purges endOfBattle modifiers: back to base is correct.
    useStore.getState().pass();
    expect(mustGameState().battle).toBeNull();
    expect(getPower(mustGameState(), targetId)).toBe(basePower);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('ignores clicks on cards that are not declared attack targets', () => {
    const main = mainPhaseWithAttacker();
    loadState(main);
    const attacker = characterAt(main, 'p1', 0);

    useStore.getState().uiEvent({ kind: 'clickFieldCard', instanceId: attacker, mine: true });
    expect(useStore.getState().ui.mode).toEqual({ kind: 'attacking', owner: 'p1', attacker });

    // An id outside attackTargets must not produce an intent or leave the mode.
    const before = mustGameState();
    useStore.getState().uiEvent({ kind: 'clickFieldCard', instanceId: 'nope', mine: false });
    expect(useStore.getState().ui.mode).toEqual({ kind: 'attacking', owner: 'p1', attacker });
    expect(useStore.getState().gameState).toBe(before);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('declares an attack from the main phase through two clicks', () => {
    const main = mainPhaseWithAttacker();
    loadState(main);
    const attacker = characterAt(main, 'p1', 0);
    const target = main.players.p2.leader;
    expect(getAffordances(main).byCard[attacker]?.attackTargets).toContain(target);

    useStore.getState().uiEvent({ kind: 'clickFieldCard', instanceId: attacker, mine: true });
    expect(useStore.getState().ui.mode).toEqual({ kind: 'attacking', owner: 'p1', attacker });

    useStore.getState().uiEvent({ kind: 'clickFieldCard', instanceId: target, mine: false });
    expect(mustGameState().battle?.attacker).toBe(attacker);
    expect(mustGameState().battle?.target).toBe(target);
    expect(mustGameState().battle?.step).toBe('block');
    // Priority handed to the defender: the banner shows "responde".
    expect(mustGameState().priority).toBe('p2');
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('store.rematch', () => {
  it('replays the stored setup and reproduces an identical opening state', () => {
    const opening = JSON.stringify(mustGameState());

    // Diverge from the opening position.
    useStore.getState().answerMulligan(false);
    useStore.getState().answerMulligan(false);
    drainQueue();
    expect(mustGameState().status).toBe('playing');

    useStore.getState().rematch();
    expect(JSON.stringify(mustGameState())).toBe(opening);
    expect(useStore.getState().screen).toBe('playing');
    expect(useStore.getState().setup).toEqual(SETUP);
    expect(useStore.getState().ui.mode).toEqual({ kind: 'idle' });
    expect(useStore.getState().animQueue).toEqual([]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('is a no-op with no stored setup', () => {
    useStore.getState().toSetup();
    useStore.setState({ setup: null });
    useStore.getState().rematch();
    expect(useStore.getState().screen).toBe('setup');
    expect(useStore.getState().gameState).toBeNull();
  });
});

describe('device handoff bookkeeping', () => {
  it('starts acknowledged for the opening player and tracks priority changes', () => {
    // newGame hands the device to whoever acts first.
    expect(useStore.getState().deviceAckFor).toBe(mustGameState().priority);

    useStore.getState().answerMulligan(false);
    // Priority moved to the other player; the handoff is now pending.
    expect(mustGameState().priority).toBe('p2');
    expect(useStore.getState().deviceAckFor).toBe('p1');

    useStore.getState().ackDevice();
    expect(useStore.getState().deviceAckFor).toBe('p2');
  });

  it('clears the acknowledgement when returning to setup', () => {
    useStore.getState().toSetup();
    expect(useStore.getState().deviceAckFor).toBeNull();
  });
});

describe('store.animTick', () => {
  it('pops the head group and ignores stale ids', () => {
    useStore.getState().dispatch({ type: 'MULLIGAN', player: 'p1', accept: false });
    useStore.getState().dispatch({ type: 'MULLIGAN', player: 'p2', accept: false });
    const queue = useStore.getState().animQueue;
    expect(queue.length).toBeGreaterThan(0);
    const head = queue[0];
    if (head === undefined) {
      throw new Error('expected a head group');
    }

    useStore.getState().animTick(head.id + 999);
    expect(useStore.getState().animQueue).toBe(queue);

    useStore.getState().animTick(head.id);
    expect(useStore.getState().animQueue.length).toBe(queue.length - 1);
  });
});

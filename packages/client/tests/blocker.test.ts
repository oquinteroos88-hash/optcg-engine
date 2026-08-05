import { describe, expect, it } from 'vitest';
import { applyAction, createGame, legalActions, registerCardSet } from '@optcg/engine';
import type { Action, Decklist, GameState, InstanceId } from '@optcg/engine';
import { computeAffordances } from '../src/game/affordances';

// No card in the engine's TEST set carries Blocker, so the block affordance
// would otherwise never be exercised: legalActions never emits DECLARE_BLOCK
// and both round-trip suites skip the branch. Registering a synthetic blocker
// through the public registry closes that gap without touching the engine.
const BLOCKER: InstanceId = 'CTEST-B01';

registerCardSet([
  {
    cardId: BLOCKER,
    name: 'Client Test Blocker',
    category: 'character',
    color: 'red',
    cost: 1,
    power: 2000,
    counter: 1000,
    life: 0,
    keywords: ['Blocker'],
  },
]);

// A deck of nothing but blockers makes the opening hand deterministic enough
// to reach a block step without depending on the shuffle.
const BLOCKER_DECK: Decklist = {
  leader: 'TEST-L01',
  cards: Array.from({ length: 50 }, () => BLOCKER),
};

function must(state: GameState, action: Action): GameState {
  const result = applyAction(state, action);
  if (!result.ok) {
    throw new Error(`setup bug: ${action.type} rejected (${result.reason})`);
  }
  return result.state;
}

/** Drives to a block step where the defender controls an active Blocker. */
function blockStepWithBlocker(): { state: GameState; blocker: InstanceId } {
  let state = createGame({
    seed: 5,
    decks: { p1: BLOCKER_DECK, p2: BLOCKER_DECK },
    firstPlayer: 'p1',
  });
  state = must(state, { type: 'MULLIGAN', player: 'p1', accept: false });
  state = must(state, { type: 'MULLIGAN', player: 'p2', accept: false });
  state = must(state, { type: 'END_TURN', player: 'p1' });

  const inHand = state.players.p2.hand[0];
  expect(inHand).toBeDefined();
  state = must(state, { type: 'PLAY_CARD', player: 'p2', instanceId: inHand as InstanceId });
  state = must(state, { type: 'END_TURN', player: 'p2' });

  state = must(state, {
    type: 'DECLARE_ATTACK',
    player: 'p1',
    attacker: state.players.p1.leader,
    target: state.players.p2.leader,
  });

  const blocker = state.players.p2.characters[0];
  expect(blocker).toBeDefined();
  return { state, blocker: blocker as InstanceId };
}

describe('block affordance', () => {
  it('reaches a block step with a blocker the defender controls', () => {
    const { state, blocker } = blockStepWithBlocker();
    expect(state.battle?.step).toBe('block');
    expect(state.priority).toBe('p2');
    expect(state.cards[blocker]?.orientation).toBe('active');
  });

  it('exposes canBlock and only for the blocker', () => {
    const { state, blocker } = blockStepWithBlocker();
    const aff = computeAffordances(state, 'p2');

    expect(aff.byCard[blocker]?.canBlock).toBe(true);
    expect(aff.global.canPass).toBe(true);
    expect(aff.global.canEndTurn).toBe(false);
    // The leader is not a blocker, so it must never offer the affordance.
    expect(aff.byCard[state.players.p2.leader]?.canBlock ?? false).toBe(false);
  });

  it('holds forward: the block affordance yields an action the engine accepts', () => {
    const { state, blocker } = blockStepWithBlocker();
    const aff = computeAffordances(state, 'p2');
    expect(aff.byCard[blocker]?.canBlock).toBe(true);

    const result = applyAction(state, { type: 'DECLARE_BLOCK', player: 'p2', blocker });
    expect(result.ok).toBe(true);
  });

  it('holds backward: every DECLARE_BLOCK offered is reachable from an affordance', () => {
    const { state } = blockStepWithBlocker();
    const aff = computeAffordances(state, 'p2');
    const blocks = legalActions(state, 'p2').filter((a) => a.type === 'DECLARE_BLOCK');

    expect(blocks.length).toBeGreaterThan(0);
    for (const action of blocks) {
      expect(aff.byCard[action.blocker]?.canBlock).toBe(true);
    }
  });
});

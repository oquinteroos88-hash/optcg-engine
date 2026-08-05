import { describe, expect, it } from 'vitest';
import { applyAction } from '@optcg/engine';
import type { Action, GameState } from '@optcg/engine';
import { computeAffordances } from '../src/game/affordances';
import { attachedDonScenario, corpusStates, counterStepScenario, fullBoardScenario } from './corpus';

function expectApplies(state: GameState, action: Action): void {
  const result = applyAction(state, action);
  if (!result.ok) {
    expect.fail(`affordance produced an illegal action ${JSON.stringify(action)}: ${result.reason}`);
  }
}

/** Every true affordance must construct at least one action the engine accepts. */
function assertForward(state: GameState): void {
  const player = state.priority;
  const aff = computeAffordances(state, player);

  if (aff.global.mustAnswerMulligan) {
    expectApplies(state, { type: 'MULLIGAN', player, accept: true });
    expectApplies(state, { type: 'MULLIGAN', player, accept: false });
  }
  if (aff.global.canPass) {
    expectApplies(state, { type: 'PASS', player });
  }
  if (aff.global.canEndTurn) {
    expectApplies(state, { type: 'END_TURN', player });
  }
  if (aff.global.canConcede) {
    expectApplies(state, { type: 'CONCEDE', player });
  }

  for (const [instanceId, card] of Object.entries(aff.byCard)) {
    if (card.canPlay && !card.playRequiresTrash) {
      expectApplies(state, { type: 'PLAY_CARD', player, instanceId });
    }
    if (card.playRequiresTrash) {
      const trashCharacter = card.trashCandidates[0];
      expect(trashCharacter).toBeDefined();
      if (trashCharacter !== undefined) {
        expectApplies(state, { type: 'PLAY_CARD', player, instanceId, trashCharacter });
      }
    }
    if (card.canAttack) {
      const target = card.attackTargets[0];
      expect(target).toBeDefined();
      if (target !== undefined) {
        expectApplies(state, { type: 'DECLARE_ATTACK', player, attacker: instanceId, target });
      }
    }
    if (card.canReceiveDon) {
      expectApplies(state, { type: 'ATTACH_DON', player, to: instanceId, count: 1 });
    }
    if (card.canBlock) {
      expectApplies(state, { type: 'DECLARE_BLOCK', player, blocker: instanceId });
    }
    if (card.canCounter) {
      const target = card.counterTargets[0];
      expect(target).toBeDefined();
      if (target !== undefined) {
        expectApplies(state, { type: 'PLAY_COUNTER', player, instanceId, target });
      }
    }
  }
}

describe('affordances forward soundness', () => {
  it('holds on every state of the random-playout + scenario corpus', { timeout: 120_000 }, () => {
    const states = corpusStates();
    expect(states.length).toBeGreaterThan(500);
    for (const state of states) {
      assertForward(state);
    }
  });

  it('collapses full-board plays into playRequiresTrash + trashCandidates', () => {
    const { state, playable } = fullBoardScenario();
    const aff = computeAffordances(state, 'p1');
    const card = aff.byCard[playable];
    expect(card).toBeDefined();
    expect(card?.canPlay).toBe(true);
    expect(card?.playRequiresTrash).toBe(true);
    expect(card?.trashCandidates).toHaveLength(5);
    expect(new Set(card?.trashCandidates)).toEqual(new Set(state.players.p1.characters));
  });

  it('exposes counter affordances to the defender mid-battle', () => {
    const { state, counterCard } = counterStepScenario();
    expect(state.battle?.step).toBe('counter');
    expect(state.priority).toBe('p2');
    const aff = computeAffordances(state, 'p2');
    expect(aff.global.canPass).toBe(true);
    expect(aff.global.canEndTurn).toBe(false);
    const card = aff.byCard[counterCard];
    expect(card?.canCounter).toBe(true);
    expect(card?.counterTargets).toContain(state.players.p2.leader);
  });

  it('keeps DON attachment sound on a board with attached DON', () => {
    const state = attachedDonScenario();
    const character = state.players.p1.characters[0];
    expect(character).toBeDefined();
    const aff = computeAffordances(state, 'p1');
    if (character !== undefined) {
      expect(aff.byCard[character]?.canReceiveDon).toBe(true);
      expect(state.cards[character]?.attachedDon).toHaveLength(2);
    }
    assertForward(state);
  });
});

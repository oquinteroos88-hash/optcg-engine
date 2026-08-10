import { describe, expect, it } from 'vitest';
import { applyAction } from '@optcg/engine';
import type { Action, ChoiceAnswer, GameState } from '@optcg/engine';
import { computeAffordances } from '../src/game/affordances';
import { attachedDonScenario, corpusStates, counterStepScenario, fullBoardScenario } from './corpus';

function expectApplies(state: GameState, action: Action): void {
  const result = applyAction(state, action);
  if (!result.ok) {
    expect.fail(`affordance produced an illegal action ${JSON.stringify(action)}: ${result.reason}`);
  }
}

/**
 * The smallest answer `pending` admits.
 *
 * Built the way the UI builds one — from `state.pending`, not from
 * `legalActions` — because that is the whole point of the exception: the marker
 * carries no payload, so soundness of `mustAnswerChoice` can only mean "an
 * answer assembled from the published shape is accepted".
 */
function minimalAnswer(state: GameState): ChoiceAnswer {
  const pending = state.pending;
  if (pending === null) {
    throw new Error('test bug: no pending choice');
  }
  switch (pending.kind) {
    case 'yesNo':
      return { kind: 'yesNo', value: false };
    case 'selectOption':
      return { kind: 'option', index: 0 };
    case 'selectCards':
    case 'orderCards':
      return { kind: 'cards', selected: pending.candidates.slice(0, pending.min) };
  }
}

/** Every true affordance must construct at least one action the engine accepts. */
function assertForward(state: GameState): void {
  const player = state.priority;
  const aff = computeAffordances(state, player);

  // PASS is battle-only in the engine: legalActions offers it at the block and
  // counter steps and nowhere else, and those are the only observable states
  // with an open battle. So canPass and an open battle are the same condition,
  // which is why the pass control lives in BattleOverlay and the ActionBar has
  // no generic one.
  //
  // The `pending` half is not a relaxation, it is the same rule stated for a
  // state class the TEST-deck corpus could not produce: an open choice pre-empts
  // the whole action list, battle or no battle, so there is no pass to offer
  // while one is open. The BattleOverlay's button disappears for exactly as
  // long as the choice overlay is up.
  //
  // If this ever fails, the engine has grown a pass outside battle and the UI
  // needs a control it does not have today - add it to ActionBar rather than
  // relaxing this assertion.
  expect(aff.global.canPass).toBe(state.battle !== null && state.pending === null);

  // An open choice is exclusive: it is the only thing its owner can do.
  expect(aff.global.mustAnswerChoice).toBe(state.pending !== null);
  if (aff.global.mustAnswerChoice) {
    expect(state.pending?.player).toBe(player);
    expectApplies(state, {
      type: 'ANSWER_CHOICE',
      player,
      choiceId: state.pending?.id ?? '',
      answer: minimalAnswer(state),
    });
    expect(aff.global.canEndTurn).toBe(false);
    expect(aff.global.mustAnswerMulligan).toBe(false);
    expect(Object.keys(aff.byCard)).toEqual([]);
  }

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
    // A [Counter] Event carries no target: the action is complete without one.
    if (card.canPlayCounterEvent) {
      expectApplies(state, { type: 'PLAY_COUNTER_EVENT', player, instanceId });
    }
    // Every entry of the menu must be playable, not just the first: a card with
    // two activated abilities would otherwise offer one that does not apply.
    expect(card.canActivate).toBe(card.activatableAbilities.length > 0);
    for (const abilityId of card.activatableAbilities) {
      expectApplies(state, { type: 'ACTIVATE_ABILITY', player, instanceId, abilityId });
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

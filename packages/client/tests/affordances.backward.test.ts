import { describe, expect, it } from 'vitest';
import { legalActions } from '@optcg/engine';
import type { GameState } from '@optcg/engine';
import { computeAffordances, EMPTY_AFFORDANCE } from '../src/game/affordances';
import { corpusStates } from './corpus';

/** Every legal action must be reachable through an affordance, modulo collapse. */
function assertBackward(state: GameState): void {
  const player = state.priority;
  const aff = computeAffordances(state, player);
  const byCard = (id: string): typeof EMPTY_AFFORDANCE => aff.byCard[id] ?? EMPTY_AFFORDANCE;

  for (const action of legalActions(state, player)) {
    switch (action.type) {
      case 'MULLIGAN':
        expect(aff.global.mustAnswerMulligan).toBe(true);
        break;
      case 'PLAY_CARD': {
        const card = byCard(action.instanceId);
        expect(card.canPlay).toBe(true);
        if (action.trashCharacter === undefined) {
          expect(card.playRequiresTrash).toBe(false);
        } else {
          expect(card.trashCandidates).toContain(action.trashCharacter);
        }
        break;
      }
      case 'ATTACH_DON':
        // Any count collapses into the single boolean; the UI dispatches count 1.
        expect(byCard(action.to).canReceiveDon).toBe(true);
        break;
      case 'DECLARE_ATTACK': {
        const card = byCard(action.attacker);
        expect(card.canAttack).toBe(true);
        expect(card.attackTargets).toContain(action.target);
        break;
      }
      case 'DECLARE_BLOCK':
        expect(byCard(action.blocker).canBlock).toBe(true);
        break;
      case 'PLAY_COUNTER': {
        const card = byCard(action.instanceId);
        expect(card.canCounter).toBe(true);
        expect(card.counterTargets).toContain(action.target);
        break;
      }
      case 'PASS':
        expect(aff.global.canPass).toBe(true);
        break;
      case 'END_TURN':
        expect(aff.global.canEndTurn).toBe(true);
        break;
      case 'PLAY_COUNTER_EVENT':
        // Its own flag, not counterTargets: this action names no target.
        expect(byCard(action.instanceId).canPlayCounterEvent).toBe(true);
        break;
      case 'ACTIVATE_ABILITY': {
        const card = byCard(action.instanceId);
        expect(card.canActivate).toBe(true);
        expect(card.activatableAbilities).toContain(action.abilityId);
        break;
      }
      case 'ANSWER_CHOICE':
        // The marker carries no answer, so this is all an affordance can say.
        // What a legal answer looks like is read from `state.pending` — the one
        // documented exception, see affordances.ts.
        expect(aff.global.mustAnswerChoice).toBe(true);
        break;
      case 'CONCEDE':
        expect(aff.global.canConcede).toBe(true);
        break;
      default: {
        // Exhaustive on purpose: a new Action variant fails to compile here
        // rather than slipping through an empty branch, which is how
        // PLAY_COUNTER_EVENT went unnoticed. tests/actionCoverage.test.ts is
        // the other half — this one says "somebody wrote a branch", that one
        // says "the corpus actually reached it".
        const never: never = action;
        throw new Error(`unhandled action ${JSON.stringify(never)}`);
      }
    }
  }
}

describe('affordances backward completeness', () => {
  it('covers every legal action on the random-playout + scenario corpus', { timeout: 120_000 }, () => {
    const states = corpusStates();
    expect(states.length).toBeGreaterThan(500);
    for (const state of states) {
      assertBackward(state);
    }
  });
});

import { applyAction } from '@optcg/engine';
import type { GameState, InstanceId } from '@optcg/engine';
import { buildScenario, characterAt, handCard } from '@optcg/engine/testdata/scenarios';
import { playout, starterPlayout } from './driver';

export const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export const MAX_STEPS = 150;

/**
 * Seeds carried over from `packages/cards/tests/game.test.ts`, where they were
 * searched for reaching every scripted ability in ST-01/ST-02 at least once —
 * including the two [Counter] Events, which are the hardest to reach unprompted.
 */
export const STARTER_SEEDS = [20260806, 5, 99, 2, 12, 9, 224] as const;
/** A short second pass answering every selection at its minimum — see AnswerPolicy. */
export const STARTER_MIN_ANSWER_SEEDS = [5, 12] as const;
export const STARTER_MAX_STEPS = 400;

function mustApply(state: GameState, action: Parameters<typeof applyAction>[1]): GameState {
  const result = applyAction(state, action);
  if (!result.ok) {
    throw new Error(`corpus bug: scripted action rejected (${result.reason})`);
  }
  return result.state;
}

/** Full board: playing the hand character requires trashing one of five. */
export function fullBoardScenario(): { state: GameState; playable: InstanceId } {
  const state = buildScenario({
    p1: {
      characters: [
        { cardId: 'TEST-001' },
        { cardId: 'TEST-001' },
        { cardId: 'TEST-002' },
        { cardId: 'TEST-002' },
        { cardId: 'TEST-003' },
      ],
      hand: ['TEST-006'],
      activeDon: 10,
    },
  });
  return { state, playable: handCard(state, 'p1', 'TEST-006') };
}

/** Main phase, battle closed: p1 owns a character that is free to attack. */
export function mainPhaseWithAttacker(): GameState {
  return buildScenario({
    p1: { characters: [{ cardId: 'TEST-005' }], activeDon: 3 },
    p2: { hand: ['TEST-101'], activeDon: 3 },
  });
}

/** Mid-battle counter step: p2 holds a counter-valued card and has priority. */
export function counterStepScenario(): { state: GameState; counterCard: InstanceId } {
  const base = mainPhaseWithAttacker();
  const attacker = characterAt(base, 'p1', 0);
  const target = base.players.p2.leader;
  const afterAttack = mustApply(base, { type: 'DECLARE_ATTACK', player: 'p1', attacker, target });
  // Block step is a real resting state; the defender passes to reach counter.
  const counterStep = mustApply(afterAttack, { type: 'PASS', player: 'p2' });
  return { state: counterStep, counterCard: handCard(counterStep, 'p2', 'TEST-101') };
}

/** A character with DON attached plus spare active DON in the cost area. */
export function attachedDonScenario(): GameState {
  return buildScenario({
    p1: { characters: [{ cardId: 'TEST-003', attachedDon: 2 }], activeDon: 6 },
  });
}

/**
 * Playouts over the real starter decks. Kept separate from `corpusStates` only
 * so a test can talk about them by name; `corpusStates` includes them.
 */
export function starterCorpusStates(): GameState[] {
  const states: GameState[] = [];
  for (const seed of STARTER_SEEDS) {
    states.push(...starterPlayout(seed, STARTER_MAX_STEPS, 'max'));
  }
  for (const seed of STARTER_MIN_ANSWER_SEEDS) {
    states.push(...starterPlayout(seed, STARTER_MAX_STEPS, 'min'));
  }
  return states;
}

/** Random-playout corpus (TEST and starter decks) plus targeted scenarios. */
export function corpusStates(): GameState[] {
  const states: GameState[] = [];
  for (const seed of SEEDS) {
    states.push(...playout(seed, MAX_STEPS));
  }
  states.push(fullBoardScenario().state);
  states.push(counterStepScenario().state);
  states.push(attachedDonScenario());
  states.push(...starterCorpusStates());
  return states;
}

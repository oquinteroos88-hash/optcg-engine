import { applyAction } from '@optcg/engine';
import type { GameState, InstanceId } from '@optcg/engine';
import { buildScenario, characterAt, handCard } from '@optcg/engine/testdata/scenarios';
import { playout, starterPlayout } from './driver';

export const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export const MAX_STEPS = 150;

/**
 * The first four are carried over from `packages/cards/tests/game.test.ts`,
 * where they were searched for reaching every scripted ability in ST-01/ST-02 at
 * least once — including all three [Counter] Events, which are the hardest to
 * reach unprompted and which only became reachable when the driver learned to
 * hold DON!! back.
 *
 * The other four carry no coverage of their own and are here for volume: this
 * corpus also backs `handFan.test.ts`, whose "these are real hands from real
 * games" guard wants more than ten thousand hand cards to be worth asserting.
 *
 * Re-searched three times: once when the driver stopped choosing by index, once
 * when it started declining to attach DON!!, and once when a discard cost began
 * asking which card pays. All three were changes to how a decision is made —
 * adding a card still does not move them, but giving the ST-02 Leader an ability
 * gave the bot a move it did not have.
 */
export const STARTER_SEEDS = [121, 292, 16, 320, 3, 5, 7, 11, 13, 17] as const;
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
    states.push(...starterPlayout(seed, STARTER_MAX_STEPS));
  }
  return states;
}

/**
 * The first state in the starter corpus whose open choice matches `accept`.
 *
 * Real positions rather than hand-built ones: `pending` is written by the
 * interpreter mid-script, and a literal would be a guess about a shape the
 * engine owns.
 */
export function firstPendingState(
  accept: (pending: NonNullable<GameState['pending']>) => boolean,
): GameState {
  for (const seed of STARTER_SEEDS) {
    for (const state of starterPlayout(seed, STARTER_MAX_STEPS)) {
      const pending = state.pending;
      if (pending !== null && accept(pending)) {
        return state;
      }
    }
  }
  throw new Error('corpus bug: no state in the starter playouts opens such a choice');
}

/** The first starter-corpus state matching `accept`. Real positions only. */
export function firstStarterStateWhere(accept: (state: GameState) => boolean): GameState {
  for (const seed of STARTER_SEEDS) {
    for (const state of starterPlayout(seed, STARTER_MAX_STEPS)) {
      if (accept(state)) {
        return state;
      }
    }
  }
  throw new Error('corpus bug: no starter state matches');
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

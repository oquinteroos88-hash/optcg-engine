import { applyAction, assertInvariants } from '@optcg/engine';
import type { Action, ChoiceAnswer, GameEvent, GameState, InstanceId, PlayerId } from '@optcg/engine';
import { buildScenario } from '@optcg/engine/testdata/scenarios';
import type { ScenarioSpec } from '@optcg/engine/testdata/scenarios';
import { registerEnglishCards, ST01_DECK, ST02_DECK, toEngineDecklist } from '../src/index.js';
import {
  OP01_RG_EVERYTHING,
  OP01_RG_LAW,
  OP01_RG_LUFFY,
  assertFixtureDecksAreLegal,
} from './fixtures/op01Decks.js';

// The set has to be in the registry before a decklist naming it can be built.
registerEnglishCards();
// An illegal fixture would surface as "this ability never fired", several files away.
assertFixtureDecksAreLegal();

export const STARTER_DECKS = {
  p1: toEngineDecklist(ST01_DECK),
  p2: toEngineDecklist(ST02_DECK),
};

/** `buildScenario` with the two real starter decks instead of the TEST ones. */
export function starterScenario(spec: Omit<ScenarioSpec, 'decks'> = {}): GameState {
  return buildScenario({ ...spec, decks: STARTER_DECKS });
}

/**
 * The same, with the constructed OP-01 fixture decks.
 *
 * `buildScenario` pulls the cards a spec names out of the deck, so a position
 * can only stage cards the decklist actually contains. That is why the OP-01
 * abilities need their own decks before they can have their own table cases.
 */
/** The deck the hand-built table tests stage from. */
export const OP01_TABLE_DECK = toEngineDecklist(OP01_RG_EVERYTHING);

/** The two decks the manifestation playouts deal from. */
export const OP01_DECKS = {
  p1: toEngineDecklist(OP01_RG_LUFFY),
  p2: toEngineDecklist(OP01_RG_LAW),
};

/**
 * Hand-built OP-01 positions. Both sides use the everything deck, because a
 * scenario can only stage cards its decklist holds and the two manifestation
 * decks split the Events between them.
 */
export function op01Scenario(spec: Omit<ScenarioSpec, 'decks'> = {}): GameState {
  return buildScenario({ ...spec, decks: { p1: OP01_TABLE_DECK, p2: OP01_TABLE_DECK } });
}

export function applyOk(state: GameState, action: Action): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) {
    throw new Error(`applyAction failed (${result.reason}) for ${JSON.stringify(action)}`);
  }
  return { state: result.state, events: result.events };
}

export function run(state: GameState, ...actions: Action[]): GameState {
  let current = state;
  for (const action of actions) current = applyOk(current, action).state;
  return current;
}

/** Answers whatever choice is open, failing loudly when there is none. */
export function answer(state: GameState, player: PlayerId, payload: ChoiceAnswer): GameState {
  const pending = state.pending;
  if (pending === null) {
    throw new Error('expected an open choice');
  }
  if (pending.player !== player) {
    throw new Error(`choice belongs to ${pending.player}, not ${player}`);
  }
  return applyOk(state, { type: 'ANSWER_CHOICE', player, choiceId: pending.id, answer: payload })
    .state;
}

/** Accepts a life card's `[Trigger]`, which is always offered as an opt-in. */
export function optIn(state: GameState, player: PlayerId, value: boolean): GameState {
  return answer(state, player, { kind: 'yesNo', value });
}

/**
 * Nothing left half-resolved and the state still sound. Every table case ends
 * here: a script that stopped in the middle would otherwise pass on the value
 * it happened to have written before it stalled.
 */
export function assertSettled(state: GameState): void {
  if (state.pending !== null) throw new Error(`still asking: ${state.pending.prompt}`);
  if (state.stack.length !== 0) throw new Error(`stack not drained: ${state.stack.length} items`);
  if (state.resume.length !== 0) throw new Error(`resume not drained: ${state.resume.length}`);
  assertInvariants(state);
}

export { characterAt, handCard } from '@optcg/engine/testdata/scenarios';

/** The abilities that actually resolved, in order, with their source. */
export function fired(events: readonly GameEvent[]): Array<{ id: string; source: InstanceId }> {
  const out: Array<{ id: string; source: InstanceId }> = [];
  for (const event of events) {
    if (event.type === 'abilityTriggered') out.push({ id: event.abilityId, source: event.source });
  }
  return out;
}

export function firedIds(events: readonly GameEvent[]): string[] {
  return fired(events).map((entry) => entry.id);
}

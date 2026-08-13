import { applyAction, assertInvariants } from '@optcg/engine';
import type { Action, ChoiceAnswer, GameEvent, GameState, InstanceId, PlayerId } from '@optcg/engine';
import { buildScenario } from '@optcg/engine/testdata/scenarios';
import type { ScenarioSpec } from '@optcg/engine/testdata/scenarios';
import { registerEnglishCards, ST01_DECK, ST02_DECK, toEngineDecklist } from '../src/index.js';
import {
  OP01_BP_CROCODILE,
  OP01_BP_EVERYTHING,
  OP01_B_DOFLAMINGO,
  OP01_BP_KAIDO,
  OP01_G_ODEN,
  OP01_RG_EVERYTHING,
  OP01_RG_LAW,
  OP01_R_ZORO,
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

/** The red/green pair the batch-1 and batch-2 manifestation playouts deal from. */
export const OP01_DECKS = {
  p1: toEngineDecklist(OP01_RG_LUFFY),
  p2: toEngineDecklist(OP01_RG_LAW),
};

/** The blue/purple pair, which batch 3 made buildable for the first time. */
export const OP01_BP_DECKS = {
  p1: toEngineDecklist(OP01_BP_CROCODILE),
  p2: toEngineDecklist(OP01_BP_KAIDO),
};

const OP01_BP_TABLE_DECK = toEngineDecklist(OP01_BP_EVERYTHING);
const OP01_BP_KAIDO_DECK = toEngineDecklist(OP01_BP_KAIDO);
const OP01_ZORO_DECK = toEngineDecklist(OP01_R_ZORO);

/**
 * Mono-red, Zoro-led. The only way to stage OP01-001: a Leader static is live
 * only in a game that Leader is leading.
 */
export function op01ZoroScenario(spec: Omit<ScenarioSpec, 'decks'> = {}): GameState {
  return buildScenario({ ...spec, decks: { p1: OP01_ZORO_DECK, p2: OP01_ZORO_DECK } });
}

/** Zoro against Luffy, for the manifestation of the Leader static. */
export const OP01_ZORO_DECKS = {
  p1: OP01_ZORO_DECK,
  p2: toEngineDecklist(OP01_RG_LUFFY),
};

const OP01_ODEN_DECK = toEngineDecklist(OP01_G_ODEN);
const OP01_DOFFY_DECK = toEngineDecklist(OP01_B_DOFLAMINGO);

/**
 * Mono-blue, Doflamingo-led. The only deck that can reach OP01-060's ability,
 * and the only place a card is played from the *deck* rather than the hand.
 */
export function op01DoflamingoScenario(spec: Omit<ScenarioSpec, 'decks'> = {}): GameState {
  return buildScenario({ ...spec, decks: { p1: OP01_DOFFY_DECK, p2: OP01_DOFFY_DECK } });
}

/** Doflamingo against Crocodile, for the reveal-and-play manifestation. */
export const OP01_DOFFY_DECKS = {
  p1: OP01_DOFFY_DECK,
  p2: toEngineDecklist(OP01_BP_CROCODILE),
};

/**
 * Mono-green, Oden-led. The only deck that can reach `OP01-031`'s activated
 * ability, and the only one holding `OP01-059` in quantity — both pay the same
 * {Land of Wano} price out of the same hand, so the two share a fixture.
 */
export function op01OdenScenario(spec: Omit<ScenarioSpec, 'decks'> = {}): GameState {
  return buildScenario({ ...spec, decks: { p1: OP01_ODEN_DECK, p2: OP01_ODEN_DECK } });
}

/** Oden against Law, for the manifestation of the two filtered-discard cards. */
export const OP01_ODEN_DECKS = {
  p1: OP01_ODEN_DECK,
  p2: toEngineDecklist(OP01_RG_LAW),
};

/**
 * Hand-built blue/purple positions, Crocodile-led so the two type-gated
 * abilities (OP01-079, OP01-089) are live.
 */
export function op01BpScenario(spec: Omit<ScenarioSpec, 'decks'> = {}): GameState {
  return buildScenario({ ...spec, decks: { p1: OP01_BP_TABLE_DECK, p2: OP01_BP_TABLE_DECK } });
}

/**
 * The same, Kaido-led. Only OP01-094 needs it: its gate wants an
 * {Animal Kingdom Pirates} Leader, and Kaido is the one blue/purple Leader with
 * the type.
 */
export function op01KaidoScenario(spec: Omit<ScenarioSpec, 'decks'> = {}): GameState {
  return buildScenario({ ...spec, decks: { p1: OP01_BP_KAIDO_DECK, p2: OP01_BP_KAIDO_DECK } });
}

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

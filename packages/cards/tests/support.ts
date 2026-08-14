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
  OP01_P_KAIDO,
  OP01_G_ODEN,
  OP01_RG_EVERYTHING,
  OP01_RG_LAW,
  OP01_R_ZORO,
  OP01_RG_LUFFY,
  OP01_RG_HEARTS,
  OP01_G_AKAZAYA,
  OP01_BP_PACIFISTA,
  OP01_BP_JACK,
  OP01_G_KANJURO,
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
 * Mono-purple, Kaido-led. The only deck that holds batch 10's eight DON!!-adding
 * cards at a density a random game meets, and the only place `OP01-061`'s own
 * ability can be live — a Leader's trigger only exists in a game that Leader is
 * leading.
 */
export function op01PurpleScenario(spec: Omit<ScenarioSpec, 'decks'> = {}): GameState {
  const deck = toEngineDecklist(OP01_P_KAIDO);
  return buildScenario({ ...spec, decks: { p1: deck, p2: deck } });
}

/** Mono-purple against blue/purple, for the batch-10 manifestation games. */
export const OP01_PURPLE_DECKS = {
  p1: toEngineDecklist(OP01_P_KAIDO),
  p2: toEngineDecklist(OP01_BP_CROCODILE),
};

/**
 * Hand-built blue/purple positions from the **Crocodile** deck rather than the
 * everything deck.
 *
 * One card needs it. `OP01-085` Mr.3 gates on a {Baroque Works} Leader and could
 * not go into `OP01_BP_EVERYTHING` — that deck is exactly 50 and every filler
 * line in it is a body some staged position needs a pair of. This deck is
 * Crocodile-led, so the gate is open, and it is where Mr.3 lives.
 */
export function op01CrocodileScenario(spec: Omit<ScenarioSpec, 'decks'> = {}): GameState {
  const deck = toEngineDecklist(OP01_BP_CROCODILE);
  return buildScenario({ ...spec, decks: { p1: deck, p2: deck } });
}

/**
 * Hand-built OP-01 positions. Both sides use the everything deck, because a
 * scenario can only stage cards its decklist holds and the two manifestation
 * decks split the Events between them.
 */
export function op01Scenario(spec: Omit<ScenarioSpec, 'decks'> = {}): GameState {
  return buildScenario({ ...spec, decks: { p1: OP01_TABLE_DECK, p2: OP01_TABLE_DECK } });
}

/* ------------------------------------------------- reference by name (12) */

const OP01_HEARTS_DECK = toEngineDecklist(OP01_RG_HEARTS);
const OP01_AKAZAYA_DECK = toEngineDecklist(OP01_G_AKAZAYA);
const OP01_PACIFISTA_DECK = toEngineDecklist(OP01_BP_PACIFISTA);

/**
 * Red/green, Law-led. Nine of the twelve name cards, and the **closed** side of
 * the Leader-name gate — Trafalgar Law is not [Kouzuki Oden].
 */
export function op01HeartsScenario(spec: Omit<ScenarioSpec, 'decks'> = {}): GameState {
  return buildScenario({ ...spec, decks: { p1: OP01_HEARTS_DECK, p2: OP01_HEARTS_DECK } });
}

/** Mono-green, Oden-led. The **open** side of the same gate, and nothing else. */
export function op01AkazayaScenario(spec: Omit<ScenarioSpec, 'decks'> = {}): GameState {
  return buildScenario({ ...spec, decks: { p1: OP01_AKAZAYA_DECK, p2: OP01_AKAZAYA_DECK } });
}

/** Blue/purple, Crocodile-led. The inclusion form, and `OP01-099`'s static. */
export function op01PacifistaScenario(spec: Omit<ScenarioSpec, 'decks'> = {}): GameState {
  return buildScenario({ ...spec, decks: { p1: OP01_PACIFISTA_DECK, p2: OP01_PACIFISTA_DECK } });
}

/**
 * The three manifestation pairings, and all three are **mirrors**.
 *
 * Every other batch pairs its new deck against an older one, and says why: an
 * exact union is only exact if it names everything, so the far side's abilities
 * are listed too and a card that stopped firing over there is a regression the
 * file can see. This batch has three decks of its own and no older deck holds
 * any of its cards, so a mirror is the pairing that makes the union *smaller* —
 * it names this batch and its supporting cast and nothing else. The regression
 * cover the mixed pairings buy is already bought here by the other nine
 * fixtures, which this batch did not touch.
 */
export const OP01_HEARTS_DECKS = { p1: OP01_HEARTS_DECK, p2: OP01_HEARTS_DECK };
export const OP01_AKAZAYA_DECKS = { p1: OP01_AKAZAYA_DECK, p2: OP01_AKAZAYA_DECK };
export const OP01_PACIFISTA_DECKS = { p1: OP01_PACIFISTA_DECK, p2: OP01_PACIFISTA_DECK };

/* ------------------------------------------- the player-chosen discard (4) */

const OP01_JACK_DECK = toEngineDecklist(OP01_BP_JACK);
const OP01_KANJURO_DECK = toEngineDecklist(OP01_G_KANJURO);

/** Blue/purple, Kaido-led. `OP01-102`, `OP01-114` and `OP01-088`. */
export function op01JackScenario(spec: Omit<ScenarioSpec, 'decks'> = {}): GameState {
  return buildScenario({ ...spec, decks: { p1: OP01_JACK_DECK, p2: OP01_JACK_DECK } });
}

/** Mono-green, Oden-led. `OP01-038` and the 2-cost bodies its first half wants. */
export function op01KanjuroScenario(spec: Omit<ScenarioSpec, 'decks'> = {}): GameState {
  return buildScenario({ ...spec, decks: { p1: OP01_KANJURO_DECK, p2: OP01_KANJURO_DECK } });
}

export const OP01_JACK_DECKS = { p1: OP01_JACK_DECK, p2: OP01_JACK_DECK };
export const OP01_KANJURO_DECKS = { p1: OP01_KANJURO_DECK, p2: OP01_KANJURO_DECK };

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

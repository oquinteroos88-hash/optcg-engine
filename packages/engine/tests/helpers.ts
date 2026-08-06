import { applyAction, createGame, getOpponent } from '../src/index.js';
import type { Action, GameEvent, GameState, PlayerId } from '../src/index.js';
import { assertInvariants } from '../src/invariants.js';
import { assertSerializationRoundTrip } from '../src/testing/index.js';
import { GREEN_DECK, RED_DECK } from '../src/testdata/decks.js';

export function buildGame(seed = 42, firstPlayer: PlayerId = 'p1'): GameState {
  return createGame({ seed, decks: { p1: RED_DECK, p2: GREEN_DECK }, firstPlayer });
}

// Applies each action, asserting success plus invariants and serializability
// after every step (mirrors the simulation harness).
export function run(state: GameState, ...actions: Action[]): GameState {
  let current = state;
  for (const action of actions) {
    const result = applyAction(current, action);
    if (!result.ok) {
      throw new Error(`applyAction failed (${result.reason}) for ${JSON.stringify(action)}`);
    }
    current = result.state;
    assertInvariants(current);
    assertSerializationRoundTrip(current);
  }
  return current;
}

export function applyOk(
  state: GameState,
  action: Action,
): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) {
    throw new Error(`applyAction failed (${result.reason}) for ${JSON.stringify(action)}`);
  }
  return { state: result.state, events: result.events };
}

export function applyFail(state: GameState, action: Action): string {
  const result = applyAction(state, action);
  if (result.ok) {
    throw new Error(`expected failure but action succeeded: ${JSON.stringify(action)}`);
  }
  return result.reason;
}

// Declines both mulligans in priority order, landing in firstPlayer's turn 1 main.
export function advanceToMain(state: GameState): GameState {
  const first = state.priority;
  const second = getOpponent(first);
  return run(
    state,
    { type: 'MULLIGAN', player: first, accept: false },
    { type: 'MULLIGAN', player: second, accept: false },
  );
}

// Round-trip clone (state is fully serializable) so tests can stage precise
// scenarios; mutations must keep card and DON conservation intact.
export function cloneWith(state: GameState, mutate: (draft: GameState) => void): GameState {
  const clone = JSON.parse(JSON.stringify(state)) as GameState;
  mutate(clone);
  return clone;
}

// Draft stagers for use inside cloneWith. They move instances between zones of
// the same player, so conservation invariants keep holding.

function takeFromDeck(draft: GameState, player: PlayerId, cardId: string): string {
  const deck = draft.players[player].deck;
  const index = deck.findIndex((id) => draft.cards[id]?.cardId === cardId);
  if (index === -1) {
    throw new Error(`no ${cardId} left in ${player} deck`);
  }
  const [id] = deck.splice(index, 1);
  return id as string;
}

export function draftHandCard(draft: GameState, player: PlayerId, cardId: string): string {
  const id = takeFromDeck(draft, player, cardId);
  draft.players[player].hand.push(id);
  return id;
}

export function draftPutCharacter(
  draft: GameState,
  player: PlayerId,
  cardId: string,
  opts: { orientation?: 'active' | 'rested'; playedOnTurn?: number } = {},
): string {
  const id = takeFromDeck(draft, player, cardId);
  draft.players[player].characters.push(id);
  const card = draft.cards[id];
  if (card === undefined) {
    throw new Error(`missing instance ${id}`);
  }
  card.orientation = opts.orientation ?? 'active';
  card.playedOnTurn = opts.playedOnTurn ?? 0;
  return id;
}

// Resets the player's 10 DON: first `active` in cost active, next `rested` in
// cost rested, remainder in the DON deck. Clears any attachments first.
export function draftSetCostDon(
  draft: GameState,
  player: PlayerId,
  active: number,
  rested = 0,
): void {
  for (const id of Object.keys(draft.cards)) {
    const card = draft.cards[id];
    if (card !== undefined && card.controller === player) {
      card.attachedDon = [];
    }
  }
  draft.players[player].don.forEach((don, i) => {
    if (i < active) {
      don.location = { kind: 'cost', orientation: 'active' };
    } else if (i < active + rested) {
      don.location = { kind: 'cost', orientation: 'rested' };
    } else {
      don.location = { kind: 'donDeck' };
    }
  });
}

export function draftAttachDon(
  draft: GameState,
  player: PlayerId,
  donIndex: number,
  to: string,
): void {
  const don = draft.players[player].don[donIndex];
  const card = draft.cards[to];
  if (don === undefined || card === undefined) {
    throw new Error(`bad don index ${donIndex} or target ${to}`);
  }
  don.location = { kind: 'attached', to };
  card.attachedDon.push(don.instanceId);
}

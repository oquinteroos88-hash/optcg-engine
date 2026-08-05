import { freeze } from 'immer';
import { applyAction } from '../applyAction.js';
import { createGame } from '../createGame.js';
import type { CardId, GameState, InstanceId, Orientation, PlayerId } from '../types.js';
import { GREEN_DECK, RED_DECK } from './decks.js';

/**
 * Direct construction of mid-game positions for targeted tests.
 *
 * Random bots reach some rule branches once in a thousand games and others
 * never, so tests that need those positions must build them instead of playing
 * toward them. Everything here moves instances between zones of the same
 * player, so card and DON!! conservation keep holding and the engine's own
 * invariant checks stay meaningful.
 *
 * Uses only the synthetic TEST-xxx set. Deterministic: a fixed default seed and
 * no dependence on execution order.
 */

export interface CharacterSpec {
  cardId: CardId;
  orientation?: Orientation;
  /** Defaults to 0, i.e. played long ago and free to attack. */
  playedOnTurn?: number;
  /** DON!! moved from the cost area onto this character (+1000 power each). */
  attachedDon?: number;
}

export interface SideSpec {
  characters?: CharacterSpec[];
  hand?: CardId[];
  /** Active DON!! in the cost area; the rest stay in the DON!! deck. */
  activeDon?: number;
  /** Trim life to exactly this many cards; the excess goes back to the deck. */
  life?: number;
  /** Replace the hand entirely instead of adding to the dealt one. */
  clearHand?: boolean;
}

export interface ScenarioSpec {
  seed?: number;
  /** Defaults to 3, past the first-player turn-1 attack restriction. */
  turn?: number;
  firstPlayer?: PlayerId;
  p1?: SideSpec;
  p2?: SideSpec;
}

const DEFAULT_SEED = 7;

function takeFromDeck(draft: GameState, player: PlayerId, cardId: CardId): InstanceId {
  const deck = draft.players[player].deck;
  const index = deck.findIndex((id) => draft.cards[id]?.cardId === cardId);
  if (index === -1) {
    throw new Error(`scenario: no ${cardId} left in ${player}'s deck`);
  }
  const [id] = deck.splice(index, 1);
  if (id === undefined) {
    throw new Error(`scenario: failed to take ${cardId} from ${player}'s deck`);
  }
  return id;
}

function applySide(draft: GameState, player: PlayerId, side: SideSpec): void {
  const ps = draft.players[player];

  if (side.clearHand === true) {
    ps.deck.push(...ps.hand);
    ps.hand = [];
  }

  if (side.life !== undefined) {
    while (ps.life.length > side.life) {
      const card = ps.life.pop();
      if (card === undefined) {
        break;
      }
      ps.deck.push(card);
    }
  }

  // DON!! layout before attachments, which consume from the active pool.
  if (side.activeDon !== undefined) {
    ps.don.forEach((don, i) => {
      don.location = i < (side.activeDon ?? 0) ? { kind: 'cost', orientation: 'active' } : { kind: 'donDeck' };
    });
  }

  for (const spec of side.characters ?? []) {
    const id = takeFromDeck(draft, player, spec.cardId);
    const card = draft.cards[id];
    if (card === undefined) {
      throw new Error(`scenario: missing instance ${id}`);
    }
    ps.characters.push(id);
    card.orientation = spec.orientation ?? 'active';
    card.playedOnTurn = spec.playedOnTurn ?? 0;

    let remaining = spec.attachedDon ?? 0;
    for (const don of ps.don) {
      if (remaining === 0) {
        break;
      }
      if (don.location.kind === 'cost' && don.location.orientation === 'active') {
        don.location = { kind: 'attached', to: id };
        card.attachedDon.push(don.instanceId);
        remaining -= 1;
      }
    }
    if (remaining > 0) {
      throw new Error(`scenario: not enough active DON to attach ${spec.attachedDon} to ${spec.cardId}`);
    }
  }

  for (const cardId of side.hand ?? []) {
    ps.hand.push(takeFromDeck(draft, player, cardId));
  }
}

/** Builds a position at the start of `turn`, in the main phase, battle closed. */
export function buildScenario(spec: ScenarioSpec = {}): GameState {
  const firstPlayer: PlayerId = spec.firstPlayer ?? 'p1';
  const start = createGame({
    seed: spec.seed ?? DEFAULT_SEED,
    decks: { p1: RED_DECK, p2: GREEN_DECK },
    firstPlayer,
  });

  // Decline both mulligans to reach 'playing'; this is also what places life.
  let state = start;
  for (const player of [firstPlayer, firstPlayer === 'p1' ? 'p2' : 'p1'] as PlayerId[]) {
    const result = applyAction(state, { type: 'MULLIGAN', player, accept: false });
    if (!result.ok) {
      throw new Error(`scenario: mulligan rejected (${result.reason})`);
    }
    state = result.state;
  }

  const draft = JSON.parse(JSON.stringify(state)) as GameState;
  draft.turn = spec.turn ?? 3;
  draft.activePlayer = firstPlayer;
  draft.priority = firstPlayer;
  if (spec.p1 !== undefined) {
    applySide(draft, 'p1', spec.p1);
  }
  if (spec.p2 !== undefined) {
    applySide(draft, 'p2', spec.p2);
  }
  return freeze(draft, true);
}

/** Instance id of the nth character on a player's board. */
export function characterAt(state: GameState, player: PlayerId, index: number): InstanceId {
  const id = state.players[player].characters[index];
  if (id === undefined) {
    throw new Error(`scenario: ${player} has no character at index ${index}`);
  }
  return id;
}

/** Instance id of the first hand card with the given printed card id. */
export function handCard(state: GameState, player: PlayerId, cardId: CardId): InstanceId {
  const id = state.players[player].hand.find((instanceId) => state.cards[instanceId]?.cardId === cardId);
  if (id === undefined) {
    throw new Error(`scenario: ${player} has no ${cardId} in hand`);
  }
  return id;
}

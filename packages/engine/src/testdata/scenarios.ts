import { freeze } from 'immer';
import { applyAction } from '../applyAction.js';
import { createGame } from '../createGame.js';
import type {
  Action,
  CardId,
  Decklist,
  GameState,
  InstanceId,
  Orientation,
  PlayerId,
} from '../types.js';
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
  /** Card id to place in the stage slot. */
  stage?: CardId;
  hand?: CardId[];
  /** Active DON!! in the cost area; the rest stay in the DON!! deck. */
  activeDon?: number;
  /**
   * Rested DON!! in the cost area, placed after the active ones. Lets a test
   * stage the spent-DON position that an activated ability with no cost cannot
   * create on its own — `giveDon` only ever draws from rested DON!!.
   */
  restedDon?: number;
  /** Trim life to exactly this many cards; the excess goes back to the deck. */
  life?: number;
  /**
   * Replace the life area with these exact cards, top first. Needed for
   * `[Trigger]` tests, where which card damage turns over is the whole point.
   */
  lifeCards?: CardId[];
  /** Replace the hand entirely instead of adding to the dealt one. */
  clearHand?: boolean;
  /**
   * Put these cards on top of the deck, first one topmost.
   *
   * The deck's *order* became a precondition the day an effect looked at it:
   * "look at 5 cards from the top of your deck" is a table case about five
   * named cards, and a shuffled deck makes it a table case about whatever the
   * seed dealt. Applied last, after every other stager has finished taking
   * cards out of the deck, so nothing can push these back down.
   */
  deckTop?: CardId[];
}

export interface ScenarioSpec {
  seed?: number;
  /** Defaults to 3, past the first-player turn-1 attack restriction. */
  turn?: number;
  firstPlayer?: PlayerId;
  /** Defaults to the vanilla RED/GREEN decks. Pass ABIL decks for effects. */
  decks?: Record<PlayerId, Decklist>;
  p1?: SideSpec;
  p2?: SideSpec;
  /**
   * Actions applied after the position is staged, for building a state that
   * rests on an open choice. Each must be accepted, and `expectPending` then
   * asserts the engine really did stop to ask.
   */
  then?: Action[];
  /** Require the built state to rest on an open PendingChoice. */
  expectPending?: boolean;
}

const DEFAULT_SEED = 7;

/**
 * Takes a copy of `cardId` out of the deck, or out of the opening hand if the
 * deck has none left. The hand fallback matters for the ABIL decks, where a
 * card has only two copies and both can easily be dealt away before a scenario
 * asks for one.
 */
function takeFromDeck(draft: GameState, player: PlayerId, cardId: CardId): InstanceId {
  const ps = draft.players[player];
  for (const zone of [ps.deck, ps.hand]) {
    const index = zone.findIndex((id) => draft.cards[id]?.cardId === cardId);
    if (index === -1) {
      continue;
    }
    const [id] = zone.splice(index, 1);
    if (id === undefined) {
      throw new Error(`scenario: failed to take ${cardId} from ${player}`);
    }
    return id;
  }
  throw new Error(`scenario: no ${cardId} left in ${player}'s deck or hand`);
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

  if (side.lifeCards !== undefined) {
    ps.deck.push(...ps.life);
    ps.life = [];
    for (const cardId of side.lifeCards) {
      ps.life.push(takeFromDeck(draft, player, cardId));
    }
  }

  // DON!! layout before attachments, which consume from the active pool: first
  // the active DON!!, then the rested ones, then the DON!! deck.
  if (side.activeDon !== undefined || side.restedDon !== undefined) {
    const active = side.activeDon ?? 0;
    const rested = side.restedDon ?? 0;
    ps.don.forEach((don, i) => {
      if (i < active) {
        don.location = { kind: 'cost', orientation: 'active' };
      } else if (i < active + rested) {
        don.location = { kind: 'cost', orientation: 'rested' };
      } else {
        don.location = { kind: 'donDeck' };
      }
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

  if (side.stage !== undefined) {
    const id = takeFromDeck(draft, player, side.stage);
    ps.stage = id;
    const card = draft.cards[id];
    if (card !== undefined) {
      card.playedOnTurn = 0;
    }
  }

  for (const cardId of side.hand ?? []) {
    ps.hand.push(takeFromDeck(draft, player, cardId));
  }

  // Last, so no later stager can take one of these back out of the deck. They
  // are pulled from wherever they are and re-inserted in the order given.
  if (side.deckTop !== undefined) {
    const ids = side.deckTop.map((cardId) => takeFromDeck(draft, player, cardId));
    ps.deck.unshift(...ids);
  }
}

/** Builds a position at the start of `turn`, in the main phase, battle closed. */
export function buildScenario(spec: ScenarioSpec = {}): GameState {
  const firstPlayer: PlayerId = spec.firstPlayer ?? 'p1';
  const start = createGame({
    seed: spec.seed ?? DEFAULT_SEED,
    decks: spec.decks ?? { p1: RED_DECK, p2: GREEN_DECK },
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

  let built = freeze(draft, true);
  for (const action of spec.then ?? []) {
    const result = applyAction(built, action);
    if (!result.ok) {
      throw new Error(`scenario: staged action rejected (${result.reason})`);
    }
    built = result.state;
  }
  if (spec.expectPending === true && built.pending === null) {
    throw new Error('scenario: expected an open choice, but nothing is pending');
  }
  return built;
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

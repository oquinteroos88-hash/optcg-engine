import { fireTriggers } from '../abilities/triggers.js';
import type { GameEvent } from '../events.js';
import { mark } from '../instrument.js';
import type { CardInstance, GameState, InstanceId, PlayerId } from '../types.js';

// Handlers run on an immer draft; the shapes are identical to GameState.
export function emit(draft: GameState, events: GameEvent[], event: GameEvent): void {
  draft.log.push(event);
  events.push(event);
}

// Validation ran before produce, so a missing instance here is an engine bug.
export function mustGetCard(state: GameState, id: InstanceId): CardInstance {
  const card = state.cards[id];
  if (card === undefined) {
    throw new Error(`Engine bug: missing card instance ${id}`);
  }
  return card;
}

export function finishGame(
  draft: GameState,
  winner: PlayerId,
  endReason: 'lifeOut' | 'deckOut' | 'concede',
  events: GameEvent[],
): void {
  draft.status = 'finished';
  draft.winner = winner;
  draft.endReason = endReason;
  emit(draft, events, { type: 'gameEnded', winner, endReason });
}

export function expireEndOfTurnModifiers(draft: GameState): void {
  draft.modifiers = draft.modifiers.filter((modifier) => modifier.duration !== 'endOfTurn');
}

// DON!! are fungible: rest the first `cost` active cost-area DON in array order.
export function payDonCost(
  draft: GameState,
  player: PlayerId,
  cost: number,
  events: GameEvent[],
): void {
  if (cost <= 0) {
    return;
  }
  let remaining = cost;
  for (const don of draft.players[player].don) {
    if (remaining === 0) {
      break;
    }
    if (don.location.kind === 'cost' && don.location.orientation === 'active') {
      don.location = { kind: 'cost', orientation: 'rested' };
      remaining -= 1;
    }
  }
  if (remaining > 0) {
    throw new Error('Engine bug: not enough active DON at pay time');
  }
  emit(draft, events, { type: 'donPaid', player, count: cost });
}

/**
 * Takes a card off the field without deciding where it goes.
 *
 * Split out of `leaveField` so that a `moveCard` effect can send a character to
 * the hand or the deck through the same DON!!-return and normalization rules a
 * KO uses. Every field exit in the engine still goes through exactly this code.
 */
export function detachFromField(draft: GameState, id: InstanceId, events: GameEvent[]): void {
  const card = mustGetCard(draft, id);
  const controller = card.controller;
  const ps = draft.players[controller];

  let returned = 0;
  for (const donId of card.attachedDon) {
    const don = ps.don.find((d) => d.instanceId === donId);
    if (don === undefined) {
      throw new Error(`Engine bug: attached DON ${donId} not in ${controller}'s DON`);
    }
    don.location = { kind: 'cost', orientation: 'rested' };
    returned += 1;
  }
  if (returned > 0) {
    mark('don.returnedRestedOnLeave');
    emit(draft, events, { type: 'donReturned', player: controller, count: returned, rested: true });
  }

  draft.modifiers = draft.modifiers.filter((modifier) => modifier.target !== id);

  card.orientation = 'active';
  card.attachedDon = [];
  card.playedOnTurn = null;
  card.usedThisTurn = [];

  const characterIndex = ps.characters.indexOf(id);
  if (characterIndex !== -1) {
    ps.characters.splice(characterIndex, 1);
  } else if (ps.stage === id) {
    ps.stage = null;
  } else {
    throw new Error(`Engine bug: ${id} is not on ${controller}'s field`);
  }
}

/**
 * Shared exit path for a card leaving the field *to the trash*. Attached DON!!
 * return to the cost area RESTED. Only a real KO emits the koed event and wakes
 * an [On K.O.] ability; the stageReplaced event is emitted by the caller, which
 * knows the incoming stage.
 */
export function leaveField(
  draft: GameState,
  id: InstanceId,
  cause: 'ko' | 'trashedForRoom' | 'stageReplaced' | 'cost',
  events: GameEvent[],
): void {
  const card = mustGetCard(draft, id);
  const controller = card.controller;
  detachFromField(draft, id, events);
  draft.players[card.owner].trash.unshift(id);

  if (cause === 'ko') {
    emit(draft, events, { type: 'koed', player: controller, instanceId: id });
    // A KO wakes the card's own [On K.O.] ability. It is queued, not run: the
    // effect that caused the KO finishes its script first.
    fireTriggers(draft, 'onKO', [id]);
  } else if (cause === 'trashedForRoom') {
    // Deliberately not a KO, and deliberately no onKO trigger: making room for
    // a 6th character is a discard, which is a different rule.
    emit(draft, events, { type: 'characterTrashedForRoom', player: controller, instanceId: id });
  }
}

/**
 * Pulls a card out of whichever off-field zone holds it. Returns false when it
 * was in none of them, which for a `moveCard` target simply means "no longer
 * where the effect expected it" and is not an error.
 */
export function removeFromNonFieldZone(draft: GameState, id: InstanceId): boolean {
  const card = draft.cards[id];
  if (card === undefined) {
    return false;
  }
  const ps = draft.players[card.owner];
  for (const zone of ['hand', 'deck', 'trash', 'life'] as const) {
    const index = ps[zone].indexOf(id);
    if (index !== -1) {
      ps[zone].splice(index, 1);
      return true;
    }
  }
  return false;
}

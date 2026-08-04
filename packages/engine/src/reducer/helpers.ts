import type { GameEvent } from '../events.js';
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

// Shared exit path for any card leaving the field. Attached DON return to the
// cost area RESTED. Only a real KO emits the koed event; the stageReplaced
// event is emitted by the caller, which knows the incoming stage.
export function leaveField(
  draft: GameState,
  id: InstanceId,
  cause: 'ko' | 'trashedForRoom' | 'stageReplaced',
  events: GameEvent[],
): void {
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
    emit(draft, events, { type: 'donReturned', player: controller, count: returned, rested: true });
  }

  draft.modifiers = draft.modifiers.filter((modifier) => modifier.target !== id);

  card.orientation = 'active';
  card.attachedDon = [];
  card.playedOnTurn = null;

  const characterIndex = ps.characters.indexOf(id);
  if (characterIndex !== -1) {
    ps.characters.splice(characterIndex, 1);
  } else if (ps.stage === id) {
    ps.stage = null;
  } else {
    throw new Error(`Engine bug: ${id} is not on ${controller}'s field`);
  }

  draft.players[card.owner].trash.unshift(id);

  if (cause === 'ko') {
    emit(draft, events, { type: 'koed', player: controller, instanceId: id });
  } else if (cause === 'trashedForRoom') {
    emit(draft, events, { type: 'characterTrashedForRoom', player: controller, instanceId: id });
  }
}

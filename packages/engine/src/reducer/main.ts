import type { GameEvent } from '../events.js';
import { mark } from '../instrument.js';
import { getCardDef } from '../registry.js';
import { getActiveCostDon, isOwnLeaderOrCharacter } from '../selectors.js';
import type { GameState, InstanceId, PlayerId } from '../types.js';
import { REASONS } from './errors.js';
import { emit, leaveField, mustGetCard, payDonCost } from './helpers.js';

const BOARD_LIMIT = 5;

interface PlayCardAction {
  player: PlayerId;
  instanceId: InstanceId;
  trashCharacter?: InstanceId;
}

interface AttachDonAction {
  player: PlayerId;
  to: InstanceId;
  count: number;
}

export function validatePlayCard(state: GameState, action: PlayCardAction): string | null {
  const ps = state.players[action.player];
  if (!ps.hand.includes(action.instanceId)) {
    return REASONS.cardNotInHand;
  }
  const card = state.cards[action.instanceId];
  if (card === undefined) {
    return REASONS.cardNotInHand;
  }
  const def = getCardDef(card.cardId);
  if (def.category !== 'character' && def.category !== 'event' && def.category !== 'stage') {
    return REASONS.unplayableCategory;
  }
  if (getActiveCostDon(state, action.player).length < def.cost) {
    return REASONS.notEnoughDon;
  }
  // The trash choice is required iff a character hits a full board.
  const needsTrash = def.category === 'character' && ps.characters.length >= BOARD_LIMIT;
  if (needsTrash) {
    if (action.trashCharacter === undefined) {
      return REASONS.trashChoiceRequired;
    }
    if (!ps.characters.includes(action.trashCharacter)) {
      return REASONS.invalidTrashChoice;
    }
  } else if (action.trashCharacter !== undefined) {
    return REASONS.trashChoiceNotAllowed;
  }
  return null;
}

export function applyPlayCard(
  draft: GameState,
  action: PlayCardAction,
  events: GameEvent[],
): void {
  const card = mustGetCard(draft, action.instanceId);
  const def = getCardDef(card.cardId);
  const ps = draft.players[action.player];

  payDonCost(draft, action.player, def.cost, events);
  ps.hand = ps.hand.filter((id) => id !== action.instanceId);

  switch (def.category) {
    case 'character': {
      mark('play.character');
      if (action.trashCharacter !== undefined) {
        mark('field.sixthCharacter');
        leaveField(draft, action.trashCharacter, 'trashedForRoom', events);
      }
      ps.characters.push(action.instanceId);
      card.orientation = 'active';
      card.playedOnTurn = draft.turn;
      emit(draft, events, {
        type: 'cardPlayed',
        player: action.player,
        instanceId: action.instanceId,
        cardId: card.cardId,
      });
      return;
    }
    case 'stage': {
      mark('play.stage');
      const oldStage = ps.stage;
      if (oldStage !== null) {
        mark('field.stageReplaced');
        leaveField(draft, oldStage, 'stageReplaced', events);
        emit(draft, events, {
          type: 'stageReplaced',
          player: action.player,
          oldStage,
          newStage: action.instanceId,
        });
      }
      ps.stage = action.instanceId;
      card.orientation = 'active';
      card.playedOnTurn = draft.turn;
      emit(draft, events, {
        type: 'cardPlayed',
        player: action.player,
        instanceId: action.instanceId,
        cardId: card.cardId,
      });
      return;
    }
    case 'event': {
      mark('play.event');
      // No effects in Phase 0: the event resolves to nothing and is trashed.
      emit(draft, events, {
        type: 'cardPlayed',
        player: action.player,
        instanceId: action.instanceId,
        cardId: card.cardId,
      });
      ps.trash.unshift(action.instanceId);
      return;
    }
    case 'leader':
      throw new Error('Engine bug: leader passed PLAY_CARD validation');
  }
}

export function validateAttachDon(state: GameState, action: AttachDonAction): string | null {
  if (!Number.isInteger(action.count) || action.count < 1) {
    return REASONS.invalidCount;
  }
  if (!isOwnLeaderOrCharacter(state, action.player, action.to)) {
    return REASONS.invalidAttachTarget;
  }
  if (getActiveCostDon(state, action.player).length < action.count) {
    return REASONS.notEnoughActiveDon;
  }
  return null;
}

export function applyAttachDon(
  draft: GameState,
  action: AttachDonAction,
  events: GameEvent[],
): void {
  const target = mustGetCard(draft, action.to);
  let remaining = action.count;
  for (const don of draft.players[action.player].don) {
    if (remaining === 0) {
      break;
    }
    if (don.location.kind === 'cost' && don.location.orientation === 'active') {
      don.location = { kind: 'attached', to: action.to };
      target.attachedDon.push(don.instanceId);
      remaining -= 1;
    }
  }
  if (remaining > 0) {
    throw new Error('Engine bug: not enough active DON at attach time');
  }
  mark('don.attached');
  emit(draft, events, {
    type: 'donAttached',
    player: action.player,
    to: action.to,
    count: action.count,
  });
}

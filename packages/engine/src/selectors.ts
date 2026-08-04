import { getCardDef } from './registry.js';
import type { GameState, InstanceId, PlayerId } from './types.js';
import { PLAYER_IDS } from './types.js';

export function getOpponent(player: PlayerId): PlayerId {
  return player === 'p1' ? 'p2' : 'p1';
}

// Power is never stored: printed power + 1000 per attached DON + modifiers.
export function getPower(state: GameState, id: InstanceId): number {
  const card = state.cards[id];
  if (card === undefined) {
    throw new Error(`Unknown instance id: ${id}`);
  }
  let power = getCardDef(card.cardId).power + card.attachedDon.length * 1000;
  for (const modifier of state.modifiers) {
    if (modifier.kind === 'power' && modifier.target === id) {
      power += modifier.value;
    }
  }
  return power;
}

export function getActiveCostDon(state: GameState, player: PlayerId): InstanceId[] {
  const ids: InstanceId[] = [];
  for (const don of state.players[player].don) {
    if (don.location.kind === 'cost' && don.location.orientation === 'active') {
      ids.push(don.instanceId);
    }
  }
  return ids;
}

export function isOnField(state: GameState, id: InstanceId): boolean {
  for (const player of PLAYER_IDS) {
    const ps = state.players[player];
    if (ps.leader === id || ps.stage === id || ps.characters.includes(id)) {
      return true;
    }
  }
  return false;
}

export function isOwnLeaderOrCharacter(
  state: GameState,
  player: PlayerId,
  id: InstanceId,
): boolean {
  const ps = state.players[player];
  return ps.leader === id || ps.characters.includes(id);
}

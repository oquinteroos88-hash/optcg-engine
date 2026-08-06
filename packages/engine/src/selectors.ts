import type { Keyword } from './abilities/dsl.js';
import { PRINTED_KEYWORD } from './abilities/dsl.js';
import { getCardDef } from './registry.js';
import type { GameState, InstanceId, PlayerId } from './types.js';
import { PLAYER_IDS } from './types.js';

export function getOpponent(player: PlayerId): PlayerId {
  return player === 'p1' ? 'p2' : 'p1';
}

/**
 * Power from everything written into the state: printed value, attached DON!!,
 * and power modifiers.
 *
 * Exported because continuous effects are evaluated against it rather than
 * against `getPower`. A `static` ability whose `affects` selector filtered on
 * effective power would ask `getPower` for a card whose effective power that
 * very ability is contributing to, and the two would call each other forever.
 * Base power is the fixed point that breaks it.
 */
export function getBasePower(state: GameState, id: InstanceId): number {
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

/**
 * Effective power. Never stored.
 *
 * Identical to `getBasePower` for now; continuous abilities plug in here.
 */
export function getPower(state: GameState, id: InstanceId): number {
  return getBasePower(state, id);
}

/**
 * The single question the engine asks about keywords: printed keywords plus
 * ones granted by live modifiers. Continuous grants plug in here.
 *
 * Nothing else may read `CardDefinition.keywords` directly — a granted Blocker
 * has to block, and a check against the printed list alone would not see it.
 */
export function hasKeyword(state: GameState, id: InstanceId, keyword: Keyword): boolean {
  const card = state.cards[id];
  if (card === undefined) {
    return false;
  }
  if (getCardDef(card.cardId).keywords.includes(PRINTED_KEYWORD[keyword])) {
    return true;
  }
  for (const modifier of state.modifiers) {
    if (modifier.kind === 'grantKeyword' && modifier.target === id && modifier.keyword === keyword) {
      return true;
    }
  }
  return false;
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

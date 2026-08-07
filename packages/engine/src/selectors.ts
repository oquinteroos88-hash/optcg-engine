import type { AbilityContext, Keyword } from './abilities/dsl.js';
import { PRINTED_KEYWORD } from './abilities/dsl.js';
import { evalCondition, fieldIds, resolveSelector } from './abilities/query.js';
import { mark } from './instrument.js';
import { getAbilities, getCardDef } from './registry.js';
import type { GameState, InstanceId, PlayerId } from './types.js';
import { PLAYER_IDS } from './types.js';

export function getOpponent(player: PlayerId): PlayerId {
  return player === 'p1' ? 'p2' : 'p1';
}

/**
 * Power from everything written into the state: printed value, attached DON!!,
 * and power modifiers. Static grants are not included.
 *
 * This is the reading `forEachStatic` uses for a static's own condition and
 * its `affects` selector. A `static` filtering on effective power would ask
 * `getPower` for a card whose effective power that very ability is
 * contributing to, and the two would call each other forever; this value is
 * the fixed point that breaks the loop. Conditions of non-static abilities and
 * scripts read `getPower` instead — there is no re-entry to guard against
 * there.
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
 * Walks every `static` ability whose source is on the field and whose condition
 * holds, calling `visit` for each one that applies to `id`.
 *
 * This is the whole of the continuous-effect machinery: nothing is written to
 * the state when a card with a static enters or leaves, so nothing has to be
 * cleaned up, recalculated, or kept in sync when it does.
 */
function forEachStatic(
  state: GameState,
  id: InstanceId,
  visit: (grants: { power?: number; keyword?: Keyword }) => void,
): void {
  for (const player of PLAYER_IDS) {
    for (const sourceId of fieldIds(state, player)) {
      const source = state.cards[sourceId];
      if (source === undefined) {
        continue;
      }
      for (const ability of getAbilities(source.cardId)) {
        if (ability.trigger !== 'static' || ability.grants === undefined) {
          continue;
        }
        const ctx: AbilityContext = {
          source: sourceId,
          controller: source.controller,
          vars: {},
        };
        // The guard has a cost here: a static whose own condition asks about
        // power reads the without-statics value, so a gate like OP06-002's
        // "7000 power or more" cannot be opened by another card's continuous
        // effect. Declared divergence — docs/trigger-reachability.md, backlog A.
        if (
          ability.condition !== undefined &&
          !evalCondition(state, ctx, ability.condition, getBasePower)
        ) {
          continue;
        }
        if (ability.affects === undefined) {
          continue;
        }
        if (!resolveSelector(state, ctx, ability.affects, getBasePower).includes(id)) {
          continue;
        }
        visit(ability.grants);
      }
    }
  }
}

/**
 * Effective power. Never stored:
 *
 *   printed + attached DON!! x 1000 + power modifiers + applicable statics
 */
export function getPower(state: GameState, id: InstanceId): number {
  let power = getBasePower(state, id);
  forEachStatic(state, id, (grants) => {
    if (grants.power !== undefined) {
      mark('static.powerApplied');
      power += grants.power;
    }
  });
  return power;
}

/**
 * The single question the engine asks about keywords. Printed keywords, plus
 * ones granted by continuous abilities, plus ones granted by live modifiers.
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
  let granted = false;
  forEachStatic(state, id, (grants) => {
    if (grants.keyword === keyword) {
      mark('static.keywordApplied');
      granted = true;
    }
  });
  return granted;
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

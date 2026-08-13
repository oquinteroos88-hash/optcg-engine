import type { Ability, AbilityContext, Keyword } from './abilities/dsl.js';
import { PRINTED_KEYWORD } from './abilities/dsl.js';
import type { Lens } from './abilities/query.js';
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
 *
 * Named "without statics" rather than "base power" deliberately: the
 * Comprehensive Rules use base power for a value an effect *sets* (4-9-2-1 —
 * when several effects set base power, the highest applies), and the engine
 * will need that name the day a card says "this Character's base power
 * becomes X". This function is not that concept; it is a recursion anchor,
 * not a rules term.
 */
export function getPowerWithoutStatics(state: GameState, id: InstanceId): number {
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
 * Printed keywords plus the ones live modifiers grant. Static grants are not
 * included.
 *
 * `getPowerWithoutStatics`'s twin and, like it, a recursion anchor rather than
 * a rules term: a `Selector` filtering on "[Blocker] Characters" evaluated
 * inside static evaluation would ask `hasKeyword`, which walks the statics it
 * is already inside. This is the fixed point that breaks that loop. Nothing
 * outside `WITHOUT_STATICS` should call it — a granted `[Blocker]` blocks.
 */
export function hasKeywordWithoutStatics(
  state: GameState,
  id: InstanceId,
  keyword: Keyword,
): boolean {
  const card = state.cards[id];
  if (card === undefined) {
    return false;
  }
  if (getCardDef(card.cardId).keywords.includes(PRINTED_KEYWORD[keyword])) {
    return true;
  }
  return state.modifiers.some(
    (modifier) =>
      modifier.kind === 'grantKeyword' && modifier.target === id && modifier.keyword === keyword,
  );
}

/**
 * Walks every `static` ability whose source is on the field and whose condition
 * holds, calling `visit` for each one that applies to `id`.
 *
 * This is the whole of the continuous-effect machinery: nothing is written to
 * the state when a card with a static enters or leaves, so nothing has to be
 * cleaned up, recalculated, or kept in sync when it does.
 */
export function forEachStatic(
  state: GameState,
  id: InstanceId,
  visit: (grants: NonNullable<Ability['grants']>) => void,
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
          !evalCondition(state, ctx, ability.condition, WITHOUT_STATICS)
        ) {
          continue;
        }
        const affects = ability.affects;
        if (affects === undefined) {
          continue;
        }
        // `{self: true}` needs no selector pass at all — the source is the one
        // card it names — which also keeps it clear of the `getPowerWithoutStatics`
        // recursion anchor a selector would ride through.
        const applies =
          'self' in affects
            ? id === sourceId
            : resolveSelector(state, ctx, affects.selector, WITHOUT_STATICS).includes(id);
        if (!applies) {
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
  let power = getPowerWithoutStatics(state, id);
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
  if (hasKeywordWithoutStatics(state, id, keyword)) {
    return true;
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

/**
 * The reading every caller outside static evaluation uses: what a card's power
 * and keywords actually are right now.
 */
export const EFFECTIVE: Lens = { power: getPower, keyword: hasKeyword };

/**
 * The reading `forEachStatic` uses on its own conditions and `affects`
 * selectors, and the only place it belongs. Both members are recursion anchors;
 * see `getPowerWithoutStatics` and `hasKeywordWithoutStatics`.
 *
 * The guard has a cost, and it is declared: a static whose own gate asks about
 * power or a keyword cannot have that gate opened by another card's continuous
 * effect. Declared divergence — docs/trigger-reachability.md, backlog A.
 */
export const WITHOUT_STATICS: Lens = {
  power: getPowerWithoutStatics,
  keyword: hasKeywordWithoutStatics,
};

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

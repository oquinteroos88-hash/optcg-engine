import type { Ability, AbilityContext, Keyword } from './abilities/dsl.js';
import { KEYWORDS as KEYWORD_LIST, PRINTED_KEYWORD } from './abilities/dsl.js';
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
  if (printedKeywords(card.cardId).has(keyword)) {
    return true;
  }
  return state.modifiers.some(
    (modifier) =>
      modifier.kind === 'grantKeyword' && modifier.target === id && modifier.keyword === keyword,
  );
}

/**
 * The keywords printed on a card, as a set.
 *
 * Keyed on the definition **object**, not on the card id: a test that
 * re-registers a set replaces the definitions, and a memo keyed on the id
 * would answer for the previous registration. The printed list itself never
 * changes — that is what makes it memoizable at all, and what keeps this a
 * lookup rather than a reading of the rules.
 */
const printedKeywordCache = new WeakMap<object, Set<Keyword>>();

function printedKeywords(cardId: string): Set<Keyword> {
  const def = getCardDef(cardId);
  const cached = printedKeywordCache.get(def);
  if (cached !== undefined) {
    return cached;
  }
  const set = new Set<Keyword>();
  for (const keyword of KEYWORD_LIST) {
    if (def.keywords.includes(PRINTED_KEYWORD[keyword])) {
      set.add(keyword);
    }
  }
  printedKeywordCache.set(def, set);
  return set;
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
  visit: (grants: NonNullable<Ability['grants']>, ctx: AbilityContext) => void,
): void {
  for (const live of liveStatics(state)) {
    // `{self: true}` needs no selector pass at all — the source is the one
    // card it names — which also keeps it clear of the `getPowerWithoutStatics`
    // recursion anchor a selector would ride through.
    const applies = live.audience === null ? id === live.ctx.source : live.audience.has(id);
    if (applies) {
      visit(live.grants, live.ctx);
    }
  }
}

interface LiveStatic {
  ctx: AbilityContext;
  grants: NonNullable<Ability['grants']>;
  /** The cards it reaches, or null for a `{self: true}` static. */
  audience: Set<InstanceId> | null;
}

const liveStaticsCache = new WeakMap<GameState, LiveStatic[]>();

/**
 * Every static in force on this board, with its audience already resolved.
 *
 * Neither the gate nor the audience depends on **which card is asking** — a
 * static's condition is about its own source and its `affects` selector is
 * about the board — so both were being recomputed once per asker for an answer
 * that could not change. Harmless while callers asked about one card at a
 * time; `playerView` asks about every card it publishes, and the repetition
 * became the client's timeout.
 *
 * Same predicates, same lens, same order — only hoisted out of the per-card
 * loop and memoized on the state, which is exact because states are frozen and
 * replaced rather than mutated.
 */
function liveStatics(state: GameState): LiveStatic[] {
  const cached = liveStaticsCache.get(state);
  if (cached !== undefined) {
    return cached;
  }
  const live: LiveStatic[] = [];
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
        live.push({
          ctx,
          grants: ability.grants,
          audience:
            'self' in affects
              ? null
              : new Set(resolveSelector(state, ctx, affects.selector, WITHOUT_STATICS)),
        });
      }
    }
  }
  liveStaticsCache.set(state, live);
  return live;
}

/**
 * Everything the continuous effects grant one card, walked **once**.
 *
 * The three questions a board asks about a card — its power, its cost, its
 * keywords — used to walk the statics once each, and `hasKeyword` once per
 * keyword on top of that: seven passes over both fields to describe one card.
 * That was invisible while the only caller asked about a card at a time, and
 * stopped being invisible the day `playerView` started describing **every**
 * card it publishes. The client's clicked-through full game went from 2.7s to
 * 8.1s against a 5s budget, which is how it was found.
 *
 * So the walk happens once and all three read the result. It is the same
 * traversal with three accumulators rather than three traversals — one
 * implementation of "what does this static do to this card", which is what
 * matters: the alternative that was rejected was an inverted loop in
 * `playerView` accumulating grants itself, which would have been the rule
 * written down a second time.
 *
 * Memoized by state identity, exact because engine states are frozen and
 * replaced rather than mutated.
 */
interface StaticGrants {
  power: number;
  cost: number;
  keywords: Set<Keyword>;
}

const staticGrantsCache = new WeakMap<GameState, Map<InstanceId, StaticGrants>>();

function staticGrantsFor(state: GameState, id: InstanceId): StaticGrants {
  let perState = staticGrantsCache.get(state);
  if (perState === undefined) {
    perState = new Map();
    staticGrantsCache.set(state, perState);
  }
  const cached = perState.get(id);
  if (cached !== undefined) {
    return cached;
  }
  const grantsFor: StaticGrants = { power: 0, cost: 0, keywords: new Set() };
  forEachStatic(state, id, (grants, ctx) => {
    if (grants.power !== undefined) {
      mark('static.powerApplied');
      grantsFor.power += grants.power;
    }
    if (grants.powerPer !== undefined) {
      // "+X power for every N cards …" — counted at read time, so the answer
      // follows the board without anything being written down. The count runs
      // through `WITHOUT_STATICS` like every other selector a static evaluates,
      // which is the same anchor `affects` rides and the reason a counting
      // selector cannot start a recursion here.
      const { of, value, per } = grants.powerPer;
      const matched = resolveSelector(state, ctx, of, WITHOUT_STATICS).length;
      // Complete groups only. CR 8-4-4 and the printed "for every 2" both
      // describe groups, and a partial group is not one — a single Event in the
      // trash is worth nothing to `OP01-083`.
      const groups = Math.floor(matched / (per ?? 1));
      if (groups > 0) {
        mark('static.powerPerApplied');
        grantsFor.power += groups * value;
      }
    }
    if (grants.cost !== undefined) {
      mark('static.costApplied');
      grantsFor.cost += grants.cost;
    }
    if (grants.keyword !== undefined) {
      mark('static.keywordApplied');
      grantsFor.keywords.add(grants.keyword);
    }
  });
  perState.set(id, grantsFor);
  return grantsFor;
}

/**
 * Effective power. Never stored:
 *
 *   printed + attached DON!! x 1000 + power modifiers + applicable statics
 */
export function getPower(state: GameState, id: InstanceId): number {
  return getPowerWithoutStatics(state, id) + staticGrantsFor(state, id).power;
}

/**
 * **What a card costs to play right now** — printed, plus every applicable
 * continuous grant.
 *
 * `getPower`'s third sibling, and it exists for the reason that one does: a cost
 * that effects can change has to be asked through one function, or the places
 * that read it drift. There were **six** of them before this — `legalActions`
 * offering a play and offering a `[Counter]` Event, and the validate/pay pair in
 * each of the two reducers — and every one read `CardDefinition.cost` straight.
 * Unifying them was the work; the grant itself is four lines.
 *
 * **Floored once, at the boundary.** CR 1-3-6-2: a cost "may become a negative
 * value only for the duration of that calculation. Outside of such calculations,
 * the cost of a card whose value becomes negative is treated as being 0" — and
 * CR 1-3-6-2-1 keeps that negative in play for further arithmetic. So the sum
 * runs signed and `Math.max(0, …)` applies once at the end. Clamping per grant
 * would read a 1-cost card under two −1s and a +3 as 3 instead of 2.
 *
 * Leaders have no cost (CR 2-7-5) and the registry stores 0 for them; nothing
 * asks this about a Leader, and if it did the answer would be 0 either way.
 */
export function getCost(state: GameState, id: InstanceId): number {
  const card = state.cards[id];
  if (card === undefined) {
    throw new Error(`Unknown instance id: ${id}`);
  }
  const cost = getCardDef(card.cardId).cost + staticGrantsFor(state, id).cost;
  return Math.max(0, cost);
}

/**
 * The single question the engine asks about keywords. Printed keywords, plus
 * ones granted by continuous abilities, plus ones granted by live modifiers.
 *
 * Nothing else may read `CardDefinition.keywords` directly — a granted Blocker
 * has to block, and a check against the printed list alone would not see it.
 */
export function hasKeyword(state: GameState, id: InstanceId, keyword: Keyword): boolean {
  return (
    hasKeywordWithoutStatics(state, id, keyword) ||
    staticGrantsFor(state, id).keywords.has(keyword)
  );
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

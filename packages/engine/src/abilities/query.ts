import { getCardDef } from '../registry.js';
import type { GameState, InstanceId, PlayerId } from '../types.js';
import { PLAYER_IDS } from '../types.js';
import type {
  AbilityContext,
  CardPredicate,
  Condition,
  Keyword,
  PlayerRef,
  Ref,
  Selector,
} from './dsl.js';
import { KO_BY_BATTLE, KO_CAUSE_VAR } from './dsl.js';

/**
 * Reading side of the DSL: selectors, refs and conditions. Pure — nothing here
 * writes to the state.
 *
 * The two board-state readings come in as parameters rather than being
 * imported. That is the recursion guard for continuous effects: `getPower` has
 * to evaluate every `static` ability's condition and `affects` selector, and if
 * those filtered on *effective* power they would call `getPower` again on the
 * same card and never bottom out. Static evaluation therefore passes the
 * without-statics reading — and only static evaluation. Scripts and the
 * conditions of non-static abilities pass the effective one: a card has one
 * power value, made higher or lower than printed by effects (Comprehensive
 * Rules 2-6-3), an activation condition is met or not against that value as it
 * stands (8-4-1-1), and the Damage Step compares "the power" of the same card
 * (7-1-4-1). A condition that asks about power asks about the same magnitude
 * everything else reads.
 *
 * `keyword` joined `power` here the day `CardPredicate` gained a keyword
 * filter, and it had to: `hasKeyword` walks the same statics `getPower` does,
 * so a selector reading "[Blocker] Characters" evaluated *inside* static
 * evaluation would re-enter it on the same card. One anchor per readable
 * property, bundled so a third cannot be added without noticing the two that
 * are already there.
 */
export interface Lens {
  power: (state: GameState, id: InstanceId) => number;
  keyword: (state: GameState, id: InstanceId, keyword: Keyword) => boolean;
}

export function opponentOf(player: PlayerId): PlayerId {
  return player === 'p1' ? 'p2' : 'p1';
}

function resolvePlayerRef(ctx: AbilityContext, ref: PlayerRef): PlayerId {
  return ref === 'you' ? ctx.controller : opponentOf(ctx.controller);
}

/** Leader, then characters in board order, then stage. */
export function fieldIds(state: GameState, player: PlayerId): InstanceId[] {
  const ps = state.players[player];
  const ids: InstanceId[] = [ps.leader, ...ps.characters];
  if (ps.stage !== null) {
    ids.push(ps.stage);
  }
  return ids;
}

function ownersFor(ctx: AbilityContext, owner: Selector['owner']): PlayerId[] {
  switch (owner) {
    case 'you':
      return [ctx.controller];
    case 'opponent':
      return [opponentOf(ctx.controller)];
    case 'any':
      // Fixed order, never "controller first": the same selector must produce
      // the same list regardless of who is asking.
      return [...PLAYER_IDS];
  }
}

function zoneIds(state: GameState, player: PlayerId, selector: Selector): InstanceId[] {
  const ps = state.players[player];
  switch (selector.zone) {
    case 'field':
      return fieldIds(state, player);
    case 'hand':
      return [...ps.hand];
    case 'trash':
      return [...ps.trash];
    case 'life':
      return [...ps.life];
    case 'deckTop':
      return ps.deck.slice(0, selector.count ?? 1);
  }
}

/**
 * Whether one card satisfies a predicate, with no question of where it is.
 *
 * Exported because a legality rule tests a candidate the caller already holds —
 * the card trying to block, the card being attacked — and has no zone to walk.
 * `resolveSelector` is this plus a place to look, which is the whole difference
 * between the two types.
 */
export function matchesPredicate(
  state: GameState,
  predicate: CardPredicate,
  id: InstanceId,
  lens: Lens,
): boolean {
  const card = state.cards[id];
  if (card === undefined) {
    return false;
  }
  const def = getCardDef(card.cardId);
  if (predicate.category !== undefined && !predicate.category.includes(def.category)) {
    return false;
  }
  if (predicate.colors !== undefined && !predicate.colors.includes(def.color)) {
    return false;
  }
  if (predicate.types !== undefined) {
    const types = def.types ?? [];
    if (!predicate.types.some((wanted) => types.includes(wanted))) {
      return false;
    }
  }
  if (predicate.costMax !== undefined && def.cost > predicate.costMax) {
    return false;
  }
  if (predicate.costMin !== undefined && def.cost < predicate.costMin) {
    return false;
  }
  if (predicate.powerMax !== undefined && lens.power(state, id) > predicate.powerMax) {
    return false;
  }
  if (predicate.powerMin !== undefined && lens.power(state, id) < predicate.powerMin) {
    return false;
  }
  // Orientation is only meaningful on the field; off-field cards are normalized
  // to 'active', so filtering elsewhere would silently match everything.
  if (predicate.orientation !== undefined && card.orientation !== predicate.orientation) {
    return false;
  }
  // Through `hasKeyword`, never the printed list: a granted [Blocker] is a
  // [Blocker] Character.
  if (predicate.keyword !== undefined && !lens.keyword(state, id, predicate.keyword)) {
    return false;
  }
  return true;
}

function matches(
  state: GameState,
  ctx: AbilityContext,
  selector: Selector,
  id: InstanceId,
  lens: Lens,
): boolean {
  if (selector.excludeSelf === true && id === ctx.source) {
    return false;
  }
  return matchesPredicate(state, selector, id, lens);
}

export function resolveSelector(
  state: GameState,
  ctx: AbilityContext,
  selector: Selector,
  lens: Lens,
): InstanceId[] {
  const found: InstanceId[] = [];
  for (const player of ownersFor(ctx, selector.owner)) {
    for (const id of zoneIds(state, player, selector)) {
      if (matches(state, ctx, selector, id, lens)) {
        found.push(id);
      }
    }
  }
  return found;
}

/** Ids a `var` holds. Scalars are not card references and yield nothing. */
function idsFromVar(ctx: AbilityContext, name: string): InstanceId[] {
  const value = ctx.vars[name];
  if (Array.isArray(value)) {
    return [...value];
  }
  if (typeof value === 'string') {
    return [value];
  }
  return [];
}

export function resolveRef(
  state: GameState,
  ctx: AbilityContext,
  ref: Ref,
  lens: Lens,
): InstanceId[] {
  if ('self' in ref) {
    return [ctx.source];
  }
  if ('var' in ref) {
    return idsFromVar(ctx, ref.var);
  }
  if ('battle' in ref) {
    const battle = state.battle;
    if (battle === null) {
      return [];
    }
    return [ref.battle === 'attacker' ? battle.attacker : battle.target];
  }
  if ('minus' in ref) {
    // Order-preserving, and the order is the one `of` produced: for
    // `lookAt`-then-take that is deck order, top first, which is what the
    // ordering choice should offer the player.
    const removed = new Set(resolveRef(state, ctx, ref.minus.without, lens));
    return resolveRef(state, ctx, ref.minus.of, lens).filter((id) => !removed.has(id));
  }
  return resolveSelector(state, ctx, ref.selector, lens);
}

export function evalCondition(
  state: GameState,
  ctx: AbilityContext,
  condition: Condition,
  lens: Lens,
): boolean {
  switch (condition.kind) {
    case 'donAttached': {
      // `[DON!! xN]` asks how many DON!! are attached. It is never paid, which
      // is why it lives here and not in Cost.
      const card = state.cards[ctx.source];
      return card !== undefined && card.attachedDon.length >= condition.min;
    }
    case 'isYourTurn':
      return state.activePlayer === ctx.controller;
    case 'lifeAtMost':
      return state.players[resolvePlayerRef(ctx, condition.player)].life.length <= condition.value;
    case 'countCards': {
      const count = resolveSelector(state, ctx, condition.selector, lens).length;
      if (condition.min !== undefined && count < condition.min) {
        return false;
      }
      if (condition.max !== undefined && count > condition.max) {
        return false;
      }
      return true;
    }
    case 'varTrue':
      return ctx.vars[condition.name] === true;
    case 'koCause': {
      // Nothing seeded it means this is not an `onKO` frame at all, so there is
      // no cause and the answer is no — never a throw. A condition that fails
      // silently is the DSL's rule for every other kind here.
      const cause = ctx.vars[KO_CAUSE_VAR];
      if (typeof cause !== 'string') {
        return false;
      }
      if (condition.by === KO_BY_BATTLE) {
        return cause === KO_BY_BATTLE;
      }
      // A battle K.O. answers `false` to both player readings rather than
      // defaulting to one of them: CR 10-2-1-3 puts "by an effect" and "due to
      // the result of a battle" on opposite sides of an `or`, so a battle is
      // nobody's effect.
      return cause === resolvePlayerRef(ctx, condition.by);
    }
    case 'and':
      return condition.of.every((sub) => evalCondition(state, ctx, sub, lens));
    case 'or':
      return condition.of.some((sub) => evalCondition(state, ctx, sub, lens));
  }
}

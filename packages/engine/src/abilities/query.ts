import { getCardDef } from '../registry.js';
import type { GameState, InstanceId, PlayerId } from '../types.js';
import { PLAYER_IDS } from '../types.js';
import type { AbilityContext, Condition, PlayerRef, Ref, Selector } from './dsl.js';

/**
 * Reading side of the DSL: selectors, refs and conditions. Pure — nothing here
 * writes to the state.
 *
 * Power comes in as a parameter rather than being imported. That is the
 * recursion guard for continuous effects: `getPower` has to evaluate every
 * `static` ability's `affects` selector, and if that selector filtered on
 * *effective* power it would call `getPower` again on the same card and never
 * bottom out. Continuous evaluation therefore passes base power; scripts, which
 * cannot be re-entered this way, pass the full one.
 */
export type PowerFn = (state: GameState, id: InstanceId) => number;

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

function matches(
  state: GameState,
  ctx: AbilityContext,
  selector: Selector,
  id: InstanceId,
  powerOf: PowerFn,
): boolean {
  const card = state.cards[id];
  if (card === undefined) {
    return false;
  }
  if (selector.excludeSelf === true && id === ctx.source) {
    return false;
  }
  const def = getCardDef(card.cardId);
  if (selector.category !== undefined && !selector.category.includes(def.category)) {
    return false;
  }
  if (selector.colors !== undefined && !selector.colors.includes(def.color)) {
    return false;
  }
  if (selector.types !== undefined) {
    const types = def.types ?? [];
    if (!selector.types.some((wanted) => types.includes(wanted))) {
      return false;
    }
  }
  if (selector.costMax !== undefined && def.cost > selector.costMax) {
    return false;
  }
  if (selector.costMin !== undefined && def.cost < selector.costMin) {
    return false;
  }
  if (selector.powerMax !== undefined && powerOf(state, id) > selector.powerMax) {
    return false;
  }
  if (selector.powerMin !== undefined && powerOf(state, id) < selector.powerMin) {
    return false;
  }
  // Orientation is only meaningful on the field; off-field cards are normalized
  // to 'active', so filtering elsewhere would silently match everything.
  if (selector.orientation !== undefined && card.orientation !== selector.orientation) {
    return false;
  }
  return true;
}

export function resolveSelector(
  state: GameState,
  ctx: AbilityContext,
  selector: Selector,
  powerOf: PowerFn,
): InstanceId[] {
  const found: InstanceId[] = [];
  for (const player of ownersFor(ctx, selector.owner)) {
    for (const id of zoneIds(state, player, selector)) {
      if (matches(state, ctx, selector, id, powerOf)) {
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
  powerOf: PowerFn,
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
  return resolveSelector(state, ctx, ref.selector, powerOf);
}

export function evalCondition(
  state: GameState,
  ctx: AbilityContext,
  condition: Condition,
  powerOf: PowerFn,
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
      const count = resolveSelector(state, ctx, condition.selector, powerOf).length;
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
    case 'and':
      return condition.of.every((sub) => evalCondition(state, ctx, sub, powerOf));
    case 'or':
      return condition.of.some((sub) => evalCondition(state, ctx, sub, powerOf));
  }
}

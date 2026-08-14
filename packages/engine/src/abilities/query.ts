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
 * **The single question the engine asks about card names**, and the only place
 * allowed to read `CardDefinition.name`.
 *
 * A question rather than a getter, and the shape is `hasKeyword`'s for
 * `hasKeyword`'s reason: what the rules define is not "this card's name" but
 * *whether a card answers to a name*. CR 2-1-3 says why in one sentence — "As an
 * exception, some cards get card names from their text. Treat these cards as if
 * they have this name by default, including during deck construction and when in
 * secret areas." That is the **alias**, and it is additive: every one of the
 * eight cards in the game that prints it says "**Also** treat this card's name
 * as [X]", and `EB04-038` adds *two* at once ("also treat this card's name as
 * [Trafalgar Law] **and** [Donquixote Rosinante]"), so that card answers to
 * three names at the same time. A `cardName(state, id): string` returning one
 * value cannot hold that, and every caller comparing against it would have to
 * change on the day the alias is built — which is precisely the hunt this
 * function exists to prevent.
 *
 * So the alias, when it is built, is **one addition here** and nothing else
 * moves: whatever grants the extra name is consulted after the printed one
 * fails. Today there is only the printed one. It is spelled out rather than left
 * implicit because the census that commissioned this field
 * (`docs/op01-closing-census.md`) found the failure mode first: build the filter
 * without a seam for the alias and `OP01-121` Yamato's only printed line stops
 * meaning anything, silently, with no test failing.
 *
 * The alias has two siblings the same sentence covers — CR 2-4-4 for types and
 * CR 2-5-7 for attributes, word for word — so `types` in `matchesPredicate` has
 * the same latent hole. Recorded here rather than fixed: no card in scope prints
 * a granted type.
 *
 * **Exact match, and that is the printed form.** CR 2-1-2-1 defines a second,
 * *substring* form — "Some text will include part of a card name in " "
 * quotation marks" — and **exactly one card in the entire game prints it**
 * (`OP16-015`, "If your Leader's card name includes "Ace""). One asker and no
 * second is a declared row by this project's standard, not a capability.
 *
 * Not a `Lens` member, unlike `power` and `keyword`. Those two are anchors
 * against a recursion that exists — a selector filtering on power, evaluated
 * inside static evaluation, asks `getPower` for a card that evaluation is
 * computing. A name reads off the definition and re-enters nothing. If the alias
 * ever arrives as a `static` grant, that is the day this needs an anchor and the
 * day to add one.
 */
export function hasName(state: GameState, id: InstanceId, name: string): boolean {
  const card = state.cards[id];
  if (card === undefined) {
    return false;
  }
  return getCardDef(card.cardId).name === name;
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
  // Every colour the card has, not just the first printed one. CR 2-3-5 treats a
  // multi-colour card as "a card of every color they possess", so a red/green
  // card answers yes to a red filter and to a green one. Unobservable today —
  // all 68 two-colour cards in the game are Leaders, and no filter names a
  // Leader by colour — which is why it was right by accident before and is right
  // on purpose now.
  if (
    predicate.colors !== undefined &&
    !colorsOf(state, id).some((color) => predicate.colors?.includes(color) === true)
  ) {
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
  // Through `hasName`, never `def.name`, so the day a card's name is more than
  // the printed one there is a single place that learns it. The two lists are
  // conjunctive and independent: `names` is an *or* over acceptable names,
  // `excludeNames` disqualifies outright, and a card naming both must satisfy
  // both.
  if (predicate.names !== undefined && !predicate.names.some((want) => hasName(state, id, want))) {
    return false;
  }
  if (predicate.excludeNames?.some((want) => hasName(state, id, want)) === true) {
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

/**
 * Whether `id` shares no colour with any card `name` holds.
 *
 * CR 2-3-5: "cards with multiple colors ... are treated as a card of every color
 * they possess", so a red/green card *is* red — and against a red reference it
 * is therefore not of a different colour. `rules.differentColorMeansNoSharedColor`
 * false takes the other reading, whole-set inequality.
 *
 * A variable naming nothing excludes nothing: there is no colour to differ from,
 * and an "up to 1" answered with nothing must not silently empty the next
 * selector. That is rule 1 of the interpreter applied to a filter.
 */
function differsInColor(
  state: GameState,
  ctx: AbilityContext,
  name: string,
  id: InstanceId,
): boolean {
  const card = state.cards[id];
  if (card === undefined) {
    return false;
  }
  const mine = colorsOf(state, id);
  for (const other of idsFromVar(ctx, name)) {
    const theirs = colorsOf(state, other);
    if (theirs.length === 0) {
      continue;
    }
    const shares = mine.some((color) => theirs.includes(color));
    const identical = mine.length === theirs.length && mine.every((c) => theirs.includes(c));
    if (state.rules.differentColorMeansNoSharedColor ? shares : identical) {
      return false;
    }
  }
  return true;
}

/** Every colour a card possesses. `colors` when the data has it, else `color`. */
function colorsOf(state: GameState, id: InstanceId): string[] {
  const card = state.cards[id];
  if (card === undefined) {
    return [];
  }
  const def = getCardDef(card.cardId);
  return def.colors === undefined ? [def.color] : [...def.colors];
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
  if (
    selector.differentColorFrom !== undefined &&
    !differsInColor(state, ctx, selector.differentColorFrom, id)
  ) {
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
export function idsFromVar(ctx: AbilityContext, name: string): InstanceId[] {
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
    case 'donOnField': {
      // Every DON!! that is not still in the DON!! deck. CR 3-1-2 makes the cost
      // area part of the field and CR 6-5-5-1 leaves a *given* DON!! on the card
      // it was given to, so both count; CR 4-4-2 makes given DON!! neither
      // active nor rested, which is why nothing here filters on orientation.
      //
      // A flat read of `location`, with no `Lens` and no re-entry: DON!! carry no
      // abilities, so this is safe to evaluate inside static evaluation — which
      // `OP01-109` Who's.Who does on every power lookup.
      const count = state.players[ctx.controller].don.filter(
        (don) => don.location.kind !== 'donDeck',
      ).length;
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
    case 'selfOrientation': {
      // On-field only. `detachFromField` normalizes a leaving card to active,
      // so a source in the trash would otherwise report an orientation it does
      // not have — and every printed card in this family is a permanent effect
      // read off the board, where "not on the field" and "not applying" are the
      // same answer.
      // Asked through `fieldIds` rather than `selectors.isOnField`, which says
      // the same thing: `selectors.ts` already imports this module, so reaching
      // back for it would close a cycle for one membership test.
      const card = state.cards[ctx.source];
      if (card === undefined || !fieldIds(state, card.controller).includes(ctx.source)) {
        return false;
      }
      return card.orientation === condition.orientation;
    }
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
    case 'varMatches': {
      // Every id the variable holds has to match, and an empty variable does
      // not: "if the revealed card is an Event" is a question about a card, and
      // no card is not an Event.
      const ids = idsFromVar(ctx, condition.name);
      if (ids.length === 0) {
        return false;
      }
      return ids.every((id) => matchesPredicate(state, condition.match, id, lens));
    }
    case 'not':
      // The same lens goes down, which is what keeps a negated power condition
      // riding PR #31's anchor instead of finding its own way around it.
      return !evalCondition(state, ctx, condition.of, lens);
    case 'and':
      return condition.of.every((sub) => evalCondition(state, ctx, sub, lens));
    case 'or':
      return condition.of.some((sub) => evalCondition(state, ctx, sub, lens));
  }
}

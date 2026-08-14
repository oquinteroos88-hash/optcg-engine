import { EFFECTIVE, getActiveCostDon, isOnField } from '../selectors.js';
import type { GameState, InstanceId, PlayerId } from '../types.js';
import type { AbilityContext, Cost } from './dsl.js';
import { resolveSelector } from './query.js';

/**
 * Payability only — pure, no mutation. Payment lives in the interpreter, which
 * is the only module allowed to write to the state.
 *
 * A cost is a price that is paid and can fail; `[DON!! xN]` is a Condition, not
 * a cost, and is nowhere near this file.
 */

export function costAreaCount(state: GameState, player: PlayerId): number {
  return state.players[player].don.filter((don) => don.location.kind === 'cost').length;
}

/**
 * The hand cards that may pay one `discardHand` cost, in hand order.
 *
 * Exported because two callers need exactly the same list and must not disagree
 * about it: `canPayCosts` counts it to decide whether the ability is offered at
 * all, and the interpreter offers it as the candidates of the choice. A filter
 * applied in one place and not the other would produce an ability that
 * `legalActions` promises and the payment cannot honour.
 */
export function discardCandidates(
  state: GameState,
  ctx: AbilityContext,
  cost: Extract<Cost, { kind: 'discardHand' }>,
): InstanceId[] {
  // Zone and owner are the cost's own, never the card's to write: "trash N
  // card(s) from *your* hand".
  return resolveSelector(state, ctx, { ...cost.filter, zone: 'hand', owner: 'you' }, EFFECTIVE);
}

/**
 * True when every cost in the list can be paid together.
 *
 * Costs are never paid halfway, so this checks the whole list against the
 * shared pools at once rather than one cost at a time. `restDon` is paid first
 * and `returnDon` prefers already-rested DON!!, so the DON!! requirement is
 * `restTotal` active plus `restTotal + returnTotal` in the cost area overall.
 *
 * The hand is checked twice over, and both checks are needed. Each
 * `discardHand` entry needs enough cards matching *its own* filter, or the
 * choice it opens would have nothing legal in it; and the entries together need
 * enough cards overall, or two costs would each count the same card.
 */
export function canPayCosts(
  state: GameState,
  ctx: AbilityContext,
  costs: readonly Cost[] | undefined,
): boolean {
  if (costs === undefined || costs.length === 0) {
    return true;
  }
  let restTotal = 0;
  let returnTotal = 0;
  let handTotal = 0;
  let characterTotal = 0;
  let activeCharacterTotal = 0;
  let lifeTotal = 0;
  let trashSelf = false;
  let restSelf = false;
  for (const cost of costs) {
    switch (cost.kind) {
      case 'restDon':
        restTotal += cost.count;
        break;
      case 'returnDon':
        returnTotal += cost.count;
        break;
      case 'discardHand':
        handTotal += cost.count;
        if (discardCandidates(state, ctx, cost).length < cost.count) {
          return false;
        }
        break;
      // Shares the hand pool with `discardHand` and is counted into the same
      // total: two costs that each take from the hand must not both count the
      // same card, which is the reason that total exists at all.
      case 'bottomDeckHand':
        handTotal += cost.count;
        break;
      case 'returnCharacters':
        characterTotal += cost.count;
        break;
      // Its own pool, because only an **active** Character can pay it —
      // `restSelf`'s rule applied to somebody else's card. A rested Character is
      // still a Character a `returnCharacters` could take, so the two totals are
      // deliberately separate rather than one "characters" number.
      case 'restCharacters':
        activeCharacterTotal += cost.count;
        break;
      case 'lifeToHand':
        lifeTotal += cost.count;
        break;
      case 'trashSelf':
        trashSelf = true;
        break;
      case 'restSelf':
        restSelf = true;
        break;
    }
  }
  if (state.players[ctx.controller].characters.length < characterTotal) {
    return false;
  }
  if (activeCharacterTotal > 0) {
    const active = state.players[ctx.controller].characters.filter(
      (id) => state.cards[id]?.orientation === 'active',
    ).length;
    if (active < activeCharacterTotal) {
      return false;
    }
  }
  // CR 1-2-1-1-1 makes the defeat condition "0 Life cards **and** your Leader
  // takes damage", so paying down to zero is legal and only the payment itself
  // has to be possible. A player with one Life card may spend it.
  if (state.players[ctx.controller].life.length < lifeTotal) {
    return false;
  }
  if (getActiveCostDon(state, ctx.controller).length < restTotal) {
    return false;
  }
  if (costAreaCount(state, ctx.controller) < restTotal + returnTotal) {
    return false;
  }
  if (state.players[ctx.controller].hand.length < handTotal) {
    return false;
  }
  if (trashSelf && !isOnField(state, ctx.source)) {
    return false;
  }
  // The only cost whose price is the source's own orientation. A card that is
  // already rested has no resting left to do, so the cost cannot be paid and the
  // ability is not activatable (CR 8-3-1-3) — the same rule that stops a rested
  // card attacking (CR 7-1-1-1). `legalActions` calls this function, so the gate
  // shows up in the enumeration and not only in `applyAction`.
  if (restSelf) {
    const source = state.cards[ctx.source];
    if (source === undefined || !isOnField(state, ctx.source) || source.orientation !== 'active') {
      return false;
    }
  }
  return true;
}

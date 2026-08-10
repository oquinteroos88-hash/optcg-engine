import { getActiveCostDon, isOnField } from '../selectors.js';
import type { GameState, PlayerId } from '../types.js';
import type { AbilityContext, Cost } from './dsl.js';

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
 * True when every cost in the list can be paid together.
 *
 * Costs are never paid halfway, so this checks the whole list against the
 * shared pools at once rather than one cost at a time. `restDon` is paid first
 * and `returnDon` prefers already-rested DON!!, so the DON!! requirement is
 * `restTotal` active plus `restTotal + returnTotal` in the cost area overall.
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
  let discardTotal = 0;
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
        discardTotal += cost.count;
        break;
      case 'trashSelf':
        trashSelf = true;
        break;
      case 'restSelf':
        restSelf = true;
        break;
    }
  }
  if (getActiveCostDon(state, ctx.controller).length < restTotal) {
    return false;
  }
  if (costAreaCount(state, ctx.controller) < restTotal + returnTotal) {
    return false;
  }
  if (state.players[ctx.controller].hand.length < discardTotal) {
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

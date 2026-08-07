import { canPayCosts } from '../abilities/costs.js';
import type { AbilityContext } from '../abilities/dsl.js';
import { evalCondition } from '../abilities/query.js';
import { enqueue, makeStackItem } from '../abilities/triggers.js';
import type { GameEvent } from '../events.js';
import { mark } from '../instrument.js';
import { getAbilities } from '../registry.js';
import { getPower, isOnField } from '../selectors.js';
import type { GameState, InstanceId, PlayerId } from '../types.js';
import { REASONS } from './errors.js';

interface ActivateAbilityAction {
  player: PlayerId;
  instanceId: InstanceId;
  abilityId: string;
}

/**
 * Main-phase activated abilities.
 *
 * The Phase 2A brief lists only ANSWER_CHOICE as a new action, but it also
 * requires `activateMain` abilities to be gated by cost in `legalActions` —
 * which presupposes an action that carries one. This is that action; without it
 * the `activateMain` trigger would be unreachable from any input.
 */
export function validateActivateAbility(
  state: GameState,
  action: ActivateAbilityAction,
): string | null {
  const card = state.cards[action.instanceId];
  if (card === undefined || card.controller !== action.player || !isOnField(state, action.instanceId)) {
    return REASONS.abilitySourceNotOnField;
  }
  const ability = getAbilities(card.cardId).find((a) => a.id === action.abilityId);
  if (ability === undefined) {
    return REASONS.unknownAbility;
  }
  if (ability.trigger !== 'activateMain') {
    return REASONS.abilityNotActivatable;
  }
  if (ability.oncePerTurn === true && card.usedThisTurn.includes(ability.id)) {
    return REASONS.abilityAlreadyUsed;
  }
  const ctx: AbilityContext = { source: action.instanceId, controller: action.player, vars: {} };
  // Conditions read the power a card has now, statics included (CR 2-6-3,
  // 8-4-1-1). The without-statics reading belongs to static evaluation only.
  if (
    ability.condition !== undefined &&
    !evalCondition(state, ctx, ability.condition, getPower)
  ) {
    return REASONS.abilityConditionUnmet;
  }
  if (!canPayCosts(state, ctx, ability.cost)) {
    return REASONS.abilityCostUnpayable;
  }
  return null;
}

export function applyActivateAbility(
  draft: GameState,
  action: ActivateAbilityAction,
  _events: GameEvent[],
): void {
  const card = draft.cards[action.instanceId];
  if (card === undefined) {
    throw new Error('Engine bug: missing source after ACTIVATE_ABILITY validation');
  }
  const ability = getAbilities(card.cardId).find((a) => a.id === action.abilityId);
  if (ability === undefined) {
    throw new Error('Engine bug: unknown ability after ACTIVATE_ABILITY validation');
  }
  mark('ability.activated');
  // Costs are paid by the interpreter when the item starts, not here: an
  // optional ability that the player then declines must not have been charged.
  enqueue(draft, [makeStackItem(action.instanceId, action.player, ability, false)]);
}

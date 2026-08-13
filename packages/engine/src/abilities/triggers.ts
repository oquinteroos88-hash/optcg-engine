import { mark } from '../instrument.js';
import { getAbilities } from '../registry.js';
import { getPower } from '../selectors.js';
import type { GameState, InstanceId, PlayerId, StackItem } from '../types.js';
import { PLAYER_IDS } from '../types.js';
import { canPayCosts } from './costs.js';
import type { Ability, AbilityContext, Trigger } from './dsl.js';
import { evalCondition, fieldIds } from './query.js';

/**
 * Turning a game event into stack items.
 *
 * Nothing here executes anything: it decides *whether* an ability fires and in
 * *what order*, and leaves the running to the interpreter.
 */

/**
 * Every card on the field, in the order simultaneous triggers resolve:
 * the turn player's cards first, then by board position (leader, characters in
 * board order, stage).
 *
 * TODO phase 2B: order chosen by the turn player. The official rules let the
 * turn player order simultaneous triggers; a fixed deterministic order is used
 * here so replays stay stable until there is a way to ask.
 */
export function orderedFieldSources(state: GameState): InstanceId[] {
  const first = state.activePlayer;
  const second = first === 'p1' ? 'p2' : 'p1';
  return [...fieldIds(state, first), ...fieldIds(state, second)];
}

export function ownedFieldSources(state: GameState, player: PlayerId): InstanceId[] {
  return fieldIds(state, player);
}

/**
 * Tells both fields that an Event card was activated.
 *
 * Called from the two places an Event can be used from hand — the `[Main]`
 * route in `applyPlayCard` and the `[Counter]` route in
 * `applyPlayCounterEvent` — because CR 8-5-2 defines card activation as "using
 * an Event card from your hand" and says nothing about which phase.
 *
 * **Called after the Event's own effect has been queued, never before.**
 * CR 8-6-3: an effect whose activation timing is fulfilled by activating a card
 * "can be activated after the resolution of the effect of the previously
 * activated card". `enqueue` puts new items *underneath* what is already on the
 * stack, so firing the Event first and the watchers second is what produces
 * that order — and firing them the other way round would invert it.
 */
export function fireEventActivated(draft: GameState, activator: PlayerId): void {
  fireTriggers(draft, 'whenActivatingEvent', ownedFieldSources(draft, activator));
  fireTriggers(
    draft,
    'whenOpponentActivatesEvent',
    ownedFieldSources(draft, activator === 'p1' ? 'p2' : 'p1'),
  );
}

export function makeStackItem(
  source: InstanceId,
  controller: PlayerId,
  ability: Ability,
  forceOptional: boolean,
): StackItem {
  return {
    abilityId: ability.id,
    source,
    controller,
    // 'optIn' means the controller still has to say yes. The state machine
    // lives on the item rather than in a side queue so that an optional
    // ability keeps its place in the resolution order.
    status: ability.optional === true || forceOptional ? 'optIn' : 'ready',
    costsPaid: 0,
    cursor: [{ path: [], index: 0, loop: null }],
    vars: {},
  };
}

/**
 * Puts items on the stack so they resolve *after* whatever is resolving now.
 *
 * The stack is LIFO, so a plain push would cut in front of the running script.
 * Newly triggered effects go directly underneath it instead: the current script
 * finishes, pops, and the first of these is next.
 */
export function enqueue(draft: GameState, items: readonly StackItem[]): void {
  const insertAt = draft.stack.length > 0 ? draft.stack.length - 1 : 0;
  // Reversed, because the stack runs from the top: after the current script
  // pops, the next item up is items[0].
  draft.stack.splice(insertAt, 0, ...[...items].reverse());
}

function canFire(
  state: GameState,
  ctx: AbilityContext,
  ability: Ability,
  sourceId: InstanceId,
): boolean {
  if (ability.trigger === 'static') {
    return false;
  }
  if (ability.oncePerTurn === true) {
    const card = state.cards[sourceId];
    if (card !== undefined && card.usedThisTurn.includes(ability.id)) {
      return false;
    }
  }
  // Conditions read the power a card has now, statics included (CR 2-6-3,
  // 8-4-1-1). The without-statics reading belongs to static evaluation only.
  if (ability.condition !== undefined && !evalCondition(state, ctx, ability.condition, getPower)) {
    return false;
  }
  // Costs are checked before the ability fires at all: an ability whose price
  // cannot be met does not trigger, and is never paid halfway.
  return canPayCosts(state, ctx, ability.cost);
}

/**
 * Collects every ability on `sources` that answers to `trigger` and may fire,
 * in resolution order.
 */
export function collectTriggers(
  state: GameState,
  trigger: Trigger,
  sources: readonly InstanceId[],
): StackItem[] {
  const items: StackItem[] = [];
  for (const sourceId of sources) {
    const card = state.cards[sourceId];
    if (card === undefined) {
      continue;
    }
    for (const ability of getAbilities(card.cardId)) {
      if (ability.trigger !== trigger) {
        continue;
      }
      const ctx: AbilityContext = { source: sourceId, controller: card.controller, vars: {} };
      if (!canFire(state, ctx, ability, sourceId)) {
        continue;
      }
      // A life card's [Trigger] is always the player's option, whether or not
      // the ability itself is written as "you may".
      items.push(makeStackItem(sourceId, card.controller, ability, trigger === 'trigger'));
    }
  }
  return items;
}

export function fireTriggers(
  draft: GameState,
  trigger: Trigger,
  sources: readonly InstanceId[],
): void {
  const items = collectTriggers(draft, trigger, sources);
  if (items.length === 0) {
    return;
  }
  if (draft.stack.length > 0) {
    // Fired from inside a running script: the new effect waits its turn rather
    // than cutting in, which is the rule most likely to be silently wrong.
    mark('trigger.chained');
  }
  enqueue(draft, items);
}

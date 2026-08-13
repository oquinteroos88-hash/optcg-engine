import { mark } from '../instrument.js';
import { getAbilities } from '../registry.js';
import { EFFECTIVE } from '../selectors.js';
import type { GameState, InstanceId, PlayerId, StackItem } from '../types.js';
import { PLAYER_IDS } from '../types.js';
import { canPayCosts } from './costs.js';
import type { Ability, AbilityContext, Trigger, VarValue } from './dsl.js';
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
 * One fact, two triggers, **one door.**
 *
 * Four families in this engine are printed from both sides of the same happening
 * — an Event activated, a Character K.O.'d, a `[Blocker]` activated, a Character
 * played — and each names the two sides with two different trigger words. This
 * is the only place that decides what order those two words go in, so there is
 * one answer to check rather than four to keep in step.
 *
 * The answer is the one PR #30 wrote and this only names: **the side the fact
 * happened to goes first, and the watchers on the other field go underneath.**
 * `enqueue` inserts below whatever is running, so the first call here resolves
 * first. CR 8-6-3 is why the watchers wait at all — an effect whose timing is
 * fulfilled by another card's activation "can be activated after the resolution
 * of the effect of the previously activated card" — and CR 8-6-1's turn-player
 * ordering is what `orderedFieldSources` gives *within* each side's list.
 *
 * **Where 8-6-1 and this convention can disagree, and why nothing is invented to
 * settle it.** When the acting side is the non-turn player, 8-6-1 read strictly
 * would put the turn player's watchers first. PR #30 chose actor-first, four
 * families now depend on it, and the choice is deterministic and documented —
 * so this centralises it instead of quietly running a second rule beside it.
 * Changing it is one edit here, and it would be a rules change with a
 * measurable effect on every replay, not a refactor.
 */
export function fireSidedTriggers(
  draft: GameState,
  actor: { trigger: Trigger; sources: readonly InstanceId[] },
  watchers: { trigger: Trigger; sources: readonly InstanceId[] },
): number {
  fireTriggers(draft, actor.trigger, actor.sources);
  return fireTriggers(draft, watchers.trigger, watchers.sources);
}

/**
 * Tells both fields that an Event card was activated.
 *
 * Called from the two places an Event can be used from hand — the `[Main]`
 * route in `applyPlayCard` and the `[Counter]` route in
 * `applyPlayCounterEvent` — because CR 8-5-2 defines card activation as "using
 * an Event card from your hand" and says nothing about which phase.
 *
 * **Called after the Event's own effect has been queued, never before**, which
 * is `fireSidedTriggers`' rule and the reason that function exists.
 */
export function fireEventActivated(draft: GameState, activator: PlayerId): void {
  fireSidedTriggers(
    draft,
    { trigger: 'whenActivatingEvent', sources: ownedFieldSources(draft, activator) },
    {
      trigger: 'whenOpponentActivatesEvent',
      sources: ownedFieldSources(draft, activator === 'p1' ? 'p2' : 'p1'),
    },
  );
}

/**
 * Tells the attacker's field that the defender activated `[Blocker]`.
 *
 * The blocker's own `[On Block]` goes first and the four cards that watch for
 * the activation go underneath, which is the same door every other sided fact
 * comes through. The *act* observed is the declaration, not CR 7-1-2-2's
 * retargeting that follows it — see the trigger's own note in the DSL, and
 * `canActivateBlocker`, which forbids the very same act.
 */
export function fireBlockerActivated(
  draft: GameState,
  blocker: InstanceId,
  defender: PlayerId,
): void {
  const woke = fireSidedTriggers(
    draft,
    { trigger: 'onBlock', sources: [blocker] },
    {
      trigger: 'whenOpponentActivatesBlocker',
      sources: ownedFieldSources(draft, defender === 'p1' ? 'p2' : 'p1'),
    },
  );
  if (woke > 0) {
    mark('trigger.opponentActivatesBlocker');
  }
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
  if (ability.condition !== undefined && !evalCondition(state, ctx, ability.condition, EFFECTIVE)) {
    return false;
  }
  // Costs are checked before the ability fires at all: an ability whose price
  // cannot be met does not trigger, and is never paid halfway.
  return canPayCosts(state, ctx, ability.cost);
}

/**
 * Collects every ability on `sources` that answers to `trigger` and may fire,
 * in resolution order.
 *
 * `seed` is what the *fact* knows and the ability cannot look up — today only
 * the cause of a K.O. It goes into the condition's context as well as onto the
 * stack item, because a `koCause` condition has to be answerable at `canFire`
 * time: an `[On K.O.]` that only wakes for the opponent's effect must not fire
 * at all when a battle killed it, and an ability filtered out after firing is a
 * different thing from one that never fired.
 */
export function collectTriggers(
  state: GameState,
  trigger: Trigger,
  sources: readonly InstanceId[],
  seed: Readonly<Record<string, VarValue>> = {},
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
      const ctx: AbilityContext = {
        source: sourceId,
        controller: card.controller,
        vars: { ...seed },
      };
      if (!canFire(state, ctx, ability, sourceId)) {
        continue;
      }
      // A life card's [Trigger] is always the player's option, whether or not
      // the ability itself is written as "you may".
      const item = makeStackItem(sourceId, card.controller, ability, trigger === 'trigger');
      item.vars = { ...seed };
      items.push(item);
    }
  }
  return items;
}

/**
 * Returns how many abilities actually woke, which is not the same question as
 * how many times the fact happened. The four prose families each have a mark for
 * the fact and a mark for the observer, and a run that reaches the first with
 * the second at zero is a deck with nobody watching — not a wiring bug. Without
 * a return value the two are indistinguishable.
 */
export function fireTriggers(
  draft: GameState,
  trigger: Trigger,
  sources: readonly InstanceId[],
  seed: Readonly<Record<string, VarValue>> = {},
): number {
  const items = collectTriggers(draft, trigger, sources, seed);
  if (items.length === 0) {
    return 0;
  }
  if (draft.stack.length > 0) {
    // Fired from inside a running script: the new effect waits its turn rather
    // than cutting in, which is the rule most likely to be silently wrong.
    mark('trigger.chained');
  }
  enqueue(draft, items);
  return items.length;
}

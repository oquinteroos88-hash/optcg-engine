import { describe, expect, it } from 'vitest';
import type { Action, GameState } from '@optcg/engine';
import { cardAffordance, computeAffordances } from '../src/game/affordances';
import { menuOptions } from '../src/game/uiMode';
import { STARTER_MAX_STEPS, STARTER_SEEDS } from './corpus';
import { starterPlayoutSteps } from './driver';

/**
 * "Every scripted ability is executable from the UI", per ability.
 *
 * `fullGame.test.ts` proves a player can play a whole game by clicking; what a
 * random clicker happens to reach in a few games is a matter of draws, not of
 * what the UI can express. This asks the sharper question instead: take the
 * real games that DO fire each ability, find the move that fired it, and check
 * that the UI would have offered exactly that move.
 *
 * "Would have offered" means: the click a player makes produces this action.
 * For a menu-driven action that is an entry of `menuOptions`; for an answer it
 * is the published `pendingChoice` admitting that answer. Anything else — an
 * action the engine allows but no click can build — is an ability that exists
 * only in the tests, which is the exact gap this phase closes.
 */

/** Can a player produce this action by clicking? Same mapping the store uses. */
function uiCanProduce(state: GameState, action: Action): string | null {
  const aff = computeAffordances(state, state.priority);
  switch (action.type) {
    case 'ACTIVATE_ABILITY': {
      const options = menuOptions(aff, action.instanceId);
      return options.some(
        (option) => option.kind === 'activate' && option.abilityId === action.abilityId,
      )
        ? null
        : 'no menu entry activates this ability';
    }
    case 'PLAY_COUNTER_EVENT':
      return cardAffordance(aff, action.instanceId).canPlayCounterEvent
        ? null
        : 'the card offers no [Counter] Event play';
    case 'PLAY_CARD':
      return cardAffordance(aff, action.instanceId).canPlay ? null : 'the card is not playable';
    case 'DECLARE_ATTACK': {
      const card = cardAffordance(aff, action.attacker);
      return card.canAttack && card.attackTargets.includes(action.target)
        ? null
        : 'the attacker cannot reach that target';
    }
    case 'PLAY_COUNTER': {
      const card = cardAffordance(aff, action.instanceId);
      return card.canCounter && card.counterTargets.includes(action.target)
        ? null
        : 'the counter cannot reach that target';
    }
    case 'ANSWER_CHOICE': {
      const choice = aff.pendingChoice;
      if (choice === null || choice.id !== action.choiceId) {
        return 'no choice is published for this answer';
      }
      const answer = action.answer;
      if (answer === undefined) {
        return 'the marker carries no answer';
      }
      if (answer.kind === 'yesNo') {
        return choice.kind === 'yesNo' ? null : 'a yes/no answer to a card selection';
      }
      if (answer.kind === 'cards') {
        if (answer.selected.length < choice.min || answer.selected.length > choice.max) {
          return 'the selection is outside the published cardinality';
        }
        return answer.selected.every((id) => choice.candidates.includes(id))
          ? null
          : 'the selection names a card that is not a published candidate';
      }
      return 'an option answer, which the UI does not build';
    }
    case 'END_TURN':
      return aff.global.canEndTurn ? null : 'the turn cannot be ended';
    case 'PASS':
      return aff.global.canPass ? null : 'there is no pass control';
    case 'MULLIGAN':
      return aff.global.mustAnswerMulligan ? null : 'no mulligan is being asked';
    case 'ATTACH_DON':
      return cardAffordance(aff, action.to).canReceiveDon ? null : 'the card takes no DON!!';
    case 'DECLARE_BLOCK':
      return cardAffordance(aff, action.blocker).canBlock ? null : 'the card cannot block';
    case 'CONCEDE':
      return aff.global.canConcede ? null : 'there is no concede control';
  }
}

/** The abilities the scripted set contains that emit an event when they fire. */
const FIRING_ABILITIES = [
  'ST01-001-main',
  'ST01-005-whenAttacking',
  'ST01-007-main',
  'ST01-011-onPlay',
  'ST01-014-counter',
  'ST01-014-trigger',
  'ST01-015-main',
  'ST01-015-trigger',
  'ST01-017-main',
  'ST02-008-whenAttacking',
  'ST02-009-onPlay',
  'ST02-013-endOfTurn',
  'ST02-015-counter',
  'ST02-015-trigger',
  'ST02-016-counter',
] as const;

interface Firing {
  action: Action;
  reason: string | null;
}

describe('every scripted ability is reachable through the UI', () => {
  // The move that fired each ability, the first time a real game fired it.
  const firstFiring = new Map<string, Firing>();
  for (const seed of STARTER_SEEDS) {
    for (const step of starterPlayoutSteps(seed, STARTER_MAX_STEPS)) {
      for (const event of step.events) {
        if (event.type !== 'abilityTriggered' || firstFiring.has(event.abilityId)) {
          continue;
        }
        firstFiring.set(event.abilityId, {
          action: step.action,
          reason: uiCanProduce(step.before, step.action),
        });
      }
    }
  }

  it('sees every one of them fire in an unstaged game', () => {
    expect([...firstFiring.keys()].sort()).toEqual([...FIRING_ABILITIES].sort());
  });

  it('offers the move that fires it as an affordance, for every one', () => {
    const unreachable = [...firstFiring.entries()]
      .filter(([, firing]) => firing.reason !== null)
      .map(([id, firing]) => `${id}: ${firing.action.type} — ${firing.reason ?? ''}`)
      .sort();
    expect(unreachable).toEqual([]);
  });

  it('names the kind of move each ability is reached by', () => {
    // Documentation with teeth: an ability that changes how it is reached — an
    // activated ability becoming an [On Play], say — shows up here rather than
    // silently changing what the UI has to support.
    const byKind: Record<string, string[]> = {};
    for (const [id, firing] of firstFiring) {
      (byKind[firing.action.type] ??= []).push(id);
    }
    for (const ids of Object.values(byKind)) {
      ids.sort();
    }
    expect(byKind).toEqual({
      // Activated Main abilities: the contextual menu is the only way in.
      ACTIVATE_ABILITY: ['ST01-001-main', 'ST01-007-main', 'ST01-017-main'],
      // Playing the card is what fires it — [On Play], and the Event's main half.
      PLAY_CARD: ['ST01-011-onPlay', 'ST01-015-main', 'ST02-009-onPlay'],
      // Declaring the attack fires [When Attacking].
      DECLARE_ATTACK: ['ST01-005-whenAttacking', 'ST02-008-whenAttacking'],
      // [Counter] Events, the action PLAY_COUNTER cannot express.
      // ST01-014 Guard Point joined the day the driver learned to hold DON!!
      // back: its [Counter] half has been written since PR #10 and had never
      // been reached by a real game until then.
      PLAY_COUNTER_EVENT: ['ST01-014-counter', 'ST02-015-counter', 'ST02-016-counter'],
      // Ending the turn fires [End of Turn].
      END_TURN: ['ST02-013-endOfTurn'],
      // A life card's [Trigger] is offered as the damage resolves, and the
      // answer belongs to the DAMAGED player — the control crossing the choice
      // overlay has to survive.
      ANSWER_CHOICE: ['ST01-014-trigger', 'ST01-015-trigger', 'ST02-015-trigger'],
    });
  });

  it('opens choices that belong to the player whose turn it is NOT', () => {
    // The control crossing, measured rather than assumed.
    //
    // What it is not: the answering player is always the one who made the last
    // move. A life card's [Trigger] resolves during damage, and damage is
    // reached by the DEFENDER passing the Counter Step, so the defender both
    // moved last and answers. There is no state in this corpus where a move by
    // one player opens a question for the other — worth pinning, because it is
    // the natural assumption in the other direction.
    //
    // What it is: the answering player is often not the ACTIVE player. That is
    // the crossing the UI has to survive — the overlay, the priority-owned mode
    // and the banner all follow `pending.player`, not `activePlayer`.
    const crossings: string[] = [];
    for (const seed of STARTER_SEEDS) {
      for (const step of starterPlayoutSteps(seed, STARTER_MAX_STEPS)) {
        const pending = step.after.pending;
        if (pending === null) {
          continue;
        }
        expect(pending.player).toBe(step.action.player);
        if (pending.player === step.after.activePlayer) {
          continue;
        }
        // Priority follows the choice, and the affordances of the player being
        // asked publish it — the two things the overlay depends on.
        expect(step.after.priority).toBe(pending.player);
        const aff = computeAffordances(step.after, pending.player);
        expect(aff.global.mustAnswerChoice).toBe(true);
        expect(aff.pendingChoice?.id).toBe(pending.id);
        // And the player whose turn it is sees nothing but CONCEDE.
        const other = computeAffordances(step.after, step.after.activePlayer);
        expect(other.pendingChoice).toBeNull();
        expect(other.global.mustAnswerChoice).toBe(false);
        crossings.push(`${step.action.type} -> ${pending.kind}`);
      }
    }
    expect(crossings.length).toBeGreaterThan(0);
    // Named so a change in which moves can cross is visible rather than silent.
    expect([...new Set(crossings)].sort()).toEqual([
      // Mid-script continuations of a [Counter] Event or a [Trigger].
      'ANSWER_CHOICE -> selectCards',
      'ANSWER_CHOICE -> yesNo',
      // The defender passes the Counter Step, damage resolves, and the life
      // card they turn over asks them whether to use its [Trigger].
      'PASS -> yesNo',
      // The defender activates a [Counter] Event, which then asks for targets.
      'PLAY_COUNTER_EVENT -> selectCards',
    ]);
  });
});

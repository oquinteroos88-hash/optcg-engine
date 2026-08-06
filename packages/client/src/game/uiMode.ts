import type { GameState, InstanceId, PlayerId } from '@optcg/engine';
import { cardAffordance, getAffordances } from './affordances';
import type { Affordances } from './affordances';
import type { ActionIntent } from './driver-types';

/**
 * Every non-idle mode records the player it was opened for. Without that stamp
 * `attachingDon` — the only mode carrying no instance id — survived a turn
 * change, handing the next player a board already in DON-targeting mode.
 *
 * There is deliberately no `cardSelected` (disambiguation) mode in phase 1: it
 * was unreachable by construction, because `canPlay` only ever describes a card
 * in hand and `canAttack` only a card on the field, so no card can carry both
 * (0 hits across 10,082 sampled states). It returns in phase 2 with different
 * semantics: once `ACTIVATE_ABILITY` exists, a character that can both attack
 * and activate an ability is genuinely ambiguous, and the menu will then offer N
 * variable options rather than a fixed Jugar/Atacar pair.
 */
export type UiMode =
  | { kind: 'idle' }
  | { kind: 'attacking'; owner: PlayerId; attacker: InstanceId }
  | { kind: 'attachingDon'; owner: PlayerId }
  | { kind: 'choosingTrash'; owner: PlayerId; cardToPlay: InstanceId }
  | { kind: 'countering'; owner: PlayerId; counterCard: InstanceId };

export type UiEvent =
  | { kind: 'clickHandCard'; instanceId: InstanceId }
  | { kind: 'clickFieldCard'; instanceId: InstanceId; mine: boolean }
  | { kind: 'clickDonArea' }
  | { kind: 'clickEmpty' }
  | { kind: 'escape' };

/** Everything except the two events that unconditionally reset to idle. */
type BoardEvent = Exclude<UiEvent, { kind: 'escape' } | { kind: 'clickEmpty' }>;

export interface UiModeResult {
  mode: UiMode;
  intent?: ActionIntent;
}

const IDLE: UiMode = { kind: 'idle' };

function anyCanReceiveDon(aff: Affordances): boolean {
  return Object.values(aff.byCard).some((card) => card.canReceiveDon);
}

function playOutcome(instanceId: InstanceId, aff: Affordances): UiModeResult {
  const card = cardAffordance(aff, instanceId);
  if (card.playRequiresTrash) {
    return { mode: { kind: 'choosingTrash', owner: aff.whoActs, cardToPlay: instanceId } };
  }
  return { mode: IDLE, intent: { type: 'PLAY_CARD', instanceId } };
}

/**
 * Pure UI-mode reducer. Clicks are interpreted strictly through affordances;
 * a click that matches nothing returns the same mode with no intent.
 */
export function reduceUiMode(mode: UiMode, ev: UiEvent, aff: Affordances): UiModeResult {
  if (ev.kind === 'escape' || ev.kind === 'clickEmpty') {
    return { mode: IDLE };
  }

  switch (mode.kind) {
    case 'idle':
      return reduceIdle(mode, ev, aff);
    case 'attacking': {
      if (ev.kind === 'clickFieldCard') {
        const attacker = cardAffordance(aff, mode.attacker);
        if (attacker.attackTargets.includes(ev.instanceId)) {
          return {
            mode: IDLE,
            intent: { type: 'DECLARE_ATTACK', attacker: mode.attacker, target: ev.instanceId },
          };
        }
      }
      return { mode };
    }
    case 'attachingDon': {
      if (ev.kind === 'clickFieldCard' && ev.mine && cardAffordance(aff, ev.instanceId).canReceiveDon) {
        return { mode: IDLE, intent: { type: 'ATTACH_DON', to: ev.instanceId, count: 1 } };
      }
      // Clicking the DON area again toggles the mode off instead of dead-ending.
      if (ev.kind === 'clickDonArea') {
        return { mode: IDLE };
      }
      return { mode };
    }
    case 'choosingTrash': {
      if (ev.kind === 'clickFieldCard' && ev.mine) {
        const pending = cardAffordance(aff, mode.cardToPlay);
        if (pending.trashCandidates.includes(ev.instanceId)) {
          return {
            mode: IDLE,
            intent: { type: 'PLAY_CARD', instanceId: mode.cardToPlay, trashCharacter: ev.instanceId },
          };
        }
      }
      return { mode };
    }
    case 'countering': {
      if (ev.kind === 'clickFieldCard' && ev.mine) {
        const counter = cardAffordance(aff, mode.counterCard);
        if (counter.counterTargets.includes(ev.instanceId)) {
          return {
            mode: IDLE,
            intent: { type: 'PLAY_COUNTER', instanceId: mode.counterCard, target: ev.instanceId },
          };
        }
      }
      return { mode };
    }
  }
}

// Exhaustive over BoardEvent on purpose: no `default`, so a new UiEvent cannot
// be added without TypeScript demanding a branch here.
function reduceIdle(mode: UiMode, ev: BoardEvent, aff: Affordances): UiModeResult {
  switch (ev.kind) {
    case 'clickHandCard': {
      const card = cardAffordance(aff, ev.instanceId);
      if (card.canCounter) {
        return { mode: { kind: 'countering', owner: aff.whoActs, counterCard: ev.instanceId } };
      }
      if (card.canPlay) {
        return playOutcome(ev.instanceId, aff);
      }
      return { mode };
    }
    case 'clickFieldCard': {
      if (!ev.mine) {
        return { mode };
      }
      const card = cardAffordance(aff, ev.instanceId);
      if (card.canAttack) {
        return { mode: { kind: 'attacking', owner: aff.whoActs, attacker: ev.instanceId } };
      }
      if (card.canBlock) {
        return { mode: IDLE, intent: { type: 'DECLARE_BLOCK', blocker: ev.instanceId } };
      }
      return { mode };
    }
    case 'clickDonArea': {
      if (anyCanReceiveDon(aff)) {
        return { mode: { kind: 'attachingDon', owner: aff.whoActs } };
      }
      return { mode };
    }
  }
}

/**
 * Re-validate a mode against a (new) state: a mode opened by a player who no
 * longer holds priority is dropped outright, and otherwise the referenced card
 * must still carry the corresponding affordance.
 */
export function ensureModeValid(mode: UiMode, state: GameState): UiMode {
  const aff = getAffordances(state);
  if (mode.kind !== 'idle' && mode.owner !== state.priority) {
    return IDLE;
  }
  switch (mode.kind) {
    case 'idle':
      return mode;
    case 'attacking':
      return cardAffordance(aff, mode.attacker).canAttack ? mode : IDLE;
    case 'attachingDon':
      return anyCanReceiveDon(aff) ? mode : IDLE;
    case 'choosingTrash': {
      const card = cardAffordance(aff, mode.cardToPlay);
      return card.canPlay && card.playRequiresTrash ? mode : IDLE;
    }
    case 'countering':
      return cardAffordance(aff, mode.counterCard).canCounter ? mode : IDLE;
  }
}

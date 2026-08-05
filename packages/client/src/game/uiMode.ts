import type { GameState, InstanceId, PlayerId } from '@optcg/engine';
import { cardAffordance, getAffordances } from './affordances';
import type { Affordances } from './affordances';
import type { ActionIntent } from './driver-types';

/**
 * Every non-idle mode records the player it was opened for. Without that stamp
 * `attachingDon` — the only mode carrying no instance id — survived a turn
 * change, handing the next player a board already in DON-targeting mode.
 */
export type UiMode =
  | { kind: 'idle' }
  | { kind: 'cardSelected'; owner: PlayerId; card: InstanceId }
  | { kind: 'attacking'; owner: PlayerId; attacker: InstanceId }
  | { kind: 'attachingDon'; owner: PlayerId }
  | { kind: 'choosingTrash'; owner: PlayerId; cardToPlay: InstanceId }
  | { kind: 'countering'; owner: PlayerId; counterCard: InstanceId };

export type UiEvent =
  | { kind: 'clickHandCard'; instanceId: InstanceId }
  | { kind: 'clickFieldCard'; instanceId: InstanceId; mine: boolean }
  | { kind: 'clickDonArea' }
  | { kind: 'clickEmpty' }
  | { kind: 'escape' }
  | { kind: 'chooseAction'; action: 'play' | 'attack' };

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
    case 'cardSelected': {
      if (ev.kind === 'chooseAction') {
        if (ev.action === 'play') {
          return playOutcome(mode.card, aff);
        }
        return { mode: { kind: 'attacking', owner: aff.whoActs, attacker: mode.card } };
      }
      return { mode };
    }
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

function reduceIdle(mode: UiMode, ev: UiEvent, aff: Affordances): UiModeResult {
  switch (ev.kind) {
    case 'clickHandCard': {
      const card = cardAffordance(aff, ev.instanceId);
      if (card.canCounter) {
        return { mode: { kind: 'countering', owner: aff.whoActs, counterCard: ev.instanceId } };
      }
      if (card.canPlay && card.canAttack) {
        return { mode: { kind: 'cardSelected', owner: aff.whoActs, card: ev.instanceId } };
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
      if (card.canAttack && card.canPlay) {
        return { mode: { kind: 'cardSelected', owner: aff.whoActs, card: ev.instanceId } };
      }
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
    default:
      return { mode };
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
    case 'cardSelected': {
      const card = cardAffordance(aff, mode.card);
      return card.canPlay || card.canAttack ? mode : IDLE;
    }
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

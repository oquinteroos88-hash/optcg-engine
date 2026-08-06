import { produce, setAutoFreeze } from 'immer';
import { settle } from './abilities/interpreter.js';
import type { GameEvent } from './events.js';
import { applyActivateAbility, validateActivateAbility } from './reducer/activate.js';
import { applyAnswerChoice, validateAnswerChoice } from './reducer/choice.js';
import {
  applyDeclareAttack,
  applyDeclareBlock,
  applyPass,
  applyPlayCounter,
  validateDeclareAttack,
  validateDeclareBlock,
  validatePlayCounter,
} from './reducer/battle.js';
import { applyConcede } from './reducer/concede.js';
import { REASONS } from './reducer/errors.js';
import {
  applyAttachDon,
  applyPlayCard,
  validateAttachDon,
  validatePlayCard,
} from './reducer/main.js';
import { applyMulligan } from './reducer/mulligan.js';
import { applyEndTurn } from './reducer/turn.js';
import type { Action, ApplyResult, GameState } from './types.js';

// Engine-returned states are always deeply frozen.
setAutoFreeze(true);

const ACTION_TYPES: ReadonlySet<string> = new Set([
  'MULLIGAN',
  'PLAY_CARD',
  'ATTACH_DON',
  'DECLARE_ATTACK',
  'DECLARE_BLOCK',
  'PLAY_COUNTER',
  'PASS',
  'END_TURN',
  'CONCEDE',
  'ACTIVATE_ABILITY',
  'ANSWER_CHOICE',
]);

// The answer payload arrives as untrusted JSON like everything else, so its
// shape is checked before the semantic rules in reducer/choice.ts look at it.
function malformedAnswer(raw: unknown): boolean {
  if (raw === undefined) {
    return false; // absent is legal here; reducer/choice.ts rejects it by rule.
  }
  if (typeof raw !== 'object' || raw === null) {
    return true;
  }
  const answer = raw as Record<string, unknown>;
  switch (answer['kind']) {
    case 'cards':
      return !Array.isArray(answer['selected']);
    case 'yesNo':
      return typeof answer['value'] !== 'boolean';
    case 'option':
      return typeof answer['index'] !== 'number';
    default:
      return true;
  }
}

// Actions may arrive as untrusted JSON: verify the shape before trusting the
// declared type. Semantic checks come later and have their own codes.
function structuralReason(action: Action): string | null {
  const raw = action as unknown as Record<string, unknown>;
  if (typeof raw !== 'object' || raw === null || !ACTION_TYPES.has(raw['type'] as string)) {
    return REASONS.malformedAction;
  }
  if (raw['player'] !== 'p1' && raw['player'] !== 'p2') {
    return REASONS.unknownPlayer;
  }
  switch (action.type) {
    case 'MULLIGAN':
      return typeof raw['accept'] === 'boolean' ? null : REASONS.malformedAction;
    case 'PLAY_CARD':
      if (typeof raw['instanceId'] !== 'string') {
        return REASONS.malformedAction;
      }
      if ('trashCharacter' in raw && typeof raw['trashCharacter'] !== 'string') {
        return REASONS.malformedAction;
      }
      return null;
    case 'ATTACH_DON':
      return typeof raw['to'] === 'string' && typeof raw['count'] === 'number'
        ? null
        : REASONS.malformedAction;
    case 'DECLARE_ATTACK':
      return typeof raw['attacker'] === 'string' && typeof raw['target'] === 'string'
        ? null
        : REASONS.malformedAction;
    case 'DECLARE_BLOCK':
      return typeof raw['blocker'] === 'string' ? null : REASONS.malformedAction;
    case 'PLAY_COUNTER':
      return typeof raw['instanceId'] === 'string' && typeof raw['target'] === 'string'
        ? null
        : REASONS.malformedAction;
    case 'ACTIVATE_ABILITY':
      return typeof raw['instanceId'] === 'string' && typeof raw['abilityId'] === 'string'
        ? null
        : REASONS.malformedAction;
    case 'ANSWER_CHOICE':
      if (typeof raw['choiceId'] !== 'string') {
        return REASONS.malformedAction;
      }
      return malformedAnswer(raw['answer']) ? REASONS.malformedAction : null;
    case 'PASS':
    case 'END_TURN':
    case 'CONCEDE':
      return null;
  }
}

// Full validation happens here, before produce: apply never bails mid-mutation.
function validateAction(state: GameState, action: Action): string | null {
  if (state.status === 'finished') {
    return REASONS.gameFinished;
  }
  const structural = structuralReason(action);
  if (structural !== null) {
    return structural;
  }
  if (action.type === 'CONCEDE') {
    return null;
  }
  if (action.player !== state.priority) {
    return REASONS.notYourPriority;
  }
  // An open choice blocks the whole game, not just its own player: nothing may
  // move until it is answered.
  if (state.pending !== null) {
    return action.type === 'ANSWER_CHOICE'
      ? validateAnswerChoice(state, action)
      : REASONS.choicePending;
  }
  if (action.type === 'ANSWER_CHOICE') {
    return REASONS.noPendingChoice;
  }
  if (state.status === 'mulligan') {
    return action.type === 'MULLIGAN' ? null : REASONS.wrongStatus;
  }
  if (action.type === 'MULLIGAN') {
    return REASONS.wrongStatus;
  }

  // Battle gate. Priority already restricts battle actions to the defender.
  switch (action.type) {
    case 'PLAY_CARD':
    case 'ATTACH_DON':
    case 'DECLARE_ATTACK':
    case 'END_TURN':
    case 'ACTIVATE_ABILITY':
      if (state.battle !== null) {
        return REASONS.battleInProgress;
      }
      break;
    case 'DECLARE_BLOCK':
      if (state.battle === null) {
        return REASONS.noBattle;
      }
      if (state.battle.step !== 'block') {
        return REASONS.wrongBattleStep;
      }
      break;
    case 'PLAY_COUNTER':
      if (state.battle === null) {
        return REASONS.noBattle;
      }
      if (state.battle.step !== 'counter') {
        return REASONS.wrongBattleStep;
      }
      break;
    case 'PASS':
      if (state.battle === null) {
        return REASONS.noBattle;
      }
      if (state.battle.step !== 'block' && state.battle.step !== 'counter') {
        return REASONS.wrongBattleStep;
      }
      break;
  }

  switch (action.type) {
    case 'END_TURN':
    case 'PASS':
      return null;
    case 'PLAY_CARD':
      return validatePlayCard(state, action);
    case 'ATTACH_DON':
      return validateAttachDon(state, action);
    case 'DECLARE_ATTACK':
      return validateDeclareAttack(state, action);
    case 'DECLARE_BLOCK':
      return validateDeclareBlock(state, action);
    case 'PLAY_COUNTER':
      return validatePlayCounter(state, action);
    case 'ACTIVATE_ABILITY':
      return validateActivateAbility(state, action);
  }
}

function applyValidated(draft: GameState, action: Action, events: GameEvent[]): void {
  switch (action.type) {
    case 'CONCEDE':
      applyConcede(draft, action, events);
      return;
    case 'MULLIGAN':
      applyMulligan(draft, action, events);
      return;
    case 'END_TURN':
      applyEndTurn(draft, action, events);
      return;
    case 'PLAY_CARD':
      applyPlayCard(draft, action, events);
      return;
    case 'ATTACH_DON':
      applyAttachDon(draft, action, events);
      return;
    case 'DECLARE_ATTACK':
      applyDeclareAttack(draft, action, events);
      return;
    case 'DECLARE_BLOCK':
      applyDeclareBlock(draft, action, events);
      return;
    case 'PLAY_COUNTER':
      applyPlayCounter(draft, action, events);
      return;
    case 'PASS':
      applyPass(draft, action, events);
      return;
    case 'ACTIVATE_ABILITY':
      applyActivateAbility(draft, action, events);
      return;
    case 'ANSWER_CHOICE':
      applyAnswerChoice(draft, action, events);
      return;
  }
}

export function applyAction(state: GameState, action: Action): ApplyResult {
  const reason = validateAction(state, action);
  if (reason !== null) {
    return { ok: false, reason };
  }
  const events: GameEvent[] = [];
  const nextState = produce(state, (draft) => {
    applyValidated(draft, action, events);
    // Handlers queue effects; the interpreter runs them. It stops at the first
    // question, so a state that comes back with `pending` set is mid-effect and
    // the next action has to be the answer.
    settle(draft, events);
  });
  return { ok: true, state: nextState, events };
}

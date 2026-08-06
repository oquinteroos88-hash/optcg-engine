import { applyAnswer } from '../abilities/interpreter.js';
import type { GameEvent } from '../events.js';
import { mark } from '../instrument.js';
import type { ChoiceAnswer, GameState, PlayerId } from '../types.js';
import { REASONS } from './errors.js';

interface AnswerChoiceAction {
  player: PlayerId;
  choiceId: string;
  answer?: ChoiceAnswer;
}

/**
 * Validation for the one action `legalActions` does not enumerate.
 *
 * Because the list only carries a marker, everything a caller needs to build a
 * legal answer is data in `state.pending` — candidates, min, max — and every
 * way of getting it wrong has to come back as its own reason code. A caller
 * that guesses is entitled to know exactly which rule it broke.
 */
export function validateAnswerChoice(state: GameState, action: AnswerChoiceAction): string | null {
  const pending = state.pending;
  if (pending === null) {
    return REASONS.noPendingChoice;
  }
  if (action.choiceId !== pending.id) {
    return REASONS.wrongChoiceId;
  }
  if (action.player !== pending.player) {
    return REASONS.notYourChoice;
  }
  const answer = action.answer;
  if (answer === undefined) {
    return REASONS.missingAnswer;
  }

  switch (pending.kind) {
    case 'yesNo':
      return answer.kind === 'yesNo' ? null : REASONS.choiceKindMismatch;
    case 'selectOption':
      if (answer.kind !== 'option') {
        return REASONS.choiceKindMismatch;
      }
      if (!Number.isInteger(answer.index) || answer.index < 0 || answer.index >= pending.max) {
        return REASONS.choiceOptionOutOfRange;
      }
      return null;
    case 'selectCards':
    case 'orderCards': {
      if (answer.kind !== 'cards') {
        return REASONS.choiceKindMismatch;
      }
      const selected = answer.selected;
      if (selected.length < pending.min || selected.length > pending.max) {
        return REASONS.choiceCardinality;
      }
      const seen = new Set<string>();
      for (const id of selected) {
        if (typeof id !== 'string' || !pending.candidates.includes(id)) {
          return REASONS.choiceCandidateUnknown;
        }
        if (seen.has(id)) {
          return REASONS.choiceDuplicateSelection;
        }
        seen.add(id);
      }
      return null;
    }
  }
}

export function applyAnswerChoice(
  draft: GameState,
  action: AnswerChoiceAction,
  events: GameEvent[],
): void {
  if (action.answer === undefined) {
    throw new Error('Engine bug: answerless ANSWER_CHOICE passed validation');
  }
  mark('choice.answered');
  applyAnswer(draft, action.answer, events);
}

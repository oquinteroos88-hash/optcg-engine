import { applyAnswer } from '../abilities/interpreter.js';
import type { GameEvent } from '../events.js';
import { mark } from '../instrument.js';
import type { ChoiceAnswer, GameState, InstanceId, PendingChoice, PlayerId } from '../types.js';
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
      return answer.kind === 'cards'
        ? cardListReason(pending, answer.selected)
        : REASONS.choiceKindMismatch;
    /**
     * A permutation, checked with the codes that were already here.
     *
     * Three properties — the right *length*, every id *from* the candidates,
     * and no id *twice* — force the answer to be exactly the candidate
     * multiset. That is the pigeonhole: n distinct members drawn from a set of
     * n is that set. So "a card is missing" needs no reason code of its own,
     * because it is not reachable without one of the three already having
     * fired, and a code that can never be returned is a code that lies about
     * the contract.
     *
     * The length comes from `min`/`max`, which `orderToBottom` opens equal to
     * `candidates.length`; `checkEffectShape` asserts that rather than trusting
     * it, so `choiceCardinality` here really does mean "not all of them".
     */
    case 'orderCards':
      return answer.kind === 'order'
        ? cardListReason(pending, answer.order)
        : REASONS.choiceKindMismatch;
  }
}

/** Shared by both card-list answers: cardinality, membership, distinctness. */
function cardListReason(pending: PendingChoice, ids: readonly InstanceId[]): string | null {
  if (ids.length < pending.min || ids.length > pending.max) {
    return REASONS.choiceCardinality;
  }
  const seen = new Set<string>();
  for (const id of ids) {
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

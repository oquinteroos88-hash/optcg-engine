import { fireTriggers, orderedFieldSources } from '../abilities/triggers.js';
import type { GameEvent } from '../events.js';
import { mark } from '../instrument.js';
import { getOpponent } from '../selectors.js';
import type { GameState, PlayerId } from '../types.js';
import { emit, expireEndOfTurnModifiers } from './helpers.js';
import { startTurn } from './startTurn.js';

/**
 * End Turn queues rather than executes.
 *
 * An `endOfTurn` ability may ask the player a question, and the turn must not
 * change hands until that is answered — so the rest of the transition is pushed
 * as a resume step and the interpreter runs it once the effects are done. With
 * no abilities in play the whole thing still happens inside this one action,
 * and the event order is unchanged from Phase 0.
 */
export function applyEndTurn(
  draft: GameState,
  action: { player: PlayerId },
  _events: GameEvent[],
): void {
  draft.resume.push({ kind: 'startTurn', player: action.player });
  fireTriggers(draft, 'endOfTurn', orderedFieldSources(draft));
}

/** The End Phase proper, run by the interpreter's `startTurn` continuation. */
export function finishTurn(draft: GameState, player: PlayerId, events: GameEvent[]): void {
  // CR 6-6-1-1 activated the [End of Your Turn] effects above; CR 6-6-1-2 is
  // this line, and it now needs to know *whose* turn is ending, because
  // `endOfOpponentNextTurn` is the first duration whose answer depends on it.
  // The Refresh Phase of the next turn (6-6-1-4 → 6-2) comes after, so a rule
  // that expires here is gone before anybody un-rests anything.
  expireEndOfTurnModifiers(draft, player);
  for (const card of Object.values(draft.cards)) {
    if (card.usedThisTurn.length > 0) {
      card.usedThisTurn = [];
    }
  }
  mark('turn.ended');
  emit(draft, events, { type: 'turnEnded', turn: draft.turn, player });
  startTurn(draft, getOpponent(player), events);
}

export { startTurn };

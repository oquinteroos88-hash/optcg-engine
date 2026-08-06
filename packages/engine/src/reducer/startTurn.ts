import type { GameEvent } from '../events.js';
import { mark } from '../instrument.js';
import { getOpponent } from '../selectors.js';
import type { GameState, PlayerId } from '../types.js';
import { emit, finishGame, mustGetCard } from './helpers.js';

/**
 * The automatic start of a turn: Refresh, Draw, DON!!.
 *
 * Lives in its own module because both the End Turn handler and the
 * interpreter's `startTurn` continuation need it, and neither may import the
 * other: an `endOfTurn` ability can suspend on a choice, so the turn transition
 * has to be resumable from a saved state rather than run inside one call.
 */
export function startTurn(draft: GameState, player: PlayerId, events: GameEvent[]): void {
  draft.activePlayer = player;
  draft.priority = player;
  draft.turn += 1;
  emit(draft, events, { type: 'turnStarted', turn: draft.turn, player });

  // Refresh: field cards active; attached DON return to cost active; cost DON active.
  const ps = draft.players[player];
  const fieldIds = [ps.leader, ...ps.characters];
  if (ps.stage !== null) {
    fieldIds.push(ps.stage);
  }
  for (const id of fieldIds) {
    mustGetCard(draft, id).orientation = 'active';
  }
  let returned = 0;
  for (const don of ps.don) {
    if (don.location.kind === 'attached') {
      const carrier = mustGetCard(draft, don.location.to);
      carrier.attachedDon = carrier.attachedDon.filter((id) => id !== don.instanceId);
      don.location = { kind: 'cost', orientation: 'active' };
      returned += 1;
    } else if (don.location.kind === 'cost' && don.location.orientation === 'rested') {
      don.location = { kind: 'cost', orientation: 'active' };
    }
  }
  if (returned > 0) {
    mark('don.returnedActiveOnRefresh');
    emit(draft, events, { type: 'donReturned', player, count: returned, rested: false });
  }

  // Draw: the firstPlayer skips it on turn 1.
  const isFirstTurnOfFirstPlayer = draft.turn === 1 && player === draft.firstPlayer;
  if (isFirstTurnOfFirstPlayer) {
    mark('turn.firstPlayerSkipsDraw');
  } else {
    const top = ps.deck.shift();
    if (top === undefined) {
      mark('deckOut');
      finishGame(draft, getOpponent(player), 'deckOut', events);
      return;
    }
    ps.hand.push(top);
    emit(draft, events, { type: 'cardDrawn', player, instanceId: top });
  }

  // DON!!: 2 per turn (1 for the firstPlayer on turn 1), bounded by the DON
  // deck and the 10-slot cost area.
  const gain = isFirstTurnOfFirstPlayer ? 1 : 2;
  const inDonDeck = ps.don.filter((don) => don.location.kind === 'donDeck');
  const costCount = ps.don.filter((don) => don.location.kind === 'cost').length;
  const actual = Math.min(gain, inDonDeck.length, 10 - costCount);
  // Which of the three terms bound the gain is a rule distinction line
  // coverage cannot see: the Math.min is always one covered line.
  if (actual < gain && 10 - costCount === actual) {
    mark('don.gainCappedByCostArea');
  }
  if (actual < gain && inDonDeck.length === actual) {
    mark('don.gainCappedByDonDeck');
  }
  for (let i = 0; i < actual; i += 1) {
    const don = inDonDeck[i];
    if (don === undefined) {
      throw new Error('Engine bug: DON deck shorter than computed gain');
    }
    don.location = { kind: 'cost', orientation: 'active' };
  }
  if (actual > 0) {
    emit(draft, events, { type: 'donGained', player, count: actual });
  }

  draft.phase = 'main';
}

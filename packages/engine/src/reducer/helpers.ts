import { fieldIds } from '../abilities/query.js';
import { fireTriggers } from '../abilities/triggers.js';
import type { GameEvent } from '../events.js';
import { mark } from '../instrument.js';
import type { CardInstance, GameState, InstanceId, Orientation, PlayerId } from '../types.js';

/** CR 3-7-6: "Up to 5 Character cards can be placed in the Character area." */
export const BOARD_LIMIT = 5;

// Handlers run on an immer draft; the shapes are identical to GameState.
export function emit(draft: GameState, events: GameEvent[], event: GameEvent): void {
  draft.log.push(event);
  events.push(event);
}

// Validation ran before produce, so a missing instance here is an engine bug.
export function mustGetCard(state: GameState, id: InstanceId): CardInstance {
  const card = state.cards[id];
  if (card === undefined) {
    throw new Error(`Engine bug: missing card instance ${id}`);
  }
  return card;
}

export function finishGame(
  draft: GameState,
  winner: PlayerId,
  endReason: 'lifeOut' | 'deckOut' | 'concede',
  events: GameEvent[],
): void {
  draft.status = 'finished';
  draft.winner = winner;
  draft.endReason = endReason;
  emit(draft, events, { type: 'gameEnded', winner, endReason });
}

export function expireEndOfTurnModifiers(draft: GameState): void {
  draft.modifiers = draft.modifiers.filter((modifier) => modifier.duration !== 'endOfTurn');
}

// DON!! are fungible: rest the first `cost` active cost-area DON in array order.
export function payDonCost(
  draft: GameState,
  player: PlayerId,
  cost: number,
  events: GameEvent[],
): void {
  if (cost <= 0) {
    return;
  }
  let remaining = cost;
  for (const don of draft.players[player].don) {
    if (remaining === 0) {
      break;
    }
    if (don.location.kind === 'cost' && don.location.orientation === 'active') {
      don.location = { kind: 'cost', orientation: 'rested' };
      remaining -= 1;
    }
  }
  if (remaining > 0) {
    throw new Error('Engine bug: not enough active DON at pay time');
  }
  emit(draft, events, { type: 'donPaid', player, count: cost });
}

/**
 * Takes a card off the field without deciding where it goes.
 *
 * Split out of `leaveField` so that a `moveCard` effect can send a character to
 * the hand or the deck through the same DON!!-return and normalization rules a
 * KO uses. Every field exit in the engine still goes through exactly this code.
 */
export function detachFromField(draft: GameState, id: InstanceId, events: GameEvent[]): void {
  const card = mustGetCard(draft, id);
  const controller = card.controller;
  const ps = draft.players[controller];

  let returned = 0;
  for (const donId of card.attachedDon) {
    const don = ps.don.find((d) => d.instanceId === donId);
    if (don === undefined) {
      throw new Error(`Engine bug: attached DON ${donId} not in ${controller}'s DON`);
    }
    don.location = { kind: 'cost', orientation: 'rested' };
    returned += 1;
  }
  if (returned > 0) {
    mark('don.returnedRestedOnLeave');
    emit(draft, events, { type: 'donReturned', player: controller, count: returned, rested: true });
  }

  draft.modifiers = draft.modifiers.filter((modifier) => modifier.target !== id);

  card.orientation = 'active';
  card.attachedDon = [];
  card.playedOnTurn = null;
  card.usedThisTurn = [];

  const characterIndex = ps.characters.indexOf(id);
  if (characterIndex !== -1) {
    ps.characters.splice(characterIndex, 1);
  } else if (ps.stage === id) {
    ps.stage = null;
  } else {
    throw new Error(`Engine bug: ${id} is not on ${controller}'s field`);
  }
}

/**
 * Shared exit path for a card leaving the field *to the trash*. Attached DON!!
 * return to the cost area RESTED. Only a real KO emits the koed event and wakes
 * an [On K.O.] ability; the stageReplaced event is emitted by the caller, which
 * knows the incoming stage.
 */
export function leaveField(
  draft: GameState,
  id: InstanceId,
  cause: 'ko' | 'trashedForRoom' | 'stageReplaced' | 'cost',
  events: GameEvent[],
): void {
  const card = mustGetCard(draft, id);
  const controller = card.controller;
  detachFromField(draft, id, events);
  draft.players[card.owner].trash.unshift(id);

  if (cause === 'ko') {
    emit(draft, events, { type: 'koed', player: controller, instanceId: id });
    // A KO wakes the card's own [On K.O.] ability. It is queued, not run: the
    // effect that caused the KO finishes its script first.
    fireTriggers(draft, 'onKO', [id]);
    // And it tells the other player's field, which is a different question:
    // `onKO` is "**I** was K.O.'d", and a card watching the opponent's board
    // had no way in until this line existed. Fired here rather than at each
    // call site, so every route to a K.O. — a battle, a script's `ko`, a cost
    // — reaches it, and the three causes that are *not* K.O.s never do
    // (CR 3-7-6-1-1 for the 6th-Character trash).
    //
    // The K.O.'d card's own trigger goes first and the watchers underneath it,
    // which is CR 8-6-1's order read the only way it can be read here: both
    // effects' timing is fulfilled at once, and the engine's fixed order —
    // turn player first, then board position — is what `orderedFieldSources`
    // has always given simultaneous triggers.
    const watchers = fieldIds(draft, controller === 'p1' ? 'p2' : 'p1');
    fireTriggers(draft, 'whenOpponentCharacterKOd', watchers);
  } else if (cause === 'trashedForRoom') {
    // Deliberately not a KO, and deliberately no onKO trigger: making room for
    // a 6th character is a discard, which is a different rule.
    emit(draft, events, { type: 'characterTrashedForRoom', player: controller, instanceId: id });
  }
}

/**
 * Puts a Character card into its controller's Character area.
 *
 * **The one routine that does this.** `PLAY_CARD` calls it and so does the
 * `play` instruction, because two code paths that put cards on the field are
 * how one of them gets fixed and the other does not. Everything both of them
 * owe the rules lives here:
 *
 * - **The card is placed active** unless the caller says otherwise. CR 3-7-5:
 *   "When placing cards in the Character area, they should be set as active
 *   unless otherwise specified." `OP01-060` is the "otherwise".
 * - **`playedOnTurn` is stamped**, which is what makes CR 3-7-4 true — "played
 *   cards cannot attack on the turn in which they are played unless otherwise
 *   specified". A card an effect puts down is played, so it is summoning-sick
 *   exactly like one paid for by hand, and `[Rush]` is the "otherwise".
 * - **The 6th-Character sacrifice is applied first.** CR 3-7-6-1 has the player
 *   "trash 1 of the Character cards **already in** their Character area, and
 *   then play the new Character card" — so the card entering can never be the
 *   card sacrificed, and the order is trash-then-place rather than the reverse.
 *   CR 3-7-6-1-1 makes that trash "processing a rule", so it is not a K.O. and
 *   wakes no `[On K.O.]` — which `leaveField`'s `trashedForRoom` cause is.
 * - **The `[On Play]` fires.** Official Q&A: "Can I play a Character card with
 *   an [On Play] effect without activating this [On Play] effect?" — "No, you
 *   must activate the [On Play] effect whenever possible." It is queued rather
 *   than run, so an effect that put this card down finishes its own script
 *   first.
 *
 * The caller is responsible for having taken the card out of the zone it came
 * from, and for the cost: paying is the `PLAY_CARD` action's business (CR
 * 6-5-3-1), and no instruction pays.
 */
export function enterCharacterArea(
  draft: GameState,
  player: PlayerId,
  id: InstanceId,
  events: GameEvent[],
  opts: { orientation?: Orientation; trashCharacter?: InstanceId } = {},
): void {
  const card = mustGetCard(draft, id);
  const ps = draft.players[player];
  mark('play.character');
  if (opts.trashCharacter !== undefined) {
    mark('field.sixthCharacter');
    leaveField(draft, opts.trashCharacter, 'trashedForRoom', events);
  }
  ps.characters.push(id);
  card.orientation = opts.orientation ?? 'active';
  card.playedOnTurn = draft.turn;
  emit(draft, events, {
    type: 'cardPlayed',
    player,
    instanceId: id,
    cardId: card.cardId,
  });
  fireTriggers(draft, 'onPlay', [id]);
}

/**
 * Pulls a card out of whichever off-field zone holds it. Returns false when it
 * was in none of them, which for a `moveCard` target simply means "no longer
 * where the effect expected it" and is not an error.
 */
export function removeFromNonFieldZone(draft: GameState, id: InstanceId): boolean {
  const card = draft.cards[id];
  if (card === undefined) {
    return false;
  }
  const ps = draft.players[card.owner];
  for (const zone of ['hand', 'deck', 'trash', 'life'] as const) {
    const index = ps[zone].indexOf(id);
    if (index !== -1) {
      ps[zone].splice(index, 1);
      return true;
    }
  }
  return false;
}

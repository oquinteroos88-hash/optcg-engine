import { current, isDraft } from 'immer';
import type { Duration } from '../abilities/dsl.js';
import { KO_BY_BATTLE, KO_CAUSE_VAR } from '../abilities/dsl.js';
import { fieldIds } from '../abilities/query.js';
import { fireSidedTriggers, fireTriggers } from '../abilities/triggers.js';
import type { GameEvent } from '../events.js';
import { mark } from '../instrument.js';
import { dropLegalityNaming } from '../legality.js';
import type { CardInstance, GameState, InstanceId, Orientation, PlayerId } from '../types.js';
import { rememberDeparture } from '../visibility.js';

/** CR 3-7-6: "Up to 5 Character cards can be placed in the Character area." */
export const BOARD_LIMIT = 5;

// Handlers run on an immer draft; the shapes are identical to GameState.
export function emit(draft: GameState, events: GameEvent[], event: GameEvent): void {
  draft.log.push(event);
  events.push(event);
}

/**
 * The card table as it stands at this point in the recipe, readable without
 * drafting it.
 *
 * Reading a child through an immer draft manufactures a proxy for it and
 * marks its parent copied, and `finalize` then walks every proxy it made. A
 * loop that *looks at* every card in order to change a few of them was
 * therefore paying for a proxy per card instance, about a hundred and twenty
 * of them — measured on the ability sweep as END_TURN, the one action that
 * looks at every card, costing 806µs against a 150µs median for the rest,
 * with immer's `finalizeProperty` alone at 29% of it.
 *
 * `current` returns the same data with every write the recipe has already
 * made, and no proxies. Writes still go through the draft, which is what
 * keeps this a read-side change: the state that comes out is byte for byte
 * the state that came out before, and `packages/server/tests/replay.test.ts`
 * is the proof. Outside a recipe (a scenario builder's plain object) the
 * table is returned as is.
 */
export function peekCards(draft: GameState): Readonly<Record<InstanceId, CardInstance>> {
  return isDraft(draft.cards) ? current(draft.cards) : draft.cards;
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

/**
 * CR 6-6-1-2: everything whose lifetime this End Phase ends, modifiers and
 * legality rules together, because the two share a `Duration` and always have.
 *
 * The legality half is what makes ST01-016 finish honestly: "your opponent
 * cannot activate [Blocker] if that Leader or Character attacks during this
 * turn" ends with the turn whether the named card ever attacked or not, so the
 * rule cannot be cleared by the attack it was waiting for — only by the clock.
 *
 * `expireLegality` used to be called from here and is not any more, because the
 * two lists now answer the same per-entry question and a second function that
 * could only filter by an exact duration would have been the place the third
 * duration was forgotten.
 */
export function expireEndOfTurnModifiers(draft: GameState, endingPlayer: PlayerId): void {
  draft.modifiers = draft.modifiers.filter(
    (modifier) => !expiresAtEndOf(draft, modifier, endingPlayer),
  );
  draft.legality = draft.legality.filter((rule) => !expiresAtEndOf(draft, rule, endingPlayer));
}

/**
 * Whether a timed record dies in the End Phase now running.
 *
 * **This is the whole of `endOfOpponentNextTurn`, and it takes an `endingPlayer`
 * because that duration is the first one the engine has that cannot be answered
 * without knowing whose turn just ended.** `endOfTurn` never had to ask: CR
 * 6-6-1-2 expires both players' turn-scoped effects in the same End Phase, in
 * two clauses that differ only in the order the two players process them —
 * "(1) … of the **turn player** … (2) … of the **non-turn player**". Both die,
 * so the question never came up.
 *
 * A duration that spans a change of turn player has to answer it. The rule reads
 * off clause (2) directly: an `endOfOpponentNextTurn` effect belongs to a player
 * and dies on that player's **opponent's** turn, so it survives every End Phase
 * in which its controller is the turn player and dies in the first one in which
 * they are not.
 *
 * The `writtenOnTurn` comparison is the second half, and it is the ambiguity
 * `rules.nextTurnExcludesTurnInProgress` names: an effect written *during* the
 * opponent's turn is already inside a turn that clause (2) would end. See the
 * flag in `types.ts` for which reading ships and why.
 */
function expiresAtEndOf(
  state: GameState,
  entry: { duration: Duration; controller: PlayerId; writtenOnTurn: number },
  endingPlayer: PlayerId,
): boolean {
  if (entry.duration === 'endOfTurn') {
    return true;
  }
  if (entry.duration !== 'endOfOpponentNextTurn') {
    // `endOfBattle`, which the End of the Battle expired long before this.
    return false;
  }
  if (entry.controller === endingPlayer) {
    return false;
  }
  return !state.rules.nextTurnExcludesTurnInProgress || state.turn > entry.writtenOnTurn;
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
 * **The one place a card on the field changes orientation.**
 *
 * Five things rest a card — an attack (CR 7-1-1-1), a `[Blocker]` activation
 * (CR 10-1-4-1), a `restSelf` cost, a `rest` instruction, and the Refresh Phase
 * running the other way (CR 6-2-4) — and until this existed each of them
 * assigned the field itself. Eight cards in the full set read "when this
 * Character **becomes rested**", with no cause printed on any of them, so the
 * trigger answers to every route: putting it at each caller would have been five
 * copies of one rule and four chances to forget it. The lesson is PR #30's, in
 * its sharpest form yet — *the trigger fires where the fact happens.*
 *
 * **It is a transition, and that is the design.** "Becomes" is a change of
 * state; a card already rested has none to make, so an unchanged orientation
 * returns early and fires nothing. That guard was already in the `rest`
 * instruction for its own reasons and is now the trigger's definition.
 *
 * **The Refresh Phase comes through here and can never fire it**, because it
 * sets cards *active*. It is the inverse movement, in the same way `addDon` is
 * the inverse of `returnDon`, and it needs no exclusion — only a direction.
 *
 * `announce` is false for the two battle callers, and not as an optimisation:
 * `attackDeclared` and `blockDeclared` **are** the log of those rests. CR
 * 7-1-1-1 makes resting part of declaring an attack and CR 10-1-4-1 makes it
 * part of activating `[Blocker]`, so a client rendering both events would tell
 * the player the same thing twice — the distinction `battleEndedEarly` is kept
 * apart from `battleResolved` for. The trigger fires either way; only the line
 * in the log is conditional.
 */
export function setOrientation(
  draft: GameState,
  id: InstanceId,
  orientation: Orientation,
  events: GameEvent[],
  opts: { announce?: boolean } = {},
): void {
  const card = mustGetCard(draft, id);
  if (card.orientation === orientation) {
    return;
  }
  card.orientation = orientation;
  if (opts.announce !== false) {
    emit(draft, events, { type: 'orientationChanged', instanceId: id, orientation });
  }
  if (orientation === 'rested') {
    mark('orientation.becameRested');
    if (fireTriggers(draft, 'whenBecomingRested', [id]) > 0) {
      mark('trigger.becameRested');
    }
  }
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
  // Departure is the moment sight becomes memory: the field showed this card
  // to both players, and wherever it goes next, neither forgets its face
  // until a shuffle takes it (see `rememberDeparture`).
  rememberDeparture(draft, id, 'characters', controller);

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
  // The same rule one array over: CR 3-1-6 makes the card that comes back a new
  // card, so nothing said *about this card* survives its exit.
  dropLegalityNaming(draft, id);

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
 * Why a card left the field.
 *
 * The K.O. member carries **who caused it** and the other three carry nothing,
 * because only a K.O. has a card asking. Six cards in the full set read "when
 * this Character is K.O.'d **by your opponent's effect**", and until this field
 * existed `leaveField` knew the cause (`'ko'` against three others) and not the
 * causer.
 *
 * It is a required field of the member rather than an optional parameter, and
 * that is the point: a caller cannot K.O. a card without saying what did it.
 * `'battle'` is the Damage Step (CR 7-1-4-1-2), a `PlayerId` is the controller
 * of the effect that ordered it, and CR 10-2-1-3 puts those two on opposite
 * sides of an `or` — "K.O.'d by an effect **or** due to the result of a battle"
 * — so a battle is nobody's effect and there is no third thing to spell.
 */
export type LeaveFieldCause =
  | { kind: 'ko'; by: PlayerId | typeof KO_BY_BATTLE }
  | { kind: 'trashedForRoom' }
  | { kind: 'stageReplaced' }
  | { kind: 'cost' };

/**
 * Shared exit path for a card leaving the field *to the trash*. Attached DON!!
 * return to the cost area RESTED. Only a real KO emits the koed event and wakes
 * an [On K.O.] ability; the stageReplaced event is emitted by the caller, which
 * knows the incoming stage.
 */
export function leaveField(
  draft: GameState,
  id: InstanceId,
  cause: LeaveFieldCause,
  events: GameEvent[],
): void {
  const card = mustGetCard(draft, id);
  const controller = card.controller;
  detachFromField(draft, id, events);
  draft.players[card.owner].trash.unshift(id);

  if (cause.kind === 'ko') {
    emit(draft, events, { type: 'koed', player: controller, instanceId: id });
    // A KO wakes the card's own [On K.O.] ability. It is queued, not run: the
    // effect that caused the KO finishes its script first.
    //
    // The cause rides along in the trigger's seed rather than in a second
    // trigger. "When this Character is K.O.'d by your opponent's effect" is an
    // ordinary [On K.O.] with a question attached, and giving it its own
    // trigger would have meant a second firing site for a fact that has one.
    // `koCause` is the question; this is the only thing that ever answers it.
    mark(cause.by === KO_BY_BATTLE ? 'ko.byBattle' : 'ko.byEffect');
    fireTriggers(draft, 'onKO', [id], { [KO_CAUSE_VAR]: cause.by });
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
    // has always given simultaneous triggers. `fireSidedTriggers` is where that
    // choice is now written down for all four sided facts at once.
    //
    // The watchers get no seed: "when your opponent's Character is K.O.'d" is
    // printed with no cause on it, and a variable no card can read is a
    // variable that should not be in the state.
    const watchers = fieldIds(draft, controller === 'p1' ? 'p2' : 'p1');
    fireTriggers(draft, 'whenOpponentCharacterKOd', watchers);
  } else if (cause.kind === 'trashedForRoom') {
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
  opts: {
    orientation?: Orientation;
    trashCharacter?: InstanceId;
    /**
     * Which of CR's two senses of "play" brought this card here: the Main Phase
     * *action* that pays (`'action'`, CR 6-5-3-1) or an effect that places
     * (`'effect'`, CR 3-7-3). Everything above this line treats them
     * identically — that is the whole reason this routine is shared — and the
     * one reader is `rules.effectPlayIsPlayingACharacter`, which exists because
     * the Comprehensive Rules never reconcile the two senses and a card watching
     * for "your opponent plays a Character" has to be told which reading won.
     */
    route: 'action' | 'effect';
  },
): void {
  const card = mustGetCard(draft, id);
  const ps = draft.players[player];
  mark('play.character');
  if (opts.trashCharacter !== undefined) {
    mark('field.sixthCharacter');
    leaveField(draft, opts.trashCharacter, { kind: 'trashedForRoom' }, events);
  }
  ps.characters.push(id);
  const orientation = opts.orientation ?? 'active';
  card.orientation = orientation;
  card.playedOnTurn = draft.turn;
  emit(draft, events, {
    type: 'cardPlayed',
    player,
    instanceId: id,
    cardId: card.cardId,
  });
  // Placing a card rested is not the same act as a card *becoming* rested, and
  // the assignment above deliberately does not go through `setOrientation`.
  // CR 3-7-5 calls this **placing** — "when placing cards in the Character area,
  // they should be set as active unless otherwise specified" — and a card that
  // arrives rested was never active on the field to change from. The reading is
  // arguable, which is why it is a flag and not a comment; see
  // `rules.placedRestedBecomesRested`.
  if (orientation === 'rested' && draft.rules.placedRestedBecomesRested) {
    mark('play.restedCountsAsBecoming');
    fireTriggers(draft, 'whenBecomingRested', [id]);
  }
  // The played card's own [On Play] first, then the other field's watchers —
  // the same door every sided fact comes through. "When your opponent plays a
  // Character" is printed on two cards in the full set and neither says how the
  // Character got there, which is CR 3-7-3's sense of the word: placing a card
  // in the Character area *is* playing it. `PLAY_CARD` and the `play`
  // instruction both arrive here, so both are seen.
  const watching = fireSidedTriggers(
    draft,
    { trigger: 'onPlay', sources: [id] },
    {
      trigger: 'whenOpponentPlaysCharacter',
      sources:
        opts.route === 'action' || draft.rules.effectPlayIsPlayingACharacter
          ? fieldIds(draft, player === 'p1' ? 'p2' : 'p1')
          : [],
    },
  );
  if (watching > 0) {
    mark('trigger.opponentPlaysCharacter');
  }
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
      // Whoever this zone showed the card to keeps it — recorded before the
      // splice, while "which zone" still has an answer.
      rememberDeparture(draft, id, zone, card.owner);
      ps[zone].splice(index, 1);
      return true;
    }
  }
  return false;
}

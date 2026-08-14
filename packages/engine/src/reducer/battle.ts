import { KO_BY_BATTLE } from '../abilities/dsl.js';
import {
  fireBlockerActivated,
  fireEventActivated,
  fireTriggers,
  ownedFieldSources,
} from '../abilities/triggers.js';
import type { GameEvent } from '../events.js';
import { mark } from '../instrument.js';
import { canActivateBlocker, canAttack, canBeKOdInBattle, expireLegality } from '../legality.js';
import { getCardDef, isCounterEvent } from '../registry.js';
import {
  getActiveCostDon,
  getCost,
  getOpponent,
  getPower,
  hasKeyword,
  isOnField,
  isOwnLeaderOrCharacter,
} from '../selectors.js';
import type { Battle, GameState, InstanceId, PlayerId } from '../types.js';
import { REASONS } from './errors.js';
import { emit, leaveField, mustGetCard, payDonCost, setOrientation } from './helpers.js';

interface DeclareAttackAction {
  player: PlayerId;
  attacker: InstanceId;
  target: InstanceId;
}

interface DeclareBlockAction {
  player: PlayerId;
  blocker: InstanceId;
}

interface PlayCounterAction {
  player: PlayerId;
  instanceId: InstanceId;
  target: InstanceId;
}

interface PlayCounterEventAction {
  player: PlayerId;
  instanceId: InstanceId;
}

function mustGetBattle(draft: GameState): Battle {
  if (draft.battle === null) {
    throw new Error('Engine bug: battle handler reached with no battle open');
  }
  return draft.battle;
}

export function validateDeclareAttack(state: GameState, action: DeclareAttackAction): string | null {
  if (!isOwnLeaderOrCharacter(state, action.player, action.attacker)) {
    return REASONS.invalidAttacker;
  }
  const attacker = state.cards[action.attacker];
  if (attacker === undefined) {
    return REASONS.invalidAttacker;
  }
  if (attacker.orientation !== 'active') {
    return REASONS.attackerNotActive;
  }
  // Rush lifts exactly this restriction and nothing else.
  if (attacker.playedOnTurn === state.turn && !hasKeyword(state, action.attacker, 'rush')) {
    return REASONS.cannotAttackYet;
  }
  if (
    state.rules.firstPlayerCannotAttackTurnOne &&
    state.turn === 1 &&
    action.player === state.firstPlayer
  ) {
    return REASONS.firstTurnAttackForbidden;
  }
  const defender = getOpponent(action.player);
  if (!isOwnLeaderOrCharacter(state, defender, action.target)) {
    return REASONS.invalidTarget;
  }
  const target = state.cards[action.target];
  if (target === undefined) {
    return REASONS.invalidTarget;
  }
  // The rested-target rule (CR 7-1-1-2) and everything a card says about it, in
  // one question. `targetNotRested` stays the reason code for the ordinary
  // refusal — the codes are a public contract — and `attackForbidden` is the
  // separate one for a target the base rule *would* have allowed and a card
  // took away.
  if (!canAttack(state, action.attacker, action.target)) {
    const targetIsLeader = state.players[defender].leader === action.target;
    return !targetIsLeader && target.orientation !== 'rested'
      ? REASONS.targetNotRested
      : REASONS.attackForbidden;
  }
  return null;
}

export function applyDeclareAttack(
  draft: GameState,
  action: DeclareAttackAction,
  events: GameEvent[],
): void {
  const attacker = mustGetCard(draft, action.attacker);
  if (attacker.playedOnTurn === draft.turn) {
    mark('keyword.rushAttack');
  }
  // CR 7-1-1-1 rests the attacker *as part of* declaring — "rests their active
  // Leader card or 1 active Character card and declares the attack" — and
  // CR 7-1-1-3 activates [When Attacking] after that. So the rest, and anything
  // that watches for it, comes first; the two queue in that order and resolve in
  // it. `announce: false` because `attackDeclared` below already says it.
  setOrientation(draft, action.attacker, 'rested', events, { announce: false });
  draft.battle = {
    step: 'block',
    attacker: action.attacker,
    target: action.target,
    originalTarget: action.target,
    wasBlocked: false,
  };
  draft.priority = getOpponent(action.player);
  emit(draft, events, {
    type: 'attackDeclared',
    player: action.player,
    attacker: action.attacker,
    target: action.target,
  });
  // The attacker's own [When Attacking] first, then the defender's watchers.
  fireTriggers(draft, 'whenAttacking', [action.attacker]);
  fireTriggers(draft, 'whenOpponentAttacks', ownedFieldSources(draft, getOpponent(action.player)));
}

export function validateDeclareBlock(state: GameState, action: DeclareBlockAction): string | null {
  if (!state.players[action.player].characters.includes(action.blocker)) {
    return REASONS.invalidBlocker;
  }
  const blocker = state.cards[action.blocker];
  if (blocker === undefined) {
    return REASONS.invalidBlocker;
  }
  if (!hasKeyword(state, action.blocker, 'blocker')) {
    return REASONS.notABlocker;
  }
  if (blocker.orientation !== 'active') {
    return REASONS.blockerNotActive;
  }
  // Revalidated, as always. `legalActions` withheld the offer; an action that
  // arrives anyway — a replayed log, a client built against an older state, a
  // bot that kept a stale list — is refused here with its own reason.
  if (!canActivateBlocker(state, action.blocker)) {
    return REASONS.blockForbidden;
  }
  return null;
}

export function applyDeclareBlock(
  draft: GameState,
  action: DeclareBlockAction,
  events: GameEvent[],
): void {
  const battle = mustGetBattle(draft);
  mark('battle.blocked');
  mark('keyword.blockerUsed');
  // CR 10-1-4-1 makes [Blocker] "a keyword effect allowing you to activate it by
  // **resting this card** during the Block Step", so the rest is the activation
  // and not a step beside it. `announce: false` because `blockDeclared` is
  // already the log of exactly this.
  setOrientation(draft, action.blocker, 'rested', events, { announce: false });
  battle.target = action.blocker;
  battle.wasBlocked = true;
  battle.step = 'counter';
  emit(draft, events, { type: 'blockDeclared', player: action.player, blocker: action.blocker });
  fireBlockerActivated(draft, action.blocker, action.player);
}

export function validatePlayCounter(state: GameState, action: PlayCounterAction): string | null {
  if (!state.players[action.player].hand.includes(action.instanceId)) {
    return REASONS.cardNotInHand;
  }
  const card = state.cards[action.instanceId];
  if (card === undefined) {
    return REASONS.cardNotInHand;
  }
  // A card with no printed Counter value cannot be played in the Counter Step
  // at all; this is not the same as one that would add zero.
  if (getCardDef(card.cardId).counter === null) {
    return REASONS.noCounterValue;
  }
  // Counters may boost any own leader or on-field character, battling or not.
  if (!isOwnLeaderOrCharacter(state, action.player, action.target)) {
    return REASONS.invalidCounterTarget;
  }
  return null;
}

export function applyPlayCounter(
  draft: GameState,
  action: PlayCounterAction,
  events: GameEvent[],
): void {
  const card = mustGetCard(draft, action.instanceId);
  const value = getCardDef(card.cardId).counter;
  if (value === null) {
    throw new Error('Engine bug: counter-less card passed PLAY_COUNTER validation');
  }
  const ps = draft.players[action.player];
  mark('counter.played');
  const battle = mustGetBattle(draft);
  if (action.target !== battle.target && action.target !== battle.attacker) {
    mark('counter.onNonBattlingCard');
  }
  if (draft.modifiers.some((modifier) => modifier.duration === 'endOfBattle')) {
    mark('counter.stacked');
  }
  ps.hand = ps.hand.filter((id) => id !== action.instanceId);
  ps.trash.unshift(action.instanceId);
  draft.modifiers.push({
    // log.length grows monotonically, so this is unique across the game.
    id: `mod-${draft.log.length}`,
    target: action.target,
    kind: 'power',
    value,
    duration: 'endOfBattle',
    source: action.instanceId,
    controller: action.player,
    writtenOnTurn: draft.turn,
  });
  emit(draft, events, {
    type: 'counterPlayed',
    player: action.player,
    instanceId: action.instanceId,
    target: action.target,
    value,
  });
  // A Counter card with an effect resolves it from the trash, where the card
  // now is. Only the printed Counter value gates the play itself.
  //
  // **No printed card can reach this line.** Discarding a card for its Counter
  // value needs `counter !== null`, and a [Counter] ability needs the marker in
  // the text — and across all 2665 cards those two sets do not intersect: all
  // 184 [Counter] cards are Events, and no Event carries a printed Counter
  // value. So this is the second of the trigger's two firing sites and the
  // unreachable one; `applyPlayCounterEvent` is the live one.
  //
  // Kept rather than deleted, and pinned by
  // `packages/cards/tests/abilCardShapes.test.ts`, which fails the day a card
  // prints both. The rule the card text states — "a Counter card with an effect
  // resolves it" — is correct whether or not the game has printed such a card;
  // removing the line would encode "no such card exists" as an absence nobody
  // can see, which is how ABIL-016's invented shape hid a missing engine move
  // for a year. An unreachable path with a guard and a reason beats a deleted
  // one.
  fireTriggers(draft, 'counterEvent', [action.instanceId]);
}

export function validatePlayCounterEvent(
  state: GameState,
  action: PlayCounterEventAction,
): string | null {
  if (!state.players[action.player].hand.includes(action.instanceId)) {
    return REASONS.cardNotInHand;
  }
  const card = state.cards[action.instanceId];
  if (card === undefined) {
    return REASONS.cardNotInHand;
  }
  const def = getCardDef(card.cardId);
  // CR 7-1-3-2-2: only an Event card carrying a [Counter] effect may be
  // activated here. A printed Counter value is a different play (PLAY_COUNTER);
  // a Counter Event has none and is trashed for its effect instead.
  if (def.category !== 'event' || !isCounterEvent(card.cardId)) {
    return REASONS.notACounterEvent;
  }
  // The price is the Event's printed play cost, paid with the defender's active
  // cost-area DON!!. No active-DON to rest for it means the play is unavailable.
  if (getActiveCostDon(state, action.player).length < getCost(state, action.instanceId)) {
    return REASONS.notEnoughDon;
  }
  return null;
}

export function applyPlayCounterEvent(
  draft: GameState,
  action: PlayCounterEventAction,
  events: GameEvent[],
): void {
  const card = mustGetCard(draft, action.instanceId);
  const def = getCardDef(card.cardId);
  const ps = draft.players[action.player];
  mark('counterEvent.played');
  // CR 7-1-3-2-2, in order: pay the cost, trash the Event, then activate the
  // [Counter] effect. The trash step comes before the trigger, so the card is
  // already in the trash when its own effect resolves — a `{ self }` ref names
  // a card in the trash, exactly as a Main-phase Event does.
  // Read while the Event is still in hand, for the reason `applyPlayCard` is.
  const price = getCost(draft, action.instanceId);
  payDonCost(draft, action.player, price, events);
  ps.hand = ps.hand.filter((id) => id !== action.instanceId);
  ps.trash.unshift(action.instanceId);
  emit(draft, events, {
    type: 'cardPlayed',
    player: action.player,
    instanceId: action.instanceId,
    cardId: card.cardId,
  });
  fireTriggers(draft, 'counterEvent', [action.instanceId]);
  // A [Counter] Event is an Event card used from hand, which is all CR 8-5-2
  // asks of card activation — the phase it is used in is not part of the
  // definition. Fired second, so the watchers resolve after the Event's own
  // effect (CR 8-6-3), exactly as on the [Main] route.
  //
  // Deliberately *not* on the PLAY_COUNTER path above: discarding a card for
  // its printed Counter value is not activating an Event card.
  fireEventActivated(draft, action.player);
}

export function applyPass(draft: GameState, _action: { player: PlayerId }, events: GameEvent[]): void {
  const battle = mustGetBattle(draft);
  if (battle.step === 'block') {
    battle.step = 'counter';
    return;
  }
  resolveBattle(draft, events);
}

/**
 * End of the Battle (CR 7-1-5), reached by the normal route or the early one.
 *
 * Emits nothing: `resolveBattle` announces its own outcome first, and the early
 * exit announces a different event. What is shared is the bookkeeping, and it
 * is shared precisely so the two exits cannot drift.
 *
 * - **CR 7-1-5-3 / 7-1-5-4** — effects that last "during this battle" end, for
 *   the turn player and the non-turn player alike. That is the `endOfBattle`
 *   purge, and it runs on *both* exits: the rules route an early end to 7-1-5
 *   rather than to nothing, so a Counter played into a battle that then
 *   evaporates still expires here rather than leaking into the next one.
 * - **CR 7-1-5-5** — the battle ends and the game returns to 6-5-2, the turn
 *   player's Main Phase. That is the priority hand-back.
 *
 * What it deliberately does **not** do is set the attacker active. CR 7-1-1-1
 * rests the attacker to declare, and nothing in 7-1-5 gives it back; a rested
 * attacker returns to active in its controller's next Refresh Phase (CR 6-2-4)
 * like any other rested card. An attack that evaporates still cost the tap.
 */
function closeBattle(draft: GameState): void {
  draft.modifiers = draft.modifiers.filter((modifier) => modifier.duration !== 'endOfBattle');
  // 7-1-5-3 and 7-1-5-4 say "effects that last 'during this battle'", not
  // "power modifiers": a blocker ban written for this battle expires on exactly
  // the same line, on both exits, for both players.
  expireLegality(draft, 'endOfBattle');
  draft.battle = null;
  draft.priority = draft.activePlayer;
}

/**
 * The battle whose attacker or target left the field, ended per the rules
 * instead of crashed into.
 *
 * The Comprehensive Rules say this three times, once per step, in identical
 * words — CR **7-1-1-4** (end of the Attack Step), **7-1-2-3** (end of the
 * Block Step), and the rule at the end of the Counter Step, which v1.2.0 prints
 * as "7-1-2-3" a second time and plainly means 7-1-3-3:
 *
 * > "If, at the end of the … Step, the attacking card **or** the target card
 * > for the attack has moved areas due to some method, proceed not to the …
 * > Step, but to the End of the Battle (see 7-1-5.)."
 *
 * Four things in that sentence decide the shape of this function:
 *
 * 1. **"the attacking card or the target card"** — the rule is symmetric. A
 *    defender's `[On Block]` or `[On Your Opponent's Attack]` that removes the
 *    attacker ends the battle exactly as an attacker's `[When Attacking]` that
 *    removes the target does. Both sides are checked here.
 * 2. **"has moved areas"**, not "is K.O.'d". K.O. is one way to move areas
 *    (CR 10-2-1-2 places the Character in the trash); a bounce to hand or to
 *    the deck is another, and the rule covers it. `isOnField` is the right
 *    question and the destination is irrelevant.
 * 3. **"the target card for the attack"** — the *current* target. A [Blocker]
 *    makes itself the new target (CR 7-1-2), which this engine models by
 *    reassigning `battle.target`, so reading that field is reading the rule.
 *    `originalTarget` is a spectator by then and is not checked.
 * 4. **"at the end of the … Step"** — a step is not over while an effect it
 *    started is still resolving. So this runs when the game is **quiescent**:
 *    no open choice, no stack, no engine continuation. A `[When Attacking]`
 *    that K.O.s the target and then asks a question has not finished its step,
 *    and the battle it is inside is still the battle it is inside.
 *
 * Called once, from `applyAction`, after `settle` — the single point where the
 * engine returns an observable state. Putting it there rather than in each of
 * the three step handlers is what makes the bad state *unreachable* rather than
 * *tolerated*: there is no path back to a caller that skips it.
 */
export function endBattleIfParticipantLeft(draft: GameState, events: GameEvent[]): void {
  const battle = draft.battle;
  if (battle === null) {
    return;
  }
  // Point 4 above: mid-effect is not the end of a step.
  if (draft.pending !== null || draft.stack.length > 0 || draft.resume.length > 0) {
    return;
  }
  const attackerGone = !isOnField(draft, battle.attacker);
  const targetGone = !isOnField(draft, battle.target);
  if (!attackerGone && !targetGone) {
    return;
  }
  mark('battle.endedEarly');
  emit(draft, events, {
    type: 'battleEndedEarly',
    attacker: battle.attacker,
    target: battle.target,
    gone: attackerGone && targetGone ? 'both' : attackerGone ? 'attacker' : 'target',
  });
  // CR 7-1-5-2 — "effects that read 'at the end of this battle' activate" —
  // fires nothing, because the `Trigger` union has no member for it. When one
  // is added it belongs here and in `resolveBattle`, which is the other reason
  // both exits share `closeBattle`.
  closeBattle(draft);
}

/**
 * Damage step.
 *
 * Powers are compared, the battle is closed, and only then is the outcome
 * applied. Closing first matters now that an outcome can suspend: a life card's
 * `[Trigger]` or an `[On K.O.]` ability can open a choice, and leaving the
 * battle half-open across that pause would mean a state where the battle
 * invariants describe a battle nobody is fighting. Nothing observable moves,
 * because closing emits no events and nothing between the comparison and the
 * outcome can change a power.
 */
function resolveBattle(draft: GameState, events: GameEvent[]): void {
  const battle = mustGetBattle(draft);
  const targetCard = mustGetCard(draft, battle.target);
  const attackPower = getPower(draft, battle.attacker);
  const defensePower = getPower(draft, battle.target);
  const defender = targetCard.controller;
  const targetIsLeader = draft.players[defender].leader === battle.target;
  const attacker = battle.attacker;
  const target = battle.target;

  // The attacker wins ties. Line coverage cannot tell the tie apart from a
  // margin win, so the two are marked separately.
  if (attackPower === defensePower) {
    mark('battle.tie');
  } else if (attackPower > defensePower) {
    mark('battle.attackerWinsByMargin');
  } else {
    mark('battle.attackerLoses');
  }

  // CR 7-1-4-1-2 K.O.s the losing Character; a card may say it cannot be. The
  // question is asked here, where the K.O. is *decided*, and the answer changes
  // only that: CR 7-1-4-1-2 continues "Then, proceed to End of the Battle", and
  // it proceeds there either way. A survived hit is not a battle that never
  // happened, so it gets its own outcome rather than borrowing `noEffect` —
  // the same distinction `battleEndedEarly` exists to keep.
  const wins = attackPower >= defensePower;
  const koPrevented = wins && !targetIsLeader && !canBeKOdInBattle(draft, target);
  if (koPrevented) {
    mark('battle.koPrevented');
  }
  emit(draft, events, {
    type: 'battleResolved',
    attacker,
    target,
    outcome: wins
      ? targetIsLeader
        ? 'lifeDamage'
        : koPrevented
          ? 'koPrevented'
          : 'ko'
      : 'noEffect',
  });

  // Cleanup always runs, even on noEffect: every endOfBattle modifier expires,
  // including ones parked on cards that never fought. Shared with the early
  // exit, which reaches the same End of the Battle (CR 7-1-5).
  closeBattle(draft);

  if (!wins) {
    return;
  }

  if (!targetIsLeader) {
    if (koPrevented) {
      return;
    }
    mark('battle.characterKo');
    // The Damage Step is nobody's effect. CR 10-2-1-3 puts "K.O.'d by an
    // effect" and "due to the result of a battle" on the two sides of an `or`,
    // so the six cards reading "K.O.'d by your opponent's effect" must not wake
    // here — and `koCause` answering `battle` is what keeps them asleep.
    leaveField(draft, target, { kind: 'ko', by: KO_BY_BATTLE }, events);
    return;
  }

  // Double Attack deals two damage; Banish sends the life cards to the trash
  // without their [Trigger] ever being offered. Both are read through
  // hasKeyword, so a granted keyword counts exactly like a printed one.
  const doubleAttack = hasKeyword(draft, attacker, 'doubleAttack');
  const banish = hasKeyword(draft, attacker, 'banish');
  if (doubleAttack) {
    mark('keyword.doubleAttack');
  }
  if (banish) {
    mark('keyword.banish');
  }
  draft.resume.push({
    kind: 'damage',
    player: defender,
    remaining: doubleAttack ? 2 : 1,
    banish,
    first: true,
  });
}

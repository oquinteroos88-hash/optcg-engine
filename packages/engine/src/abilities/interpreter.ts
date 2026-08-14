import type { GameEvent } from '../events.js';
import { mark } from '../instrument.js';
import {
  BOARD_LIMIT,
  detachFromField,
  emit,
  enterCharacterArea,
  finishGame,
  leaveField,
  mustGetCard,
  payDonCost,
  removeFromNonFieldZone,
  setOrientation,
} from '../reducer/helpers.js';
import { finishTurn } from '../reducer/turn.js';
import { getAbilities } from '../registry.js';
import { getCardDef } from '../registry.js';
import { EFFECTIVE, getOpponent, isOnField } from '../selectors.js';
import type {
  ChoiceAnswer,
  GameState,
  InstanceId,
  LegalityRule,
  Orientation,
  PathStep,
  PendingChoice,
  PlayerId,
  ResumeStep,
  StackItem,
} from '../types.js';
import { canPayCosts, discardCandidates } from './costs.js';
import type {
  Ability,
  AbilityContext,
  Cost,
  Duration,
  Instruction,
  PlayerRef,
  Ref,
  ZoneRef,
} from './dsl.js';
import { LOOP_VAR } from './dsl.js';
import { evalCondition, idsFromVar, resolveRef, resolveSelector } from './query.js';
import { fireTriggers, ownedFieldSources } from './triggers.js';

/**
 * The interpreter.
 *
 * A card's effect is a list of instructions and the state records which one it
 * stopped on. There are no callbacks and no saved continuations: when an effect
 * needs an answer it writes a `PendingChoice`, returns, and the reducer ends.
 * Whatever arrives next — the same process or one that rehydrated the state
 * from JSON — resumes from the recorded position and cannot tell the difference.
 *
 * `settle` is the only entry point. `applyAction` calls it after every action;
 * individual reducers push work and return.
 */

// Effects that trigger each other can in principle loop. A bounded settle turns
// that into a loud engine bug instead of a hung process.
const SETTLE_LIMIT = 10_000;

function ctxOf(item: StackItem): AbilityContext {
  return { source: item.source, controller: item.controller, vars: item.vars };
}

function abilityOf(state: GameState, item: StackItem): Ability | null {
  const card = state.cards[item.source];
  if (card === undefined) {
    return null;
  }
  return getAbilities(card.cardId).find((a) => a.id === item.abilityId) ?? null;
}

/**
 * Outside a suspended effect, priority is derived, not remembered: the defender
 * while a battle is open, the active player otherwise. So there is nothing to
 * save when a choice suspends and nothing to restore incorrectly afterwards.
 */
function restorePriority(draft: GameState): void {
  if (draft.status !== 'playing') {
    return;
  }
  draft.priority = draft.battle === null ? draft.activePlayer : getOpponent(draft.activePlayer);
}

function clearEffects(draft: GameState): void {
  draft.stack = [];
  draft.resume = [];
  draft.pending = null;
}

function openChoice(
  draft: GameState,
  events: GameEvent[],
  choice: Omit<PendingChoice, 'id'>,
): void {
  const id = `choice-${draft.log.length}`;
  draft.pending = { ...choice, id };
  draft.priority = choice.player;
  mark('choice.opened');
  emit(draft, events, {
    type: 'choiceOpened',
    player: choice.player,
    choiceId: id,
    kind: choice.kind,
    prompt: choice.prompt,
  });
}

// ---------------------------------------------------------------------------
// Costs
// ---------------------------------------------------------------------------

/**
 * The prompt a `discardHand` cost shows.
 *
 * Derived rather than printed on the cost, so it cannot drift from the filter
 * it is describing: a card that says "{Land of Wano} type" in its prompt and
 * filters on something else would be a lie the type system cannot catch.
 */
function discardPrompt(cost: Extract<Cost, { kind: 'discardHand' }>): string {
  const types = cost.filter?.types;
  const what = types === undefined ? 'card' : `${types.map((t) => `{${t}}`).join(' or ')} type card`;
  return `Trash ${cost.count} ${what}${cost.count === 1 ? '' : 's'} from your hand`;
}

/**
 * Trashes the cards a player chose to pay a `discardHand` cost.
 *
 * Shared by the two ends of the suspension: `applyAnswer` calls it with what the
 * player picked. Nothing else may write this payment, which is what keeps the
 * cost's effect identical whether it was answered in the same process or after
 * a JSON round trip.
 */
function payChosenDiscard(
  draft: GameState,
  player: PlayerId,
  chosen: readonly InstanceId[],
  events: GameEvent[],
): void {
  const ps = draft.players[player];
  for (const id of chosen) {
    const at = ps.hand.indexOf(id);
    if (at === -1) {
      throw new Error('Engine bug: cost discard names a card that is not in hand');
    }
    ps.hand.splice(at, 1);
    ps.trash.unshift(id);
    emit(draft, events, { type: 'cardDiscarded', player, instanceId: id });
  }
  mark('cost.discardHand');
}

/**
 * Applies whichever chosen cost the player just answered.
 *
 * One routine rather than four call sites, for `payChosenDiscard`'s reason:
 * nothing else may write a payment, which is what keeps a cost identical whether
 * it was answered in the same process or after a JSON round trip.
 *
 * The two `restSelf`-less costs are missing on purpose — `restDon`, `returnDon`,
 * `trashSelf`, `restSelf` and `lifeToHand` never open a choice, so an answer can
 * never be about them and the default throws rather than silently doing nothing.
 */
function payChosenCost(
  draft: GameState,
  player: PlayerId,
  cost: Cost,
  chosen: readonly InstanceId[],
  events: GameEvent[],
): void {
  switch (cost.kind) {
    case 'discardHand':
      payChosenDiscard(draft, player, chosen, events);
      return;
    case 'bottomDeckHand': {
      const ps = draft.players[player];
      for (const id of chosen) {
        const at = ps.hand.indexOf(id);
        if (at === -1) {
          throw new Error('Engine bug: bottom-deck cost names a card that is not in hand');
        }
        ps.hand.splice(at, 1);
        ps.deck.push(id);
        emit(draft, events, { type: 'cardMoved', player, instanceId: id, to: 'deck' });
      }
      mark('cost.bottomDeckHand');
      return;
    }
    case 'returnCharacters': {
      // Through `moveCard`, which is the routine `[On Play]`-style bounces
      // already use: it detaches DON!!, clears modifiers and delivers the card
      // to its **owner's** hand (CR 3-1-6). Paying with the source is allowed and
      // is what `rules.selfReturnResolvesEffect` is about — the payment itself is
      // the same move either way.
      for (const id of chosen) {
        moveCard(draft, id, { zone: 'hand' }, 'top', events);
      }
      mark('cost.returnCharacters');
      return;
    }
    case 'restCharacters': {
      for (const id of chosen) {
        // Through the shared transition, so a Character rested to pay for
        // somebody else's ability still *became rested* — the same route
        // `restSelf` takes, and the reason `whenBecomingRested` sees both.
        setOrientation(draft, id, 'rested', events);
      }
      mark('cost.restCharacters');
      return;
    }
    default:
      throw new Error(`Engine bug: ${cost.kind} does not open a choice`);
  }
}

/**
 * Pays one entry of a checked cost list, in printed order (CR 8-3-1-1: multiple
 * actions in one activation cost "are to be carried out in order starting from
 * the text closest to the top" — the order is the card's, never the player's).
 *
 * Returns `false` when the cost opened a choice instead of paying. That is the
 * script's rule applied to the cost list: **the suspending step does not
 * advance the cursor, the answer does.** `canPayCosts` ran before the first
 * entry, so a shortfall here is an engine bug, not a game move.
 *
 * `returnDon` prefers already-rested DON!!, which keeps the player's usable
 * resources intact.
 */
function payCost(
  draft: GameState,
  item: StackItem,
  cost: Cost,
  events: GameEvent[],
): boolean {
  switch (cost.kind) {
    case 'restDon':
      payDonCost(draft, item.controller, cost.count, events);
      return true;
    case 'returnDon': {
      let remaining = cost.count;
      const don = draft.players[item.controller].don;
      for (const orientation of ['rested', 'active'] as const) {
        for (const card of don) {
          if (remaining === 0) {
            break;
          }
          if (card.location.kind === 'cost' && card.location.orientation === orientation) {
            card.location = { kind: 'donDeck' };
            remaining -= 1;
          }
        }
      }
      if (remaining > 0) {
        throw new Error('Engine bug: not enough cost-area DON at return time');
      }
      mark('cost.returnDon');
      emit(draft, events, {
        type: 'donReturnedToDeck',
        player: item.controller,
        count: cost.count,
      });
      // **The only place in the engine where a DON!! card reaches the DON!!
      // deck**, which is why sixteen cards can watch for it from one line. The
      // event has been emitted since PR #11 and had no listener until now; PR
      // #33 wrote the guarantee from the far side, that `addDon` moves DON!!
      // the other way and never emits this.
      //
      // Fired from inside the payment, before the paying ability resolves. That
      // is CR 8-6-3 rather than an accident of placement: the observer's timing
      // is fulfilled the moment the DON!! moves, and `enqueue` puts it *under*
      // the ability that is paying, so the payer finishes first.
      //
      // The observers are on the DON!!'s own controller's field, and there is no
      // second side to tell: a DON!! belongs to one player and returns to that
      // player's deck, so "a DON!! card on your field is returned to your DON!!
      // deck" can only ever be read by that player's cards.
      if (
        fireTriggers(draft, 'whenDonReturnedToDeck', ownedFieldSources(draft, item.controller)) > 0
      ) {
        mark('trigger.donReturnedToDeck');
      }
      return true;
    }
    case 'trashSelf':
      mark('cost.trashSelf');
      if (isOnField(draft, item.source)) {
        leaveField(draft, item.source, { kind: 'cost' }, events);
      }
      return true;
    case 'restSelf': {
      // Paid here, before `status` becomes 'running', so by the time the first
      // instruction executes the source is already rested — CR 8-4-1 runs
      // "pay all activation costs" (8-4-1-3) ahead of activation (8-4-1-4) and
      // resolution (8-4-1-5). A script that reads its own orientation, or a
      // selector that filters on it, sees the paid state.
      const source = draft.cards[item.source];
      if (source === undefined || !isOnField(draft, item.source) || source.orientation !== 'active') {
        throw new Error('Engine bug: rest-self cost paid by a source that cannot rest');
      }
      mark('cost.restSelf');
      // Through the shared transition, so a source that rests to pay for its own
      // ability is a source that *became rested* — the family's fourth route in,
      // and the one a card is most likely to be written to catch.
      setOrientation(draft, item.source, 'rested', events);
      return true;
    }
    case 'lifeToHand': {
      // The one new cost in this batch that asks nothing. CR 3-10-2: "when
      // moving a card from their Life area to another area, a player must select
      // the card at the top of their Life cards unless otherwise specified", and
      // neither printed card otherwise-specifies — `OP01-008` and `OP01-013` say
      // "1 card from your Life area", which the default rule resolves to the top.
      //
      // **No `[Trigger]`.** CR 2-11-1 makes `[Trigger]` "an effect that can be
      // activated instead of the player adding the card from their Life area to
      // their hand **on taking damage**", and CR 4-6-3 offers it only for a card
      // added "during this procedure" — the damage procedure of CR 4-6-2. This is
      // a payment, so the card arrives in hand as an ordinary card and
      // `applyDamage`'s trigger route is not involved.
      const ps = draft.players[item.controller];
      for (let i = 0; i < cost.count; i += 1) {
        const id = ps.life.shift();
        if (id === undefined) {
          throw new Error('Engine bug: life cost paid with an empty Life area');
        }
        ps.hand.push(id);
        mark('cost.lifeToHand');
        emit(draft, events, { type: 'cardMoved', player: item.controller, instanceId: id, to: 'hand' });
      }
      return true;
    }
    case 'bottomDeckHand': {
      const hand = draft.players[item.controller].hand;
      if (hand.length < cost.count) {
        throw new Error('Engine bug: not enough hand cards at bottom-deck time');
      }
      mark('cost.bottomDeckChoice');
      openChoice(draft, events, {
        player: item.controller,
        kind: 'selectCards',
        prompt: `Place ${cost.count} card${cost.count === 1 ? '' : 's'} from your hand at the bottom of your deck`,
        candidates: [...hand],
        min: cost.count,
        max: cost.count,
        sink: { kind: 'cost' },
      });
      return false;
    }
    case 'returnCharacters': {
      const characters = draft.players[item.controller].characters;
      if (characters.length < cost.count) {
        throw new Error('Engine bug: not enough Characters at return time');
      }
      // The source is **not** excluded. Nothing in `OP01-047`'s text excludes it,
      // and a card that means to says so — `OP08-047` prints "other than this
      // Character". What happens after it pays with itself is
      // `rules.selfReturnResolvesEffect`.
      mark('cost.returnCharacterChoice');
      openChoice(draft, events, {
        player: item.controller,
        kind: 'selectCards',
        prompt: `Return ${cost.count} Character${cost.count === 1 ? '' : 's'} to your hand`,
        candidates: [...characters],
        min: cost.count,
        max: cost.count,
        sink: { kind: 'cost' },
      });
      return false;
    }
    case 'restCharacters': {
      const active = draft.players[item.controller].characters.filter(
        (id) => draft.cards[id]?.orientation === 'active',
      );
      if (active.length < cost.count) {
        throw new Error('Engine bug: not enough active Characters at rest time');
      }
      // Active only, for `restSelf`'s reason: resting is a state change and a
      // card already rested has none to make.
      mark('cost.restCharacterChoice');
      openChoice(draft, events, {
        player: item.controller,
        kind: 'selectCards',
        prompt: `Rest ${cost.count} of your Characters`,
        candidates: active,
        min: cost.count,
        max: cost.count,
        sink: { kind: 'cost' },
      });
      return false;
    }
    case 'discardHand': {
      const candidates = discardCandidates(draft, ctxOf(item), cost);
      if (candidates.length < cost.count) {
        throw new Error('Engine bug: not enough matching hand cards at discard time');
      }
      // Always asked, even when the candidates are exactly the cards required.
      // CR 8-3-1-5 has the player select what pays and does not make the
      // selection conditional on there being alternatives, and a payment that
      // sometimes asks and sometimes does not is a payment whose log a client
      // cannot render the same way twice.
      mark('cost.discardChoice');
      openChoice(draft, events, {
        player: item.controller,
        kind: 'selectCards',
        prompt: discardPrompt(cost),
        candidates,
        // A cost is exact. CR 8-3-1-3: if some or all of it cannot be paid it
        // cannot be paid at all — there is no "up to" in a price, and the
        // decline that CR 8-3-1-4 allows happens before payment starts, not
        // inside it.
        min: cost.count,
        max: cost.count,
        sink: { kind: 'cost' },
      });
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

/** Walks the frame path down to the instruction list a frame is executing. */
function blockAt(script: Instruction[], path: readonly PathStep[]): Instruction[] {
  let list = script;
  for (const step of path) {
    const instruction = list[step.i];
    if (instruction === undefined) {
      throw new Error('Engine bug: cursor path points outside the script');
    }
    if (step.branch === 'do') {
      if (instruction.op !== 'forEach') {
        throw new Error('Engine bug: cursor path expected a forEach');
      }
      list = instruction.do;
    } else if (step.branch === 'then') {
      if (instruction.op !== 'if') {
        throw new Error('Engine bug: cursor path expected an if');
      }
      list = instruction.then;
    } else {
      if (instruction.op !== 'if' || instruction.else === undefined) {
        throw new Error('Engine bug: cursor path expected an if/else');
      }
      list = instruction.else;
    }
  }
  return list;
}

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

function playerOf(item: StackItem, ref: PlayerRef): PlayerId {
  return ref === 'you' ? item.controller : getOpponent(item.controller);
}

function targets(state: GameState, item: StackItem, ref: Ref): InstanceId[] {
  return resolveRef(state, ctxOf(item), ref, EFFECTIVE);
}

function draw(draft: GameState, player: PlayerId, count: number, events: GameEvent[]): void {
  for (let i = 0; i < count; i += 1) {
    const top = draft.players[player].deck.shift();
    if (top === undefined) {
      // Same rule as the turn draw: no card to draw is a loss.
      mark('deckOut');
      finishGame(draft, getOpponent(player), 'deckOut', events);
      return;
    }
    draft.players[player].hand.push(top);
    emit(draft, events, { type: 'cardDrawn', player, instanceId: top });
  }
}

function isLeader(state: GameState, id: InstanceId): boolean {
  const card = state.cards[id];
  return card !== undefined && state.players[card.controller].leader === id;
}

function addModifier(
  draft: GameState,
  item: StackItem,
  target: InstanceId,
  duration: Duration,
  grant: { power: number } | { keyword: import('./dsl.js').Keyword },
  events: GameEvent[],
): void {
  // Modifiers only ever live on the field, and an endOfBattle modifier created
  // with no battle open would have a lifetime of zero anyway — creating it
  // would leave the state describing a battle that is not happening.
  if (!isOnField(draft, target)) {
    mark('op.targetGone');
    return;
  }
  if (duration === 'endOfBattle' && draft.battle === null) {
    mark('op.targetGone');
    return;
  }
  // log.length grows monotonically and every branch below emits, so ids are
  // unique across the game.
  const id = `mod-${draft.log.length}`;
  if ('power' in grant) {
    mark('op.addPower');
    draft.modifiers.push({
      id,
      target,
      kind: 'power',
      value: grant.power,
      duration,
      source: item.source,
      // Whose effect this is, and when it was written. Only
      // `endOfOpponentNextTurn` reads either, and both are stored on every
      // modifier rather than on the ones that need them — see `types.ts`.
      controller: item.controller,
      writtenOnTurn: draft.turn,
    });
    emit(draft, events, { type: 'powerGranted', target, value: grant.power, duration });
    return;
  }
  mark('op.grantKeyword');
  draft.modifiers.push({
    id,
    target,
    kind: 'grantKeyword',
    keyword: grant.keyword,
    duration,
    source: item.source,
    controller: item.controller,
    writtenOnTurn: draft.turn,
  });
  emit(draft, events, { type: 'keywordGranted', target, keyword: grant.keyword, duration });
}

/**
 * Writes the timed legality rules one `setLegality` instruction calls for.
 *
 * One rule per named card when the subject is a `Ref`, exactly as `addPower`
 * writes one modifier per target; one rule for the whole side when the subject
 * is a player. The two forms are the two the printed cards need and there is no
 * third: a card either widens what one specific card may do, or narrows what a
 * whole side may do.
 *
 * Rule 1 of the interpreter, twice over. A `whileAttacker` that names nothing —
 * ST01-016's "up to 1" answered with nothing — writes no rule, because a
 * prohibition waiting on a card that was never chosen is a prohibition that can
 * never apply, and the state should not carry it around until the turn ends. A
 * subject `Ref` that names nothing writes nothing for the same reason.
 */
function setLegality(
  draft: GameState,
  item: StackItem,
  instruction: Instruction & { op: 'setLegality' },
  events: GameEvent[],
): void {
  // Same guard `addModifier` carries, same reason: an endOfBattle lifetime with
  // no battle open is a lifetime of zero, and writing it would leave the state
  // describing a battle that is not happening.
  if (instruction.duration === 'endOfBattle' && draft.battle === null) {
    mark('op.setLegalityNoSubject');
    return;
  }
  let whileAttacker: InstanceId | undefined;
  if (instruction.whileAttacker !== undefined) {
    whileAttacker = targets(draft, item, instruction.whileAttacker)[0];
    if (whileAttacker === undefined) {
      mark('op.setLegalityNoSubject');
      return;
    }
  }
  const subjects: LegalityRule['subject'][] =
    'cards' in instruction.subject
      ? targets(draft, item, instruction.subject.cards).map((id) => ({ is: id }))
      : [
          instruction.subject.match === undefined
            ? { player: playerOf(item, instruction.subject.player) }
            : {
                player: playerOf(item, instruction.subject.player),
                match: instruction.subject.match,
              },
        ];
  if (subjects.length === 0) {
    mark('op.setLegalityNoSubject');
    return;
  }
  for (const subject of subjects) {
    mark('op.setLegality');
    draft.legality.push({
      // log.length grows monotonically and the emit below moves it, so ids are
      // unique across the game — the same scheme `addModifier` uses.
      id: `leg-${draft.log.length}`,
      source: item.source,
      duration: instruction.duration,
      // The pair `endOfOpponentNextTurn` needs, and the reason `OP01-085` can
      // aim a prohibition at an opponent's Character and have it still be there
      // when that Character tries to attack: the rule outlives the turn it was
      // written in, and the End Phase can only tell whose it is by asking.
      controller: item.controller,
      writtenOnTurn: draft.turn,
      effect: instruction.effect,
      subject,
      clause: instruction.clause,
      ...(whileAttacker === undefined ? {} : { whileAttacker }),
    });
    emit(draft, events, {
      type: 'legalitySet',
      source: item.source,
      effect: instruction.effect,
      question: instruction.clause.question,
      duration: instruction.duration,
    });
  }
}

function moveCard(
  draft: GameState,
  id: InstanceId,
  to: ZoneRef,
  position: 'top' | 'bottom',
  events: GameEvent[],
): void {
  // A leader never leaves its slot, and a card the effect can no longer find is
  // simply skipped.
  if (isLeader(draft, id)) {
    return;
  }
  const card = draft.cards[id];
  if (card === undefined) {
    return;
  }
  if (isOnField(draft, id)) {
    detachFromField(draft, id, events);
  } else if (!removeFromNonFieldZone(draft, id)) {
    mark('op.targetGone');
    return;
  }
  mark('op.moveCard');
  const ps = draft.players[card.owner];
  switch (to.zone) {
    case 'hand':
      ps.hand.push(id);
      break;
    case 'trash':
      ps.trash.unshift(id);
      break;
    case 'deck':
      if (position === 'bottom') {
        ps.deck.push(id);
      } else {
        ps.deck.unshift(id);
      }
      break;
    case 'life':
      if (position === 'bottom') {
        ps.life.push(id);
      } else {
        ps.life.unshift(id);
      }
      break;
  }
  emit(draft, events, { type: 'cardMoved', player: card.owner, instanceId: id, to: to.zone });
}

/**
 * Attaches DON!! from the controller's cost area onto a card they control.
 *
 * Only *rested* DON!! qualify. Every printed card that gives DON!! this way says
 * "give up to N rested DON!! card(s)", and in the game that word is a
 * restriction, not a search order: an active DON!! is never a legal source, so a
 * cost area holding only active DON!! gives nothing at all. With fewer than
 * `count` rested DON!! available the effect gives what there is — "up to X" is a
 * choice of 0..X, so a short supply is a smaller number, not a failed effect
 * (CR 4-8-1, 8-4-4-1).
 */
function giveDon(
  draft: GameState,
  item: StackItem,
  target: InstanceId,
  count: number,
  events: GameEvent[],
): void {
  const card = draft.cards[target];
  // DON!! may only sit on a card its own controller controls, which is also
  // what the DON!! conservation invariant checks.
  if (card === undefined || card.controller !== item.controller || !isOnField(draft, target)) {
    mark('op.targetGone');
    return;
  }
  let remaining = count;
  for (const don of draft.players[item.controller].don) {
    if (remaining === 0) {
      break;
    }
    if (don.location.kind === 'cost' && don.location.orientation === 'rested') {
      don.location = { kind: 'attached', to: target };
      card.attachedDon.push(don.instanceId);
      remaining -= 1;
    }
  }
  const given = count - remaining;
  if (given > 0) {
    mark('op.giveDon');
    emit(draft, events, { type: 'donAttached', player: item.controller, to: target, count: given });
  }
}

/**
 * Moves up to `count` DON!! out of a player's DON!! deck and into their cost
 * area, in `orientation`.
 *
 * The DON!! Phase's own gain (`reducer/startTurn.ts`) does the same movement
 * with the orientation fixed to active, and the two are deliberately not shared:
 * that one is a phase step bounded by "2 per turn, 1 for the first player on
 * turn 1" (CR 6-4-1) and this one is a card effect bounded by its own printed
 * number. What they *do* share is the shortfall rule, and it is a rule rather
 * than a coincidence — CR 6-4-2 and 6-4-3 place 1 from a 1-card deck and none
 * from an empty one, which is CR 1-3-2's "as many of the actions as possible"
 * applied to this exact movement.
 *
 * Nothing here checks a ten-card ceiling, and nothing needs to: the ten DON!!
 * of CR 5-1-2 are the entire supply, so the cost area cannot hold an eleventh
 * for want of one existing. `checkDonConservation` asserts that from the other
 * end after every action.
 */
function addDon(
  draft: GameState,
  player: PlayerId,
  orientation: Orientation,
  count: number,
  events: GameEvent[],
): void {
  let remaining = count;
  for (const don of draft.players[player].don) {
    if (remaining === 0) {
      break;
    }
    if (don.location.kind === 'donDeck') {
      don.location = { kind: 'cost', orientation };
      remaining -= 1;
    }
  }
  const added = count - remaining;
  if (added === 0) {
    // An empty DON!! deck, which is what a player with all ten in play has.
    mark('op.addDonNone');
    return;
  }
  if (added < count) {
    mark('op.addDonShort');
  }
  mark('op.addDon');
  // Never `donReturnedToDeck`: that is the inverse movement, and sixteen cards
  // in the full set watch for it. This one adds.
  emit(draft, events, { type: 'donAdded', player, count: added, orientation });
}

/**
 * Turns up to `count` of one player's cost-area DON!! to `orientation`.
 *
 * Works by quantity because DON!! are fungible — there is nothing to choose
 * between two rested DON!! — so this takes a count and a player rather than a
 * `Ref`, and never asks the controller which ones.
 *
 * Two exclusions, and only one of them is an optimisation:
 *
 * - Attached DON!! are not candidates at all. A given DON!! is "neither active
 *   nor rested" (CR 4-4-2), which the state models as a `location` union with no
 *   `orientation` field on the attached side. There is no orientation there to
 *   change, and the Q&A for ST02-008 confirms the reading — a DON!! given to a
 *   Character cannot be rested by that effect.
 * - DON!! already in the target orientation are skipped, so `count` is a budget
 *   of DON!! *changed*, not of DON!! looked at. That is the same Q&A again:
 *   resting the opponent's DON!! must "choose up to 1 active DON!! card", so an
 *   all-rested cost area is nothing to choose from and the effect does nothing.
 *   Rule 3 of the interpreter, as always: fewer than asked is a smaller number,
 *   not a failed effect (CR 4-8-1, 8-4-4-1).
 */
function orientDon(
  draft: GameState,
  player: PlayerId,
  orientation: Orientation,
  count: number,
  events: GameEvent[],
): void {
  let remaining = count;
  for (const don of draft.players[player].don) {
    if (remaining === 0) {
      break;
    }
    if (don.location.kind === 'cost' && don.location.orientation !== orientation) {
      don.location = { kind: 'cost', orientation };
      remaining -= 1;
    }
  }
  const turned = count - remaining;
  if (turned > 0) {
    mark('op.orientDon');
    emit(draft, events, { type: 'donOrientationChanged', player, orientation, count: turned });
  }
}

/**
 * Executes one state-changing instruction.
 *
 * Rule 1 of the interpreter lives here: a target that moved on is *ignored*,
 * never a reason to abort. If the character a script meant to KO already left
 * the field, that instruction does nothing and the next one still runs. No
 * instruction can cancel the rest of its script.
 */
function execute(
  draft: GameState,
  item: StackItem,
  instruction: Instruction,
  events: GameEvent[],
): void {
  switch (instruction.op) {
    case 'ko': {
      for (const id of targets(draft, item, instruction.target)) {
        // Leaders cannot be KO'd, and a card that already left is a no-op.
        if (!isOnField(draft, id) || isLeader(draft, id)) {
          mark('op.targetGone');
          continue;
        }
        mark('op.ko');
        // The controller of *this ability* is whose effect did it. CR 8-1-1
        // reads an effect as belonging to the player who activated it, not to
        // the owner of the card it points at, so a Character K.O.'d by the
        // opponent's script sees `by` equal to that opponent — which is exactly
        // the datum the six "K.O.'d by your opponent's effect" cards ask for.
        leaveField(draft, id, { kind: 'ko', by: item.controller }, events);
      }
      return;
    }
    case 'rest':
    case 'setActive': {
      const orientation = instruction.op === 'rest' ? 'rested' : 'active';
      for (const id of targets(draft, item, instruction.target)) {
        if (!isOnField(draft, id)) {
          mark('op.targetGone');
          continue;
        }
        const card = mustGetCard(draft, id);
        if (card.orientation === orientation) {
          continue;
        }
        mark(instruction.op === 'rest' ? 'op.rest' : 'op.setActive');
        // The unchanged-orientation guard above is kept rather than left to
        // `setOrientation`'s own: this one decides whether the *mark* is
        // recorded, and a no-op that counted as a rest would misreport coverage.
        setOrientation(draft, id, orientation, events);
      }
      return;
    }
    case 'addPower': {
      for (const id of targets(draft, item, instruction.target)) {
        addModifier(draft, item, id, instruction.duration, { power: instruction.value }, events);
      }
      return;
    }
    case 'grantKeyword': {
      for (const id of targets(draft, item, instruction.target)) {
        addModifier(draft, item, id, instruction.duration, { keyword: instruction.keyword }, events);
      }
      return;
    }
    case 'moveCard': {
      for (const id of targets(draft, item, instruction.target)) {
        moveCard(draft, id, instruction.to, instruction.position ?? 'top', events);
      }
      return;
    }
    case 'draw': {
      mark('op.draw');
      draw(draft, playerOf(item, instruction.player), instruction.count, events);
      return;
    }
    case 'giveDon': {
      for (const id of targets(draft, item, instruction.target)) {
        giveDon(draft, item, id, instruction.count, events);
      }
      return;
    }
    case 'orientDon': {
      orientDon(
        draft,
        playerOf(item, instruction.player),
        instruction.orientation,
        instruction.count,
        events,
      );
      return;
    }
    case 'setLegality': {
      setLegality(draft, item, instruction, events);
      return;
    }
    case 'addDon': {
      addDon(draft, item.controller, instruction.orientation, instruction.count, events);
      return;
    }
    case 'lookAt': {
      // CR 11-3-2: "cards remain in their original areas while being looked
      // at". So nothing moves — the deck is read, not spent, and the whole op
      // is one variable write.
      const deck = draft.players[item.controller].deck;
      const looked = deck.slice(0, instruction.count);
      item.vars[instruction.as] = looked;
      if (looked.length === 0) {
        // An empty deck yields nothing to look at, and every instruction after
        // this one degrades to a no-op on its own. Rule 1 of the interpreter:
        // nothing aborts.
        mark('op.lookAtNothing');
        return;
      }
      mark('op.lookAt');
      emit(draft, events, {
        type: 'cardsLookedAt',
        player: item.controller,
        instanceIds: looked,
      });
      return;
    }
    case 'reveal': {
      // Two shapes, told apart by which key is present — `Ref`'s discipline. The
      // variable form reveals cards something already chose and binds nothing:
      // `OP01-105` picks two out of the opponent's hand and then reveals *those*.
      const revealed =
        'from' in instruction
          ? resolveSelector(draft, ctxOf(item), instruction.from, EFFECTIVE)
          : idsFromVar(ctxOf(item), instruction.var);
      if ('from' in instruction) {
        item.vars[instruction.as] = revealed;
      }
      mark('from' in instruction ? 'op.reveal' : 'op.revealVar');
      // **Where hidden information will start.** Revealing is the act that makes
      // a card known to a player who could not see it, so a per-player view has
      // to record *who learned what* here rather than merely withholding ids.
      // Filed with the rest of that debt in `docs/op01-inventory.md`; nothing is
      // built for it, and this comment is the pointer the mine asked for.
      emit(draft, events, {
        type: 'cardsRevealed',
        player: item.controller,
        instanceIds: revealed,
      });
      return;
    }
    case 'select':
    case 'confirm':
    case 'play':
    case 'orderToBottom':
    case 'orderToDeckEnds':
    case 'discard':
    case 'if':
    case 'forEach':
      throw new Error(`Engine bug: ${instruction.op} is control flow, not a mutation`);
  }
}

/**
 * `if` and `forEach` do not run anything themselves: they push a frame naming
 * the nested block, and the cursor walks into it. That is why the cursor is a
 * stack of frames rather than a single number — and it stays plain data, so a
 * choice suspended three levels deep still round-trips through JSON.
 */
function pushControlFrame(
  draft: GameState,
  item: StackItem,
  instruction: Instruction & { op: 'if' | 'forEach' },
  frame: { path: PathStep[] },
  at: number,
): void {
  if (instruction.op === 'if') {
    const taken = evalCondition(draft, ctxOf(item), instruction.cond, EFFECTIVE);
    if (taken) {
      mark('op.if');
      item.cursor.push({ path: [...frame.path, { i: at, branch: 'then' }], index: 0, loop: null });
      return;
    }
    if (instruction.else !== undefined) {
      mark('op.ifElse');
      item.cursor.push({ path: [...frame.path, { i: at, branch: 'else' }], index: 0, loop: null });
    }
    return;
  }
  const items = targets(draft, item, instruction.in);
  const first = items[0];
  if (first === undefined) {
    return;
  }
  mark('op.forEach');
  item.vars[LOOP_VAR] = [first];
  item.cursor.push({
    path: [...frame.path, { i: at, branch: 'do' }],
    index: 0,
    loop: { items, at: 0 },
  });
}

// ---------------------------------------------------------------------------
// Stack stepping
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Putting a card on the field
// ---------------------------------------------------------------------------

/**
 * The card a `play` instruction can actually put down, or null.
 *
 * Rule 1 of the interpreter applies in full: a target that cannot be played is
 * *ignored*, never a reason to abort. Three ways to be unplayable, and all three
 * are silent — an Event or a Leader, which has no Character area to enter
 * (CR 3-7-1); a card that is not in one of its owner's off-field zones, which
 * covers a target that already moved on; and somebody else's card, since every
 * printed effect in this set says "from **your** hand".
 */
function playableTarget(
  draft: GameState,
  item: StackItem,
  ref: Ref,
): InstanceId | null {
  for (const id of targets(draft, item, ref)) {
    const card = draft.cards[id];
    if (card === undefined || card.owner !== item.controller) {
      continue;
    }
    if (getCardDef(card.cardId).category !== 'character') {
      mark('op.playNotACharacter');
      continue;
    }
    if (isOnField(draft, id)) {
      continue;
    }
    return id;
  }
  return null;
}

/**
 * Takes `id` out of the zone it is sitting in and puts it on the field.
 *
 * The removal and the placement happen together, in one step, for the reason
 * the whole suspension design exists: a card that had left its zone but not yet
 * reached the field would be a state describing a card that is nowhere.
 */
function playCardFromZone(
  draft: GameState,
  player: PlayerId,
  id: InstanceId,
  rested: boolean,
  trashCharacter: InstanceId | undefined,
  events: GameEvent[],
): void {
  if (!removeFromNonFieldZone(draft, id)) {
    mark('op.targetGone');
    return;
  }
  mark('op.play');
  enterCharacterArea(draft, player, id, events, {
    // CR 3-7-3's sense of "play": placing, with no cost paid. The one thing
    // downstream that reads it is `rules.effectPlayIsPlayingACharacter`.
    route: 'effect',
    ...(rested ? { orientation: 'rested' as const } : {}),
    ...(trashCharacter === undefined ? {} : { trashCharacter }),
  });
}

/**
 * Runs a `play` instruction, returning true when it stopped to ask instead.
 *
 * The only question it can raise is the 6th-Character sacrifice, and CR 3-7-6-1
 * puts it before the placement: the player "should reveal the card they want to
 * play, trash 1 of the Character cards **already in** their Character area, and
 * then play the new Character card". So the choice opens with nothing moved
 * yet — the card is still in hand, the board is still full — and the answer does
 * the trash and the placement in one step.
 *
 * The candidates are the Characters already there, which is also why the card
 * entering cannot be sacrificed to make room for itself.
 */
function playInstruction(
  draft: GameState,
  item: StackItem,
  instruction: Instruction & { op: 'play' },
  events: GameEvent[],
): boolean {
  const id = playableTarget(draft, item, instruction.target);
  if (id === null) {
    mark('op.playNoTarget');
    return false;
  }
  const rested = instruction.rested === true;
  const board = draft.players[item.controller].characters;
  if (board.length < BOARD_LIMIT) {
    playCardFromZone(draft, item.controller, id, rested, undefined, events);
    return false;
  }
  const card = mustGetCard(draft, id);
  mark('op.playNeedsRoom');
  openChoice(draft, events, {
    player: item.controller,
    kind: 'selectCards',
    prompt: `Trash 1 of your Characters to make room for ${getCardDef(card.cardId).name}`,
    candidates: [...board],
    // Exactly one. CR 3-7-6-1 trashes 1 Character, and there is no "up to"
    // about it: the alternative is not playing the card, and that decision was
    // already made when the effect resolved.
    min: 1,
    max: 1,
    sink: { kind: 'play', entering: id, rested },
  });
  return true;
}

/**
 * Puts `ordered` at the bottom of their owner's deck, first card shallowest.
 *
 * The mapping is the whole of the answer's meaning, so it is one loop and it is
 * stated twice — here and in the DSL comment. Each card comes out of wherever
 * it is in the deck and goes to the end, in the order given, which is CR 3-2-3
 * read literally: "when multiple cards in a deck are moved simultaneously, they
 * should be moved one by one". One by one onto the bottom leaves the **last**
 * card placed deepest, so `ordered[0]` is the one its owner draws first.
 *
 * A card that is no longer in the deck is skipped rather than chased. Rule 1 of
 * the interpreter: the ordering was decided about cards that were there, and an
 * effect that moved one on in the meantime does not cancel the placement of the
 * others.
 */
function placeAtBottom(
  draft: GameState,
  ordered: readonly InstanceId[],
  events: GameEvent[],
): void {
  const placed: InstanceId[] = [];
  for (const id of ordered) {
    const card = draft.cards[id];
    if (card === undefined) {
      continue;
    }
    const deck = draft.players[card.owner].deck;
    const at = deck.indexOf(id);
    if (at === -1) {
      mark('op.targetGone');
      continue;
    }
    deck.splice(at, 1);
    deck.push(id);
    placed.push(id);
  }
  const first = placed[0];
  if (first === undefined) {
    return;
  }
  mark('op.orderToBottom');
  emit(draft, events, {
    type: 'deckOrdered',
    player: mustGetCard(draft, first).owner,
    instanceIds: placed,
  });
}

/**
 * Places a partition at the two ends of the deck.
 *
 * **One loop and one sentence, because the mapping is the answer's whole
 * meaning and the two sides must not drift apart.** Both lists read as *draw
 * order*: `top[0]` ends up the very next card its owner draws, `top.at(-1)` the
 * last of the top group, then whatever the deck already held, then `bottom[0]`
 * down to `bottom.at(-1)` deepest in the game.
 *
 * The bottom half is `placeAtBottom`'s rule unchanged — CR 3-2-3, cards moved
 * "one by one", last placed deepest — and the top half is that rule applied to
 * the other end, which is where the ambiguity lives. Placing one by one *onto*
 * the top would leave the **last** card placed on top, so a literal reading of
 * the procedure inverts the top list relative to the bottom one. It is not
 * inverted here, because "in any order" hands the player the sequence they
 * place in: the answer names the arrangement they want and the engine reaches
 * it. Reading the two sides the same way is what stops a client from having to
 * remember which list runs backwards.
 *
 * Cards no longer in the deck are skipped rather than chased, exactly as the
 * bottom-only placement does — rule 1 of the interpreter.
 */
function placeAtDeckEnds(
  draft: GameState,
  top: readonly InstanceId[],
  bottom: readonly InstanceId[],
  events: GameEvent[],
): void {
  const placed: InstanceId[] = [];
  const stillInDeck = (id: InstanceId): boolean => {
    const card = draft.cards[id];
    return card !== undefined && draft.players[card.owner].deck.includes(id);
  };

  // Bottom first, so that the top group's final indices are not disturbed by
  // cards leaving the middle of the deck afterwards. Either order produces the
  // same deck; doing it this way means the top insert is a single splice at 0.
  for (const id of bottom) {
    if (!stillInDeck(id)) {
      mark('op.targetGone');
      continue;
    }
    const deck = draft.players[mustGetCard(draft, id).owner].deck;
    deck.splice(deck.indexOf(id), 1);
    deck.push(id);
    placed.push(id);
  }

  const goingUp: InstanceId[] = [];
  for (const id of top) {
    if (!stillInDeck(id)) {
      mark('op.targetGone');
      continue;
    }
    const deck = draft.players[mustGetCard(draft, id).owner].deck;
    deck.splice(deck.indexOf(id), 1);
    goingUp.push(id);
  }
  // Re-inserted in one go at index 0, in the order given: `goingUp[0]` becomes
  // `deck[0]`, which is the next card drawn.
  const first = goingUp[0];
  if (first !== undefined) {
    draft.players[mustGetCard(draft, first).owner].deck.unshift(...goingUp);
  }

  const anyCard = first ?? placed[0];
  if (anyCard === undefined) {
    return;
  }
  mark('op.orderToDeckEnds');
  emit(draft, events, {
    type: 'deckPartitioned',
    player: mustGetCard(draft, anyCard).owner,
    top: goingUp,
    bottom: placed,
  });
}

/**
 * Runs an `orderToBottom`, returning true when it stopped to ask.
 *
 * The candidates are filtered to cards still in a deck, which is what keeps
 * `checkEffectShape`'s "offers a candidate it cannot place" honest, and the
 * count decides whether there is a question at all: with one card or none the
 * permutation is unique, so the placement happens on the spot. **The engine
 * decides that, not the UI** — a client auto-answering a one-option question is
 * a client holding a rule.
 */
function orderInstruction(
  draft: GameState,
  item: StackItem,
  instruction: Instruction & { op: 'orderToBottom' },
  events: GameEvent[],
): boolean {
  const candidates = targets(draft, item, instruction.cards).filter((id) => {
    const card = draft.cards[id];
    return card !== undefined && draft.players[card.owner].deck.includes(id);
  });
  if (candidates.length <= 1) {
    // Nothing to ask: zero cards is nothing to place, one card has one place to
    // go. Both still *place*, which is the half a "no choice needed" shortcut
    // would be most likely to drop.
    mark('choice.orderTrivial');
    placeAtBottom(draft, candidates, events);
    return false;
  }
  openChoice(draft, events, {
    player: item.controller,
    kind: 'orderCards',
    prompt: instruction.prompt,
    candidates,
    // A permutation is exact at both ends. `validateAnswerChoice` leans on this
    // pair being the candidate count, and `checkEffectShape` asserts it.
    min: candidates.length,
    max: candidates.length,
    sink: { kind: 'orderToBottom' },
  });
  return true;
}

/**
 * Runs an `orderToDeckEnds`, returning true when it stopped to ask.
 *
 * `orderInstruction`'s sibling with **one deliberate difference**: the floor is
 * zero, not one. An ordering of a single card has one possible answer and is
 * placed on the spot; a partition of a single card has one possible *order* and
 * two possible *ends*, so the question is real and gets asked. Only an empty
 * window is silent, and it places nothing because there is nothing to place.
 *
 * The candidate filter is the same and for the same reason — cards still in a
 * deck — which keeps `checkEffectShape`'s "offers a candidate it cannot place"
 * honest, and inherits the short-deck behaviour PR #32 already settled: `lookAt`
 * on a four-card deck records four cards, so this is asked about four. No
 * special case, because a short deck was never a special case.
 */
function partitionInstruction(
  draft: GameState,
  item: StackItem,
  instruction: Instruction & { op: 'orderToDeckEnds' },
  events: GameEvent[],
): boolean {
  const candidates = targets(draft, item, instruction.cards).filter((id) => {
    const card = draft.cards[id];
    return card !== undefined && draft.players[card.owner].deck.includes(id);
  });
  if (candidates.length === 0) {
    mark('choice.partitionTrivial');
    return false;
  }
  openChoice(draft, events, {
    player: item.controller,
    kind: 'partitionCards',
    prompt: instruction.prompt,
    candidates,
    // Every candidate must be placed somewhere, so the pair is the candidate
    // count exactly as an ordering's is — `validateAnswerChoice` leans on it to
    // turn three cheap properties into "exactly this multiset", and
    // `checkEffectShape` asserts it rather than trusting it.
    min: candidates.length,
    max: candidates.length,
    sink: { kind: 'orderToDeckEnds' },
  });
  return true;
}

/**
 * Trashes the cards a player chose out of `owner`'s hand.
 *
 * `payChosenDiscard`'s twin for the instruction half, and deliberately not the
 * same function: that one is a **payment** — it advances `costsPaid`, it is
 * always the controller's own hand, and it marks `cost.discardHand`. This one is
 * an effect resolving, the hand is whichever the instruction named, and the
 * player who *chose* is not necessarily the player who *loses* the card.
 *
 * The event carries the **owner**, never the chooser. `cardDiscarded.player` has
 * meant "whose hand this left" since Phase 0, and it is the reading the printed
 * observers want: the four cards in the full set that watch a discard all say
 * "when a card is trashed from **your** hand", which is a fact about the owner.
 */
function trashChosenFromHand(
  draft: GameState,
  owner: PlayerId,
  chosen: readonly InstanceId[],
  events: GameEvent[],
): void {
  const ps = draft.players[owner];
  for (const id of chosen) {
    const at = ps.hand.indexOf(id);
    if (at === -1) {
      throw new Error('Engine bug: discard names a card that is not in the owner’s hand');
    }
    ps.hand.splice(at, 1);
    ps.trash.unshift(id);
    mark('op.discard');
    emit(draft, events, { type: 'cardDiscarded', player: owner, instanceId: id });
  }
}

/**
 * The prompt the chooser sees, derived rather than printed on the instruction.
 *
 * Same reason `discardPrompt` derives the cost's: a prompt written by hand can
 * drift from what the instruction does. It also has to read correctly from
 * **two** sides — the same op says "Trash 1 card from your hand" to a player
 * emptying their own hand and "Choose 1 card from your opponent's hand to trash"
 * to Kanjuro's opponent — and deriving is what makes that automatic instead of
 * something a card author has to remember.
 */
function discardInstructionPrompt(count: number, chooserOwnsIt: boolean): string {
  const cards = `${count} card${count === 1 ? '' : 's'}`;
  return chooserOwnsIt
    ? `Trash ${cards} from your hand`
    : `Choose ${cards} from your opponent's hand to trash`;
}

/**
 * "Trash N cards from a hand, chosen by a player" — the instruction half of the
 * oldest divergence in the project.
 *
 * **The only instruction that can open a choice to the player who does not
 * control the effect.** Every other `openChoice` in this file passes
 * `item.controller`; this one passes whoever the card named. The machinery
 * underneath needed nothing new — `openChoice` already moves priority to the
 * asked player, `checkEffectShape` already asserts the two agree, and
 * `validateAnswerChoice` already refuses an answer from anyone else with
 * `notYourChoice` — but this is the first script that uses it, so it is the
 * first time a controller can be left holding exactly `[CONCEDE]` by their own
 * card's effect.
 *
 * Nothing is asked when the hand is empty: CR 1-3-2 performs "as many of the
 * actions as possible", which for a discard with nothing to discard is none, and
 * an unanswerable choice would be a game that cannot continue.
 */
function discardInstruction(
  draft: GameState,
  item: StackItem,
  instruction: Instruction & { op: 'discard' },
  events: GameEvent[],
): boolean {
  const owner = playerOf(item, instruction.owner);
  const chooser = playerOf(item, instruction.chooser);
  const hand = draft.players[owner].hand;
  // CR 8-4-4-1: as many as they can, up to the number specified. A short hand
  // trashes what there is rather than nothing.
  const count = Math.min(instruction.count, hand.length);
  if (count === 0) {
    mark('choice.noCandidates');
    return false;
  }
  openChoice(draft, events, {
    player: chooser,
    kind: 'selectCards',
    prompt: discardInstructionPrompt(count, chooser === owner),
    candidates: [...hand],
    // Mandatory: no printed form of this sentence says "may".
    min: count,
    max: count,
    sink: { kind: 'discard', owner },
  });
  return true;
}

/** Opens the choice a suspending instruction needs, or resolves it trivially. */
function suspend(
  draft: GameState,
  item: StackItem,
  instruction: Instruction & {
    op: 'select' | 'confirm' | 'play' | 'orderToBottom' | 'orderToDeckEnds' | 'discard';
  },
  events: GameEvent[],
): boolean {
  if (instruction.op === 'play') {
    return playInstruction(draft, item, instruction, events);
  }
  if (instruction.op === 'discard') {
    return discardInstruction(draft, item, instruction, events);
  }
  if (instruction.op === 'orderToBottom') {
    return orderInstruction(draft, item, instruction, events);
  }
  if (instruction.op === 'orderToDeckEnds') {
    return partitionInstruction(draft, item, instruction, events);
  }
  if (instruction.op === 'confirm') {
    openChoice(draft, events, {
      player: item.controller,
      kind: 'yesNo',
      prompt: instruction.prompt,
      candidates: [],
      min: 0,
      max: 0,
      sink: { kind: 'var', name: instruction.as },
    });
    return true;
  }
  const candidates = resolveSelector(draft, ctxOf(item), instruction.from, EFFECTIVE);
  // Rule 3: a mandatory "choose 2" with one candidate takes the one. The
  // requirement shrinks to what exists rather than cancelling the effect.
  const max = Math.min(instruction.max, candidates.length);
  const min = Math.min(instruction.min, max);
  if (max === 0) {
    item.vars[instruction.as] = [];
    mark('choice.noCandidates');
    return false;
  }
  openChoice(draft, events, {
    player: item.controller,
    kind: 'selectCards',
    prompt: instruction.prompt,
    candidates,
    min,
    max,
    sink: { kind: 'var', name: instruction.as },
  });
  return true;
}

/** Advances the top stack item by exactly one step. */
function stepStack(draft: GameState, events: GameEvent[]): void {
  const item = draft.stack[draft.stack.length - 1];
  if (item === undefined) {
    return;
  }
  const ability = abilityOf(draft, item);
  if (ability === null) {
    draft.stack.pop();
    return;
  }

  if (item.status === 'optIn') {
    openChoice(draft, events, {
      player: item.controller,
      kind: 'yesNo',
      prompt: `Activate ${ability.id}?`,
      candidates: [],
      min: 0,
      max: 0,
      sink: { kind: 'optIn' },
    });
    return;
  }

  if (item.status === 'ready') {
    const costs = ability.cost ?? [];
    // Re-checked at the moment of payment, and *only* on the first entry: an
    // earlier effect in the same chain may have taken the resources away since
    // the ability was queued. Re-asking once payment has begun would ask about
    // a list that is already partly paid — the DON!! a `restDon` just spent are
    // gone, and the whole list would read as unaffordable.
    if (item.costsPaid === 0) {
      if (!canPayCosts(draft, ctxOf(item), costs)) {
        mark('ability.costLostBeforeResolution');
        draft.stack.pop();
        return;
      }
      // Spent as payment *starts*, not once it finishes. CR 10-2-13-5: a
      // [Once Per Turn] effect whose payment breaks down partway through may
      // not be activated again that turn, "even if the effect following that
      // activation cost did not resolve as a result". Charging it after the
      // last cost would hand the use back.
      if (ability.oncePerTurn === true) {
        const card = draft.cards[item.source];
        if (card !== undefined && !card.usedThisTurn.includes(ability.id)) {
          card.usedThisTurn.push(ability.id);
        }
      }
    }
    // One entry per step, in printed order (CR 8-3-1-1), because an entry can
    // stop and ask. `payCost` returning false means it opened a choice and this
    // cursor stays where it is; the answer moves it.
    const cost = costs[item.costsPaid];
    if (cost !== undefined) {
      if (payCost(draft, item, cost, events)) {
        item.costsPaid += 1;
      }
      return;
    }
    // Every cost is paid; the effect activates (CR 8-4-1-4) and resolves
    // (8-4-1-5). The one case where that is a judgement rather than a step is a
    // cost that removed its **own source** from the field — `OP01-047` Law
    // paying "return 1 Character to your hand" with Law. CR 8-1-3-1-3 read
    // against CR 8-4-1's ordering says such an effect never activates; CR
    // 8-3-1-3-1 describes activation as already having happened by the time a
    // payment is in progress. `rules.selfReturnResolvesEffect` picks, and the
    // default keeps the printed card meaning something.
    if (!draft.rules.selfReturnResolvesEffect && costs.length > 0 && !isOnField(draft, item.source)) {
      mark('ability.sourceLeftDuringPayment');
      draft.stack.pop();
      return;
    }
    item.status = 'running';
    mark('ability.resolved');
    emit(draft, events, {
      type: 'abilityTriggered',
      player: item.controller,
      source: item.source,
      abilityId: ability.id,
    });
    return;
  }

  const frame = item.cursor[item.cursor.length - 1];
  if (frame === undefined) {
    draft.stack.pop();
    return;
  }
  const block = blockAt(ability.script, frame.path);

  if (frame.index >= block.length) {
    if (frame.loop !== null) {
      frame.loop.at += 1;
      const next = frame.loop.items[frame.loop.at];
      if (next !== undefined) {
        frame.index = 0;
        item.vars[LOOP_VAR] = [next];
        return;
      }
    }
    item.cursor.pop();
    return;
  }

  const instruction = block[frame.index];
  if (instruction === undefined) {
    throw new Error('Engine bug: cursor index outside its block');
  }

  // Suspending ops do not advance the cursor. The answer advances it, which is
  // what makes "resume at pc + 1" true no matter how the state got here.
  if (
    instruction.op === 'select' ||
    instruction.op === 'confirm' ||
    instruction.op === 'play' ||
    instruction.op === 'orderToBottom' ||
    instruction.op === 'orderToDeckEnds' ||
    instruction.op === 'discard'
  ) {
    if (suspend(draft, item, instruction, events)) {
      return;
    }
    frame.index += 1;
    return;
  }

  const at = frame.index;
  frame.index += 1;
  if (instruction.op === 'if' || instruction.op === 'forEach') {
    pushControlFrame(draft, item, instruction, frame, at);
    return;
  }
  execute(draft, item, instruction, events);
}

// ---------------------------------------------------------------------------
// Engine-level continuations
// ---------------------------------------------------------------------------

function stepResume(draft: GameState, events: GameEvent[]): void {
  const step = draft.resume.pop();
  if (step === undefined) {
    return;
  }
  switch (step.kind) {
    case 'startTurn': {
      finishTurn(draft, step.player, events);
      return;
    }
    case 'damage': {
      dealDamage(draft, step, events);
      return;
    }
  }
}

/**
 * One instance of damage to a leader.
 *
 * The Double Attack case is the reason this is a resume step and not a loop:
 * the `[Trigger]` of the first life card resolves *before* the second damage,
 * so the second instance has to survive an arbitrary pause.
 */
function dealDamage(
  draft: GameState,
  step: Extract<ResumeStep, { kind: 'damage' }>,
  events: GameEvent[],
): void {
  if (step.remaining <= 0) {
    return;
  }
  const ps = draft.players[step.player];
  if (ps.life.length === 0) {
    // Official Q&A: a Double Attack cannot win against a player who had one
    // life card. The first instance takes it; the second finds an empty life
    // area and does nothing. A lone damage instance against an empty life area
    // is still a loss.
    if (step.first || draft.rules.doubleAttackCanWinFromOneLife) {
      mark('lifeOut');
      finishGame(draft, getOpponent(step.player), 'lifeOut', events);
    } else {
      mark('damage.absorbedByEmptyLife');
    }
    return;
  }

  const lifeCard = ps.life.shift();
  if (lifeCard === undefined) {
    throw new Error('Engine bug: life card missing after length check');
  }

  // Queue the rest of the damage first: the trigger goes on the stack, which
  // settle drains before it comes back to this queue.
  if (step.remaining > 1) {
    draft.resume.push({
      kind: 'damage',
      player: step.player,
      remaining: step.remaining - 1,
      banish: step.banish,
      first: false,
    });
  }

  if (step.banish) {
    // Banish sends the life card to the trash without it ever reaching the
    // hand, and its [Trigger] never gets the chance to fire.
    mark('damage.banished');
    draft.players[mustGetCard(draft, lifeCard).owner].trash.unshift(lifeCard);
    emit(draft, events, {
      type: 'lifeBanished',
      player: step.player,
      instanceId: lifeCard,
      remaining: ps.life.length,
    });
    return;
  }

  mark('battle.leaderDamageToHand');
  ps.hand.push(lifeCard);
  emit(draft, events, {
    type: 'lifeTaken',
    player: step.player,
    instanceId: lifeCard,
    remaining: ps.life.length,
  });
  // The card is in hand now; its [Trigger] is offered from there.
  const before = draft.stack.length;
  fireTriggers(draft, 'trigger', [lifeCard]);
  if (draft.stack.length > before) {
    mark('damage.lifeTriggerOffered');
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Runs every effect that can run right now, and stops at the first question.
 *
 * Card effects on the stack drain before engine continuations, which is what
 * puts a life card's `[Trigger]` ahead of the damage instance that follows it.
 */
export function settle(draft: GameState, events: GameEvent[]): void {
  for (let guard = 0; guard < SETTLE_LIMIT; guard += 1) {
    if (draft.status === 'finished') {
      clearEffects(draft);
      return;
    }
    if (draft.pending !== null) {
      return;
    }
    if (draft.stack.length > 0) {
      stepStack(draft, events);
      continue;
    }
    if (draft.resume.length > 0) {
      stepResume(draft, events);
      continue;
    }
    restorePriority(draft);
    return;
  }
  throw new Error('Engine bug: effect resolution did not terminate');
}

/** Writes an accepted answer into the state and lets the effect continue. */
export function applyAnswer(
  draft: GameState,
  answer: ChoiceAnswer,
  events: GameEvent[],
): void {
  const pending = draft.pending;
  if (pending === null) {
    throw new Error('Engine bug: answering with no pending choice');
  }
  emit(draft, events, {
    type: 'choiceAnswered',
    player: pending.player,
    choiceId: pending.id,
  });
  draft.pending = null;

  const item = draft.stack[draft.stack.length - 1];

  if (pending.sink.kind === 'optIn') {
    if (item === undefined) {
      throw new Error('Engine bug: opt-in answer with an empty stack');
    }
    if (answer.kind !== 'yesNo') {
      throw new Error('Engine bug: opt-in answered with a non-yesNo answer');
    }
    if (answer.value) {
      item.status = 'ready';
    } else {
      mark('ability.declined');
      emit(draft, events, {
        type: 'abilityDeclined',
        player: item.controller,
        source: item.source,
        abilityId: item.abilityId,
      });
      draft.stack.pop();
    }
    return;
  }

  if (item === undefined) {
    throw new Error('Engine bug: script answer with an empty stack');
  }

  if (pending.sink.kind === 'play') {
    if (answer.kind !== 'cards') {
      throw new Error('Engine bug: a play sacrifice answered with a non-cards answer');
    }
    const sacrificed = answer.selected[0];
    if (sacrificed === undefined) {
      throw new Error('Engine bug: a play sacrifice answered with nothing');
    }
    // Trash and placement in one step, from a record that already names the
    // card entering — nothing is re-resolved, so the answer cannot land on a
    // different card than the question was about.
    playCardFromZone(
      draft,
      item.controller,
      pending.sink.entering,
      pending.sink.rested,
      sacrificed,
      events,
    );
    const playFrame = item.cursor[item.cursor.length - 1];
    if (playFrame === undefined) {
      throw new Error('Engine bug: answered a play choice with no open frame');
    }
    playFrame.index += 1;
    return;
  }

  if (pending.sink.kind === 'orderToBottom') {
    if (answer.kind !== 'order') {
      throw new Error('Engine bug: an ordering answered with a non-order answer');
    }
    // The answer *is* the placement. Nothing is re-resolved: validation already
    // proved this list is exactly `pending.candidates`, so there is no second
    // reading of a `Ref` that could name a different card than the question was
    // about — the same guarantee the `play` sink buys by carrying its card.
    placeAtBottom(draft, answer.order, events);
    const orderFrame = item.cursor[item.cursor.length - 1];
    if (orderFrame === undefined) {
      throw new Error('Engine bug: answered an ordering with no open frame');
    }
    orderFrame.index += 1;
    return;
  }

  if (pending.sink.kind === 'orderToDeckEnds') {
    if (answer.kind !== 'partition') {
      throw new Error('Engine bug: a partition answered with a non-partition answer');
    }
    // Same contract as the ordering above, one step wider: validation proved the
    // two sides together are exactly `pending.candidates`, so the answer is the
    // placement and no `Ref` is read a second time.
    placeAtDeckEnds(draft, answer.top, answer.bottom, events);
    const partitionFrame = item.cursor[item.cursor.length - 1];
    if (partitionFrame === undefined) {
      throw new Error('Engine bug: answered a partition with no open frame');
    }
    partitionFrame.index += 1;
    return;
  }

  if (pending.sink.kind === 'discard') {
    if (answer.kind !== 'cards') {
      throw new Error('Engine bug: a discard answered with a non-cards answer');
    }
    // The answer is the trashing, the way an ordering's answer is the placement.
    // The owner comes off the sink rather than from a second reading of the
    // instruction, so the cards cannot leave a different hand than the question
    // was about — and the chooser, who may be the other player entirely, has
    // already been checked by `validateAnswerChoice`.
    trashChosenFromHand(draft, pending.sink.owner, answer.selected, events);
    const discardFrame = item.cursor[item.cursor.length - 1];
    if (discardFrame === undefined) {
      throw new Error('Engine bug: answered a discard with no open frame');
    }
    discardFrame.index += 1;
    return;
  }

  if (pending.sink.kind === 'cost') {
    if (answer.kind !== 'cards') {
      throw new Error('Engine bug: cost answered with a non-cards answer');
    }
    // **The sink did not have to grow, and `costsPaid` is why.** Four costs can
    // now open a choice where PR #28 had one, so the answer has to know which
    // price it is paying — and that is exactly what `costsPaid` already names:
    // the cost that suspended did not advance it, so it is still pointing at
    // itself. Recording the kind on the sink would be recording a second time
    // something the stack item already says, and the two could then disagree.
    // `abilityOf` can return null for a source that has left the field, and a
    // cost that removes its own source makes that reachable — `OP01-047` paying
    // with itself is exactly it. The definition is still findable because
    // `getAbilities` reads the registry rather than the board, so the null here
    // means the *instance* is gone, which a payment in progress cannot survive.
    const paying = abilityOf(draft, item)?.cost?.[item.costsPaid];
    if (paying === undefined) {
      throw new Error('Engine bug: a cost answer with no cost at the cursor');
    }
    payChosenCost(draft, item.controller, paying, answer.selected, events);
    // The same rule the script cursor lives by, one level up: the cost that
    // opened this choice did not advance `costsPaid`, so the answer both pays
    // and advances. Between the two there is no half-paid state to serialize.
    item.costsPaid += 1;
    return;
  }

  switch (answer.kind) {
    case 'cards':
      item.vars[pending.sink.name] = [...answer.selected];
      break;
    case 'yesNo':
      item.vars[pending.sink.name] = answer.value;
      break;
    case 'option':
      item.vars[pending.sink.name] = answer.index;
      break;
  }
  // The suspending instruction did not advance the cursor when it opened the
  // choice; the answer does. That is "resume at pc + 1", and it works the same
  // whether or not the state was serialized in between.
  const frame = item.cursor[item.cursor.length - 1];
  if (frame === undefined) {
    throw new Error('Engine bug: answered a choice with no open frame');
  }
  frame.index += 1;
}

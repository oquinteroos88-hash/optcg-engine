import type { GameEvent } from '../events.js';
import { mark } from '../instrument.js';
import {
  detachFromField,
  emit,
  finishGame,
  leaveField,
  mustGetCard,
  payDonCost,
  removeFromNonFieldZone,
} from '../reducer/helpers.js';
import { finishTurn } from '../reducer/turn.js';
import { getAbilities } from '../registry.js';
import { getOpponent, getPower, isOnField } from '../selectors.js';
import type {
  ChoiceAnswer,
  GameState,
  InstanceId,
  Orientation,
  PathStep,
  PendingChoice,
  PlayerId,
  ResumeStep,
  StackItem,
} from '../types.js';
import { canPayCosts } from './costs.js';
import type {
  Ability,
  AbilityContext,
  Duration,
  Instruction,
  PlayerRef,
  Ref,
  ZoneRef,
} from './dsl.js';
import { LOOP_VAR } from './dsl.js';
import { evalCondition, resolveRef, resolveSelector } from './query.js';
import { fireTriggers } from './triggers.js';

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
 * Pays a checked cost list. `canPayCosts` ran first, so a shortfall here is an
 * engine bug, not a game move.
 *
 * `returnDon` prefers already-rested DON!!, which keeps the player's usable
 * resources intact; `discardHand` takes from the front of the hand.
 * TODO phase 2B: let the player choose which cards a `discardHand` cost eats.
 */
function payCosts(draft: GameState, item: StackItem, ability: Ability, events: GameEvent[]): void {
  for (const cost of ability.cost ?? []) {
    switch (cost.kind) {
      case 'restDon':
        payDonCost(draft, item.controller, cost.count, events);
        break;
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
        break;
      }
      case 'trashSelf':
        mark('cost.trashSelf');
        if (isOnField(draft, item.source)) {
          leaveField(draft, item.source, 'cost', events);
        }
        break;
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
        source.orientation = 'rested';
        emit(draft, events, {
          type: 'orientationChanged',
          instanceId: item.source,
          orientation: 'rested',
        });
        break;
      }
      case 'discardHand': {
        const ps = draft.players[item.controller];
        for (let i = 0; i < cost.count; i += 1) {
          const id = ps.hand.shift();
          if (id === undefined) {
            throw new Error('Engine bug: empty hand at discard time');
          }
          ps.trash.unshift(id);
          emit(draft, events, { type: 'cardDiscarded', player: item.controller, instanceId: id });
        }
        mark('cost.discardHand');
        break;
      }
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
  return resolveRef(state, ctxOf(item), ref, getPower);
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
  });
  emit(draft, events, { type: 'keywordGranted', target, keyword: grant.keyword, duration });
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
        leaveField(draft, id, 'ko', events);
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
        card.orientation = orientation;
        emit(draft, events, { type: 'orientationChanged', instanceId: id, orientation });
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
    case 'discard': {
      // Front of the hand, deterministically.
      // TODO phase 2B: let the player choose which cards a discard takes.
      const player = playerOf(item, instruction.player);
      const ps = draft.players[player];
      for (let i = 0; i < instruction.count; i += 1) {
        const id = ps.hand.shift();
        if (id === undefined) {
          return;
        }
        mark('op.discard');
        ps.trash.unshift(id);
        emit(draft, events, { type: 'cardDiscarded', player, instanceId: id });
      }
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
    case 'reveal': {
      const revealed = resolveSelector(draft, ctxOf(item), instruction.from, getPower);
      item.vars[instruction.as] = revealed;
      mark('op.reveal');
      emit(draft, events, {
        type: 'cardsRevealed',
        player: item.controller,
        instanceIds: revealed,
      });
      return;
    }
    case 'select':
    case 'confirm':
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
    const taken = evalCondition(draft, ctxOf(item), instruction.cond, getPower);
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

/** Opens the choice a suspending instruction needs, or resolves it trivially. */
function suspend(
  draft: GameState,
  item: StackItem,
  instruction: Instruction & { op: 'select' | 'confirm' },
  events: GameEvent[],
): boolean {
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
  const candidates = resolveSelector(draft, ctxOf(item), instruction.from, getPower);
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
    const ctx = ctxOf(item);
    // Re-checked at the moment of payment: an earlier effect in the same chain
    // may have taken the resources away since the ability was queued.
    if (!canPayCosts(draft, ctx, ability.cost)) {
      mark('ability.costLostBeforeResolution');
      draft.stack.pop();
      return;
    }
    payCosts(draft, item, ability, events);
    if (ability.oncePerTurn === true) {
      const card = draft.cards[item.source];
      if (card !== undefined && !card.usedThisTurn.includes(ability.id)) {
        card.usedThisTurn.push(ability.id);
      }
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
  if (instruction.op === 'select' || instruction.op === 'confirm') {
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

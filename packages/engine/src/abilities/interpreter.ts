import type { GameEvent } from '../events.js';
import { mark } from '../instrument.js';
import { emit, finishGame, leaveField, mustGetCard, payDonCost } from '../reducer/helpers.js';
import { finishTurn } from '../reducer/turn.js';
import { getAbilities } from '../registry.js';
import { getOpponent, getPower, isOnField } from '../selectors.js';
import type {
  ChoiceAnswer,
  GameState,
  InstanceId,
  PathStep,
  PendingChoice,
  PlayerId,
  ResumeStep,
  StackItem,
} from '../types.js';
import { canPayCosts } from './costs.js';
import type { Ability, AbilityContext, Instruction, PlayerRef, Ref } from './dsl.js';
import { LOOP_VAR } from './dsl.js';
import { resolveRef, resolveSelector } from './query.js';
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

/**
 * Executes one state-changing instruction.
 *
 * Rule 1 of the interpreter lives here: a target that moved on is *ignored*,
 * never a reason to abort. If the character a script meant to KO already left
 * the field, that instruction does nothing and the next one still runs. No
 * instruction can cancel the rest of its script.
 *
 * Three ops for now — enough to prove the suspend/resume cycle end to end
 * before the rest of the instruction set is written on top of it.
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
    case 'draw': {
      mark('op.draw');
      draw(draft, playerOf(item, instruction.player), instruction.count, events);
      return;
    }
    case 'select':
    case 'confirm':
      throw new Error(`Engine bug: ${instruction.op} is control flow, not a mutation`);
    default:
      throw new Error(`Engine bug: op ${instruction.op} is not implemented yet`);
  }
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

  frame.index += 1;
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

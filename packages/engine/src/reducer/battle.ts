import type { GameEvent } from '../events.js';
import { mark } from '../instrument.js';
import { getCardDef } from '../registry.js';
import { getOpponent, getPower, isOwnLeaderOrCharacter } from '../selectors.js';
import type { Battle, GameState, InstanceId, PlayerId } from '../types.js';
import { REASONS } from './errors.js';
import { emit, finishGame, leaveField, mustGetCard } from './helpers.js';

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
  if (attacker.playedOnTurn === state.turn) {
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
  const targetIsLeader = state.players[defender].leader === action.target;
  if (!targetIsLeader && target.orientation !== 'rested') {
    return REASONS.targetNotRested;
  }
  return null;
}

export function applyDeclareAttack(
  draft: GameState,
  action: DeclareAttackAction,
  events: GameEvent[],
): void {
  mustGetCard(draft, action.attacker).orientation = 'rested';
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
}

export function validateDeclareBlock(state: GameState, action: DeclareBlockAction): string | null {
  if (!state.players[action.player].characters.includes(action.blocker)) {
    return REASONS.invalidBlocker;
  }
  const blocker = state.cards[action.blocker];
  if (blocker === undefined) {
    return REASONS.invalidBlocker;
  }
  // No Phase 0 card has Blocker, so this always fires today; the step and the
  // checks below stay real so Phase 1 only has to add the keyword.
  if (!getCardDef(blocker.cardId).keywords.includes('Blocker')) {
    return REASONS.notABlocker;
  }
  if (blocker.orientation !== 'active') {
    return REASONS.blockerNotActive;
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
  mustGetCard(draft, action.blocker).orientation = 'rested';
  battle.target = action.blocker;
  battle.wasBlocked = true;
  battle.step = 'counter';
  emit(draft, events, { type: 'blockDeclared', player: action.player, blocker: action.blocker });
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
  });
  emit(draft, events, {
    type: 'counterPlayed',
    player: action.player,
    instanceId: action.instanceId,
    target: action.target,
    value,
  });
}

export function applyPass(draft: GameState, _action: { player: PlayerId }, events: GameEvent[]): void {
  const battle = mustGetBattle(draft);
  if (battle.step === 'block') {
    battle.step = 'counter';
    return;
  }
  resolveBattle(draft, events);
}

// Damage step. Transient: it runs inside the defender's final PASS, so 'damage'
// is never a resting battle step.
function resolveBattle(draft: GameState, events: GameEvent[]): void {
  const battle = mustGetBattle(draft);
  const attackerCard = mustGetCard(draft, battle.attacker);
  const targetCard = mustGetCard(draft, battle.target);
  const attackPower = getPower(draft, battle.attacker);
  const defensePower = getPower(draft, battle.target);
  const defender = targetCard.controller;

  // The attacker wins ties. Line coverage cannot tell the tie apart from a
  // margin win, so the two are marked separately.
  if (attackPower === defensePower) {
    mark('battle.tie');
  } else if (attackPower > defensePower) {
    mark('battle.attackerWinsByMargin');
  } else {
    mark('battle.attackerLoses');
  }

  if (attackPower >= defensePower) {
    const defenderState = draft.players[defender];
    if (defenderState.leader === battle.target) {
      emit(draft, events, {
        type: 'battleResolved',
        attacker: battle.attacker,
        target: battle.target,
        outcome: 'lifeDamage',
      });
      if (defenderState.life.length === 0) {
        mark('lifeOut');
        finishGame(draft, attackerCard.controller, 'lifeOut', events);
      } else {
        mark('battle.leaderDamageToHand');
        const lifeCard = defenderState.life.shift();
        if (lifeCard === undefined) {
          throw new Error('Engine bug: life card missing after length check');
        }
        // Triggers are out of scope: the card simply joins the hand.
        defenderState.hand.push(lifeCard);
        emit(draft, events, {
          type: 'lifeTaken',
          player: defender,
          instanceId: lifeCard,
          remaining: defenderState.life.length,
        });
      }
    } else {
      emit(draft, events, {
        type: 'battleResolved',
        attacker: battle.attacker,
        target: battle.target,
        outcome: 'ko',
      });
      mark('battle.characterKo');
      leaveField(draft, battle.target, 'ko', events);
    }
  } else {
    emit(draft, events, {
      type: 'battleResolved',
      attacker: battle.attacker,
      target: battle.target,
      outcome: 'noEffect',
    });
  }

  // Cleanup always runs, even on noEffect or after a lifeOut finish: every
  // endOfBattle modifier expires, including ones parked on non-battle cards.
  draft.modifiers = draft.modifiers.filter((modifier) => modifier.duration !== 'endOfBattle');
  draft.battle = null;
  draft.priority = draft.activePlayer;
}

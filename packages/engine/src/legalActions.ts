import { getCardDef } from './registry.js';
import { getActiveCostDon, getOpponent } from './selectors.js';
import type { Action, GameState, PlayerId } from './types.js';

const BOARD_LIMIT = 5;

// Pure and exhaustive: every legal action appears, every emitted action
// validates ok. Priority is the universal gate: the non-priority player gets
// exactly [CONCEDE] while the game is live, and everyone gets [] once finished.
export function legalActions(state: GameState, player: PlayerId): Action[] {
  if (state.status === 'finished') {
    return [];
  }
  if (player !== state.priority) {
    return [{ type: 'CONCEDE', player }];
  }

  const actions: Action[] = [];
  if (state.status === 'mulligan') {
    actions.push({ type: 'MULLIGAN', player, accept: true });
    actions.push({ type: 'MULLIGAN', player, accept: false });
  } else if (state.battle === null) {
    pushMainActions(state, player, actions);
    actions.push({ type: 'END_TURN', player });
  } else if (state.battle.step === 'block') {
    actions.push({ type: 'PASS', player });
    pushBlockActions(state, player, actions);
  } else if (state.battle.step === 'counter') {
    actions.push({ type: 'PASS', player });
    pushCounterActions(state, player, actions);
  }
  actions.push({ type: 'CONCEDE', player });
  return actions;
}

function pushMainActions(state: GameState, player: PlayerId, actions: Action[]): void {
  const ps = state.players[player];
  const activeDon = getActiveCostDon(state, player).length;
  const boardFull = ps.characters.length >= BOARD_LIMIT;

  for (const instanceId of ps.hand) {
    const card = state.cards[instanceId];
    if (card === undefined) {
      continue;
    }
    const def = getCardDef(card.cardId);
    if (def.category === 'leader' || def.cost > activeDon) {
      continue;
    }
    if (def.category === 'character' && boardFull) {
      for (const trashCharacter of ps.characters) {
        actions.push({ type: 'PLAY_CARD', player, instanceId, trashCharacter });
      }
    } else {
      actions.push({ type: 'PLAY_CARD', player, instanceId });
    }
  }

  if (activeDon > 0) {
    for (const to of [ps.leader, ...ps.characters]) {
      for (let count = 1; count <= activeDon; count += 1) {
        actions.push({ type: 'ATTACH_DON', player, to, count });
      }
    }
  }

  pushAttackActions(state, player, actions);
}

function pushAttackActions(state: GameState, player: PlayerId, actions: Action[]): void {
  if (
    state.rules.firstPlayerCannotAttackTurnOne &&
    state.turn === 1 &&
    player === state.firstPlayer
  ) {
    return;
  }
  const ps = state.players[player];
  const enemy = state.players[getOpponent(player)];
  const targets = [
    enemy.leader,
    ...enemy.characters.filter((id) => state.cards[id]?.orientation === 'rested'),
  ];
  for (const attacker of [ps.leader, ...ps.characters]) {
    const card = state.cards[attacker];
    if (card === undefined || card.orientation !== 'active' || card.playedOnTurn === state.turn) {
      continue;
    }
    for (const target of targets) {
      actions.push({ type: 'DECLARE_ATTACK', player, attacker, target });
    }
  }
}

// Real enumeration even though no Phase 0 card carries Blocker: the row stays
// honest for Phase 1.
function pushBlockActions(state: GameState, player: PlayerId, actions: Action[]): void {
  for (const blocker of state.players[player].characters) {
    const card = state.cards[blocker];
    if (
      card !== undefined &&
      card.orientation === 'active' &&
      getCardDef(card.cardId).keywords.includes('Blocker')
    ) {
      actions.push({ type: 'DECLARE_BLOCK', player, blocker });
    }
  }
}

function pushCounterActions(state: GameState, player: PlayerId, actions: Action[]): void {
  const ps = state.players[player];
  const targets = [ps.leader, ...ps.characters];
  for (const instanceId of ps.hand) {
    const card = state.cards[instanceId];
    if (card === undefined || getCardDef(card.cardId).counter === null) {
      continue;
    }
    for (const target of targets) {
      actions.push({ type: 'PLAY_COUNTER', player, instanceId, target });
    }
  }
}

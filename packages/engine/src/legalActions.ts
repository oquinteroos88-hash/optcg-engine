import { canPayCosts } from './abilities/costs.js';
import type { AbilityContext } from './abilities/dsl.js';
import { evalCondition } from './abilities/query.js';
import { getAbilities, getCardDef } from './registry.js';
import { getActiveCostDon, getOpponent, getPower, hasKeyword } from './selectors.js';
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
  // While a choice is open the only move is to answer it, and the answer is not
  // enumerated: for a "select 2 of 7" the subsets alone would be 21 entries, and
  // the space explodes from there. The marker names the question; the shape of
  // a valid answer is data in `state.pending`. This is the single documented
  // exception to legalActions being exhaustive.
  if (state.pending !== null) {
    actions.push({ type: 'ANSWER_CHOICE', player, choiceId: state.pending.id });
    actions.push({ type: 'CONCEDE', player });
    return actions;
  }
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

  pushActivateActions(state, player, actions);
  pushAttackActions(state, player, actions);
}

/**
 * Main-phase activated abilities whose condition holds and whose cost can be
 * paid. An ability that cannot be paid for is not activatable, so it never
 * appears here — a cost is never paid halfway to discover that.
 */
function pushActivateActions(state: GameState, player: PlayerId, actions: Action[]): void {
  const ps = state.players[player];
  const sources = [ps.leader, ...ps.characters];
  if (ps.stage !== null) {
    sources.push(ps.stage);
  }
  for (const instanceId of sources) {
    const card = state.cards[instanceId];
    if (card === undefined) {
      continue;
    }
    for (const ability of getAbilities(card.cardId)) {
      if (ability.trigger !== 'activateMain') {
        continue;
      }
      if (ability.oncePerTurn === true && card.usedThisTurn.includes(ability.id)) {
        continue;
      }
      const ctx: AbilityContext = { source: instanceId, controller: player, vars: {} };
      // Conditions read the power a card has now, statics included (CR 2-6-3,
      // 8-4-1-1). The without-statics reading belongs to static evaluation only.
      if (
        ability.condition !== undefined &&
        !evalCondition(state, ctx, ability.condition, getPower)
      ) {
        continue;
      }
      if (!canPayCosts(state, ctx, ability.cost)) {
        continue;
      }
      actions.push({ type: 'ACTIVATE_ABILITY', player, instanceId, abilityId: ability.id });
    }
  }
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
    if (card === undefined || card.orientation !== 'active') {
      continue;
    }
    // Rush is exactly the exemption from summoning sickness.
    if (card.playedOnTurn === state.turn && !hasKeyword(state, attacker, 'rush')) {
      continue;
    }
    for (const target of targets) {
      actions.push({ type: 'DECLARE_ATTACK', player, attacker, target });
    }
  }
}

// Blocker is asked of `hasKeyword`, never of the printed list: a Blocker
// granted by a continuous effect or a modifier has to be able to block.
function pushBlockActions(state: GameState, player: PlayerId, actions: Action[]): void {
  for (const blocker of state.players[player].characters) {
    const card = state.cards[blocker];
    if (card !== undefined && card.orientation === 'active' && hasKeyword(state, blocker, 'blocker')) {
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

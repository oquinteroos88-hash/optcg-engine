import { legalActions } from './legalActions.js';
import { getOpponent, isOnField } from './selectors.js';
import type { GameState, InstanceId, PlayerId } from './types.js';
import { PLAYER_IDS } from './types.js';

const INSTANCES_PER_PLAYER = 51; // leader + 50 deck cards
const DON_PER_PLAYER = 10;

// Returns human-readable violations; empty array means the state is sound.
// Shared by unit tests and the simulation harness (run after every action).
export function checkInvariants(state: GameState): string[] {
  const violations: string[] = [];
  checkCardConservation(state, violations);
  checkDonConservation(state, violations);
  checkDonBidirectional(state, violations);
  checkFieldLimits(state, violations);
  checkOffFieldNormalized(state, violations);
  checkModifierShape(state, violations);
  checkBattleShape(state, violations);
  checkStateShape(state, violations);
  return violations;
}

export function assertInvariants(state: GameState): void {
  const violations = checkInvariants(state);
  if (violations.length > 0) {
    throw new Error(`Invariant violations:\n${violations.join('\n')}`);
  }
}

// Acceptance criterion 6: while the game is live the non-priority player has
// exactly [CONCEDE]; once finished, both players have [].
export function checkTurnLeak(state: GameState): string[] {
  const violations: string[] = [];
  for (const player of PLAYER_IDS) {
    const actions = legalActions(state, player);
    if (state.status === 'finished') {
      if (actions.length !== 0) {
        violations.push(`${player}: finished game must offer no actions, got ${actions.length}`);
      }
    } else if (player !== state.priority) {
      const soleConcede = actions.length === 1 && actions[0]?.type === 'CONCEDE';
      if (!soleConcede) {
        violations.push(
          `${player}: non-priority player must get exactly [CONCEDE], got ${JSON.stringify(actions)}`,
        );
      }
    }
  }
  return violations;
}

// assertSerializationRoundTrip lives in ./testing/index.ts: it needs node:assert,
// and keeping that import here put a Node builtin in the public barrel's
// dependency tree, which a browser bundler cannot resolve.

function zonesOf(state: GameState, player: PlayerId): Array<[string, readonly InstanceId[]]> {
  const ps = state.players[player];
  return [
    ['leader', [ps.leader]],
    ['characters', ps.characters],
    ['stage', ps.stage === null ? [] : [ps.stage]],
    ['hand', ps.hand],
    ['deck', ps.deck],
    ['trash', ps.trash],
    ['life', ps.life],
  ];
}

function checkCardConservation(state: GameState, violations: string[]): void {
  for (const player of PLAYER_IDS) {
    const seen = new Map<InstanceId, string>();
    let total = 0;
    for (const [zoneName, ids] of zonesOf(state, player)) {
      for (const id of ids) {
        total += 1;
        const previous = seen.get(id);
        if (previous !== undefined) {
          violations.push(`cardConservation: ${id} appears in ${previous} and ${zoneName}`);
        }
        seen.set(id, zoneName);
        const card = state.cards[id];
        if (card === undefined) {
          violations.push(`cardConservation: ${id} referenced by ${player} ${zoneName} but not in cards`);
        } else if (card.owner !== player) {
          violations.push(`cardConservation: ${id} owned by ${card.owner} but in ${player} ${zoneName}`);
        }
      }
    }
    if (total !== INSTANCES_PER_PLAYER) {
      violations.push(
        `cardConservation: ${player} zones hold ${total} instances, expected ${INSTANCES_PER_PLAYER}`,
      );
    }
    for (const [id, card] of Object.entries(state.cards)) {
      if (card.owner === player && !seen.has(id)) {
        violations.push(`cardConservation: ${id} owned by ${player} is in no zone`);
      }
    }
  }
}

function checkDonConservation(state: GameState, violations: string[]): void {
  for (const player of PLAYER_IDS) {
    const ps = state.players[player];
    if (ps.don.length !== DON_PER_PLAYER) {
      violations.push(`donConservation: ${player} has ${ps.don.length} DON, expected ${DON_PER_PLAYER}`);
    }
    const ids = new Set(ps.don.map((don) => don.instanceId));
    if (ids.size !== ps.don.length) {
      violations.push(`donConservation: ${player} has duplicate DON instance ids`);
    }
    for (const don of ps.don) {
      if (don.location.kind === 'attached') {
        const to = don.location.to;
        const carrierOnOwnField = ps.leader === to || ps.characters.includes(to);
        if (!carrierOnOwnField) {
          violations.push(
            `donConservation: ${don.instanceId} attached to ${to}, not ${player}'s leader/character`,
          );
        }
      }
    }
  }
}

function checkDonBidirectional(state: GameState, violations: string[]): void {
  for (const player of PLAYER_IDS) {
    for (const don of state.players[player].don) {
      if (don.location.kind !== 'attached') {
        continue;
      }
      const carrier = state.cards[don.location.to];
      if (carrier === undefined || !carrier.attachedDon.includes(don.instanceId)) {
        violations.push(
          `donBidirectional: ${don.instanceId} points at ${don.location.to} which does not list it`,
        );
      }
    }
  }
  for (const card of Object.values(state.cards)) {
    const seen = new Set<InstanceId>();
    for (const donId of card.attachedDon) {
      if (seen.has(donId)) {
        violations.push(`donBidirectional: ${card.instanceId} lists ${donId} twice`);
      }
      seen.add(donId);
      const don = state.players[card.controller].don.find((d) => d.instanceId === donId);
      if (
        don === undefined ||
        don.location.kind !== 'attached' ||
        don.location.to !== card.instanceId
      ) {
        violations.push(
          `donBidirectional: ${card.instanceId} lists ${donId} which is not attached to it`,
        );
      }
    }
  }
}

function checkFieldLimits(state: GameState, violations: string[]): void {
  for (const player of PLAYER_IDS) {
    const ps = state.players[player];
    if (ps.characters.length > 5) {
      violations.push(`fieldLimits: ${player} has ${ps.characters.length} characters (max 5)`);
    }
    const costCount = ps.don.filter((don) => don.location.kind === 'cost').length;
    if (costCount > 10) {
      violations.push(`fieldLimits: ${player} has ${costCount} DON in the cost area (max 10)`);
    }
  }
}

function checkOffFieldNormalized(state: GameState, violations: string[]): void {
  for (const card of Object.values(state.cards)) {
    if (isOnField(state, card.instanceId)) {
      continue;
    }
    if (
      card.orientation !== 'active' ||
      card.attachedDon.length !== 0 ||
      card.playedOnTurn !== null
    ) {
      violations.push(`offFieldNormalized: ${card.instanceId} is off-field but not normalized`);
    }
  }
}

function checkModifierShape(state: GameState, violations: string[]): void {
  const seen = new Set<string>();
  for (const modifier of state.modifiers) {
    if (seen.has(modifier.id)) {
      violations.push(`modifierShape: duplicate modifier id ${modifier.id}`);
    }
    seen.add(modifier.id);
    if (!isOnField(state, modifier.target)) {
      violations.push(`modifierShape: ${modifier.id} targets off-field ${modifier.target}`);
    }
    if (
      state.status === 'playing' &&
      modifier.duration === 'endOfBattle' &&
      state.battle === null
    ) {
      violations.push(`modifierShape: ${modifier.id} is endOfBattle but no battle is open`);
    }
  }
}

function checkBattleShape(state: GameState, violations: string[]): void {
  const battle = state.battle;
  if (battle === null) {
    return;
  }
  if (battle.step !== 'block' && battle.step !== 'counter') {
    violations.push(`battleShape: resting battle step must be block/counter, got ${battle.step}`);
  }
  const attacker = state.cards[battle.attacker];
  if (attacker === undefined || !isOnField(state, battle.attacker)) {
    violations.push(`battleShape: attacker ${battle.attacker} is not on the field`);
  } else if (attacker.controller !== state.activePlayer) {
    violations.push(`battleShape: attacker ${battle.attacker} not controlled by the active player`);
  }
  const defender = getOpponent(state.activePlayer);
  const target = state.cards[battle.target];
  if (target === undefined || !isOnField(state, battle.target)) {
    violations.push(`battleShape: target ${battle.target} is not on the field`);
  } else if (target.controller !== defender) {
    violations.push(`battleShape: target ${battle.target} not controlled by the defender`);
  }
  if (state.cards[battle.originalTarget] === undefined) {
    violations.push(`battleShape: unknown originalTarget ${battle.originalTarget}`);
  }
}

function checkStateShape(state: GameState, violations: string[]): void {
  if (state.status === 'finished') {
    if (state.winner === null || state.endReason === null) {
      violations.push('stateShape: finished game must have winner and endReason');
    }
  } else if (state.winner !== null || state.endReason !== null) {
    violations.push('stateShape: live game must not have winner or endReason');
  }
  if (state.status === 'mulligan') {
    if (state.turn !== 0) {
      violations.push(`stateShape: mulligan requires turn 0, got ${state.turn}`);
    }
    if (state.battle !== null) {
      violations.push('stateShape: mulligan must have no battle');
    }
  }
  if (state.status === 'playing') {
    if (state.turn < 1) {
      violations.push(`stateShape: playing requires turn >= 1, got ${state.turn}`);
    }
    if (state.battle === null) {
      if (state.phase !== 'main') {
        violations.push(`stateShape: resting playing state must be in main, got ${state.phase}`);
      }
      if (state.priority !== state.activePlayer) {
        violations.push('stateShape: priority must be the active player outside battle');
      }
    } else if (state.priority !== getOpponent(state.activePlayer)) {
      violations.push('stateShape: priority must be the defender during battle');
    }
  }
}

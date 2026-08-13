import { isLegalityRuleLive } from './legality.js';
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
  checkLegalityShape(state, violations);
  checkBattleShape(state, violations);
  checkStateShape(state, violations);
  checkEffectShape(state, violations);
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

/**
 * `checkModifierShape`'s twin, clause for clause, because the two arrays have
 * the same lifetimes and the same ways of going stale.
 *
 * The on-field clause is narrower here on purpose: a modifier always targets one
 * card, so "targets an off-field card" is always a violation. A legality rule
 * may speak about a *side* — "your opponent cannot activate [Blocker]" names no
 * card at all — and only the two identity references it can hold are checkable.
 * Those two are exactly what `dropLegalityNaming` clears (CR 3-1-6), so this is
 * the assertion that the clearing happens on every route off the field.
 */
function checkLegalityShape(state: GameState, violations: string[]): void {
  const seen = new Set<string>();
  for (const rule of state.legality) {
    if (seen.has(rule.id)) {
      violations.push(`legalityShape: duplicate legality rule id ${rule.id}`);
    }
    seen.add(rule.id);
    if (!isLegalityRuleLive(state, rule)) {
      violations.push(`legalityShape: ${rule.id} names a card that is not on the field`);
    }
    if (state.status === 'playing' && rule.duration === 'endOfBattle' && state.battle === null) {
      violations.push(`legalityShape: ${rule.id} is endOfBattle but no battle is open`);
    }
  }
}

/**
 * A battle's shape, with the on-field clauses scoped to a **quiescent** state.
 *
 * The clauses used to be unconditional, and that statement was not strong — it
 * was false. A `[When Attacking]` effect may K.O. the target and then ask a
 * question, and the state that comes back holds an open battle, an open choice,
 * and a target in the trash. The rules say so outright: the battle ends "at the
 * end of the … Step" (CR 7-1-1-4), and a step is not over while an effect it
 * started is still resolving. An invariant that fires on a legal position is a
 * bug in the invariant, and this one did fire — it was the second witness to the
 * crash that `endBattleIfParticipantLeft` now prevents.
 *
 * So the on-field clauses now say what is actually true, and say it about the
 * only states where it can be true:
 *
 * > When no choice is open, no ability is on the stack and no engine
 * > continuation is queued, an open battle's attacker and current target are
 * > both on the field.
 *
 * That is narrower in scope and stronger in force. Narrower, because it exempts
 * the mid-effect window the rules describe. Stronger, because in the states it
 * does cover the engine **guarantees** it — `applyAction` ends such a battle
 * before returning — where before the property was merely asserted and the
 * engine had no way to keep it. The other clauses (step, controllers, a known
 * `originalTarget`) hold in every state and are checked unconditionally, as
 * they always were.
 */
function checkBattleShape(state: GameState, violations: string[]): void {
  const battle = state.battle;
  if (battle === null) {
    return;
  }
  if (battle.step !== 'block' && battle.step !== 'counter') {
    violations.push(`battleShape: resting battle step must be block/counter, got ${battle.step}`);
  }
  const defender = getOpponent(state.activePlayer);
  // Mid-effect: an ability is still resolving and may legitimately have removed
  // a participant a moment ago. `applyAction` closes the battle once it stops.
  const quiescent =
    state.pending === null && state.stack.length === 0 && state.resume.length === 0;

  const attacker = state.cards[battle.attacker];
  if (attacker === undefined) {
    violations.push(`battleShape: unknown attacker ${battle.attacker}`);
  } else {
    if (quiescent && !isOnField(state, battle.attacker)) {
      violations.push(`battleShape: attacker ${battle.attacker} is not on the field`);
    }
    if (attacker.controller !== state.activePlayer) {
      violations.push(
        `battleShape: attacker ${battle.attacker} not controlled by the active player`,
      );
    }
  }

  const target = state.cards[battle.target];
  if (target === undefined) {
    violations.push(`battleShape: unknown target ${battle.target}`);
  } else {
    if (quiescent && !isOnField(state, battle.target)) {
      violations.push(`battleShape: target ${battle.target} is not on the field`);
    }
    if (target.controller !== defender) {
      violations.push(`battleShape: target ${battle.target} not controlled by the defender`);
    }
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
    // A suspended effect owns priority: whoever has to answer holds it, and it
    // goes back to being derived the moment the choice is answered.
    if (state.pending !== null) {
      if (state.priority !== state.pending.player) {
        violations.push('stateShape: priority must be the player who owes an answer');
      }
    } else if (state.battle === null) {
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

/**
 * Effects never rest half-resolved.
 *
 * Between actions the interpreter has run to completion, so a non-empty stack
 * or resume queue means the engine is waiting on somebody — and a finished game
 * means nothing is left waiting at all.
 */
function checkEffectShape(state: GameState, violations: string[]): void {
  const busy = state.stack.length > 0 || state.resume.length > 0;
  if (state.status === 'finished') {
    if (busy || state.pending !== null) {
      violations.push('effectShape: a finished game must have no pending effects');
    }
    return;
  }
  if (state.pending === null && busy) {
    violations.push('effectShape: effects are queued but nothing is waiting on a choice');
  }
  const pending = state.pending;
  if (pending === null) {
    return;
  }
  if (state.stack.length === 0 && state.resume.length === 0) {
    violations.push('effectShape: a choice is open with nothing to resume into');
  }
  if (pending.min > pending.max) {
    violations.push(`effectShape: choice ${pending.id} has min ${pending.min} > max ${pending.max}`);
  }
  if (pending.kind === 'selectCards' || pending.kind === 'orderCards') {
    if (pending.max > pending.candidates.length) {
      violations.push(`effectShape: choice ${pending.id} allows more cards than it offers`);
    }
  }
  // An ordering is a permutation, and `validateAnswerChoice` leans on that:
  // right length plus membership plus distinctness only forces the exact
  // multiset when the length is the whole candidate list. Asserted here rather
  // than assumed there, so a future op that opens a loose ordering fails
  // loudly instead of accepting a partial answer.
  if (pending.kind === 'orderCards') {
    if (pending.min !== pending.candidates.length || pending.max !== pending.candidates.length) {
      violations.push(
        `effectShape: ordering ${pending.id} must ask for all ${pending.candidates.length} candidates, asks ${pending.min}-${pending.max}`,
      );
    }
    if (pending.candidates.length < 2) {
      violations.push(`effectShape: ordering ${pending.id} has no choice to offer`);
    }
  }
  const seen = new Set<InstanceId>();
  for (const id of pending.candidates) {
    if (seen.has(id)) {
      violations.push(`effectShape: choice ${pending.id} lists candidate ${id} twice`);
    }
    seen.add(id);
    if (state.cards[id] === undefined) {
      violations.push(`effectShape: choice ${pending.id} offers unknown candidate ${id}`);
    }
  }
  for (const item of state.stack) {
    if (state.cards[item.source] === undefined) {
      violations.push(`effectShape: stack item ${item.abilityId} has unknown source ${item.source}`);
    }
  }
}

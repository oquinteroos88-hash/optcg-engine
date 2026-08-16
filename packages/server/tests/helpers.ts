import type { Action, Decklist, GameState, InstanceId, PlayerId } from '@optcg/engine';
import { applyAction, blindHandleOrder, PLAYER_IDS } from '@optcg/engine';
import { decide } from '@optcg/engine/testing';
import type { MatchState, HandleActionResult } from '../src/session.js';
import { createMatch, handleAction } from '../src/session.js';
import type { UpdatePayload } from '../src/protocol.js';
import { PROTOCOL_VERSION } from '../src/protocol.js';

/**
 * Wraps a staged `GameState` in a `MatchState`, for tests that need a precise
 * position (Kanjuro's cross-choice) the sweep would reach only by luck. Such a
 * match cannot be replayed from its seed — the staging bypassed the actions —
 * which is exactly why the replay tests use `createMatch` sweeps instead.
 */
export function matchFromGame(game: GameState): MatchState {
  const seats = {} as MatchState['seats'];
  for (const seat of PLAYER_IDS) {
    seats[seat] = { journal: [], droppedChoices: [] };
  }
  return {
    protocol: PROTOCOL_VERSION,
    seed: -1,
    decklists: { p1: { leader: '', cards: [] }, p2: { leader: '', cards: [] } },
    game,
    actions: [],
    seats,
  };
}

export interface SweepResult {
  match: MatchState;
  /** The state createMatch produced — what journal batch zero was redacted
   * against. */
  initialState: GameState;
  /** Every accepted emission, in order, with the state it was redacted against. */
  emissions: { seat: PlayerId; payload: UpdatePayload; state: GameState }[];
  /** Rejection payloads produced by the injected out-of-turn attempts. */
  rejections: { seat: PlayerId; reason: string; state: GameState }[];
  sawBlindChoice: boolean;
  sawShuffle: boolean;
  handleAnswers: number;
  /** How many emitted affordances were re-offered to the engine. */
  offeredChecked: number;
  /** Offered actions the engine then refused — must always be empty. */
  offeredRejected: string[];
}

/**
 * Drives one full game through the session with the shared test policy —
 * `runGame`'s loop with the server in the middle. Blind choices are answered
 * **by handle** (the multiplayer alphabet), which is what makes the replay
 * sweep double as the salt-determinism proof. Every twenty-fifth action the
 * non-priority seat tries to end the turn, so rejection payloads exist for the
 * wire leak test to inspect.
 */
export function driveMatch(
  seed: number,
  decklists: Record<PlayerId, Decklist>,
  opts: { injectRejections?: boolean; checkOffered?: boolean } = {},
): SweepResult {
  let match = createMatch(seed, decklists);
  const initialState = match.game;
  const emissions: SweepResult['emissions'] = [];
  const rejections: SweepResult['rejections'] = [];
  let sawBlindChoice = false;
  let sawShuffle = false;
  let handleAnswers = 0;
  let decision = 0;
  let offeredChecked = 0;
  const offeredRejected: string[] = [];

  for (let step = 0; match.game.status !== 'finished' && step < 1_500; step += 1) {
    if (opts.injectRejections === true && step % 25 === 24) {
      const bystander: PlayerId = match.game.priority === 'p1' ? 'p2' : 'p1';
      const result = handleAction(match, bystander, { type: 'END_TURN', player: bystander });
      if (result.ok) {
        throw new Error('an out-of-priority END_TURN was accepted');
      }
      rejections.push({ seat: bystander, reason: result.reason, state: match.game });
    }

    const player = match.game.priority;
    let action = decide(match.game, player, seed, decision);
    decision += 1;
    if (action === undefined) {
      throw new Error(`no action for ${player} in a live game`);
    }
    const pending = match.game.pending;
    if (
      pending !== null &&
      pending.blind === true &&
      action.type === 'ANSWER_CHOICE' &&
      action.answer?.kind === 'cards'
    ) {
      sawBlindChoice = true;
      const order = blindHandleOrder(pending.id, pending.candidates);
      const selected = action.answer.selected.map((id) => order.indexOf(id));
      action = { ...action, answer: { kind: 'handles', selected } };
      handleAnswers += 1;
    }

    const result: HandleActionResult = handleAction(match, player, action);
    if (!result.ok) {
      throw new Error(`sweep action rejected: ${result.reason}`);
    }
    match = result.match;
    for (const seat of PLAYER_IDS) {
      emissions.push({ seat, payload: result.emitted[seat], state: match.game });
      if (opts.checkOffered !== true) {
        continue;
      }
      // The affordance round-trip, run where the affordances now come from.
      // The `ANSWER_CHOICE` marker is skipped and only that one: it carries no
      // answer by design (enumerating the subsets of a "select 2 of 7" is 21
      // entries), so re-offering it would be testing the documented exception
      // rather than the contract.
      for (const offered of result.emitted[seat].actions) {
        if (offered.type === 'ANSWER_CHOICE') {
          continue;
        }
        offeredChecked += 1;
        const check = applyAction(match.game, offered);
        if (!check.ok) {
          offeredRejected.push(`${offered.type} refused with ${check.reason}`);
        }
      }
    }
    if (result.emitted.p1.events.some((event) => event.type === 'deckShuffled')) {
      sawShuffle = true;
    }
  }

  return {
    match,
    initialState,
    emissions,
    rejections,
    sawBlindChoice,
    sawShuffle,
    handleAnswers,
    offeredChecked,
    offeredRejected,
  };
}

const QUOTED = /"([^"]*)"/g;

function quotedStrings(json: string): Set<string> {
  const out = new Set<string>();
  for (const match of json.matchAll(QUOTED)) {
    out.add(match[1] as string);
  }
  return out;
}

/**
 * The #43 arbiter pointed at the wire: the unknown list is computed **from
 * the opposite side** — the secret zones minus the raw `knownBy` record —
 * never through the machinery under test, and the payload's JSON must not
 * carry a forbidden id as a quoted string.
 */
export function payloadLeaks(state: GameState, seat: PlayerId, payload: unknown): string[] {
  const other: PlayerId = seat === 'p1' ? 'p2' : 'p1';
  const secret: InstanceId[] = [
    ...state.players.p1.deck,
    ...state.players.p2.deck,
    ...state.players.p1.life,
    ...state.players.p2.life,
    ...state.players[other].hand,
  ];
  const unknown = secret.filter((id) => !(state.knownBy[id]?.includes(seat) ?? false));
  const unknownSet = new Set(unknown);
  const knownCardIds = new Set(
    Object.values(state.cards)
      .filter((card) => !unknownSet.has(card.instanceId))
      .map((card) => card.cardId),
  );

  const json = JSON.stringify(payload);
  const present = quotedStrings(json);
  const found: string[] = [];
  for (const id of unknown) {
    if (present.has(id)) {
      found.push(`${seat} sees instance ${id}`);
    }
    const cardId = state.cards[id]?.cardId;
    if (cardId !== undefined && !knownCardIds.has(cardId) && present.has(cardId)) {
      found.push(`${seat} sees printed card ${cardId} (only hidden copies exist)`);
    }
  }
  if (json.includes('"rng"') || json.includes('"seed"') || json.includes('"matchId"')) {
    found.push(`${seat} sees the rng or the seed-bearing matchId`);
  }
  return found;
}

/** Applies a list of actions through the session, asserting each is accepted. */
export function runActions(
  match: MatchState,
  steps: readonly { seat: PlayerId; action: Action }[],
): { match: MatchState; emitted: Record<PlayerId, UpdatePayload>[] } {
  let current = match;
  const emitted: Record<PlayerId, UpdatePayload>[] = [];
  for (const step of steps) {
    const result = handleAction(current, step.seat, step.action);
    if (!result.ok) {
      throw new Error(`action rejected (${result.reason}): ${JSON.stringify(step.action)}`);
    }
    current = result.match;
    emitted.push(result.emitted);
  }
  return { match: current, emitted };
}

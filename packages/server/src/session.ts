import type {
  Action,
  Decklist,
  GameEvent,
  GameState,
  PlayerId,
  PlayerView,
  ViewEvent,
} from '@optcg/engine';
import { applyAction, createGame, playerView, redactEvent, PLAYER_IDS } from '@optcg/engine';
import type { UpdatePayload } from './protocol.js';
import { PROTOCOL_VERSION } from './protocol.js';

/**
 * The session: pure match logic, synchronously testable, and blind to the
 * network. No `Date.now`, no `Math.random`, no I/O — every function here maps
 * plain data to plain data, and the only randomness in the whole server is
 * the `rng` inside `GameState`, which `playerView` already guarantees never
 * leaves.
 *
 * **Zero game rules.** The session routes, persists and replays; every game
 * question is the engine's: `applyAction` validates, `playerView` redacts the
 * state, `redactEvent` redacts the log. If a change here ever needs to decide
 * what is legal, who sees what, or what happens when — stop: that rule
 * belongs in the engine.
 */

export interface MatchState {
  protocol: typeof PROTOCOL_VERSION;
  seed: number;
  decklists: Record<PlayerId, Decklist>;
  game: GameState;
  /**
   * Every accepted action exactly as it arrived, handles included — the
   * replay's single source. `seed + actions` reconstructs `game` byte for
   * byte (`replayMatch` proves it), which is the phase-0 promise with an
   * owner.
   */
  actions: Action[];
  seats: Record<PlayerId, SeatState>;
}

export interface SeatState {
  /**
   * Every emission's redacted events, in order — the authority for
   * reconnection. The engine's log redaction is memoryless (a revealed card
   * shuffled back nulls out even in the reveal that showed it), so
   * re-deriving history produces *more* redaction than a player legitimately
   * saw live. Streaming and re-deriving diverge; the journal is the one that
   * matches what was seen, because it is literally what was sent.
   * Re-derivation is forbidden as a source of history.
   *
   * Events, not whole `update` payloads: each update also carries a full
   * `playerView`, and the view carries the whole redacted log, so journaling
   * payloads is quadratic in game length — measured at 8.4MB average and
   * 16MB worst per seat over the sweep. The events *are* the history a
   * player watched; the present is one `playerView` away at rejoin. What
   * this journal cannot give back is intermediate board snapshots — a
   * declared trade, stated in the protocol doc.
   */
  journal: ViewEvent[][];
  /**
   * The redaction fold's state, threaded across per-action emissions: a
   * foreign yes/no offer that was dropped takes its answer with it, and the
   * answer can arrive actions later. Plain array so the whole `MatchState`
   * survives `JSON.parse(JSON.stringify)` — the same law the engine lives by.
   */
  droppedChoices: string[];
}

export type HandleActionResult =
  | { ok: false; reason: string }
  | { ok: true; match: MatchState; emitted: Record<PlayerId, UpdatePayload> };

/** A new match: the engine's setup, then the opening emission to both seats. */
export function createMatch(seed: number, decklists: Record<PlayerId, Decklist>): MatchState {
  const game = createGame({ seed, decks: decklists, firstPlayer: 'p1' });
  const seats = {} as Record<PlayerId, SeatState>;
  const match: MatchState = { protocol: PROTOCOL_VERSION, seed, decklists, game, actions: [], seats };
  for (const seat of PLAYER_IDS) {
    const seatState: SeatState = { journal: [], droppedChoices: [] };
    seats[seat] = seatState;
    // Entry zero: the setup's own events (gameStarted, and nothing else the
    // seat is entitled to), so a reconnecting client's history starts where a
    // live client's did.
    seatState.journal.push(redactFor(game, seat, game.log, seatState));
  }
  return match;
}

/**
 * One action from one authenticated seat. The seat comes from the transport's
 * token, never from the payload: the engine validates whose *turn* it is, and
 * only this check validates who is *talking* — without it a player could
 * submit the opponent's legal move.
 */
export function handleAction(match: MatchState, seat: PlayerId, action: Action): HandleActionResult {
  const result = applyAction(match.game, action);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  const emitted = {} as Record<PlayerId, UpdatePayload>;
  const seats = {} as Record<PlayerId, SeatState>;
  for (const player of PLAYER_IDS) {
    const seatState: SeatState = {
      journal: [...match.seats[player].journal],
      droppedChoices: [...match.seats[player].droppedChoices],
    };
    const events = redactFor(result.state, player, result.events, seatState);
    const payload: UpdatePayload = {
      type: 'update',
      view: playerView(result.state, player),
      events,
    };
    seatState.journal.push(events);
    seats[player] = seatState;
    emitted[player] = payload;
  }

  return {
    ok: true,
    match: {
      ...match,
      game: result.state,
      actions: [...match.actions, action],
      seats,
    },
    emitted,
  };
}

/**
 * What a seat is told on joining — first time and reconnection alike: the
 * current view plus the seat's whole journal. Nothing is re-derived; the
 * history a returning player reads is the history they watched.
 */
export function rejoinPayload(
  match: MatchState,
  seat: PlayerId,
): { type: 'joined'; protocol: typeof PROTOCOL_VERSION; seat: PlayerId; view: PlayerView; journal: ViewEvent[][] } {
  return {
    type: 'joined',
    protocol: PROTOCOL_VERSION,
    seat,
    view: playerView(match.game, seat),
    journal: match.seats[seat].journal,
  };
}

/**
 * The engine's per-event redaction with the fold state threaded through the
 * seat: redaction itself is entirely the engine's — this only carries the
 * dropped-choice set from one emission to the next and writes it back as
 * plain data.
 */
function redactFor(
  state: GameState,
  seat: PlayerId,
  events: readonly GameEvent[],
  seatState: SeatState,
): ViewEvent[] {
  const dropped = new Set(seatState.droppedChoices);
  const out: ViewEvent[] = [];
  for (const event of events) {
    const redacted = redactEvent(state, seat, event, dropped);
    if (redacted !== null) {
      out.push(redacted);
    }
  }
  for (const id of dropped) {
    if (!seatState.droppedChoices.includes(id)) {
      seatState.droppedChoices.push(id);
    }
  }
  return out;
}

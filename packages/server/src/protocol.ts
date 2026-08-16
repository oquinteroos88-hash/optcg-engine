import type { Action, PlayerId, PlayerView, ViewEvent } from '@optcg/engine';

/**
 * The wire protocol, versioned so an old client fails loudly instead of
 * strangely: the number travels in the join message and the server refuses a
 * mismatch with `protocolMismatch` before anything else happens.
 *
 * **2 — the affordance list joined the payloads (PR #45), and the bump is not
 * a formality.** Adding a field is additive on the wire, but a client that has
 * no `GameState` cannot compute what it may do: `legalActions` is the
 * affordance contract and it needs the whole state to run. A v2 client against
 * a v1 server would receive payloads with no `actions`, render an empty
 * affordance set, and sit there looking like a game where nothing is legal —
 * failing strangely, which is the exact outcome this number exists to prevent.
 */
export const PROTOCOL_VERSION = 2;

/**
 * What a client may send. Everything else coming over the socket is answered
 * with `malformedMessage` — the transport parses, it never interprets.
 */
export type ClientMessage =
  | { type: 'join'; protocol: number; matchId: string; token: string }
  /** An engine action, handles included where the choice is blind. The seat is
   * the socket's, never the payload's: an action whose `player` is not the
   * authenticated seat is refused with `seatMismatch` before the engine sees
   * it, because the engine validates *whose turn it is*, not *who is talking*. */
  | { type: 'action'; action: Action };

/**
 * What a seat receives. `update` is the only game-bearing shape and it is the
 * only thing the journal stores: after every accepted action, each seat gets
 * its **whole** `playerView` plus the events of that action redacted for it —
 * snapshots over diffs, correctness first.
 */
export type ServerToClient =
  /** The answer to a successful join — first join and reconnection alike.
   * `view` is the present; `journal` is the history exactly as this seat saw
   * it live: every emission's redacted events, stored verbatim at the moment
   * of emission and never re-derived. The intermediate board snapshots are
   * not kept — a full-payload journal measured quadratic (8.4MB average,
   * 16MB worst per seat-game in the sweep, the log riding inside every view)
   * while the event journal is the same history at a linear cost. What a
   * returning client cannot do is scrub through past board states; that is a
   * declared trade, not an accident. */
  | {
      type: 'joined';
      protocol: typeof PROTOCOL_VERSION;
      seat: PlayerId;
      view: PlayerView;
      journal: ViewEvent[][];
      actions: Action[];
    }
  | UpdatePayload
  /** Sent only to the seat that acted, with the engine's reason verbatim.
   * Rejections are request/response, not history: they are never journaled
   * and the other seat never learns the attempt existed. */
  | { type: 'rejected'; reason: string }
  /** Transport-level failure. `code` is a server code (below), never an engine
   * reason — the two vocabularies do not mix. */
  | { type: 'error'; code: ServerErrorCode };

export interface UpdatePayload {
  type: 'update';
  view: PlayerView;
  events: ViewEvent[];
  /**
   * What this seat may do now — `legalActions(state, seat)`, verbatim.
   *
   * The affordance contract has always been the engine's list; what PR #45
   * found is that it had no way to travel. A client with a redacted view
   * cannot run `legalActions` — it needs the whole state, hidden zones
   * included — so a networked client that computed its own affordances would
   * be encoding the rules a second time from strictly less information. The
   * engine computes, the server carries, the client indexes.
   *
   * It carries no identity the seat lacks, and that is a property of
   * `legalActions` rather than of a filter here: every action it emits names
   * cards this seat can act *with* — its own hand and field, the opponent's
   * public field — and while a choice is open it emits only the bare
   * `ANSWER_CHOICE` marker, whose payload lives in the redacted `pending`.
   * The wire leak test checks the field like every other, from the opposite
   * side.
   */
  actions: Action[];
}

/**
 * The transport's own vocabulary: authentication and message shape, nothing
 * about the game. Engine reasons answer game questions; these answer "who are
 * you and what did you send".
 */
export const SERVER_ERRORS = {
  protocolMismatch: 'protocolMismatch',
  unknownMatch: 'unknownMatch',
  badToken: 'badToken',
  seatMismatch: 'seatMismatch',
  notJoined: 'notJoined',
  malformedMessage: 'malformedMessage',
} as const;

export type ServerErrorCode = (typeof SERVER_ERRORS)[keyof typeof SERVER_ERRORS];

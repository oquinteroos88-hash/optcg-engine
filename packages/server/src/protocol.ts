import type { Action, PlayerId, PlayerView, ViewEvent } from '@optcg/engine';

/**
 * The wire protocol, versioned so an old client fails loudly instead of
 * strangely: the number travels in the join message and the server refuses a
 * mismatch with `protocolMismatch` before anything else happens.
 */
export const PROTOCOL_VERSION = 1;

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

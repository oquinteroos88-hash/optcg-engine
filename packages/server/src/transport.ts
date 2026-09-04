import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import type { Decklist, PlayerId } from '@optcg/engine';
import type { ServerLimits } from './limits.js';
import { DEFAULT_LIMITS } from './limits.js';
import type { ClientMessage, ServerErrorCode, ServerToClient } from './protocol.js';
import { PROTOCOL_VERSION, SERVER_ERRORS } from './protocol.js';
import type { MatchState } from './session.js';
import { createMatch, handleAction, rejoinPayload } from './session.js';
import { parseClientMessage } from './validate.js';

/**
 * The transport: a thin WebSocket skin over the pure session. It parses,
 * authenticates a seat token, feeds actions to `handleAction`, and delivers
 * each seat exactly the payloads the session emitted for it — nothing more
 * travels, and nothing here decides anything about the game.
 *
 * No accounts, no matchmaking: a `create` opens a match and hands back its id
 * and two seat tokens, and the creator sends one of them to somebody — that
 * link *is* the invitation. Joining is `matchId + token`.
 *
 * **The entropy this module has, and the entropy it does not.** It mints match
 * ids and seat tokens, which name a match and its seats and never reach the
 * board. The game's one source of randomness is still the seed the creator
 * chose, which is what keeps `seed + actions = the match` true — the session's
 * no-own-entropy guarantee is about the *game*, and it holds.
 *
 * A second socket presenting the same token is
 * a reconnection: it takes the seat, the old socket is closed, and the
 * journal is re-emitted — the minimum that lets a dropped player return
 * mid-choice and keep playing.
 *
 * **The perimeter.** This is also the only module that faces the open
 * internet, so every mitigation in `docs/threat-model.md` that is not a test
 * lives here or in `validate.ts`, each marked with its item. The rule that
 * organises them: a socket that sends something the protocol cannot name is
 * told once and closed; a socket that sends a well-formed thing the server
 * cannot honour is told and kept, because the next message may be the right
 * one. The table:
 *
 * | code               | after sending it                                  |
 * | ------------------ | ------------------------------------------------- |
 * | `malformedMessage` | close 1008, reason = the code                     |
 * | `oversizedMessage` | close 1008                                        |
 * | `protocolMismatch` | close 1008                                        |
 * | `rateLimited`      | close 1008                                        |
 * | `internalError`    | close 1011                                        |
 * | `unknownMatch`     | keep; counts as an authentication failure (M4)    |
 * | `badToken`         | keep; counts as an authentication failure (M4)    |
 * | `unknownDeck`      | keep                                              |
 * | `notJoined`        | keep                                              |
 * | `seatMismatch`     | keep                                              |
 * | `serverFull`       | keep                                              |
 *
 * A close reason is always exactly the code and never anything else: it is
 * the one channel that bypasses `send`, and the wire arbiter (M12) holds it to
 * the same vocabulary.
 */

interface MatchEntry {
  match: MatchState;
  tokens: Record<PlayerId, string>;
  sockets: Partial<Record<PlayerId, WebSocket>>;
}

/** What the transport remembers about one socket, and nothing about the
 * person behind it: the perimeter's counters, kept off the match. */
interface Peer {
  /** `unknownMatch` and `badToken` so far; the `MAX_AUTH_FAILURES`-th closes
   * the socket (M4). A guesser gets five tries per TCP handshake. */
  authFailures: number;
}

/**
 * What the transport tells its operator, and the whole of it. `error` is an
 * `Error.name`, never a message and never a stack; `type` is the message type
 * being handled when it is known. No field ever carries a payload, a token,
 * an id or a reason — a log line is another wire (M3, M12).
 */
export interface ServerLogEntry {
  event: 'handlerError' | 'socketError' | 'serverError';
  type?: string;
  error: string;
}

export type ServerLogger = (entry: ServerLogEntry) => void;

export interface GameServer {
  /** The bound port — pass 0 at start to get an ephemeral one. */
  port: number;
  /** The decks a `create` message may name, by id. */
  decks: Record<string, Decklist>;
  /** Registers a match; tokens are the caller's to mint and hand out. */
  createMatch(opts: {
    matchId: string;
    seed: number;
    decklists: Record<PlayerId, Decklist>;
    tokens: Record<PlayerId, string>;
  }): void;
  /** Read access for tests and tooling; the wire never carries this. */
  getMatch(matchId: string): MatchState | undefined;
  close(): Promise<void>;
}

/**
 * The codes that end the conversation, with the close code each one earns:
 * 1008 (policy violation) for a sender that broke the protocol, 1011
 * (internal error) for the one case where the server did. Everything not
 * listed keeps the socket.
 */
const CLOSE_AFTER: Partial<Record<ServerErrorCode, number>> = {
  [SERVER_ERRORS.malformedMessage]: 1008,
  [SERVER_ERRORS.oversizedMessage]: 1008,
  [SERVER_ERRORS.protocolMismatch]: 1008,
  [SERVER_ERRORS.rateLimited]: 1008,
  [SERVER_ERRORS.internalError]: 1011,
};

export function startServer(opts: {
  port: number;
  /**
   * The deck catalog a `create` may name. Injected rather than imported: the
   * library holds no card data, which is what keeps `@optcg/engine` its only
   * game dependency. The runnable entry point supplies the real set. Held by
   * reference, so the catalog stays whatever the caller handed over — a test
   * may hand over one that throws, to prove the handler path survives it.
   */
  decks?: Record<string, Decklist>;
  /** Overrides for `limits.ts`, for tests that want a cap within reach. */
  limits?: Partial<ServerLimits>;
  /** Where the transport reports; silent by default, because a library has
   * no business writing to a console it was not given. */
  log?: ServerLogger;
}): Promise<GameServer> {
  const limits: ServerLimits = { ...DEFAULT_LIMITS, ...opts.limits };
  const log: ServerLogger = opts.log ?? (() => undefined);
  const matches = new Map<string, MatchEntry>();
  const seatsBySocket = new Map<WebSocket, { matchId: string; seat: PlayerId }>();
  const peers = new Map<WebSocket, Peer>();
  const decks: Record<string, Decklist> = opts.decks ?? {};
  // M2: `ws` refuses a frame over the limit before assembling it, closing
  // with 1009 on its own; the parser applies the same number to the string.
  const wss = new WebSocketServer({ port: opts.port, maxPayload: limits.MAX_MESSAGE_BYTES });

  wss.on('connection', (socket) => {
    peers.set(socket, { authFailures: 0 });
    socket.on('message', (data) => {
      // M3: the whole per-message path under one try/catch. A throw is one
      // log line, one `internalError`, one closed socket — and the process,
      // with every other match on it, keeps going.
      let type = 'unparsed';
      try {
        const parsed = parseClientMessage(String(data), limits);
        if (!parsed.ok) {
          refuse(socket, parsed.code);
          return;
        }
        type = parsed.message.type;
        dispatch(socket, parsed.message);
      } catch (error) {
        log({ event: 'handlerError', type, error: errorName(error) });
        refuse(socket, SERVER_ERRORS.internalError);
      }
    });
    // M3: an `error` an emitter has no listener for is a throw.
    socket.on('error', (error) => log({ event: 'socketError', error: errorName(error) }));
    socket.on('close', () => {
      peers.delete(socket);
      const seat = seatsBySocket.get(socket);
      seatsBySocket.delete(socket);
      if (seat !== undefined) {
        const entry = matches.get(seat.matchId);
        if (entry !== undefined && entry.sockets[seat.seat] === socket) {
          delete entry.sockets[seat.seat];
        }
      }
    });
  });

  function dispatch(socket: WebSocket, message: ClientMessage): void {
    if (message.type === 'create') {
      handleCreate(socket, message);
      return;
    }
    if (message.type === 'join') {
      handleJoin(socket, message);
      return;
    }
    handleActionMessage(socket, message);
  }

  /** The error channel, and the close policy in the table above. */
  function refuse(socket: WebSocket, code: ServerErrorCode): void {
    send(socket, { type: 'error', code });
    const closeCode = CLOSE_AFTER[code];
    if (closeCode !== undefined) {
      socket.close(closeCode, code);
      return;
    }
    // M4: a wrong match id or a wrong token is a guess, and the socket gets
    // a bounded number of them. A player who mistyped a seat code has several
    // tries; a guesser has the same several, against 122 bits per try.
    if (code === SERVER_ERRORS.unknownMatch || code === SERVER_ERRORS.badToken) {
      const peer = peers.get(socket);
      if (peer !== undefined) {
        peer.authFailures += 1;
        if (peer.authFailures >= limits.MAX_AUTH_FAILURES) {
          socket.close(1008, SERVER_ERRORS.badToken);
        }
      }
    }
  }

  function handleCreate(
    socket: WebSocket,
    message: Extract<ClientMessage, { type: 'create' }>,
  ): void {
    if (message.protocol !== PROTOCOL_VERSION) {
      refuse(socket, SERVER_ERRORS.protocolMismatch);
      return;
    }
    const p1 = decks[message.deckIdP1];
    const p2 = decks[message.deckIdP2];
    if (p1 === undefined || p2 === undefined) {
      refuse(socket, SERVER_ERRORS.unknownDeck);
      return;
    }
    // The two things this server invents. Neither is game state: they name a
    // match and its seats, and the game's only randomness is still the seed
    // the creator chose — which is what keeps `seed + actions = the match`
    // true of every match this opens.
    const matchId = randomUUID();
    const tokens: Record<PlayerId, string> = { p1: randomUUID(), p2: randomUUID() };
    matches.set(matchId, {
      match: createMatch(message.seed, { p1, p2 }),
      tokens,
      sockets: {},
    });
    send(socket, { type: 'created', protocol: PROTOCOL_VERSION, matchId, tokens });
  }

  function handleJoin(socket: WebSocket, message: Extract<ClientMessage, { type: 'join' }>): void {
    if (message.protocol !== PROTOCOL_VERSION) {
      refuse(socket, SERVER_ERRORS.protocolMismatch);
      return;
    }
    const entry = matches.get(message.matchId);
    if (entry === undefined) {
      refuse(socket, SERVER_ERRORS.unknownMatch);
      return;
    }
    const seat = seatForToken(entry, message.token);
    if (seat === null) {
      refuse(socket, SERVER_ERRORS.badToken);
      return;
    }
    // Reconnection: the token re-authenticates, the newcomer takes the seat,
    // and whatever socket held it before is closed rather than left as a
    // second pair of eyes on the same seat.
    const previous = entry.sockets[seat];
    if (previous !== undefined && previous !== socket) {
      seatsBySocket.delete(previous);
      previous.close();
    }
    entry.sockets[seat] = socket;
    seatsBySocket.set(socket, { matchId: message.matchId, seat });
    send(socket, rejoinPayload(entry.match, seat));
  }

  function handleActionMessage(
    socket: WebSocket,
    message: Extract<ClientMessage, { type: 'action' }>,
  ): void {
    const seatInfo = seatsBySocket.get(socket);
    if (seatInfo === undefined) {
      refuse(socket, SERVER_ERRORS.notJoined);
      return;
    }
    const entry = matches.get(seatInfo.matchId);
    if (entry === undefined) {
      refuse(socket, SERVER_ERRORS.unknownMatch);
      return;
    }
    // The engine validates whose turn it is; only this validates who is
    // talking. Without it a seat could submit the opponent's legal move.
    if (message.action.player !== seatInfo.seat) {
      refuse(socket, SERVER_ERRORS.seatMismatch);
      return;
    }
    const result = handleAction(entry.match, seatInfo.seat, message.action);
    if (!result.ok) {
      // The engine's reason verbatim, to the actor alone: the other seat
      // never learns the attempt existed.
      send(socket, { type: 'rejected', reason: result.reason });
      return;
    }
    entry.match = result.match;
    for (const [player, payload] of Object.entries(result.emitted) as [
      PlayerId,
      (typeof result.emitted)[PlayerId],
    ][]) {
      const target = entry.sockets[player];
      if (target !== undefined) {
        send(target, payload);
      }
      // A disconnected seat misses nothing: the payload is already in its
      // journal, which the reconnecting join re-emits.
    }
  }

  return new Promise((resolve, reject) => {
    wss.once('error', reject);
    wss.once('listening', () => {
      // M3: after startup the server's own errors are reported, not thrown.
      wss.on('error', (error) => log({ event: 'serverError', error: errorName(error) }));
      const address = wss.address() as AddressInfo;
      resolve({
        port: address.port,
        decks,
        createMatch({ matchId, seed, decklists, tokens }) {
          matches.set(matchId, { match: createMatch(seed, decklists), tokens, sockets: {} });
        },
        getMatch(matchId) {
          return matches.get(matchId)?.match;
        },
        close() {
          return new Promise<void>((done) => {
            for (const client of wss.clients) {
              client.close();
            }
            wss.close(() => done());
          });
        },
      });
    });
  });
}

/**
 * M4: the comparison takes the same time whether the guess shares no
 * character with the token or all but the last. `timingSafeEqual` needs equal
 * lengths, so the length is compared first — the length of a UUID is not a
 * secret, and a candidate of another length is wrong before any byte is read.
 */
function seatForToken(entry: MatchEntry, token: string): PlayerId | null {
  const candidate = Buffer.from(token);
  if (sameToken(candidate, entry.tokens.p1)) {
    return 'p1';
  }
  if (sameToken(candidate, entry.tokens.p2)) {
    return 'p2';
  }
  return null;
}

function sameToken(candidate: Buffer, token: string): boolean {
  const expected = Buffer.from(token);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** The name and only the name: a message can quote the payload that caused
 * it, and a log line is a wire like any other. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function send(socket: WebSocket, payload: ServerToClient): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

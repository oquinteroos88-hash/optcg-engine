import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import type { Decklist, PlayerId } from '@optcg/engine';
import type { ClientMessage, ServerToClient } from './protocol.js';
import { PROTOCOL_VERSION, SERVER_ERRORS } from './protocol.js';
import type { MatchState } from './session.js';
import { createMatch, handleAction, rejoinPayload } from './session.js';

/**
 * The transport: a thin WebSocket skin over the pure session. It parses,
 * authenticates a seat token, feeds actions to `handleAction`, and delivers
 * each seat exactly the payloads the session emitted for it — nothing more
 * travels, and nothing here decides anything about the game.
 *
 * No accounts, no matchmaking: a match is registered with two seat tokens
 * (the caller mints them; this module has no randomness of its own, which
 * keeps the session's no-own-entropy guarantee true of the whole server), and
 * joining is `matchId + token`. A second socket presenting the same token is
 * a reconnection: it takes the seat, the old socket is closed, and the
 * journal is re-emitted — the minimum that lets a dropped player return
 * mid-choice and keep playing.
 */

interface MatchEntry {
  match: MatchState;
  tokens: Record<PlayerId, string>;
  sockets: Partial<Record<PlayerId, WebSocket>>;
}

export interface GameServer {
  /** The bound port — pass 0 at start to get an ephemeral one. */
  port: number;
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

export function startServer(opts: { port: number }): Promise<GameServer> {
  const matches = new Map<string, MatchEntry>();
  const seatsBySocket = new Map<WebSocket, { matchId: string; seat: PlayerId }>();
  const wss = new WebSocketServer({ port: opts.port });

  wss.on('connection', (socket) => {
    socket.on('message', (data) => {
      const message = parseMessage(String(data));
      if (message === null) {
        send(socket, { type: 'error', code: SERVER_ERRORS.malformedMessage });
        return;
      }
      if (message.type === 'join') {
        handleJoin(socket, message);
        return;
      }
      handleActionMessage(socket, message);
    });
    socket.on('close', () => {
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

  function handleJoin(socket: WebSocket, message: Extract<ClientMessage, { type: 'join' }>): void {
    if (message.protocol !== PROTOCOL_VERSION) {
      send(socket, { type: 'error', code: SERVER_ERRORS.protocolMismatch });
      return;
    }
    const entry = matches.get(message.matchId);
    if (entry === undefined) {
      send(socket, { type: 'error', code: SERVER_ERRORS.unknownMatch });
      return;
    }
    const seat = seatForToken(entry, message.token);
    if (seat === null) {
      send(socket, { type: 'error', code: SERVER_ERRORS.badToken });
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
      send(socket, { type: 'error', code: SERVER_ERRORS.notJoined });
      return;
    }
    const entry = matches.get(seatInfo.matchId);
    if (entry === undefined) {
      send(socket, { type: 'error', code: SERVER_ERRORS.unknownMatch });
      return;
    }
    // The engine validates whose turn it is; only this validates who is
    // talking. Without it a seat could submit the opponent's legal move.
    if (
      typeof message.action !== 'object' ||
      message.action === null ||
      message.action.player !== seatInfo.seat
    ) {
      send(socket, { type: 'error', code: SERVER_ERRORS.seatMismatch });
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
      const address = wss.address() as AddressInfo;
      resolve({
        port: address.port,
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

function seatForToken(entry: MatchEntry, token: string): PlayerId | null {
  if (entry.tokens.p1 === token) {
    return 'p1';
  }
  if (entry.tokens.p2 === token) {
    return 'p2';
  }
  return null;
}

/** Parses without trusting: a shape this cannot name is `malformedMessage`. */
function parseMessage(raw: string): ClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const message = parsed as Record<string, unknown>;
  if (message['type'] === 'join') {
    return typeof message['protocol'] === 'number' &&
      typeof message['matchId'] === 'string' &&
      typeof message['token'] === 'string'
      ? (parsed as ClientMessage)
      : null;
  }
  if (message['type'] === 'action') {
    // The action itself is untrusted JSON too — and stays that way: the
    // engine's own structural validation is the authority on its shape, and
    // rejects with its own reasons.
    return typeof message['action'] === 'object' && message['action'] !== null
      ? (parsed as ClientMessage)
      : null;
  }
  return null;
}

function send(socket: WebSocket, payload: ServerToClient): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

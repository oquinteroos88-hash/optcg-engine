import type { Action } from '@optcg/engine';
import type { ClientMessage, ServerToClient } from '@optcg/server/protocol';
import { PROTOCOL_VERSION } from '@optcg/server/protocol';
import { setNetSend, useStore } from '../store/store';

/**
 * The client's half of the wire.
 *
 * It owns the socket and nothing else: every message it receives goes straight
 * into a store action, and every action the store dispatches goes straight out.
 * It decides nothing about the game — the same rule the server keeps on its
 * side, and for the same reason.
 *
 * **Reconnection is the token, and that is all it is.** A dropped socket is
 * retried on a backoff with the seat token that was saved when the match was
 * joined; the server re-authenticates it, hands back the present plus the
 * journal of everything this seat was sent, and play continues. Nothing about
 * the game is resent by this layer, because nothing about the game is known to
 * it.
 */

/** Where the seat token lives between reloads. Nothing else is persisted. */
const STORAGE_KEY = 'optcg.seat';

export interface SeatCredentials {
  url: string;
  matchId: string;
  token: string;
}

export function saveCredentials(creds: SeatCredentials): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(creds));
  } catch {
    // A browser with storage disabled still plays; it just cannot come back
    // after a reload. Losing the seat is not worth failing the join over.
  }
}

export function loadCredentials(): SeatCredentials | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw === null || raw === undefined) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<SeatCredentials>;
    if (
      typeof parsed.url !== 'string' ||
      typeof parsed.matchId !== 'string' ||
      typeof parsed.token !== 'string'
    ) {
      return null;
    }
    return { url: parsed.url, matchId: parsed.matchId, token: parsed.token };
  } catch {
    return null;
  }
}

export function clearCredentials(): void {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Same reasoning as `saveCredentials`.
  }
}

/** The bit of `WebSocket` this layer uses — the seam the tests inject through. */
export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: ((this: unknown, ev: unknown) => unknown) | null;
  onclose: ((this: unknown, ev: unknown) => unknown) | null;
  onerror: ((this: unknown, ev: unknown) => unknown) | null;
  onmessage: ((this: unknown, ev: { data: unknown }) => unknown) | null;
}

export type SocketFactory = (url: string) => SocketLike;

const defaultFactory: SocketFactory = (url) =>
  new WebSocket(url) as unknown as SocketLike;

export interface Connection {
  /** Closes for good: no retry, no banner. */
  disconnect(): void;
}

/** Backoff for the retry, capped. Deliberately short: a match is waiting. */
const RETRY_MS = [250, 500, 1000, 2000, 4000];

export function connect(
  creds: SeatCredentials,
  options: { socketFactory?: SocketFactory } = {},
): Connection {
  const factory = options.socketFactory ?? defaultFactory;
  const store = useStore.getState();
  let attempt = 0;
  let closedForGood = false;
  let socket: SocketLike | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  store.netStart(creds.matchId);
  saveCredentials(creds);

  const open = (): void => {
    if (closedForGood) {
      return;
    }
    useStore.getState().netStatus(attempt === 0 ? 'connecting' : 'lost');
    const next = factory(creds.url);
    socket = next;
    setNetSend((action: Action) => {
      const message: ClientMessage = { type: 'action', action };
      next.send(JSON.stringify(message));
    });

    next.onopen = () => {
      attempt = 0;
      const join: ClientMessage = {
        type: 'join',
        protocol: PROTOCOL_VERSION,
        matchId: creds.matchId,
        token: creds.token,
      };
      next.send(JSON.stringify(join));
    };

    next.onmessage = (event) => {
      let message: ServerToClient;
      try {
        message = JSON.parse(String(event.data)) as ServerToClient;
      } catch {
        return;
      }
      receive(message);
    };

    const retry = (): void => {
      if (closedForGood) {
        return;
      }
      useStore.getState().netStatus('lost');
      // The banner is up; the token is the only thing needed to come back.
      const wait = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)] ?? 4000;
      attempt += 1;
      timer = setTimeout(open, wait);
    };

    next.onclose = retry;
    next.onerror = retry;
  };

  open();

  return {
    disconnect(): void {
      closedForGood = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
      setNetSend(null);
      socket?.close();
    },
  };
}

/** One server message into one store action. No branching about the game. */
export function receive(message: ServerToClient): void {
  const store = useStore.getState();
  switch (message.type) {
    case 'joined':
      store.netJoined({
        seat: message.seat,
        view: message.view,
        journal: message.journal,
        actions: message.actions,
      });
      return;
    case 'update':
      store.netUpdate({ view: message.view, events: message.events, actions: message.actions });
      return;
    case 'rejected':
      store.netRejected(message.reason);
      return;
    case 'error':
      // A transport refusal is terminal: a bad token or an unknown match will
      // not fix itself by retrying, so it raises the banner with a reason
      // rather than starting a backoff that can never succeed.
      store.netError(message.code);
      return;
  }
}

import { WebSocket } from 'ws';
import type { ClientOptions } from 'ws';
import type { ServerToClient } from '../src/protocol.js';
import { PROTOCOL_VERSION } from '../src/protocol.js';

/** A refused HTTP upgrade: the status and the body, which is the reason. */
export class UpgradeRefused extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
  ) {
    super(`Unexpected server response: ${status}`);
    this.name = 'UpgradeRefused';
  }
}

/**
 * A minimal test client: connects, queues everything the server sends, and
 * hands messages back one promise at a time so a test reads the conversation
 * in order. A missing message fails with a timeout instead of hanging the
 * suite.
 *
 * It also records how the conversation ended: `closed` resolves with the
 * close code and reason the server sent, which is how the close policy in
 * `transport.ts` gets asserted rather than described.
 */
export class TestClient {
  private readonly socket: WebSocket;
  private readonly queue: ServerToClient[] = [];
  private readonly waiters: ((message: ServerToClient) => void)[] = [];
  /** The server's close frame, or the abrupt end, whichever came. */
  readonly closed: Promise<{ code: number; reason: string }>;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('message', (data) => {
      const message = JSON.parse(String(data)) as ServerToClient;
      const waiter = this.waiters.shift();
      if (waiter !== undefined) {
        waiter(message);
      } else {
        this.queue.push(message);
      }
    });
    this.closed = new Promise((resolve) => {
      socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });
  }

  /**
   * `options` reach `ws`'s client verbatim: `origin` sets the header the
   * origin allowlist reads, `autoPong: false` makes a client that never
   * answers a ping — the half-open peer the heartbeat exists to detect.
   * A refused upgrade rejects with an `UpgradeRefused`: `ws`'s own message
   * plus the status and the body the server wrote, so a test can hold the
   * refusal to the vocabulary rather than only to a number.
   */
  static connect(port: number, options: ClientOptions = {}): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}`, options);
      socket.once('open', () => resolve(new TestClient(socket)));
      socket.once('error', reject);
      socket.once('unexpected-response', (_request, response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          reject(new UpgradeRefused(response.statusCode ?? 0, Buffer.concat(chunks).toString())),
        );
      });
    });
  }

  send(message: unknown): void {
    this.socket.send(typeof message === 'string' ? message : JSON.stringify(message));
  }

  /** Bytes as a binary frame, for the fuzzer: what a non-client sends. */
  sendRaw(bytes: Buffer): void {
    this.socket.send(bytes);
  }

  join(matchId: string, token: string, protocol = PROTOCOL_VERSION): void {
    this.send({ type: 'join', protocol, matchId, token });
  }

  next(timeoutMs = 2_000): Promise<ServerToClient> {
    const queued = this.queue.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('timed out waiting for a server message')),
        timeoutMs,
      );
      this.waiters.push((message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  }

  /** Resolves the next message and asserts its `type`, for linear scripts. */
  async expect<T extends ServerToClient['type']>(
    type: T,
  ): Promise<Extract<ServerToClient, { type: T }>> {
    const message = await this.next();
    if (message.type !== type) {
      throw new Error(`expected ${type}, got ${message.type}: ${JSON.stringify(message).slice(0, 200)}`);
    }
    return message as Extract<ServerToClient, { type: T }>;
  }

  /** Whether the socket is still open from this side — the kept-socket half
   * of the close policy is a fact about this, not about a message. */
  isOpen(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  close(): void {
    this.socket.close();
  }

  /** Abrupt drop, no close handshake — the disconnect a reconnect test wants. */
  terminate(): void {
    this.socket.terminate();
  }
}

/**
 * Polls every 5ms until `condition` holds, or fails after `timeoutMs`. The
 * server's bookkeeping lags the client's view of a close by one event-loop
 * turn — `wss.clients` releases a socket after the peer already saw its
 * close frame — so a test that wants to observe a count waits for it
 * instead of guessing the clock.
 */
export async function until(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`condition not met within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

import { WebSocket } from 'ws';
import type { ServerToClient } from '../src/protocol.js';
import { PROTOCOL_VERSION } from '../src/protocol.js';

/**
 * A minimal test client: connects, queues everything the server sends, and
 * hands messages back one promise at a time so a test reads the conversation
 * in order. A missing message fails with a timeout instead of hanging the
 * suite.
 */
export class TestClient {
  private readonly socket: WebSocket;
  private readonly queue: ServerToClient[] = [];
  private readonly waiters: ((message: ServerToClient) => void)[] = [];

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
  }

  static connect(port: number): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}`);
      socket.once('open', () => resolve(new TestClient(socket)));
      socket.once('error', reject);
    });
  }

  send(message: unknown): void {
    this.socket.send(typeof message === 'string' ? message : JSON.stringify(message));
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

  close(): void {
    this.socket.close();
  }

  /** Abrupt drop, no close handshake — the disconnect a reconnect test wants. */
  terminate(): void {
    this.socket.terminate();
  }
}

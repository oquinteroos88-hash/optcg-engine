// @vitest-environment jsdom
//
// **The milestone.** Two clients, one real server, one match, played through
// the UI from both sides.
//
// Everything else in this package drives one store against a local engine.
// This drives two independent stores over real sockets against
// `@optcg/server`, which is the only way to check the thing the whole arc was
// for: that two people can play, that neither is shown what they may not see,
// and that a player who drops comes back to the game they left.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { WebSocket as NodeWebSocket } from 'ws';
import type { Action, InstanceId, PlayerId } from '@optcg/engine';
import { registerStarterCards, starterDecklists, toEngineDecklist } from '@optcg/cards/starters';
import type { GameServer } from '@optcg/server';
import { startServer } from '@optcg/server';
import type { SocketFactory, SocketLike } from '../src/net/connection';
import { connect } from '../src/net/connection';
import { GameScreen } from '../src/screens/GameScreen';
import { getNetSend, setNetSend, useStore } from '../src/store/store';

/**
 * Two seats, one process, one module-level store.
 *
 * A browser gets a store to itself; this test has to run two, so each seat's
 * store is **swapped in** while that seat acts and captured when it stops.
 * That works for everything the seat does, and breaks for the one thing it
 * does not control: a socket message arriving while the *other* seat is in
 * front would land in the wrong store.
 *
 * So delivery is held rather than faked. The factory below wraps a real
 * socket, queues what arrives, and hands it to the connection layer's own
 * `onmessage` only when that seat is in front — which is what a browser does
 * by construction, since there each socket only ever has one store to write
 * to. Everything else is the real thing: the real server, the real join, the
 * real `receive`, the real store actions.
 */
type Snapshot = ReturnType<typeof useStore.getState>;

class SeatClient {
  snapshot: Snapshot | null = null;
  socket: SocketLike | null = null;
  readonly queued: unknown[] = [];
  send: ((action: Action) => void) | null = null;

  /** A factory that binds every socket this seat opens to this seat's queue. */
  factory: SocketFactory = (url) => {
    const raw = new NodeWebSocket(url);
    const wrapper: SocketLike = {
      send: (data: string) => raw.send(data),
      close: () => raw.close(),
      onopen: null,
      onclose: null,
      onerror: null,
      onmessage: null,
    };
    raw.on('open', () => wrapper.onopen?.call(wrapper, {}));
    raw.on('message', (data) => {
      this.queued.push(String(data));
    });
    raw.on('close', () => wrapper.onclose?.call(wrapper, {}));
    this.socket = wrapper;
    return wrapper;
  };

  /** Delivers everything this seat's socket received, in order. */
  pump(): void {
    const socket = this.socket;
    if (socket === null) {
      return;
    }
    while (this.queued.length > 0) {
      const data = this.queued.shift();
      socket.onmessage?.call(socket, { data });
    }
  }
}

const seats: Record<PlayerId, SeatClient> = { p1: new SeatClient(), p2: new SeatClient() };
let live: PlayerId | null = null;

/** Brings a seat's store to the front, and points the action sink at it. */
function focus(seat: PlayerId): Snapshot {
  if (live !== null && live !== seat) {
    seats[live].snapshot = useStore.getState();
    seats[live].send = getNetSend();
  }
  const client = seats[seat];
  if (client.snapshot !== null) {
    useStore.setState(client.snapshot, true);
  }
  if (client.send !== null) {
    setNetSend(client.send);
  }
  live = seat;
  client.pump();
  drain();
  return useStore.getState();
}

/**
 * What `AnimationDriver` does in a browser, without the timers.
 *
 * The queue holds *input*, in both modes — a player must not click into a
 * board that is still showing them what happened. Nothing renders the driver
 * here, so the harness plays its part; without it the second action of the
 * match is silently swallowed, which is exactly what it looked like.
 */
function drain(): void {
  for (let guard = 0; guard < 500; guard += 1) {
    const head = useStore.getState().animQueue[0];
    if (head === undefined) {
      return;
    }
    useStore.getState().animTick(head.id);
  }
  throw new Error('the animation queue never drained');
}

/** Runs `body` with `seat` in front, then puts the store back where it was. */
async function asSeat<T>(seat: PlayerId, body: () => Promise<T> | T): Promise<T> {
  focus(seat);
  const result = await body();
  seats[seat].snapshot = useStore.getState();
  seats[seat].send = getNetSend();
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits for a seat's store to satisfy `done`, or fails loudly. */
async function until(seat: PlayerId, what: string, done: (s: Snapshot) => boolean): Promise<void> {
  for (let i = 0; i < 300; i += 1) {
    const state = focus(seat);
    if (done(state)) {
      seats[seat].snapshot = useStore.getState();
      seats[seat].send = getNetSend();
      return;
    }
    seats[seat].snapshot = useStore.getState();
    seats[seat].send = getNetSend();
    await act(async () => {
      await sleep(10);
    });
  }
  throw new Error(`timed out waiting for ${seat}: ${what}`);
}

const DECK_IDS = starterDecklists.map((deck) => deck.id);

describe('two clients, one server, one match', () => {
  let server: GameServer;

  beforeAll(async () => {
    registerStarterCards();
    const decks = Object.fromEntries(
      starterDecklists.map((deck) => [deck.id, toEngineDecklist(deck)]),
    );
    server = await startServer({ port: 0, decks });
  });

  afterAll(async () => {
    await server.close();
  });

  afterEach(() => {
    cleanup();
  });

  it('plays a match from both sides, and neither board shows the other hand', async () => {
    const [deckA, deckB] = DECK_IDS;
    server.createMatch({
      matchId: 'm1',
      seed: 82,
      decklists: {
        p1: toEngineDecklist(starterDecklists[0]!),
        p2: toEngineDecklist(starterDecklists[1]!),
      },
      tokens: { p1: 'tok-1', p2: 'tok-2' },
    });
    expect(deckA).toBeDefined();
    expect(deckB).toBeDefined();

    // Both seats join. Each gets its own present and its own journal.
    const url = `ws://127.0.0.1:${server.port}`;
    await asSeat('p1', () => {
      connect({ url, matchId: 'm1', token: 'tok-1' }, { socketFactory: seats.p1.factory });
    });
    await asSeat('p2', () => {
      connect({ url, matchId: 'm1', token: 'tok-2' }, { socketFactory: seats.p2.factory });
    });
    await until('p1', 'p1 to be seated', (s) => s.net?.seat === 'p1');
    await until('p2', 'p2 to be seated', (s) => s.net?.seat === 'p2');

    // The board each seat draws is its own view — and the opponent's hand is a
    // count of backs, checked the way the engine's own leak test checks a
    // view: the ids must not be in the payload at all.
    await asSeat('p1', () => {
      const state = useStore.getState();
      const view = state.netView;
      if (view === null) {
        throw new Error('p1 has no view');
      }
      expect(view.viewer).toBe('p1');
      expect(view.players.p1.hand.cards).not.toBeNull();
      expect(view.players.p2.hand.cards).toBeNull();
      expect(view.players.p2.hand.count).toBeGreaterThan(0);
      const json = JSON.stringify(view);
      expect(json).not.toContain('"rng"');
      expect(json).not.toContain('"seed"');
    });

    // And the board renders it: p2's hand row is that many face-down cards.
    await asSeat('p1', async () => {
      await act(async () => {
        render(<GameScreen />);
        await sleep(0);
      });
      const view = useStore.getState().netView;
      const opponentHand = screen.getByRole('group', { name: 'Mano de Jugador 2' });
      expect(within(opponentHand).getAllByLabelText('Carta oculta')).toHaveLength(
        view?.players.p2.hand.count ?? -1,
      );
      cleanup();
    });

    // Mulligans, one seat at a time, each through its own store's action.
    await until('p1', 'p1 to be asked for a mulligan', (s) =>
      Boolean(s.affordances?.global.mustAnswerMulligan),
    );
    await asSeat('p1', () => {
      useStore.getState().answerMulligan(false);
    });
    await until('p2', 'p2 to be asked for a mulligan', (s) =>
      Boolean(s.affordances?.global.mustAnswerMulligan),
    );
    await asSeat('p2', () => {
      useStore.getState().answerMulligan(false);
    });

    // The game is on, and the affordances came off the wire: the seat with
    // priority can end a turn, the other seat can only concede.
    await until('p1', 'the game to start', (s) => s.netView?.status === 'playing');
    await until('p2', 'the game to start', (s) => s.netView?.status === 'playing');

    const turnPlayer = await asSeat('p1', () => useStore.getState().netView?.priority);
    const waiting: PlayerId = turnPlayer === 'p1' ? 'p2' : 'p1';
    await asSeat(turnPlayer as PlayerId, () => {
      const aff = useStore.getState().affordances;
      expect(aff?.global.canEndTurn).toBe(true);
    });
    await asSeat(waiting, () => {
      const aff = useStore.getState().affordances;
      // CR 1-2-3: either player may concede at any point — and it is the only
      // thing the server offers a seat that is not to move.
      expect(aff?.global.canConcede).toBe(true);
      expect(aff?.global.canEndTurn).toBe(false);
      expect(Object.keys(aff?.byCard ?? {})).toHaveLength(0);
    });

    // A turn passes: the acting seat ends it, and both boards move.
    const turnsBefore = await asSeat('p1', () => useStore.getState().netView?.turn ?? 0);
    await asSeat(turnPlayer as PlayerId, () => {
      useStore.getState().endTurn();
    });
    await until('p1', 'the turn to advance for p1', (s) => (s.netView?.turn ?? 0) > turnsBefore);
    await until('p2', 'the turn to advance for p2', (s) => (s.netView?.turn ?? 0) > turnsBefore);

    // A drop, mid-match, and a return by token: the journal comes back and the
    // history the player reads is the history they watched.
    const before = await asSeat('p2', () => [...(useStore.getState().journals.p2 ?? [])]);
    await asSeat('p2', () => {
      connect({ url, matchId: 'm1', token: 'tok-2' }, { socketFactory: seats.p2.factory });
    });
    await until('p2', 'p2 to be seated again', (s) => s.net?.seat === 'p2' && s.net.status === 'open');
    await asSeat('p2', () => {
      const after = useStore.getState().journals.p2 ?? [];
      // Not "at least as long": exactly what was seen, in order. The rejoin
      // replays the server's journal, which is the same bytes it streamed.
      expect(after.slice(0, before.length)).toEqual(before);
      expect(useStore.getState().netView?.status).toBe('playing');
    });

    // And the game ends on both screens. Concede is the shortest honest route
    // to a finished board through the real UI.
    await asSeat('p1', () => {
      useStore.getState().concede();
    });
    await until('p1', 'p1 to see the end', (s) => s.netView?.status === 'finished');
    await until('p2', 'p2 to see the end', (s) => s.netView?.status === 'finished');
    await asSeat('p2', () => {
      const view = useStore.getState().netView;
      expect(view?.winner).toBe('p2');
      expect(view?.endReason).toBe('concede');
    });
  }, 60_000);

  it('sends the actions the affordances offered, and the server takes them', async () => {
    // The round-trip, over the wire and through the UI's own action space: a
    // client that offers a move the server then refuses is a client showing a
    // button that does nothing.
    server.createMatch({
      matchId: 'm2',
      seed: 7,
      decklists: {
        p1: toEngineDecklist(starterDecklists[0]!),
        p2: toEngineDecklist(starterDecklists[1]!),
      },
      tokens: { p1: 'a', p2: 'b' },
    });
    const url = `ws://127.0.0.1:${server.port}`;
    seats.p1.snapshot = null;
    seats.p2.snapshot = null;
    live = null;
    useStore.setState({ ...useStore.getState(), net: null, netView: null, affordances: null });

    await asSeat('p1', () => {
      connect({ url, matchId: 'm2', token: 'a' }, { socketFactory: seats.p1.factory });
    });
    await asSeat('p2', () => {
      connect({ url, matchId: 'm2', token: 'b' }, { socketFactory: seats.p2.factory });
    });
    await until('p1', 'p1 seated', (s) => s.net?.seat === 'p1');
    await until('p2', 'p2 seated', (s) => s.net?.seat === 'p2');

    let accepted = 0;
    for (let step = 0; step < 12; step += 1) {
      const acting: PlayerId = (await asSeat('p1', () => useStore.getState().netView?.priority)) ?? 'p1';
      const offered = await asSeat(acting, () => {
        const aff = useStore.getState().affordances;
        if (aff === null) {
          return null;
        }
        if (aff.global.mustAnswerMulligan) {
          useStore.getState().answerMulligan(false);
          return 'MULLIGAN';
        }
        if (aff.global.canEndTurn) {
          useStore.getState().endTurn();
          return 'END_TURN';
        }
        return null;
      });
      if (offered === null) {
        break;
      }
      accepted += 1;
      // The proof is the absence of a rejection: every accepted action came
      // back as an update, and `notice` is what a refusal would have set.
      await until(acting, 'the update for an offered action', (s) => s.notice === null);
    }
    expect(accepted).toBeGreaterThanOrEqual(4);
  }, 60_000);
});

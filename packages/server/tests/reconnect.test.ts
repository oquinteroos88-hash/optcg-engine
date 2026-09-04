import { deepStrictEqual } from 'node:assert';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ViewEvent } from '@optcg/engine';
import { ABIL_DECK } from '@optcg/engine/testdata/abilityDecks';
import { SERVER_ERRORS } from '../src/protocol.js';
import { createMatch } from '../src/session.js';
import type { GameServer } from '../src/transport.js';
import { startServer } from '../src/transport.js';
import { TestClient, until } from './wsHelpers.js';

/**
 * The reconnection contract, over real sockets: drop a seat in the middle of
 * an open choice, come back with the same token, and the journal you are
 * handed is — `deepStrictEqual`, payload by payload — the event batches you
 * watched live. Nothing re-derived, nothing embellished, and the match keeps
 * going.
 */

const decks = { p1: ABIL_DECK, p2: ABIL_DECK };

/** A seed whose p1 opening hand holds ABIL-002, found deterministically: the
 * scripted route to an open choice is mulligans declined, two turns of DON!!,
 * then playing it (cost 2, its [On Play] always asks). */
function seedWithScavenger(): number {
  for (let seed = 1; seed <= 60; seed += 1) {
    const match = createMatch(seed, decks);
    const hand = match.game.players.p1.hand;
    if (hand.some((id) => match.game.cards[id]?.cardId === 'ABIL-002')) {
      return seed;
    }
  }
  throw new Error('no seed in 1..60 deals p1 an ABIL-002');
}

describe('reconnection mid-choice', () => {
  let server: GameServer;

  beforeAll(async () => {
    server = await startServer({ port: 0 });
  });

  afterAll(async () => {
    await server.close();
  });

  it('re-emits exactly the live journal and the match continues', async () => {
    const seed = seedWithScavenger();
    server.createMatch({
      matchId: 'reconnect-1',
      seed,
      decklists: decks,
      tokens: { p1: 'token-p1', p2: 'token-p2' },
    });

    const c1 = await TestClient.connect(server.port);
    const c2 = await TestClient.connect(server.port);
    c1.join('reconnect-1', 'token-p1');
    c2.join('reconnect-1', 'token-p2');
    const joined1 = await c1.expect('joined');
    const joined2 = await c2.expect('joined');
    expect(joined1.seat).toBe('p1');
    expect(joined2.seat).toBe('p2');

    // Everything p2 sees live, batch by batch, starting with the setup batch
    // the join delivered.
    const liveBatches: ViewEvent[][] = [...joined2.journal];

    const script = [
      { client: c1, action: { type: 'MULLIGAN', player: 'p1', accept: false } },
      { client: c2, action: { type: 'MULLIGAN', player: 'p2', accept: false } },
      { client: c1, action: { type: 'END_TURN', player: 'p1' } },
      { client: c2, action: { type: 'END_TURN', player: 'p2' } },
    ] as const;
    for (const step of script) {
      step.client.send({ type: 'action', action: step.action });
      const update1 = await c1.expect('update');
      const update2 = await c2.expect('update');
      expect(update1.view.viewer).toBe('p1');
      liveBatches.push(update2.events);
    }

    // Turn 3: p1 has three active DON!! and plays the Scavenger; its
    // [On Play] opens the choice this test wants to be interrupted.
    const game = server.getMatch('reconnect-1')?.game;
    const scavenger = game?.players.p1.hand.find((id) => game.cards[id]?.cardId === 'ABIL-002');
    if (scavenger === undefined) {
      throw new Error('expected ABIL-002 still in hand');
    }
    c1.send({
      type: 'action',
      action: { type: 'PLAY_CARD', player: 'p1', instanceId: scavenger },
    });
    const asking1 = await c1.expect('update');
    const asking2 = await c2.expect('update');
    liveBatches.push(asking2.events);
    if (asking1.view.pending?.audience !== 'chooser') {
      throw new Error('expected p1 to be the chooser of an open choice');
    }
    expect(asking2.view.pending).toEqual({
      audience: 'other',
      id: asking1.view.pending.id,
      player: 'p1',
      kind: 'selectCards',
    });

    // The drop, mid-choice — no close handshake, the way real networks fail.
    c2.terminate();

    const c2back = await TestClient.connect(server.port);
    c2back.join('reconnect-1', 'token-p2');
    const rejoined = await c2back.expect('joined');
    expect(rejoined.seat).toBe('p2');
    // The contract: what you see on returning is exactly what you saw live,
    // because it is literally the same payloads.
    deepStrictEqual(rejoined.journal, liveBatches);
    // And the present still holds the open choice, redacted to kind.
    expect(rejoined.view.pending?.audience).toBe('other');

    // The match continues: the chooser answers, both seats get the update —
    // the returned socket included.
    const candidate = asking1.view.pending.candidates[0];
    if (candidate === undefined) {
      throw new Error('expected the chooser to have candidates');
    }
    c1.send({
      type: 'action',
      action: {
        type: 'ANSWER_CHOICE',
        player: 'p1',
        choiceId: asking1.view.pending.id,
        answer: { kind: 'cards', selected: [candidate] },
      },
    });
    const answered1 = await c1.expect('update');
    const answered2 = await c2back.expect('update');
    expect(answered1.view.pending).toBeNull();
    expect(answered2.events.some((event) => event.type === 'cardDiscarded')).toBe(true);

    c1.close();
    c2back.close();
  });
});

/**
 * The reconnection window (M6): a token re-authenticates while the match
 * lives, and a match lives while a socket is attached or for
 * `MATCH_IDLE_TTL_MS` after the last one left. Fifty milliseconds here, so
 * the test sees the whole window and not a description of it.
 */
describe('match expiry', () => {
  it('frees a match with no socket after the idle window, and keeps one with a player at the table', async () => {
    const server = await startServer({
      port: 0,
      limits: { MATCH_IDLE_TTL_MS: 50, MATCH_SWEEP_INTERVAL_MS: 10 },
    });
    server.createMatch({ matchId: 'empty', seed: 1, decklists: decks, tokens: { p1: 'a', p2: 'b' } });
    server.createMatch({ matchId: 'held', seed: 2, decklists: decks, tokens: { p1: 'a', p2: 'b' } });
    const holder = await TestClient.connect(server.port);
    holder.join('held', 'a');
    await holder.expect('joined');
    expect(server.stats().matches).toBe(2);

    // Wait for the sweep to act, not for the clock to have probably passed:
    // the positive case resolves, and the negative case is asserted after it.
    await until(() => server.stats().matches === 1);
    expect(server.getMatch('empty')).toBeUndefined();
    expect(server.getMatch('held')).toBeDefined();

    // A freed match is gone for good: the token that named a seat in it
    // names nothing now, and the answer is the same as for a match that
    // never existed — the wire learns nothing about what was.
    const late = await TestClient.connect(server.port);
    late.join('empty', 'a');
    expect((await late.expect('error')).code).toBe(SERVER_ERRORS.unknownMatch);

    // The window opens when the last socket leaves, not when it joined.
    holder.close();
    await holder.closed;
    expect(server.getMatch('held')).toBeDefined();
    await until(() => server.stats().matches === 0);
    expect(server.getMatch('held')).toBeUndefined();
    late.close();
    await server.close();
  });
});


/**
 * The heartbeat (M7): a client that stops answering pings is terminated and
 * stops counting as connected — the half-open peer that would otherwise
 * hold a seat and a slot under the cap forever. `autoPong: false` is `ws`'s
 * own switch for a client that never answers, so nothing is monkeypatched.
 */
describe('heartbeat', () => {
  it('terminates a socket that does not answer a ping, and keeps one that does', async () => {
    const server = await startServer({ port: 0, limits: { HEARTBEAT_INTERVAL_MS: 30 } });
    const mute = await TestClient.connect(server.port, { autoPong: false });
    const alive = await TestClient.connect(server.port);
    expect(server.stats().connections).toBe(2);

    // Ping at the first tick, judgement at the second: gone within two
    // intervals, with no close frame because nobody was there to answer one.
    // The server's own count is what is waited for — the client sees the
    // TCP end a tick before `ws` takes the socket out of its set.
    await until(() => server.stats().connections === 1);
    const ended = await mute.closed;
    expect(ended.code).toBe(1006);
    // The negative case, asserted once the positive one has resolved: two
    // intervals have passed, and the socket that answered is still there.
    expect(alive.isOpen()).toBe(true);
    expect(server.stats().connections).toBe(1);
    alive.close();
    await server.close();
  });
});

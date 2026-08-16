import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REASONS } from '@optcg/engine';
import { ABIL_DECK } from '@optcg/engine/testdata/abilityDecks';
import { SERVER_ERRORS } from '../src/protocol.js';
import type { GameServer } from '../src/transport.js';
import { startServer } from '../src/transport.js';
import { TestClient } from './wsHelpers.js';

/**
 * The transport smoke: two real sockets against a server on an ephemeral
 * port, one short match end to end — and every transport error code produced
 * on purpose, because a code nothing can reach is a code that lies about the
 * contract.
 */

const decks = { p1: ABIL_DECK, p2: ABIL_DECK };

describe('the transport', () => {
  let server: GameServer;

  beforeAll(async () => {
    server = await startServer({ port: 0 });
  });

  afterAll(async () => {
    await server.close();
  });

  it('plays a short match end to end over two sockets', async () => {
    server.createMatch({
      matchId: 'smoke-1',
      seed: 3,
      decklists: decks,
      tokens: { p1: 'a', p2: 'b' },
    });
    const c1 = await TestClient.connect(server.port);
    const c2 = await TestClient.connect(server.port);
    c1.join('smoke-1', 'a');
    c2.join('smoke-1', 'b');
    expect((await c1.expect('joined')).view.viewer).toBe('p1');
    expect((await c2.expect('joined')).view.viewer).toBe('p2');

    const script = [
      { client: c1, action: { type: 'MULLIGAN', player: 'p1', accept: false } },
      { client: c2, action: { type: 'MULLIGAN', player: 'p2', accept: false } },
      { client: c1, action: { type: 'END_TURN', player: 'p1' } },
      // CR 1-2-3: either player may concede at any point — here from the seat
      // without priority, which the engine accepts and the server just routes.
      { client: c2, action: { type: 'CONCEDE', player: 'p2' } },
    ] as const;
    for (const step of script) {
      step.client.send({ type: 'action', action: step.action });
      await c1.expect('update');
      await c2.expect('update');
    }

    const finished = server.getMatch('smoke-1')?.game;
    expect(finished?.status).toBe('finished');
    expect(finished?.winner).toBe('p1');
    c1.close();
    c2.close();
  });

  it('routes a rejection to the actor alone, with the engine reason verbatim', async () => {
    server.createMatch({
      matchId: 'smoke-2',
      seed: 4,
      decklists: decks,
      tokens: { p1: 'a', p2: 'b' },
    });
    const c1 = await TestClient.connect(server.port);
    const c2 = await TestClient.connect(server.port);
    c1.join('smoke-2', 'a');
    c2.join('smoke-2', 'b');
    await c1.expect('joined');
    await c2.expect('joined');

    // p2 acts while p1 holds priority: the engine refuses, only p2 hears it.
    c2.send({ type: 'action', action: { type: 'MULLIGAN', player: 'p2', accept: false } });
    const rejected = await c2.expect('rejected');
    expect(rejected.reason).toBe(REASONS.notYourPriority);

    // The proof c1 heard nothing meanwhile: its very next message is the
    // update for its own action, not anything about p2's attempt.
    c1.send({ type: 'action', action: { type: 'MULLIGAN', player: 'p1', accept: false } });
    const update = await c1.expect('update');
    expect(update.events.some((event) => event.type === 'mulliganTaken')).toBe(true);
    c1.close();
    c2.close();
  });

  it('produces every transport error code on purpose', async () => {
    server.createMatch({
      matchId: 'smoke-3',
      seed: 5,
      decklists: decks,
      tokens: { p1: 'a', p2: 'b' },
    });
    const client = await TestClient.connect(server.port);

    client.join('smoke-3', 'a', 99);
    expect((await client.expect('error')).code).toBe(SERVER_ERRORS.protocolMismatch);

    client.join('nowhere', 'a');
    expect((await client.expect('error')).code).toBe(SERVER_ERRORS.unknownMatch);

    client.join('smoke-3', 'wrong');
    expect((await client.expect('error')).code).toBe(SERVER_ERRORS.badToken);

    client.send({ type: 'action', action: { type: 'CONCEDE', player: 'p1' } });
    expect((await client.expect('error')).code).toBe(SERVER_ERRORS.notJoined);

    client.send('this is not json');
    expect((await client.expect('error')).code).toBe(SERVER_ERRORS.malformedMessage);

    client.join('smoke-3', 'a');
    await client.expect('joined');
    // The seat check: the socket authenticated as p1 may not speak as p2 —
    // the engine validates whose turn it is, this validates who is talking.
    client.send({ type: 'action', action: { type: 'CONCEDE', player: 'p2' } });
    expect((await client.expect('error')).code).toBe(SERVER_ERRORS.seatMismatch);

    client.close();
  });
});

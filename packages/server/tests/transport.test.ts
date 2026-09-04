import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Decklist } from '@optcg/engine';
import { REASONS } from '@optcg/engine';
import { ABIL_DECK } from '@optcg/engine/testdata/abilityDecks';
import { DEFAULT_LIMITS } from '../src/limits.js';
import { PROTOCOL_VERSION, SERVER_ERRORS, UPGRADE_REFUSALS } from '../src/protocol.js';
import type { GameServer, ServerLogEntry } from '../src/transport.js';
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

  it('produces every transport error code on purpose, and closes exactly when the table says', async () => {
    server.createMatch({
      matchId: 'smoke-3',
      seed: 5,
      decklists: decks,
      tokens: { p1: 'a', p2: 'b' },
    });

    // The closing codes, each on a fresh socket: the word, then the door,
    // with the code as the whole of the close reason (M3's table).
    const mismatched = await TestClient.connect(server.port);
    mismatched.join('smoke-3', 'a', 99);
    expect((await mismatched.expect('error')).code).toBe(SERVER_ERRORS.protocolMismatch);
    expect(await mismatched.closed).toEqual({ code: 1008, reason: SERVER_ERRORS.protocolMismatch });

    const garbled = await TestClient.connect(server.port);
    garbled.send('this is not json');
    expect((await garbled.expect('error')).code).toBe(SERVER_ERRORS.malformedMessage);
    expect(await garbled.closed).toEqual({ code: 1008, reason: SERVER_ERRORS.malformedMessage });

    const deep = await TestClient.connect(server.port);
    const nesting = DEFAULT_LIMITS.MAX_JSON_DEPTH + 1;
    deep.send(
      `{"type":"action","action":{"type":"END_TURN","player":"p1","deep":${'['.repeat(nesting)}${']'.repeat(nesting)}}}`,
    );
    expect((await deep.expect('error')).code).toBe(SERVER_ERRORS.oversizedMessage);
    expect(await deep.closed).toEqual({ code: 1008, reason: SERVER_ERRORS.oversizedMessage });

    // Over the byte limit `ws` itself refuses the frame (M2's `maxPayload`)
    // before the parser sees a string: no error message, close 1009.
    const huge = await TestClient.connect(server.port);
    huge.send('x'.repeat(DEFAULT_LIMITS.MAX_MESSAGE_BYTES + 1));
    expect((await huge.closed).code).toBe(1009);

    // The kept codes, all on one socket that stays open through every one.
    const client = await TestClient.connect(server.port);

    client.join('nowhere', 'a');
    expect((await client.expect('error')).code).toBe(SERVER_ERRORS.unknownMatch);

    client.join('smoke-3', 'wrong');
    expect((await client.expect('error')).code).toBe(SERVER_ERRORS.badToken);

    client.send({ type: 'action', action: { type: 'CONCEDE', player: 'p1' } });
    expect((await client.expect('error')).code).toBe(SERVER_ERRORS.notJoined);

    client.join('smoke-3', 'a');
    await client.expect('joined');
    // The seat check: the socket authenticated as p1 may not speak as p2 —
    // the engine validates whose turn it is, this validates who is talking.
    client.send({ type: 'action', action: { type: 'CONCEDE', player: 'p2' } });
    expect((await client.expect('error')).code).toBe(SERVER_ERRORS.seatMismatch);

    // A garbage payload inside a well-formed action is the engine's to
    // refuse, with its reason, and the socket is still a player's.
    client.send({ type: 'action', action: { type: 'NOT_A_THING', player: 'p1', x: [1] } });
    expect((await client.expect('rejected')).reason).toBe(REASONS.malformedAction);
    expect(client.isOpen()).toBe(true);

    client.close();
  });

  it('closes a socket on its MAX_AUTH_FAILURES-th guess, and not before', async () => {
    server.createMatch({
      matchId: 'smoke-4',
      seed: 6,
      decklists: decks,
      tokens: { p1: 'a', p2: 'b' },
    });
    const guesser = await TestClient.connect(server.port);
    // Both kinds of guess count: a match id nobody minted and a token that is
    // not the seat's. Every one of them is answered; the last one is also
    // the door (M4).
    for (let attempt = 1; attempt < DEFAULT_LIMITS.MAX_AUTH_FAILURES; attempt += 1) {
      if (attempt % 2 === 1) {
        guesser.join('smoke-4', `guess-${attempt}`);
        expect((await guesser.expect('error')).code).toBe(SERVER_ERRORS.badToken);
      } else {
        guesser.join(`nowhere-${attempt}`, 'a');
        expect((await guesser.expect('error')).code).toBe(SERVER_ERRORS.unknownMatch);
      }
    }
    expect(guesser.isOpen()).toBe(true);
    guesser.join('smoke-4', 'a');
    // A right token on the last try still seats the player: the counter is
    // about failures, not attempts.
    expect((await guesser.expect('joined')).seat).toBe('p1');
    guesser.join('smoke-4', 'wrong');
    expect((await guesser.expect('error')).code).toBe(SERVER_ERRORS.badToken);
    expect(await guesser.closed).toEqual({ code: 1008, reason: SERVER_ERRORS.badToken });
  });

  it('refuses a create over MAX_MATCHES with serverFull, and keeps the socket', async () => {
    // M5, with the cap within reach: two matches, then the word.
    const own = await startServer({ port: 0, decks: { abil: ABIL_DECK }, limits: { MAX_MATCHES: 2 } });
    const client = await TestClient.connect(own.port);
    const create = { type: 'create', protocol: PROTOCOL_VERSION, seed: 1, deckIdP1: 'abil', deckIdP2: 'abil' };
    client.send(create);
    const first = await client.expect('created');
    client.send(create);
    await client.expect('created');
    expect(own.stats().matches).toBe(2);
    client.send(create);
    expect((await client.expect('error')).code).toBe(SERVER_ERRORS.serverFull);
    expect(own.stats().matches).toBe(2);
    // Kept: the same socket may still take a seat in a match that exists.
    client.join(first.matchId, first.tokens.p1);
    expect((await client.expect('joined')).seat).toBe('p1');
    client.close();
    await own.close();
  });

  it('closes a socket that sends more than MAX_MESSAGES_PER_WINDOW in a window', async () => {
    // M8 at the default numbers: twenty well-formed messages in a burst are
    // each answered, the twenty-first is the flood.
    const flood = await TestClient.connect(server.port);
    const limit = DEFAULT_LIMITS.MAX_MESSAGES_PER_WINDOW;
    for (let n = 0; n <= limit; n += 1) {
      flood.send({ type: 'action', action: { type: 'CONCEDE', player: 'p1' } });
    }
    for (let n = 0; n < limit; n += 1) {
      expect((await flood.expect('error')).code).toBe(SERVER_ERRORS.notJoined);
    }
    expect((await flood.expect('error')).code).toBe(SERVER_ERRORS.rateLimited);
    expect(await flood.closed).toEqual({ code: 1008, reason: SERVER_ERRORS.rateLimited });
  });

  it('refuses the upgrade over MAX_CONNECTIONS with a 503, before a socket exists', async () => {
    const own = await startServer({ port: 0, limits: { MAX_CONNECTIONS: 2 } });
    const a = await TestClient.connect(own.port);
    const b = await TestClient.connect(own.port);
    expect(own.stats().connections).toBe(2);
    await expect(TestClient.connect(own.port)).rejects.toMatchObject({
      status: 503,
      reason: UPGRADE_REFUSALS.serverFull,
    });
    expect(own.stats().connections).toBe(2);
    // A seat freed is a seat available: the cap counts live sockets.
    a.close();
    await a.closed;
    const c = await TestClient.connect(own.port);
    expect(own.stats().connections).toBe(2);
    b.close();
    c.close();
    await own.close();
  });

  it('refuses an upgrade from an origin outside the allowlist with a 403, and only then', async () => {
    // M9: the header is the browser's word for where the page came from.
    const own = await startServer({ port: 0, allowedOrigins: ['https://play.example'] });
    const fromPage = await TestClient.connect(own.port, { origin: 'https://play.example' });
    // Exactly the word, and never the origin it refused.
    await expect(
      TestClient.connect(own.port, { origin: 'https://evil.example' }),
    ).rejects.toMatchObject({ status: 403, reason: UPGRADE_REFUSALS.originRefused });
    // No header is not a browser: a Node client, a test, a bot — the attack
    // needs a page, and a page always says where it is from.
    const headless = await TestClient.connect(own.port);
    expect(own.stats().connections).toBe(2);
    fromPage.close();
    headless.close();
    await own.close();

    // And with no list there is no check: the local-development default.
    const open = await startServer({ port: 0 });
    const anywhere = await TestClient.connect(open.port, { origin: 'https://evil.example' });
    expect(anywhere.isOpen()).toBe(true);
    anywhere.close();
    await open.close();
  });

  it('survives a handler that throws: one log line, internalError, 1011, and keeps serving', async () => {
    // M3, provoked honestly: the catalog is the transport's one injected
    // collaborator, and a catalog that throws on lookup is a handler that
    // throws mid-message. Nothing in the message path is stubbed.
    const entries: ServerLogEntry[] = [];
    const catalog = new Proxy<Record<string, Decklist>>(
      {},
      {
        get(_target, key) {
          if (key === 'boom') {
            throw new TypeError('the catalog exploded on boom');
          }
          return undefined;
        },
      },
    );
    const own = await startServer({ port: 0, decks: catalog, log: (entry) => entries.push(entry) });
    const client = await TestClient.connect(own.port);
    client.send({ type: 'create', protocol: PROTOCOL_VERSION, seed: 1, deckIdP1: 'boom', deckIdP2: 'boom' });
    expect((await client.expect('error')).code).toBe(SERVER_ERRORS.internalError);
    expect(await client.closed).toEqual({ code: 1011, reason: SERVER_ERRORS.internalError });

    // The log line is the event, the message type and the error's name —
    // and nothing that was in the message or the error (M12).
    expect(entries).toEqual([{ event: 'handlerError', type: 'create', error: 'TypeError' }]);
    expect(JSON.stringify(entries)).not.toContain('boom');
    expect(JSON.stringify(entries)).not.toContain('exploded');

    // The process is fine and so is the server: a match plays afterwards.
    own.createMatch({ matchId: 'after', seed: 6, decklists: decks, tokens: { p1: 'a', p2: 'b' } });
    const survivor = await TestClient.connect(own.port);
    survivor.join('after', 'a');
    expect((await survivor.expect('joined')).seat).toBe('p1');
    survivor.close();
    await own.close();
  });
});

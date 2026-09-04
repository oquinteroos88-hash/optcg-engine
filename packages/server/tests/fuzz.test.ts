import { describe, expect, it } from 'vitest';
import { ABIL_DECK } from '@optcg/engine/testdata/abilityDecks';
import { DEFAULT_LIMITS } from '../src/limits.js';
import { PROTOCOL_VERSION } from '../src/protocol.js';
import type { ServerLogEntry } from '../src/transport.js';
import { startServer } from '../src/transport.js';
import { playOut } from './wireDrive.js';
import { TestClient } from './wsHelpers.js';

/**
 * Deterministic fuzzing (threat model M11, for T1, T2, T3): thousands of
 * messages nobody would send on purpose, against a real server, from a
 * generator seeded like every other random thing in this repo. Random bytes,
 * random strings with the unicode that breaks parsers, truncated real
 * messages, real keys with wrong values, nesting, numbers JSON cannot hold,
 * keys that name a prototype. The claims: no crash, no unhandled rejection,
 * no handler ever threw, every message got an answer or a close and nothing
 * else, memory stayed within a coarse bound — and a normal match plays
 * afterwards.
 *
 * The rate limit and the auth-failure cap are raised for this server so the
 * run measures the parser and the handlers, not the counters that would end
 * it early; a socket the server closes is replaced with a fresh one, and the
 * replacements are counted.
 *
 * **The mix is weighted, and the weights are a socket budget.** Under the
 * close policy in `transport.ts` most of what the parser refuses costs a
 * socket, and a run that closed on nearly every message spent ~2,600 TCP
 * connections on loopback. Each one lingers in TIME_WAIT for a minute or
 * more after it is gone, and on Windows a few back-to-back runs were enough
 * to exhaust the ephemeral port range — the *next* run then failed at
 * `connect` with `EADDRINUSE`, a fact about the host that looked like a fact
 * about the server. So the hostility is spent where the socket survives:
 * more than half of the messages are junk inside an envelope `validate.ts`
 * accepts — actions the engine rejects, joins with wrong credentials,
 * creates naming decks the catalog lacks, actions from a socket that never
 * joined — and the parser-level families keep their place at a lower share.
 * Every family still runs, and the run asserts both halves.
 */

/** Recorded, and printed with any failure: a fuzz run nobody can repeat is
 * a rumour. */
const FUZZ_SEED = 0x5eed2026;
const MESSAGES = 3_000;
const SOCKETS = 6;
/** The slot that connects and never joins: what it sends is out of sequence
 * by construction, and a well-formed action from it is `notJoined`. */
const STRANGER = SOCKETS - 1;
/** How many replacement sockets one run may spend — the port budget above,
 * as a claim rather than a hope. */
const MAX_RECONNECTS = 1_200;

/**
 * The host's loopback ports under TIME_WAIT, not the server: a `connect`
 * that fails with one of these codes found no free ephemeral port (or a
 * stale one the stack is still tearing down) and is retried after a pause.
 * Any other connect error is the server's, and fails the run at once.
 */
const LOOPBACK_EXHAUSTION = new Set(['EADDRINUSE', 'ETIMEDOUT', 'ECONNRESET']);
const CONNECT_ATTEMPTS = 5;
const CONNECT_BACKOFF_MS = 500;

/** mulberry32, inline: the same generator the engine's RNG is built on. */
function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REAL_KEYS = [
  'type', 'protocol', 'seed', 'deckIdP1', 'deckIdP2', 'matchId', 'token', 'action', 'player',
  'choiceId', 'answer', 'kind', 'selected', 'instanceId', 'accept', 'to', 'count',
];
const REAL_TYPES = ['create', 'join', 'action', 'MULLIGAN', 'END_TURN', 'CONCEDE', 'ANSWER_CHOICE'];
/** The engine's own action vocabulary, for junk that gets past the envelope
 * and has to be refused by `applyAction` rather than by the parser. */
const ENGINE_TYPES = [
  'MULLIGAN', 'PLAY_CARD', 'ATTACH_DON', 'DECLARE_ATTACK', 'DECLARE_BLOCK', 'PLAY_COUNTER',
  'PLAY_COUNTER_EVENT', 'PASS', 'END_TURN', 'CONCEDE', 'ACTIVATE_ABILITY', 'ANSWER_CHOICE',
];
/** Where the engine expects an id, a number or an answer — the places a
 * wrong-typed value lands on a rule rather than on the parser. */
const ACTION_FIELDS = [
  'instanceId', 'to', 'count', 'attacker', 'target', 'blocker', 'choiceId', 'answer', 'accept',
  'abilityId', 'source', 'selected', 'kind', 'index',
];
/** Keys `validate.ts` refuses outright: a message that carries one is
 * closed, whatever else it says. */
const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];
/** Keys that are merely strange — empty, spaced, zero-width, full-width —
 * and survive the parser to be ignored or refused further in. */
const ODD_KEYS = ['', ' ', 'ty pe', '​type', 'ＴＹＰＥ'];
const JUNK_KEYS = [...FORBIDDEN_KEYS, ...ODD_KEYS];
/** Zero-width space, LTR and RTL marks, RTL override, BOM, NUL, unpaired
 * surrogates, an astral character, and the characters JSON escapes. */
const HOSTILE = [
  '​', '‎', '‏', '‮', '﻿', '\0', '\ud800', '\udfff', '\u{1f30a}', '"', '\\', '\n',
];

const VALID: unknown[] = [
  { type: 'create', protocol: PROTOCOL_VERSION, seed: 82, deckIdP1: 'abil', deckIdP2: 'abil' },
  { type: 'join', protocol: PROTOCOL_VERSION, matchId: 'no-such-match', token: 'no-such-token' },
  { type: 'action', action: { type: 'END_TURN', player: 'p1' } },
  { type: 'action', action: { type: 'MULLIGAN', player: 'p1', accept: false } },
  { type: 'action', action: { type: 'PLAY_CARD', player: 'p1', instanceId: 'p1-c1' } },
  { type: 'action', action: { type: 'ATTACH_DON', player: 'p1', to: 'p1-leader', count: 1 } },
  { type: 'action', action: { type: 'DECLARE_ATTACK', player: 'p1', attacker: 'p1-leader', target: 'p2-leader' } },
  {
    type: 'action',
    action: {
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId: 'choice-1',
      answer: { kind: 'handles', selected: [0] },
    },
  },
];

interface Generator {
  name: string;
  /** Its share of the run, relative to the others: the socket budget in the
   * header is made of these. */
  weight: number;
  make(rnd: () => number): string | Buffer;
}

function pick<T>(rnd: () => number, items: readonly T[]): T {
  return items[Math.floor(rnd() * items.length)] as T;
}

function randomString(rnd: () => number, max: number): string {
  const length = Math.floor(rnd() * max);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    const roll = rnd();
    if (roll < 0.6) {
      out += String.fromCharCode(32 + Math.floor(rnd() * 95));
    } else if (roll < 0.9) {
      out += pick(rnd, HOSTILE);
    } else {
      out += String.fromCharCode(Math.floor(rnd() * 0xffff));
    }
  }
  return out;
}

/**
 * A random JSON value: scalars, arrays and objects, `depth` containers deep
 * at most. `keys` is the pool object keys come from — the hostile default
 * names prototypes, so a value meant to survive `validate.ts` passes a pool
 * without them.
 */
function randomValue(
  rnd: () => number,
  depth: number,
  keys: readonly string[] = JUNK_KEYS,
): unknown {
  const roll = rnd();
  if (depth <= 0 || roll < 0.45) {
    const scalar = rnd();
    if (scalar < 0.25) {
      return pick(rnd, [0, -0, 1, -1, 2, 99, 2 ** 31, 2 ** 53, -(2 ** 53), 1e308, -1e308, 0.5, 1e-300]);
    }
    if (scalar < 0.55) {
      return rnd() < 0.5 ? pick(rnd, [...REAL_TYPES, 'p1', 'p2', 'abil']) : randomString(rnd, 40);
    }
    if (scalar < 0.7) {
      return null;
    }
    return rnd() < 0.5;
  }
  if (roll < 0.65) {
    const items: unknown[] = [];
    const count = Math.floor(rnd() * 4);
    for (let i = 0; i < count; i += 1) {
      items.push(randomValue(rnd, depth - 1, keys));
    }
    return items;
  }
  const out: Record<string, unknown> = {};
  const count = Math.floor(rnd() * 5);
  for (let i = 0; i < count; i += 1) {
    const key = rnd() < 0.8 ? pick(rnd, REAL_KEYS) : pick(rnd, keys);
    out[key] = randomValue(rnd, depth - 1, keys);
  }
  return out;
}

/**
 * The families, each with its weight. The first ten attack the parser and
 * nearly always cost the socket; the last four pass the parser and are
 * refused, or occasionally honoured, by a handler or the engine with the
 * socket kept. The weights put the kept half at roughly two thirds of the
 * run — see `MAX_RECONNECTS`.
 */
const GENERATORS: Generator[] = [
  {
    name: 'random bytes',
    weight: 1,
    make: (rnd) => {
      const bytes = Buffer.alloc(Math.floor(rnd() * 300));
      for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = Math.floor(rnd() * 256);
      }
      return bytes;
    },
  },
  { name: 'random string', weight: 1, make: (rnd) => randomString(rnd, 200) },
  {
    name: 'truncated valid message',
    weight: 1,
    make: (rnd) => {
      const json = JSON.stringify(pick(rnd, VALID));
      return json.slice(0, Math.floor(rnd() * json.length));
    },
  },
  {
    name: 'valid JSON, random shape',
    weight: 1,
    make: (rnd) => {
      const shape = randomValue(rnd, 1 + Math.floor(rnd() * 6));
      const message =
        typeof shape === 'object' && shape !== null && !Array.isArray(shape) && rnd() < 0.7
          ? { ...(shape as object), type: pick(rnd, REAL_TYPES) }
          : shape;
      return JSON.stringify(message);
    },
  },
  {
    name: 'valid message, one field replaced',
    weight: 1,
    make: (rnd) => {
      const base = JSON.parse(JSON.stringify(pick(rnd, VALID))) as Record<string, unknown>;
      const key = pick(rnd, Object.keys(base));
      base[key] = randomValue(rnd, 3);
      return JSON.stringify(base);
    },
  },
  {
    name: 'hostile unicode in a real field',
    weight: 1,
    make: (rnd) =>
      JSON.stringify(pick(rnd, VALID)).replace(/"([^"]*)"/, () => `"${randomString(rnd, 30)}"`),
  },
  {
    name: 'deep nesting',
    weight: 1,
    make: (rnd) => {
      const depth = 1 + Math.floor(rnd() * 3000);
      return rnd() < 0.5
        ? `${'['.repeat(depth)}${']'.repeat(depth)}`
        : `${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}`;
    },
  },
  {
    name: 'huge numbers',
    weight: 1,
    make: (rnd) =>
      pick(rnd, [
        `{"type":"create","protocol":2,"seed":${'9'.repeat(400)},"deckIdP1":"abil","deckIdP2":"abil"}`,
        '{"type":"create","protocol":2,"seed":1e999,"deckIdP1":"abil","deckIdP2":"abil"}',
        '{"type":"create","protocol":2,"seed":-0,"deckIdP1":"abil","deckIdP2":"abil"}',
        '{"type":"create","protocol":2,"seed":9007199254740993,"deckIdP1":"abil","deckIdP2":"abil"}',
        `{"type":"join","protocol":${'1'.repeat(40)},"matchId":"a","token":"b"}`,
        '{"type":"action","action":{"type":"ATTACH_DON","player":"p1","to":"x","count":1e308}}',
        '{"type":"action","action":{"type":"ANSWER_CHOICE","player":"p1","choiceId":"c","answer":{"kind":"handles","selected":[-1,1e308,null]}}}',
      ]),
  },
  {
    name: 'prototype keys',
    weight: 1,
    make: (rnd) =>
      pick(rnd, [
        '{"type":"join","protocol":2,"matchId":"a","token":"b","__proto__":{"polluted":true}}',
        '{"__proto__":{"type":"join"},"type":"join","protocol":2,"matchId":"a","token":"b"}',
        '{"type":"action","action":{"type":"END_TURN","player":"p1","constructor":{"prototype":{"x":1}}}}',
        '{"type":"action","action":{"__proto__":{"type":"END_TURN","player":"p1"}}}',
        '{"type":"action","action":{"type":"END_TURN","player":"p1","answer":{"__proto__":null}}}',
      ]),
  },
  {
    name: 'oversized',
    weight: 1,
    make: (rnd) => {
      const padding = 'x'.repeat(DEFAULT_LIMITS.MAX_MESSAGE_BYTES + Math.floor(rnd() * 100));
      return `{"type":"join","protocol":2,"matchId":"a","token":"${padding}"}`;
    },
  },
  // From here on the envelope is one `validate.ts` accepts, and the socket
  // is the server's to keep.
  {
    // An `action` whose inner shape is anybody's guess: an engine type or a
    // random one, the seat's player or somebody else's, and extra fields
    // holding arrays, objects and numbers where the engine expects ids. The
    // parser sees `{ type, action: { type: string, player: string } }` and
    // hands it on; `applyAction` — or `seatMismatch`, or `notJoined` from
    // the stranger slot — refuses it with the socket kept.
    name: 'junk action in a valid envelope',
    weight: 10,
    make: (rnd) => {
      const action: Record<string, unknown> = {};
      const extras = Math.floor(rnd() * 4);
      for (let i = 0; i < extras; i += 1) {
        const key =
          rnd() < 0.7 ? pick(rnd, ACTION_FIELDS) : pick(rnd, [...ODD_KEYS, randomString(rnd, 12)]);
        action[key] = randomValue(rnd, 3, ODD_KEYS);
      }
      // Set last, so the two strings the envelope demands are always there.
      action['type'] = rnd() < 0.6 ? pick(rnd, ENGINE_TYPES) : randomString(rnd, 24);
      const seat = rnd();
      action['player'] = seat < 0.7 ? 'p1' : seat < 0.85 ? 'p2' : randomString(rnd, 8);
      return JSON.stringify({ type: 'action', action });
    },
  },
  {
    // A real match id with a token that fits no seat, or a match id nobody
    // minted: `badToken` and `unknownMatch`, each an authentication failure
    // the raised cap never turns into a close. Never a real token — a
    // successful join would seat this socket and close the slot's own.
    name: 'join with wrong credentials',
    weight: 4,
    make: (rnd) =>
      JSON.stringify({
        type: 'join',
        protocol: PROTOCOL_VERSION,
        matchId:
          rnd() < 0.5 ? `fuzz-target-${Math.floor(rnd() * SOCKETS)}` : randomString(rnd, 40),
        token:
          rnd() < 0.5
            ? `fuzz-p${rnd() < 0.5 ? 1 : 2}-${SOCKETS + Math.floor(rnd() * 9)}`
            : randomString(rnd, 40),
      }),
  },
  {
    // A `create` naming a deck the server was not started with: the second
    // id is never the one deck in the catalog, so this is `unknownDeck`
    // every time, and never a match the run has to hold.
    name: 'create with an unknown deck',
    weight: 2,
    make: (rnd) =>
      JSON.stringify({
        type: 'create',
        protocol: PROTOCOL_VERSION,
        seed: Math.floor(rnd() * 2 ** 31),
        deckIdP1: rnd() < 0.5 ? 'abil' : randomString(rnd, 20),
        deckIdP2: pick(rnd, ['no-such-deck', 'ABIL', 'abil ', 'abil\0', randomString(rnd, 20)]),
      }),
  },
  { name: 'valid message', weight: 2, make: (rnd) => JSON.stringify(pick(rnd, VALID)) },
];

const TOTAL_WEIGHT = GENERATORS.reduce((sum, generator) => sum + generator.weight, 0);

/** One roll, weighted: the families' shares of the run. */
function pickGenerator(rnd: () => number): Generator {
  let roll = rnd() * TOTAL_WEIGHT;
  for (const generator of GENERATORS) {
    roll -= generator.weight;
    if (roll < 0) {
      return generator;
    }
  }
  return GENERATORS[GENERATORS.length - 1] as Generator;
}

type Outcome =
  | { kind: 'reply'; type: string; code?: string }
  | { kind: 'closed'; code: number }
  | { kind: 'silent' };

async function outcomeOf(client: TestClient): Promise<Outcome> {
  return Promise.race([
    client.next(2_000).then(
      (message): Outcome =>
        message.type === 'error'
          ? { kind: 'reply', type: message.type, code: message.code }
          : { kind: 'reply', type: message.type },
    ),
    client.closed.then((end): Outcome => ({ kind: 'closed', code: end.code })),
  ]).catch((): Outcome => ({ kind: 'silent' }));
}

/**
 * `TestClient.connect`, retried a bounded number of times when the failure
 * is the host's — `LOOPBACK_EXHAUSTION` names the codes: the loopback
 * ephemeral ports under TIME_WAIT, not the server. Any other error is the
 * server's and fails at once, as before.
 */
async function connectThroughTimeWait(port: number): Promise<TestClient> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await TestClient.connect(port);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= CONNECT_ATTEMPTS || code === undefined || !LOOPBACK_EXHAUSTION.has(code)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, CONNECT_BACKOFF_MS));
    }
  }
}

describe('deterministic fuzzing', () => {
  it(`survives ${MESSAGES} hostile messages (seed ${FUZZ_SEED}) and plays a match afterwards`, { timeout: 180_000 }, async () => {
    const rnd = mulberry32(FUZZ_SEED);
    const log: ServerLogEntry[] = [];
    let uncaught = 0;
    let unhandled = 0;
    const onUncaught = (): void => {
      uncaught += 1;
    };
    const onUnhandled = (): void => {
      unhandled += 1;
    };
    process.on('uncaughtException', onUncaught);
    process.on('unhandledRejection', onUnhandled);

    const server = await startServer({
      port: 0,
      decks: { abil: ABIL_DECK },
      limits: { MAX_MESSAGES_PER_WINDOW: 1_000_000, MAX_AUTH_FAILURES: 1_000_000 },
      log: (entry) => log.push(entry),
    });
    const heapBefore = process.memoryUsage().heapUsed;
    const tally = { replies: 0, closes: 0, silent: 0, reconnects: 0 };
    const closeCodes = new Map<number, number>();
    const replyTypes = new Map<string, number>();
    const errorCodes = new Map<string, number>();
    const byGenerator = new Map<string, number>();

    // Every fuzzing socket but one holds p1's seat in a real match of its
    // own, so an `action` that gets past the parser reaches the engine: the
    // fuzz is aimed at `applyAction`'s structural validation as much as at
    // the parser, and a socket with no seat would have every action refused
    // as `notJoined` before the engine saw a byte. One match per slot,
    // because two sockets on one seat is a reconnection and the first would
    // be closed by the rule rather than by anything the fuzz sent. The one
    // exception is the stranger: it connects and never joins, so everything
    // it sends is out of sequence and the `notJoined` path gets its share of
    // the same hostility.
    for (let slot = 0; slot < SOCKETS; slot += 1) {
      server.createMatch({
        matchId: `fuzz-target-${slot}`,
        seed: 1 + slot,
        decklists: { p1: ABIL_DECK, p2: ABIL_DECK },
        tokens: { p1: `fuzz-p1-${slot}`, p2: `fuzz-p2-${slot}` },
      });
    }
    const seated = async (slot: number): Promise<TestClient> => {
      const client = await connectThroughTimeWait(server.port);
      if (slot === STRANGER) {
        return client;
      }
      client.join(`fuzz-target-${slot}`, `fuzz-p1-${slot}`);
      await client.expect('joined');
      return client;
    };

    try {
      const sockets: (TestClient | null)[] = [];
      for (let slot = 0; slot < SOCKETS; slot += 1) {
        sockets.push(await seated(slot));
      }
      for (let n = 0; n < MESSAGES; n += 1) {
        const slot = n % SOCKETS;
        let client = sockets[slot] ?? null;
        if (client === null || !client.isOpen()) {
          client = await seated(slot);
          sockets[slot] = client;
          tally.reconnects += 1;
        }
        const generator = pickGenerator(rnd);
        byGenerator.set(generator.name, (byGenerator.get(generator.name) ?? 0) + 1);
        const payload = generator.make(rnd);
        if (typeof payload === 'string') {
          client.send(payload);
        } else {
          client.sendRaw(payload);
        }
        const outcome = await outcomeOf(client);
        if (outcome.kind === 'reply') {
          tally.replies += 1;
          replyTypes.set(outcome.type, (replyTypes.get(outcome.type) ?? 0) + 1);
          if (outcome.code !== undefined) {
            errorCodes.set(outcome.code, (errorCodes.get(outcome.code) ?? 0) + 1);
          }
          // A closing code is followed by the close; wait for it so the next
          // message on this slot goes out on a socket that is really open.
          if (!client.isOpen()) {
            await client.closed;
          }
        } else if (outcome.kind === 'closed') {
          tally.closes += 1;
          closeCodes.set(outcome.code, (closeCodes.get(outcome.code) ?? 0) + 1);
        } else {
          tally.silent += 1;
        }
      }
      for (const client of sockets) {
        client?.close();
      }

      // The claims.
      expect(uncaught).toBe(0);
      expect(unhandled).toBe(0);
      expect(log.filter((entry) => entry.event === 'handlerError')).toEqual([]);
      expect(tally.silent).toBe(0);
      // A well-formed action is sometimes a legal one — the seat is real —
      // and an `update` is the honest answer to it. Nothing else may come.
      for (const type of replyTypes.keys()) {
        expect(['error', 'rejected', 'created', 'update']).toContain(type);
      }
      for (const code of closeCodes.keys()) {
        expect([1008, 1009]).toContain(code);
      }
      // Both halves of the mix ran: every family sent something, and the
      // kept-socket refusals each happened — the engine's, and each of the
      // transport codes the close policy keeps the socket on.
      for (const generator of GENERATORS) {
        expect(byGenerator.get(generator.name) ?? 0, generator.name).toBeGreaterThan(0);
      }
      expect(replyTypes.get('rejected') ?? 0).toBeGreaterThan(MESSAGES / 10);
      const kept = ['unknownMatch', 'badToken', 'unknownDeck', 'notJoined', 'seatMismatch'];
      for (const code of kept) {
        expect(errorCodes.get(code) ?? 0, code).toBeGreaterThan(0);
      }
      // The socket budget: the seed is fixed, so this is a property of the
      // mix, and a change to the mix that breaks it is a change to how many
      // loopback ports the suite burns.
      expect(tally.reconnects).toBeLessThanOrEqual(MAX_RECONNECTS);
      const heapAfter = process.memoryUsage().heapUsed;
      expect(heapAfter - heapBefore).toBeLessThan(64 * 1024 * 1024);

      // And a normal match plays afterwards, to the end, over two sockets.
      server.createMatch({
        matchId: 'after-the-storm',
        seed: 3,
        decklists: { p1: ABIL_DECK, p2: ABIL_DECK },
        tokens: { p1: 'a', p2: 'b' },
      });
      const p1 = await connectThroughTimeWait(server.port);
      const p2 = await connectThroughTimeWait(server.port);
      p1.join('after-the-storm', 'a');
      p2.join('after-the-storm', 'b');
      await p1.expect('joined');
      await p2.expect('joined');
      const accepted = await playOut(server, 'after-the-storm', { p1, p2 }, 3);
      expect(accepted).toBeGreaterThan(50);
      expect(server.getMatch('after-the-storm')?.game.status).toBe('finished');
      p1.close();
      p2.close();

      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          fuzzSeed: FUZZ_SEED,
          ...tally,
          closeCodes: Object.fromEntries(closeCodes),
          replies: Object.fromEntries(replyTypes),
          errorCodes: Object.fromEntries(errorCodes),
          byGenerator: Object.fromEntries(byGenerator),
          heapGrowthMiB: Math.round(((heapAfter - heapBefore) / 1024 / 1024) * 10) / 10,
        }),
      );
    } catch (error) {
      throw new Error(
        `[fuzz seed ${FUZZ_SEED}] ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      process.off('uncaughtException', onUncaught);
      process.off('unhandledRejection', onUnhandled);
      await server.close();
    }
  });
});

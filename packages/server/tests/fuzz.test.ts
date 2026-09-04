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
 */

/** Recorded, and printed with any failure: a fuzz run nobody can repeat is
 * a rumour. */
const FUZZ_SEED = 0x5eed2026;
const MESSAGES = 3_000;
const SOCKETS = 6;

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
const JUNK_KEYS = [
  '__proto__', 'constructor', 'prototype', '', ' ', 'ty pe', '​type', 'ＴＹＰＥ',
];
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

function randomValue(rnd: () => number, depth: number): unknown {
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
      items.push(randomValue(rnd, depth - 1));
    }
    return items;
  }
  const out: Record<string, unknown> = {};
  const count = Math.floor(rnd() * 5);
  for (let i = 0; i < count; i += 1) {
    const key = rnd() < 0.8 ? pick(rnd, REAL_KEYS) : pick(rnd, JUNK_KEYS);
    out[key] = randomValue(rnd, depth - 1);
  }
  return out;
}

const GENERATORS: Generator[] = [
  {
    name: 'random bytes',
    make: (rnd) => {
      const bytes = Buffer.alloc(Math.floor(rnd() * 300));
      for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = Math.floor(rnd() * 256);
      }
      return bytes;
    },
  },
  { name: 'random string', make: (rnd) => randomString(rnd, 200) },
  {
    name: 'truncated valid message',
    make: (rnd) => {
      const json = JSON.stringify(pick(rnd, VALID));
      return json.slice(0, Math.floor(rnd() * json.length));
    },
  },
  {
    name: 'valid JSON, random shape',
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
    make: (rnd) => {
      const base = JSON.parse(JSON.stringify(pick(rnd, VALID))) as Record<string, unknown>;
      const key = pick(rnd, Object.keys(base));
      base[key] = randomValue(rnd, 3);
      return JSON.stringify(base);
    },
  },
  {
    name: 'hostile unicode in a real field',
    make: (rnd) =>
      JSON.stringify(pick(rnd, VALID)).replace(/"([^"]*)"/, () => `"${randomString(rnd, 30)}"`),
  },
  {
    name: 'deep nesting',
    make: (rnd) => {
      const depth = 1 + Math.floor(rnd() * 3000);
      return rnd() < 0.5
        ? `${'['.repeat(depth)}${']'.repeat(depth)}`
        : `${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}`;
    },
  },
  {
    name: 'huge numbers',
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
    make: (rnd) => {
      const padding = 'x'.repeat(DEFAULT_LIMITS.MAX_MESSAGE_BYTES + Math.floor(rnd() * 100));
      return `{"type":"join","protocol":2,"matchId":"a","token":"${padding}"}`;
    },
  },
  { name: 'valid message', make: (rnd) => JSON.stringify(pick(rnd, VALID)) },
];

type Outcome =
  | { kind: 'reply'; type: string }
  | { kind: 'closed'; code: number }
  | { kind: 'silent' };

async function outcomeOf(client: TestClient): Promise<Outcome> {
  return Promise.race([
    client.next(2_000).then((message): Outcome => ({ kind: 'reply', type: message.type })),
    client.closed.then((end): Outcome => ({ kind: 'closed', code: end.code })),
  ]).catch((): Outcome => ({ kind: 'silent' }));
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
    const byGenerator = new Map<string, number>();

    // Every fuzzing socket holds p1's seat in a real match of its own, so an
    // `action` that gets past the parser reaches the engine: the fuzz is
    // aimed at `applyAction`'s structural validation as much as at the
    // parser, and a socket with no seat would have every action refused as
    // `notJoined` before the engine saw a byte. One match per slot, because
    // two sockets on one seat is a reconnection and the first would be
    // closed by the rule rather than by anything the fuzz sent.
    for (let slot = 0; slot < SOCKETS; slot += 1) {
      server.createMatch({
        matchId: `fuzz-target-${slot}`,
        seed: 1 + slot,
        decklists: { p1: ABIL_DECK, p2: ABIL_DECK },
        tokens: { p1: `fuzz-p1-${slot}`, p2: `fuzz-p2-${slot}` },
      });
    }
    const seated = async (slot: number): Promise<TestClient> => {
      const client = await TestClient.connect(server.port);
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
        const generator = pick(rnd, GENERATORS);
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
      const heapAfter = process.memoryUsage().heapUsed;
      expect(heapAfter - heapBefore).toBeLessThan(64 * 1024 * 1024);

      // And a normal match plays afterwards, to the end, over two sockets.
      server.createMatch({
        matchId: 'after-the-storm',
        seed: 3,
        decklists: { p1: ABIL_DECK, p2: ABIL_DECK },
        tokens: { p1: 'a', p2: 'b' },
      });
      const p1 = await TestClient.connect(server.port);
      const p2 = await TestClient.connect(server.port);
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

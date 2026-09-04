import type { Action } from '@optcg/engine';
import type { ServerLimits } from './limits.js';
import type { ClientMessage, ServerErrorCode } from './protocol.js';
import { SERVER_ERRORS } from './protocol.js';

/**
 * The strict parser at the socket edge (threat model M1, M2): a string in, a
 * `ClientMessage` or a refusal code out, and nothing in between that trusts
 * the sender.
 *
 * Pure and synchronous on purpose — it touches no socket and no match, so a
 * unit test can throw every shape T1 names at it without a server. The rules
 * are hand-written guards rather than a schema library: three message shapes
 * do not justify new dependency surface (M13), and a guard you can read is a
 * guard you can audit.
 *
 * **What it decides and what it leaves alone.** Each message type has an
 * exact key set — not a superset, not a subset. Primitive types are checked,
 * identifiers are bounded, the byte length and the nesting depth are bounded,
 * and no object anywhere in the message may carry a key that names a
 * prototype. The inner `action` is checked for being a plain object with a
 * string `type` and a string `player`, and then it is the engine's:
 * `applyAction` validates its full shape and rejects with its own reasons.
 * Nothing here is a rule of the game, and nothing here should become one.
 */

export type ParseResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; code: ServerErrorCode };

/**
 * Keys that name a prototype rather than data. `JSON.parse` creates them as
 * own properties, harmlessly — but the objects it builds travel into the
 * engine and into spreads, and refusing the names at the edge means no later
 * layer has to remember why `__proto__` is special.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const CREATE_KEYS = ['type', 'protocol', 'seed', 'deckIdP1', 'deckIdP2'];
const JOIN_KEYS = ['type', 'protocol', 'matchId', 'token'];
const ACTION_KEYS = ['type', 'action'];

export function parseClientMessage(raw: string, limits: ServerLimits): ParseResult {
  // Bytes first, before the parser allocates anything proportional to them.
  // `ws` has already refused a frame over `maxPayload`; this is the same
  // number applied by the layer that owns the string, so the limit holds
  // whichever layer sees the message first.
  if (Buffer.byteLength(raw) > limits.MAX_MESSAGE_BYTES) {
    return refuse(SERVER_ERRORS.oversizedMessage);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return refuse(SERVER_ERRORS.malformedMessage);
  }
  const shape = inspect(parsed, limits.MAX_JSON_DEPTH);
  if (shape !== null) {
    return refuse(shape);
  }
  if (!isPlainObject(parsed)) {
    return refuse(SERVER_ERRORS.malformedMessage);
  }
  const message = parsed;
  if (message['type'] === 'create') {
    return hasExactKeys(message, CREATE_KEYS) &&
      Number.isInteger(message['protocol']) &&
      isSeed(message['seed']) &&
      isId(message['deckIdP1'], limits) &&
      isId(message['deckIdP2'], limits)
      ? { ok: true, message: message as unknown as ClientMessage }
      : refuse(SERVER_ERRORS.malformedMessage);
  }
  if (message['type'] === 'join') {
    return hasExactKeys(message, JOIN_KEYS) &&
      Number.isInteger(message['protocol']) &&
      isId(message['matchId'], limits) &&
      isId(message['token'], limits)
      ? { ok: true, message: message as unknown as ClientMessage }
      : refuse(SERVER_ERRORS.malformedMessage);
  }
  if (message['type'] === 'action') {
    // A plain object with a string `type` and a string `player`, and that is
    // where the server's opinion ends: the engine's own structural validation
    // is the authority on the rest and rejects with its own reasons.
    const action = message['action'];
    return hasExactKeys(message, ACTION_KEYS) &&
      isPlainObject(action) &&
      typeof action['type'] === 'string' &&
      typeof action['player'] === 'string'
      ? { ok: true, message: { type: 'action', action: action as unknown as Action } }
      : refuse(SERVER_ERRORS.malformedMessage);
  }
  return refuse(SERVER_ERRORS.malformedMessage);
}

function refuse(code: ServerErrorCode): ParseResult {
  return { ok: false, code };
}

/**
 * One iterative walk over the parsed value, doing the two things that need
 * every node: the depth bound and the forbidden-key check. Iterative rather
 * than recursive so that a message built to be deep cannot turn the guard
 * itself into the stack overflow it guards against. The root object counts
 * as depth one.
 */
function inspect(value: unknown, maxDepth: number): ServerErrorCode | null {
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 1 }];
  while (stack.length > 0) {
    const item = stack.pop() as { value: unknown; depth: number };
    if (typeof item.value !== 'object' || item.value === null) {
      continue;
    }
    if (item.depth > maxDepth) {
      return SERVER_ERRORS.oversizedMessage;
    }
    if (Array.isArray(item.value)) {
      for (const child of item.value) {
        stack.push({ value: child, depth: item.depth + 1 });
      }
      continue;
    }
    for (const key of Object.keys(item.value)) {
      if (FORBIDDEN_KEYS.has(key)) {
        return SERVER_ERRORS.malformedMessage;
      }
      stack.push({ value: (item.value as Record<string, unknown>)[key], depth: item.depth + 1 });
    }
  }
  return null;
}

/** An object, not null, and not an array — arrays are objects to `typeof`. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Exactly these keys: a missing one and an extra one are the same refusal. */
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/** A string of bounded length; the map lookup it feeds is the only thing that
 * cares what is in it. */
function isId(value: unknown, limits: ServerLimits): value is string {
  return typeof value === 'string' && value.length <= limits.MAX_ID_LENGTH;
}

/**
 * A non-negative safe integer. The engine's generator takes the seed through
 * `| 0` and would accept any number, and the client's picker sends
 * `Math.floor(Math.random() * 2 ** 31)` — the bound is the client's contract,
 * not the engine's, and a seed that is not an integer is not a seed anybody
 * could type into a rematch.
 */
function isSeed(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

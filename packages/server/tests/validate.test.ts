import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../src/limits.js';
import { PROTOCOL_VERSION, SERVER_ERRORS } from '../src/protocol.js';
import { parseClientMessage } from '../src/validate.js';

/**
 * The strict parser, rule by rule (threat model M1, M2). Every refusal T1 and
 * T2 name is produced here on purpose, and every legitimate shape the client
 * sends is accepted byte for byte — a parser that refuses the real client is
 * a wall around an empty room.
 */

const CREATE = {
  type: 'create',
  protocol: PROTOCOL_VERSION,
  seed: 82,
  deckIdP1: 'ST01-Straw-Hat-Crew',
  deckIdP2: 'ST02-Worst-Generation',
};
const JOIN = {
  type: 'join',
  protocol: PROTOCOL_VERSION,
  matchId: 'c2f6e0b4-1c1f-4d7a-9b6e-8f1b1a2c3d4e',
  token: '9a1c2d3e-4f50-4617-8293-a4b5c6d7e8f9',
};
const ACTION = {
  type: 'action',
  action: {
    type: 'ANSWER_CHOICE',
    player: 'p1',
    choiceId: 'choice-3',
    answer: { kind: 'handles', selected: [0, 2] },
  },
};

function parse(value: unknown): ReturnType<typeof parseClientMessage> {
  return parseClientMessage(typeof value === 'string' ? value : JSON.stringify(value), DEFAULT_LIMITS);
}

function code(value: unknown): string | null {
  const result = parse(value);
  return result.ok ? null : result.code;
}

describe('the strict parser', () => {
  it('accepts each legitimate shape verbatim', () => {
    for (const message of [CREATE, JOIN, ACTION]) {
      const result = parse(message);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.message).toEqual(message);
      }
    }
    // The client's seed picker: `Math.floor(Math.random() * 2 ** 31)`, and
    // the extremes of what it can produce.
    expect(code({ ...CREATE, seed: 0 })).toBeNull();
    expect(code({ ...CREATE, seed: 2 ** 31 - 1 })).toBeNull();
    expect(code({ ...CREATE, seed: Number.MAX_SAFE_INTEGER })).toBeNull();
  });

  it('refuses what is not JSON, or not an object', () => {
    expect(code('this is not json')).toBe(SERVER_ERRORS.malformedMessage);
    expect(code('')).toBe(SERVER_ERRORS.malformedMessage);
    expect(code('{"type":"join"')).toBe(SERVER_ERRORS.malformedMessage);
    expect(code('42')).toBe(SERVER_ERRORS.malformedMessage);
    expect(code('"join"')).toBe(SERVER_ERRORS.malformedMessage);
    expect(code('null')).toBe(SERVER_ERRORS.malformedMessage);
    expect(code('[]')).toBe(SERVER_ERRORS.malformedMessage);
    expect(code([JOIN])).toBe(SERVER_ERRORS.malformedMessage);
  });

  it('refuses an unknown or missing type', () => {
    expect(code({})).toBe(SERVER_ERRORS.malformedMessage);
    expect(code({ type: 'leave' })).toBe(SERVER_ERRORS.malformedMessage);
    expect(code({ type: 'JOIN', protocol: 2, matchId: 'a', token: 'b' })).toBe(
      SERVER_ERRORS.malformedMessage,
    );
    expect(code({ ...JOIN, type: ['join'] })).toBe(SERVER_ERRORS.malformedMessage);
  });

  it('refuses an unknown key and a missing key alike', () => {
    expect(code({ ...JOIN, extra: 1 })).toBe(SERVER_ERRORS.malformedMessage);
    expect(code({ ...CREATE, seat: 'p1' })).toBe(SERVER_ERRORS.malformedMessage);
    expect(code({ ...ACTION, matchId: 'x' })).toBe(SERVER_ERRORS.malformedMessage);
    const { token: _token, ...noToken } = JOIN;
    expect(code(noToken)).toBe(SERVER_ERRORS.malformedMessage);
    const { deckIdP2: _deck, ...noDeck } = CREATE;
    expect(code(noDeck)).toBe(SERVER_ERRORS.malformedMessage);
    const { action: _action, ...noAction } = ACTION;
    expect(code(noAction)).toBe(SERVER_ERRORS.malformedMessage);
  });

  it('refuses a wrong primitive type', () => {
    expect(code({ ...JOIN, matchId: 7 })).toBe(SERVER_ERRORS.malformedMessage);
    expect(code({ ...JOIN, token: null })).toBe(SERVER_ERRORS.malformedMessage);
    expect(code({ ...JOIN, token: { value: 'x' } })).toBe(SERVER_ERRORS.malformedMessage);
    expect(code({ ...CREATE, deckIdP1: true })).toBe(SERVER_ERRORS.malformedMessage);
    expect(code({ ...CREATE, seed: '82' })).toBe(SERVER_ERRORS.malformedMessage);
  });

  it('requires an integer protocol, and leaves the mismatch to the transport', () => {
    expect(code({ ...JOIN, protocol: 2.5 })).toBe(SERVER_ERRORS.malformedMessage);
    expect(code({ ...JOIN, protocol: '2' })).toBe(SERVER_ERRORS.malformedMessage);
    expect(code({ ...CREATE, protocol: 1e400 })).toBe(SERVER_ERRORS.malformedMessage);
    // A wrong version is a well-formed message: `protocolMismatch` is the
    // transport's answer, so an old client hears the right word.
    expect(code({ ...JOIN, protocol: 99 })).toBeNull();
  });

  it('requires a non-negative safe integer seed', () => {
    expect(code({ ...CREATE, seed: -1 })).toBe(SERVER_ERRORS.malformedMessage);
    expect(code({ ...CREATE, seed: 1.5 })).toBe(SERVER_ERRORS.malformedMessage);
    expect(code({ ...CREATE, seed: 2 ** 53 })).toBe(SERVER_ERRORS.malformedMessage);
    expect(code({ ...CREATE, seed: 1e400 })).toBe(SERVER_ERRORS.malformedMessage);
    // JSON has no NaN; the closest a sender gets is the literal, which is not
    // JSON at all, and a string, which is not a number.
    expect(code('{"type":"create","protocol":2,"seed":NaN,"deckIdP1":"a","deckIdP2":"b"}')).toBe(
      SERVER_ERRORS.malformedMessage,
    );
    expect(code({ ...CREATE, seed: 'NaN' })).toBe(SERVER_ERRORS.malformedMessage);
  });

  it('bounds every identifier', () => {
    const long = 'x'.repeat(DEFAULT_LIMITS.MAX_ID_LENGTH + 1);
    const exact = 'x'.repeat(DEFAULT_LIMITS.MAX_ID_LENGTH);
    expect(code({ ...JOIN, matchId: long })).toBe(SERVER_ERRORS.malformedMessage);
    expect(code({ ...JOIN, token: long })).toBe(SERVER_ERRORS.malformedMessage);
    expect(code({ ...CREATE, deckIdP1: long })).toBe(SERVER_ERRORS.malformedMessage);
    expect(code({ ...CREATE, deckIdP2: long })).toBe(SERVER_ERRORS.malformedMessage);
    expect(code({ ...JOIN, matchId: exact, token: exact })).toBeNull();
  });

  it('refuses a message over the byte limit, before parsing it', () => {
    const padding = 'x'.repeat(DEFAULT_LIMITS.MAX_MESSAGE_BYTES);
    const result = parseClientMessage(`{"type":"join","x":"${padding}"`, DEFAULT_LIMITS);
    expect(result).toEqual({ ok: false, code: SERVER_ERRORS.oversizedMessage });
    // Bytes, not characters: a string of multi-byte characters is measured
    // the way the frame was.
    const wide = '\u{1F30A}'.repeat(DEFAULT_LIMITS.MAX_MESSAGE_BYTES / 4);
    expect(code({ ...JOIN, token: wide })).toBe(SERVER_ERRORS.oversizedMessage);
    expect(code(`{"type":"join","x":"${'x'.repeat(DEFAULT_LIMITS.MAX_MESSAGE_BYTES - 40)}"}`)).toBe(
      SERVER_ERRORS.malformedMessage,
    );
  });

  it('refuses nesting deeper than the limit, through objects and arrays', () => {
    const depth = DEFAULT_LIMITS.MAX_JSON_DEPTH;
    let nested: unknown = 1;
    for (let level = 0; level < depth; level += 1) {
      nested = { a: nested };
    }
    // `nested` is `depth` objects deep on its own; inside `action` it is one
    // more than the limit.
    expect(code({ ...ACTION, action: { ...ACTION.action, deep: nested } })).toBe(
      SERVER_ERRORS.oversizedMessage,
    );
    let arrays: unknown = [];
    for (let level = 0; level < depth + 1; level += 1) {
      arrays = [arrays];
    }
    expect(code({ ...ACTION, action: { ...ACTION.action, deep: arrays } })).toBe(
      SERVER_ERRORS.oversizedMessage,
    );
    // A thousand levels does not make the guard recurse.
    expect(code(`${'['.repeat(1000)}${']'.repeat(1000)}`)).toBe(SERVER_ERRORS.oversizedMessage);
    // The deepest legitimate message sits inside the limit with room.
    expect(code(ACTION)).toBeNull();
  });

  it('refuses a key that names a prototype, anywhere in the message', () => {
    expect(code('{"type":"join","protocol":2,"matchId":"a","token":"b","__proto__":{}}')).toBe(
      SERVER_ERRORS.malformedMessage,
    );
    expect(
      code('{"type":"action","action":{"type":"END_TURN","player":"p1","__proto__":{"x":1}}}'),
    ).toBe(SERVER_ERRORS.malformedMessage);
    expect(
      code('{"type":"action","action":{"type":"END_TURN","player":"p1","a":{"constructor":1}}}'),
    ).toBe(SERVER_ERRORS.malformedMessage);
    expect(
      code('{"type":"action","action":{"type":"END_TURN","player":"p1","a":[{"prototype":1}]}}'),
    ).toBe(SERVER_ERRORS.malformedMessage);
  });

  it('requires the action to be a plain object with a string type and player', () => {
    expect(code({ type: 'action', action: ['END_TURN'] })).toBe(SERVER_ERRORS.malformedMessage);
    expect(code({ type: 'action', action: null })).toBe(SERVER_ERRORS.malformedMessage);
    expect(code({ type: 'action', action: 'END_TURN' })).toBe(SERVER_ERRORS.malformedMessage);
    expect(code({ type: 'action', action: { player: 'p1' } })).toBe(SERVER_ERRORS.malformedMessage);
    expect(code({ type: 'action', action: { type: 'END_TURN' } })).toBe(
      SERVER_ERRORS.malformedMessage,
    );
    expect(code({ type: 'action', action: { type: 7, player: 'p1' } })).toBe(
      SERVER_ERRORS.malformedMessage,
    );
    expect(code({ type: 'action', action: { type: 'END_TURN', player: ['p1'] } })).toBe(
      SERVER_ERRORS.malformedMessage,
    );
    // Beyond that the shape is the engine's: an action with a garbage payload
    // is well-formed here and rejected there, with the engine's reason.
    expect(
      code({ type: 'action', action: { type: 'END_TURN', player: 'p1', nonsense: { a: [1] } } }),
    ).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import type { Action, GameState } from '@optcg/engine';
import { legalActions, REASONS } from '@optcg/engine';
import { ABIL_DECK } from '@optcg/engine/testdata/abilityDecks';
import { DEFAULT_LIMITS } from '../src/limits.js';
import { PROTOCOL_VERSION, SERVER_ERRORS } from '../src/protocol.js';
import type { ServerLogEntry } from '../src/transport.js';
import { startServer } from '../src/transport.js';
import { playOut } from './wireDrive.js';
import { TestClient } from './wsHelpers.js';

/**
 * The adversary (threat model M10, affirming T9): a client that skips the UI
 * and talks to the socket directly, sending everything A1 and A2 can. Two
 * victims open a match over the wire the way real players do; an anonymous
 * socket and a modified client holding p1's real token then try every move
 * the threat model lists — before the game, and between every honest move
 * of the game. Each attempt is refused with its code, the victims' match is
 * played to the end, the counters are sane, and the process is alive because
 * the test ended.
 *
 * The seed is the one ability-sweep game (of the first sixteen) in which p1
 * faces a blind choice, so an invented handle can be refused as such and not
 * only as a wrong kind of answer. The rate limit is raised for this server
 * and only this one: the victims finish their match at machine speed, some
 * three hundred actions in under a second, and M8 has its own test at the
 * real number.
 */

const SEED = 4;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ENGINE_REASONS = new Set<string>(Object.values(REASONS));
const SERVER_CODES = new Set<string>(Object.values(SERVER_ERRORS));

function create(seed: number): Record<string, unknown> {
  return { type: 'create', protocol: PROTOCOL_VERSION, seed, deckIdP1: 'abil', deckIdP2: 'abil' };
}

describe('the adversary', () => {
  it('is refused at every turn while the victims play their match to the end', { timeout: 60_000 }, async () => {
    const log: ServerLogEntry[] = [];
    const server = await startServer({
      port: 0,
      decks: { abil: ABIL_DECK },
      limits: { MAX_MESSAGES_PER_WINDOW: 100_000 },
      log: (entry) => log.push(entry),
    });
    const closeReasons: string[] = [];

    // The victims' match, opened over the wire — and a twin with the same
    // seed, which is the proof that a match id is minted from nothing in the
    // game (M4): same seed, different id, and neither is the engine's
    // `optcg-<seed>` that `playerView` keeps off the wire.
    const creator = await TestClient.connect(server.port);
    creator.send(create(SEED));
    const created = await creator.expect('created');
    creator.send(create(SEED));
    const twin = await creator.expect('created');
    creator.close();
    expect(created.matchId).toMatch(UUID);
    expect(twin.matchId).toMatch(UUID);
    expect(created.matchId).not.toBe(twin.matchId);
    expect(created.tokens.p1).toMatch(UUID);
    expect(created.tokens.p2).toMatch(UUID);
    expect(created.tokens.p1).not.toBe(created.tokens.p2);
    expect(JSON.stringify(created)).not.toContain(`optcg-${SEED}`);
    const { matchId, tokens } = created;

    const v1 = await TestClient.connect(server.port);
    const v2 = await TestClient.connect(server.port);
    v1.join(matchId, tokens.p1);
    v2.join(matchId, tokens.p2);
    expect((await v1.expect('joined')).seat).toBe('p1');
    expect((await v2.expect('joined')).seat).toBe('p2');

    // A1 — the anonymous socket. An action with no seat, a match that does
    // not exist, then guesses at the token until the door closes on the
    // MAX_AUTH_FAILURES-th one.
    const anon = await TestClient.connect(server.port);
    anon.send({ type: 'action', action: { type: 'CONCEDE', player: 'p1' } });
    expect((await anon.expect('error')).code).toBe(SERVER_ERRORS.notJoined);
    anon.join('11111111-1111-4111-8111-111111111111', tokens.p1);
    expect((await anon.expect('error')).code).toBe(SERVER_ERRORS.unknownMatch);
    for (let guess = 2; guess <= DEFAULT_LIMITS.MAX_AUTH_FAILURES; guess += 1) {
      // The length of a UUID, so the comparison runs to the bytes.
      anon.join(matchId, `${'0'.repeat(35)}${guess}`);
      expect((await anon.expect('error')).code).toBe(SERVER_ERRORS.badToken);
    }
    const anonEnd = await anon.closed;
    expect(anonEnd).toEqual({ code: 1008, reason: SERVER_ERRORS.badToken });
    closeReasons.push(anonEnd.reason);

    // A2 — a modified client with p1's real token. Its join is a reconnection
    // by the protocol's own rule: it takes the seat, and the victim's socket
    // is closed rather than left as a second pair of eyes on it.
    const cheat = await TestClient.connect(server.port);
    cheat.join(matchId, tokens.p1);
    expect((await cheat.expect('joined')).seat).toBe('p1');
    const replaced = await v1.closed;
    expect(replaced.reason).toBe('');
    closeReasons.push(replaced.reason);

    // Before the game: the opponent's move, an answer to a choice nobody
    // asked, a payload of garbage, a create naming a deck the server has not
    // got. Refused, refused, refused — and the socket is still a player's.
    cheat.send({ type: 'action', action: { type: 'MULLIGAN', player: 'p2', accept: false } });
    expect((await cheat.expect('error')).code).toBe(SERVER_ERRORS.seatMismatch);
    cheat.send({
      type: 'action',
      action: {
        type: 'ANSWER_CHOICE',
        player: 'p1',
        choiceId: 'choice-1',
        answer: { kind: 'yesNo', value: true },
      },
    });
    expect((await cheat.expect('rejected')).reason).toBe(REASONS.noPendingChoice);
    cheat.send({
      type: 'action',
      action: { type: 'PLAY_CARD', player: 'p1', instanceId: { nested: [1, { deeper: null }] } },
    });
    const garbage = await cheat.expect('rejected');
    expect(ENGINE_REASONS.has(garbage.reason)).toBe(true);
    cheat.send({ ...create(SEED), deckIdP1: 'nope' });
    expect((await cheat.expect('error')).code).toBe(SERVER_ERRORS.unknownDeck);
    expect(cheat.isOpen()).toBe(true);

    // During the game: between every honest move, whatever the position
    // invites. The opponent's open choice answered from this seat; the
    // cheat's own choice answered with a handle that does not exist and with
    // a choice id that was never issued; p2's own legal move sent verbatim,
    // and again relabelled as p1's. The reasons each one earns are collected
    // and checked at the end, so a seed that never reaches a blind choice
    // fails loudly rather than passing by omission.
    const seen = new Set<string>();
    const injected = { foreignChoice: 0, ownChoice: 0, foreignMove: 0 };
    const CAP = 10;
    const attack = async (game: GameState): Promise<void> => {
      const pending = game.pending;
      if (pending !== null && pending.player === 'p2' && injected.foreignChoice < CAP) {
        injected.foreignChoice += 1;
        cheat.send({
          type: 'action',
          action: {
            type: 'ANSWER_CHOICE',
            player: 'p1',
            choiceId: pending.id,
            answer: { kind: 'yesNo', value: true },
          },
        });
        seen.add(`rejected:${(await cheat.expect('rejected')).reason}`);
        return;
      }
      if (pending !== null && pending.player === 'p1' && injected.ownChoice < CAP) {
        injected.ownChoice += 1;
        cheat.send({
          type: 'action',
          action: {
            type: 'ANSWER_CHOICE',
            player: 'p1',
            choiceId: pending.id,
            answer: { kind: 'handles', selected: [9_999] },
          },
        });
        const kind = pending.blind === true ? 'blind' : 'open';
        seen.add(`rejected:${(await cheat.expect('rejected')).reason}:${kind}`);
        cheat.send({
          type: 'action',
          action: {
            type: 'ANSWER_CHOICE',
            player: 'p1',
            choiceId: 'choice-invented',
            answer: { kind: 'handles', selected: [0] },
          },
        });
        seen.add(`rejected:${(await cheat.expect('rejected')).reason}`);
        return;
      }
      if (pending === null && game.priority === 'p2' && injected.foreignMove < CAP) {
        const theirs = legalActions(game, 'p2').find((action) => action.type !== 'ANSWER_CHOICE');
        if (theirs === undefined) {
          return;
        }
        injected.foreignMove += 1;
        cheat.send({ type: 'action', action: theirs });
        seen.add(`error:${(await cheat.expect('error')).code}`);
        cheat.send({ type: 'action', action: { ...theirs, player: 'p1' } as Action });
        seen.add(`rejected:${(await cheat.expect('rejected')).reason}`);
      }
    };
    const accepted = await playOut(server, matchId, { p1: cheat, p2: v2 }, SEED, {
      beforeStep: attack,
    });
    expect(accepted).toBeGreaterThan(50);
    const summary = JSON.stringify({ injected, seen: [...seen] });
    expect(injected.foreignChoice, summary).toBeGreaterThan(0);
    expect(injected.ownChoice, summary).toBeGreaterThan(0);
    expect(injected.foreignMove, summary).toBe(CAP);
    expect(seen, summary).toContain(`error:${SERVER_ERRORS.seatMismatch}`);
    expect(seen, summary).toContain(`rejected:${REASONS.notYourPriority}`);
    expect(seen, summary).toContain(`rejected:${REASONS.wrongChoiceId}`);
    expect(seen, summary).toContain(`rejected:${REASONS.choiceHandleOutOfRange}:blind`);
    for (const entry of seen) {
      const [channel, word] = entry.split(':') as [string, string];
      expect(channel === 'error' ? SERVER_CODES.has(word) : ENGINE_REASONS.has(word)).toBe(true);
    }

    // The victim returns with the same token and the cheat's socket is the
    // one closed; what it is handed is the whole history of its seat, one
    // batch per accepted action plus the setup, and a finished board.
    const v1back = await TestClient.connect(server.port);
    v1back.join(matchId, tokens.p1);
    const rejoined = await v1back.expect('joined');
    expect(rejoined.view.status).toBe('finished');
    expect(rejoined.journal).toHaveLength(accepted + 1);
    const cheatEnd = await cheat.closed;
    expect(cheatEnd.reason).toBe('');
    closeReasons.push(cheatEnd.reason);

    // The books: two matches (the victims' and its twin), two sockets (the
    // returned v1 and v2), no handler ever threw, and every word that left
    // the server on the close channel was in the vocabulary or empty.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.stats()).toEqual({ matches: 2, connections: 2 });
    expect(log.filter((entry) => entry.event === 'handlerError')).toEqual([]);
    for (const reason of closeReasons) {
      expect(reason === '' || SERVER_CODES.has(reason)).toBe(true);
    }
    v1back.close();
    v2.close();
    await server.close();
  });

  it('meets the caps: serverFull at MAX_MATCHES, a refused upgrade at MAX_CONNECTIONS', async () => {
    const server = await startServer({
      port: 0,
      decks: { abil: ABIL_DECK },
      limits: { MAX_MATCHES: 1, MAX_CONNECTIONS: 2 },
    });
    const a = await TestClient.connect(server.port);
    a.send(create(1));
    await a.expect('created');
    a.send(create(2));
    expect((await a.expect('error')).code).toBe(SERVER_ERRORS.serverFull);
    expect(a.isOpen()).toBe(true);
    const b = await TestClient.connect(server.port);
    await expect(TestClient.connect(server.port)).rejects.toThrow('Unexpected server response: 503');
    expect(server.stats()).toEqual({ matches: 1, connections: 2 });
    a.close();
    b.close();
    await server.close();
  });
});

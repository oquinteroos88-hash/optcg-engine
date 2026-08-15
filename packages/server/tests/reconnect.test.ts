import { deepStrictEqual } from 'node:assert';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ViewEvent } from '@optcg/engine';
import { ABIL_DECK } from '@optcg/engine/testdata/abilityDecks';
import { createMatch } from '../src/session.js';
import type { GameServer } from '../src/transport.js';
import { startServer } from '../src/transport.js';
import { TestClient } from './wsHelpers.js';

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

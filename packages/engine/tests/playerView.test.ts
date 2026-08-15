import { deepStrictEqual } from 'node:assert';
import { describe, expect, it } from 'vitest';
import { playerView, REASONS } from '../src/index.js';
import type { GameState, InstanceId, PlayerId } from '../src/index.js';
import { ABIL_DECK } from '../src/testdata/abilityDecks.js';
import { buildScenario, characterAt } from '../src/testdata/scenarios.js';
import { redactLog } from '../src/viewEvents.js';
import { blindHandleOrder } from '../src/visibility.js';
import { applyFail, applyOk, cloneWith } from './helpers.js';

/**
 * The per-player layer, piece by piece: the `knownBy` lifecycle, Kanjuro's
 * opaque handles, the event redaction, and the view's determinism. The sweep
 * arbiter lives in `informationLeak.test.ts`; these are the targeted cases the
 * sweep would reach only by luck.
 */

const decks = { p1: ABIL_DECK, p2: ABIL_DECK };

function pendingId(state: GameState): string {
  if (state.pending === null) {
    throw new Error('expected an open choice');
  }
  return state.pending.id;
}

function answerCards(state: GameState, player: PlayerId, selected: InstanceId[]): GameState {
  return applyOk(state, {
    type: 'ANSWER_CHOICE',
    player,
    choiceId: pendingId(state),
    answer: { kind: 'cards', selected },
  }).state;
}

// ---------------------------------------------------------------------------
// knownBy lifecycle
// ---------------------------------------------------------------------------

describe('knownBy — searching, revealing, and the shuffle that forgets', () => {
  function searcherStaged(): GameState {
    return buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-038' }], activeDon: 1 },
    });
  }

  it('a deck search belongs to the searcher, and only to the searcher', () => {
    const state = searcherStaged();
    const asking = applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: characterAt(state, 'p1', 0),
      abilityId: 'ABIL-038-dive',
    }).state;

    // CR 8-4-4-4: the searcher checked every face, so the whole deck — not the
    // matches — is theirs now, and CR 11-3-1 keeps it from the opponent.
    for (const id of asking.players.p1.deck) {
      expect(asking.knownBy[id]).toContain('p1');
      expect(asking.knownBy[id]).not.toContain('p2');
    }
    for (const id of asking.players.p2.deck) {
      expect(asking.knownBy[id]).toBeUndefined();
    }

    // The searcher's own view holds the contents as a sorted set; the
    // opponent's view of the same deck holds the count and nothing else.
    const own = playerView(asking, 'p1');
    expect(own.players.p1.deck.known).toEqual([...asking.players.p1.deck].sort());
    const foreign = playerView(asking, 'p2');
    expect(foreign.players.p1.deck.known).toEqual([]);
    expect(foreign.players.p1.deck.count).toBe(asking.players.p1.deck.length);
  });

  it('the shuffle at the end of the search takes the whole read back', () => {
    const state = searcherStaged();
    const asking = applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: characterAt(state, 'p1', 0),
      abilityId: 'ABIL-038-dive',
    }).state;
    // "Up to 1" answered with nothing: CR 4-10-2 sequencing still shuffles,
    // because the player read the deck either way.
    const done = answerCards(asking, 'p1', []);

    for (const id of done.players.p1.deck) {
      expect(done.knownBy[id]).toBeUndefined();
    }
    expect(playerView(done, 'p1').players.p1.deck.known).toEqual([]);
  });

  it('adding the found card to hand reveals it to both players — CR 11-2-1', () => {
    const state = searcherStaged();
    const asking = applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: characterAt(state, 'p1', 0),
      abilityId: 'ABIL-038-dive',
    }).state;
    const found = asking.pending?.candidates[0];
    if (found === undefined) {
      throw new Error('expected the search to find a Signal Flag');
    }
    const done = answerCards(asking, 'p1', [found]);

    // A secret-to-secret effect move "must always be revealed, even if there
    // are no instructions to reveal it" — so the opponent's view of the
    // searcher's hand names exactly this card, and no other.
    expect(done.players.p1.hand).toContain(found);
    expect(done.knownBy[found]).toEqual(['p1', 'p2']);
    expect(playerView(done, 'p2').players.p1.hand.known).toEqual([found]);
  });

  function peekStaged(): GameState {
    // Seed 11 rather than the default 7, which deals both of p2's ABIL-038
    // copies into p2's own life area where no stager may take them from.
    return buildScenario({
      seed: 11,
      decks,
      p1: { characters: [{ cardId: 'ABIL-036' }], activeDon: 1 },
      p2: { characters: [{ cardId: 'ABIL-038' }], activeDon: 1 },
    });
  }

  it('a reveal widens to both, survives the hidden zone, and dies with the shuffle', () => {
    // p1 peeks into p2's hand (the Bao Huang shape) and reveals one card.
    const staged = peekStaged();
    const asking = applyOk(staged, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: characterAt(staged, 'p1', 0),
      abilityId: 'ABIL-036-peek',
    }).state;

    // Offering is showing: the chooser has the whole hand in front of them
    // (CR 11-3-1 — the look is theirs), and their view says so.
    const handNow = [...asking.players.p2.hand].sort();
    expect(playerView(asking, 'p1').players.p2.hand.known).toEqual(handNow);

    const revealed = asking.pending?.candidates[0];
    if (revealed === undefined) {
      throw new Error('expected p2 to hold a card');
    }
    let state = answerCards(asking, 'p1', [revealed]);
    expect(state.knownBy[revealed]).toEqual(['p1', 'p2']);

    // Hand the turn over; the memory of the reveal rides along untouched.
    state = applyOk(state, { type: 'END_TURN', player: 'p1' }).state;
    expect(state.knownBy[revealed]).toEqual(['p1', 'p2']);

    // The revealed card slips to the bottom of p2's deck. The physical game
    // does not erase memories on movement: p1 can still name the deck's
    // bottom card, and their view lists it among the known contents.
    const buried = cloneWith(state, (draft) => {
      const hand = draft.players.p2.hand;
      const at = hand.indexOf(revealed);
      if (at === -1) {
        throw new Error('expected the revealed card to still be in hand');
      }
      hand.splice(at, 1);
      draft.players.p2.deck.push(revealed);
    });
    expect(playerView(buried, 'p1').players.p2.deck.known).toEqual([revealed]);

    // p2 searches and shuffles. The shuffle is the one act that narrows: the
    // tracked card becomes a back among backs for both players.
    const searching = applyOk(buried, {
      type: 'ACTIVATE_ABILITY',
      player: 'p2',
      instanceId: characterAt(buried, 'p2', 0),
      abilityId: 'ABIL-038-dive',
    }).state;
    const done = answerCards(searching, 'p2', []);
    expect(done.knownBy[revealed]).toBeUndefined();
    expect(playerView(done, 'p1').players.p2.deck.known).toEqual([]);
    expect(playerView(done, 'p2').players.p2.deck.known).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Kanjuro's shape, end to end by handle
// ---------------------------------------------------------------------------

describe('the blind choice — Kanjuro answered by opaque handle', () => {
  /** p1 kills p2's Scavenger; its [On K.O.] has p1 choose from p2's hand. */
  function killIt(): GameState {
    const state = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-012' }], activeDon: 4 },
      p2: { characters: [{ cardId: 'ABIL-002', orientation: 'rested' }], activeDon: 4 },
    });
    let next = applyOk(state, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(state, 'p1', 0),
      target: characterAt(state, 'p2', 0),
    }).state;
    next = applyOk(next, { type: 'PASS', player: 'p2' }).state;
    return applyOk(next, { type: 'PASS', player: 'p2' }).state;
  }

  it('marks the choice blind, and the chooser’s view carries handles, never identities', () => {
    const asking = killIt();
    expect(asking.pending?.blind).toBe(true);

    const view = playerView(asking, 'p1');
    if (view.pending?.audience !== 'chooserBlind') {
      throw new Error(`expected a blind chooser view, got ${view.pending?.audience ?? 'none'}`);
    }
    expect(view.pending.handleCount).toBe(asking.players.p2.hand.length);
    expect(view.pending.min).toBe(1);
    expect(view.pending.max).toBe(1);

    // Belt and braces beside the sweep: not one of the owner's hand ids
    // appears anywhere in the chooser's serialized view.
    const json = JSON.stringify(view);
    for (const id of asking.players.p2.hand) {
      expect(json).not.toContain(`"${id}"`);
    }
    // The owner watching the opponent choose gets kind and player, no more.
    expect(playerView(asking, 'p2').pending).toEqual({
      audience: 'other',
      id: pendingId(asking),
      player: 'p1',
      kind: 'selectCards',
    });
  });

  it('answering by handle produces exactly the state the id answer produces', () => {
    const asking = killIt();
    const pending = asking.pending;
    if (pending === null) {
      throw new Error('expected an open choice');
    }
    const order = blindHandleOrder(pending.id, pending.candidates);
    const handle = 1 % order.length;
    const named = order[handle];
    if (named === undefined) {
      throw new Error('expected the handle order to cover the candidates');
    }

    const byHandle = applyOk(asking, {
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId: pending.id,
      answer: { kind: 'handles', selected: [handle] },
    }).state;
    const byId = answerCards(asking, 'p1', [named]);
    deepStrictEqual(byHandle, byId);
  });

  it('the handle order is a permutation and survives serialization', () => {
    const asking = killIt();
    const pending = asking.pending;
    if (pending === null) {
      throw new Error('expected an open choice');
    }
    const order = blindHandleOrder(pending.id, pending.candidates);
    expect([...order].sort()).toEqual([...pending.candidates].sort());

    const rehydrated = JSON.parse(JSON.stringify(asking)) as GameState;
    const again = blindHandleOrder(rehydrated.pending?.id ?? '', rehydrated.pending?.candidates ?? []);
    expect(again).toEqual(order);
  });

  it('rejects bad handles with the reason that names the rule', () => {
    const asking = killIt();
    const id = pendingId(asking);
    const answerWith = (selected: number[]): string =>
      applyFail(asking, {
        type: 'ANSWER_CHOICE',
        player: 'p1',
        choiceId: id,
        answer: { kind: 'handles', selected },
      });

    expect(answerWith([99])).toBe(REASONS.choiceHandleOutOfRange);
    expect(answerWith([-1])).toBe(REASONS.choiceHandleOutOfRange);
    expect(answerWith([0.5])).toBe(REASONS.choiceHandleOutOfRange);
    expect(answerWith([])).toBe(REASONS.choiceCardinality);
    expect(answerWith([0, 1])).toBe(REASONS.choiceCardinality);
  });

  it('refuses a handles answer where the chooser can see — ids are the contract there', () => {
    // The controller trashing from their own hand: same instruction, chooser
    // and owner the same player, nothing blind about it.
    const state = buildScenario({
      decks,
      p1: { activeDon: 3, hand: ['ABIL-002'] },
      p2: { activeDon: 3 },
    });
    const own = state.players.p1.hand.find((id) => state.cards[id]?.cardId === 'ABIL-002');
    if (own === undefined) {
      throw new Error('expected ABIL-002 in hand');
    }
    const asking = applyOk(state, { type: 'PLAY_CARD', player: 'p1', instanceId: own }).state;
    expect(asking.pending?.blind).toBeUndefined();
    expect(
      applyFail(asking, {
        type: 'ANSWER_CHOICE',
        player: 'p1',
        choiceId: pendingId(asking),
        answer: { kind: 'handles', selected: [0] },
      }),
    ).toBe(REASONS.choiceNotBlind);
  });
});

// ---------------------------------------------------------------------------
// Event redaction
// ---------------------------------------------------------------------------

describe('the redacted log — counts to the rival, faces to the entitled', () => {
  function splitStaged(): GameState {
    return buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-029' }], activeDon: 1 },
    });
  }

  it('deckPartitioned survives as two lengths for the rival, ids only for the partitioner', () => {
    const staged = splitStaged();
    const asking = applyOk(staged, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: characterAt(staged, 'p1', 0),
      abilityId: 'ABIL-029-split',
    }).state;
    const candidates = asking.pending?.candidates ?? [];
    const [first, ...rest] = candidates;
    if (first === undefined) {
      throw new Error('expected a partition over three cards');
    }
    const done = applyOk(asking, {
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId: pendingId(asking),
      answer: { kind: 'partition', top: [first], bottom: rest },
    }).state;

    const rival = redactLog(done, 'p2').filter((event) => event.type === 'deckPartitioned').at(-1);
    expect(rival).toEqual({
      type: 'deckPartitioned',
      player: 'p1',
      topCount: 1,
      bottomCount: rest.length,
      top: null,
      bottom: null,
    });

    const own = redactLog(done, 'p1').filter((event) => event.type === 'deckPartitioned').at(-1);
    if (own?.type !== 'deckPartitioned') {
      throw new Error('expected the partitioner to keep the event');
    }
    expect(own.top).toEqual([first]);
    expect(own.bottom).toEqual([...rest].sort());
  });

  it('cardsLookedAt keeps its ids for the looker and only its count for the rival', () => {
    const staged = splitStaged();
    const asking = applyOk(staged, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: characterAt(staged, 'p1', 0),
      abilityId: 'ABIL-029-split',
    }).state;

    const rival = redactLog(asking, 'p2').filter((event) => event.type === 'cardsLookedAt').at(-1);
    if (rival?.type !== 'cardsLookedAt') {
      throw new Error('expected the look to survive as a count');
    }
    expect(rival.count).toBe(3);
    expect(rival.instanceIds).toBeNull();

    const own = redactLog(asking, 'p1').filter((event) => event.type === 'cardsLookedAt').at(-1);
    if (own?.type !== 'cardsLookedAt') {
      throw new Error('expected the looker to keep the event');
    }
    expect(own.instanceIds).toEqual([...(asking.pending?.candidates ?? [])].sort());
  });

  it('a foreign pending is kind and player, nothing else', () => {
    const staged = splitStaged();
    const asking = applyOk(staged, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: characterAt(staged, 'p1', 0),
      abilityId: 'ABIL-029-split',
    }).state;

    const foreign = playerView(asking, 'p2').pending;
    expect(foreign).toEqual({
      audience: 'other',
      id: pendingId(asking),
      player: 'p1',
      kind: 'partitionCards',
    });
  });

  it('a draw carries its identity to the owner and only the fact to the rival', () => {
    const staged = buildScenario({ decks, p1: { activeDon: 1 } });
    const done = applyOk(staged, { type: 'END_TURN', player: 'p1' }).state;

    const ownDraw = redactLog(done, 'p2').filter((event) => event.type === 'cardDrawn').at(-1);
    if (ownDraw?.type !== 'cardDrawn') {
      throw new Error('expected p2 to have drawn at the turn start');
    }
    expect(ownDraw.player).toBe('p2');
    expect(ownDraw.instanceId).toBe(done.players.p2.hand.at(-1));

    const rivalDraw = redactLog(done, 'p1').filter((event) => event.type === 'cardDrawn').at(-1);
    if (rivalDraw?.type !== 'cardDrawn') {
      throw new Error('expected the draw to survive as a fact');
    }
    expect(rivalDraw.instanceId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Determinism and round trip
// ---------------------------------------------------------------------------

describe('the view is a pure derivation', () => {
  it('same state, same player, same bytes — and the rehydrated state agrees', () => {
    const staged = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-012' }], activeDon: 4 },
      p2: { characters: [{ cardId: 'ABIL-002', orientation: 'rested' }], activeDon: 4 },
    });
    let state = applyOk(staged, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(staged, 'p1', 0),
      target: characterAt(staged, 'p2', 0),
    }).state;
    state = applyOk(state, { type: 'PASS', player: 'p2' }).state;
    state = applyOk(state, { type: 'PASS', player: 'p2' }).state;

    for (const player of ['p1', 'p2'] as const) {
      const once = JSON.stringify(playerView(state, player));
      const twice = JSON.stringify(playerView(state, player));
      expect(twice).toBe(once);
      const rehydrated = JSON.parse(JSON.stringify(state)) as GameState;
      expect(JSON.stringify(playerView(rehydrated, player))).toBe(once);
    }
  });

  it('a player’s own life cards are as secret as the opponent’s — CR 3-10-2', () => {
    const state = buildScenario({ decks });
    const own = playerView(state, 'p1');
    expect(own.players.p1.life.known).toEqual([]);
    expect(own.players.p1.life.count).toBe(state.players.p1.life.length);
  });
});

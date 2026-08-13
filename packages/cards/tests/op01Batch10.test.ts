import { describe, expect, it } from 'vitest';
import { applyAction, assertInvariants, createGame } from '@optcg/engine';
import { decide } from '@optcg/engine/testing';
import type { GameState, InstanceId, PlayerId } from '@optcg/engine';
import {
  answer,
  applyOk,
  assertSettled,
  characterAt,
  handCard,
  op01PurpleScenario,
  OP01_PURPLE_DECKS,
} from './support.js';

/**
 * Batch 10 — add DON!! from the DON!! deck.
 *
 * Eight cards, all purple, all one op with a count of 1 and an orientation the
 * printed text names. The op's own bounds live in
 * `packages/engine/tests/addDon.test.ts`; this file is the cards, and the
 * mono-purple fixture is where they are dense enough for a random game to meet
 * them.
 */

function costDon(state: GameState, player: PlayerId, orientation: 'active' | 'rested'): number {
  return state.players[player].don.filter(
    (don) => don.location.kind === 'cost' && don.location.orientation === orientation,
  ).length;
}

function inDonDeck(state: GameState, player: PlayerId): number {
  return state.players[player].don.filter((don) => don.location.kind === 'donDeck').length;
}

// ---------------------------------------------------------------------------
// The two orientations, on the two cards that print them plainly
// ---------------------------------------------------------------------------

describe('OP01-113 Holedem — [On K.O.] add up to 1 and rest it', () => {
  it('adds one rested DON!! when it dies, and takes it out of the DON!! deck', () => {
    const state = op01PurpleScenario({
      p1: { characters: [{ cardId: 'OP01-103' }], activeDon: 4 },
      p2: { characters: [{ cardId: 'OP01-113', orientation: 'rested' }], activeDon: 2 },
    });
    const victim = characterAt(state, 'p2', 0);
    const before = { deck: inDonDeck(state, 'p2'), rested: costDon(state, 'p2', 'rested') };

    let next = applyOk(state, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(state, 'p1', 0),
      target: victim,
    }).state;
    next = applyOk(next, { type: 'PASS', player: 'p2' }).state;
    next = applyOk(next, { type: 'PASS', player: 'p2' }).state;

    expect(next.players.p2.trash).toContain(victim);
    // Moved, not created: one fewer in the deck, one more in the cost area.
    expect(inDonDeck(next, 'p2')).toBe(before.deck - 1);
    expect(costDon(next, 'p2', 'rested')).toBe(before.rested + 1);
    assertSettled(next);
  });
});

describe('OP01-115 Elephant’s Marchoo — K.O., then add up to 1 and set it active', () => {
  function staged(): GameState {
    return op01PurpleScenario({
      p1: { hand: ['OP01-115'], activeDon: 6, clearHand: true },
      p2: { characters: [{ cardId: 'OP01-104' }], activeDon: 4 },
    });
  }

  it('adds an *active* DON!! after the K.O. lands', () => {
    const state = staged();
    const target = characterAt(state, 'p2', 0);
    const before = { deck: inDonDeck(state, 'p1'), active: costDon(state, 'p1', 'active') };

    const asking = applyOk(state, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: handCard(state, 'p1', 'OP01-115'),
    }).state;
    const done = answer(asking, 'p1', { kind: 'cards', selected: [target] });

    expect(done.players.p2.trash).toContain(target);
    expect(inDonDeck(done, 'p1')).toBe(before.deck - 1);
    // Playing the Event spent 4, so the count is read against what is left.
    expect(costDon(done, 'p1', 'active')).toBe(before.active - 4 + 1);
    assertSettled(done);
  });

  it('adds the DON!! even when the K.O. finds nothing, because "then" is sequence', () => {
    // CR 4-10-2: a "then" clause that cannot be resolved does not stop the
    // clause after it. The front half is "up to 1" anyway, so answering it with
    // nothing is a legal move rather than a failure.
    const state = staged();
    const before = inDonDeck(state, 'p1');
    const asking = applyOk(state, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: handCard(state, 'p1', 'OP01-115'),
    }).state;
    const done = answer(asking, 'p1', { kind: 'cards', selected: [] });

    expect(done.players.p2.characters).toHaveLength(1);
    expect(inDonDeck(done, 'p1')).toBe(before - 1);
    assertSettled(done);
  });
});

// ---------------------------------------------------------------------------
// The costs, on the two cards that pay one
// ---------------------------------------------------------------------------

describe('OP01-093 Ulti — rest one DON!! to add one rested', () => {
  it('is a wash this turn and a card ahead from the Refresh Phase onward', () => {
    const state = op01PurpleScenario({
      p1: { hand: ['OP01-093'], activeDon: 5, clearHand: true },
      p2: { activeDon: 4 },
    });
    const before = inDonDeck(state, 'p1');

    const done = applyOk(state, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: handCard(state, 'p1', 'OP01-093'),
    }).state;

    // Five active, and four of them end up rested: two paid Ulti's printed
    // cost, one paid the ①, and the fourth is the one the effect added. Paying
    // rests DON!! rather than removing them (CR 8-3-1: the ① symbol is "rest
    // the specified number"), so the cost area keeps its count and only the
    // orientations move — which is exactly why "a wash this turn" is the right
    // description and "a card ahead" only starts at the Refresh Phase.
    expect(costDon(done, 'p1', 'active')).toBe(2);
    expect(costDon(done, 'p1', 'rested')).toBe(4);
    expect(inDonDeck(done, 'p1')).toBe(before - 1);
    assertSettled(done);
  });
});

describe('OP01-101 Sasaki — trash a card from hand to add one rested', () => {
  it('asks which card pays, and adds only once it is paid', () => {
    // The cost half of the chosen-discard gap, which batch 5 built. CR 8-4-1-3
    // pays before 8-4-1-4 activates, so nothing arrives until the answer does.
    const state = op01PurpleScenario({
      p1: {
        characters: [{ cardId: 'OP01-101', attachedDon: 1 }],
        hand: ['OP01-104', 'OP01-103'],
        activeDon: 4,
        clearHand: true,
      },
      p2: { activeDon: 4 },
    });
    const before = inDonDeck(state, 'p1');
    const attacker = characterAt(state, 'p1', 0);

    const asking = applyOk(state, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker,
      target: state.players.p2.leader,
    }).state;
    expect(asking.pending?.kind).toBe('selectCards');
    // Still nothing added: the cost has not been paid.
    expect(inDonDeck(asking, 'p1')).toBe(before);

    const paid = answer(asking, 'p1', {
      kind: 'cards',
      selected: [asking.pending?.candidates[0] as InstanceId],
    });
    expect(paid.players.p1.trash).toContain(asking.pending?.candidates[0]);
    expect(inDonDeck(paid, 'p1')).toBe(before - 1);
    expect(costDon(paid, 'p1', 'rested')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The Leader, which needed two batches
// ---------------------------------------------------------------------------

describe('OP01-061 Kaido (Leader) — add an active DON!! when the opponent loses a Character', () => {
  function staged(turnOwner: PlayerId): GameState {
    return op01PurpleScenario({
      firstPlayer: turnOwner,
      p1: { characters: [{ cardId: 'OP01-103' }], activeDon: 6 },
      p2: { characters: [{ cardId: 'OP01-104', orientation: 'rested' }], activeDon: 4 },
    });
  }

  it('fires on the K.O. of an opposing Character, once, with a DON!! attached', () => {
    const state = staged('p1');
    const draft = JSON.parse(JSON.stringify(staged('p1'))) as GameState;
    // [DON!! x1] is a condition on the Leader itself.
    const leader = draft.players.p1.leader;
    const don = draft.players.p1.don.find(
      (d) => d.location.kind === 'cost' && d.location.orientation === 'active',
    );
    expect(don).toBeDefined();
    if (don !== undefined) {
      don.location = { kind: 'attached', to: leader };
      draft.cards[leader]?.attachedDon.push(don.instanceId);
    }
    const before = inDonDeck(draft, 'p1');
    void state;

    let next = applyOk(draft, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(draft, 'p1', 0),
      target: characterAt(draft, 'p2', 0),
    }).state;
    next = applyOk(next, { type: 'PASS', player: 'p2' }).state;
    next = applyOk(next, { type: 'PASS', player: 'p2' }).state;

    expect(inDonDeck(next, 'p1')).toBe(before - 1);
    expect(assertSettled(next)).toBeUndefined();
  });

  it('does nothing without the DON!! attached, which is the printed gate', () => {
    const bare = staged('p1');
    const before = inDonDeck(bare, 'p1');
    let next = applyOk(bare, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(bare, 'p1', 0),
      target: characterAt(bare, 'p2', 0),
    }).state;
    next = applyOk(next, { type: 'PASS', player: 'p2' }).state;
    next = applyOk(next, { type: 'PASS', player: 'p2' }).state;

    expect(next.players.p2.trash).toHaveLength(1);
    expect(inDonDeck(next, 'p1')).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Both orientations on one card
// ---------------------------------------------------------------------------

describe('OP01-119 Thunder Bagua — the only card that adds in both orientations', () => {
  it('rests what it adds on the [Counter] half, and only when Life is low', () => {
    const state = op01PurpleScenario({
      firstPlayer: 'p2',
      p1: { hand: ['OP01-119'], activeDon: 4, clearHand: true, life: 2 },
      p2: { characters: [{ cardId: 'OP01-103' }], activeDon: 4 },
    });
    const before = inDonDeck(state, 'p1');
    const battle = applyOk(state, {
      type: 'DECLARE_ATTACK',
      player: 'p2',
      attacker: characterAt(state, 'p2', 0),
      target: state.players.p1.leader,
    }).state;
    const counter = applyOk(battle, { type: 'PASS', player: 'p1' }).state;

    const asking = applyOk(counter, {
      type: 'PLAY_COUNTER_EVENT',
      player: 'p1',
      instanceId: handCard(counter, 'p1', 'OP01-119'),
    }).state;
    const done = answer(asking, 'p1', { kind: 'cards', selected: [done0(asking)] });

    expect(inDonDeck(done, 'p1')).toBe(before - 1);
    expect(costDon(done, 'p1', 'rested')).toBeGreaterThan(0);
  });

  it('adds nothing on that half with three or more Life cards', () => {
    const state = op01PurpleScenario({
      firstPlayer: 'p2',
      p1: { hand: ['OP01-119'], activeDon: 4, clearHand: true, life: 4 },
      p2: { characters: [{ cardId: 'OP01-103' }], activeDon: 4 },
    });
    const before = inDonDeck(state, 'p1');
    const battle = applyOk(state, {
      type: 'DECLARE_ATTACK',
      player: 'p2',
      attacker: characterAt(state, 'p2', 0),
      target: state.players.p1.leader,
    }).state;
    const counter = applyOk(battle, { type: 'PASS', player: 'p1' }).state;
    const asking = applyOk(counter, {
      type: 'PLAY_COUNTER_EVENT',
      player: 'p1',
      instanceId: handCard(counter, 'p1', 'OP01-119'),
    }).state;
    const done = answer(asking, 'p1', { kind: 'cards', selected: [done0(asking)] });

    expect(inDonDeck(done, 'p1')).toBe(before);
  });
});

/** The first candidate of whatever choice is open. */
function done0(state: GameState): InstanceId {
  const id = state.pending?.candidates[0];
  if (id === undefined) {
    throw new Error('expected a candidate');
  }
  return id;
}

// ---------------------------------------------------------------------------
// Manifestation
// ---------------------------------------------------------------------------

describe('a real game of OP-01 mono-purple', () => {
  /**
   * Seven seeds, from a greedy cover over 300 games in one pass. The corpus is
   * new because the deck is: batch 10's eight cards are spread one or two to a
   * mixed deck, and a family a random game meets once in three hundred is a
   * family nobody has measured.
   */
  const SEEDS = [151, 22, 45, 63, 123, 42, 146] as const;
  const ACTIONS = 400;

  /** Every ability a random game of this deck reaches, as an exact set. */
  const PURPLE_ABILITIES = [
    // Batch 10, all twelve halves of the eight cards.
    'OP01-061-onEnemyKO',
    'OP01-093-onPlay',
    'OP01-101-whenAttacking',
    'OP01-106-onPlay',
    'OP01-106-trigger',
    'OP01-113-onKO',
    'OP01-115-main',
    'OP01-115-trigger',
    'OP01-118-counter',
    'OP01-118-trigger',
    'OP01-119-counter',
    'OP01-119-trigger',
    // The batch-9 card this deck also holds, through its own [Trigger].
    'OP01-104-trigger',
    // The other side of the table is `OP01_BP_CROCODILE`, unchanged since batch
    // 3, and its abilities fire too. Listed rather than filtered out: an exact
    // union is only exact if it names everything, and a card on the far side
    // that stopped firing would be a regression this file should see.
    'OP01-062-onOwnEvent',
    'OP01-064-whenAttacking',
    'OP01-070-onPlay',
    'OP01-078-onBlock',
    'OP01-078-whenAttacking',
    'OP01-079-onKO',
    'OP01-080-onKO',
    'OP01-082-trigger',
    'OP01-086-counter',
    'OP01-086-trigger',
    'OP01-087-counter',
    'OP01-087-trigger',
    'OP01-089-counter',
  ] as const;

  function run(seed: number): { state: GameState; fired: Set<string>; added: number } {
    let state = createGame({ seed, decks: OP01_PURPLE_DECKS, firstPlayer: 'p1' });
    const fired = new Set<string>();
    let added = 0;
    for (let step = 0; step < ACTIONS; step += 1) {
      if (state.status === 'finished') break;
      const action = decide(state, state.priority, seed, step);
      if (action === undefined) break;
      const result = applyAction(state, action);
      if (!result.ok) {
        throw new Error(`action ${step} (${action.type}) rejected: ${result.reason}`);
      }
      state = result.state;
      for (const event of result.events) {
        if (event.type === 'abilityTriggered') fired.add(event.abilityId);
        if (event.type === 'donAdded') added += event.count;
      }
      assertInvariants(state);
    }
    return { state, fired, added };
  }

  it('reaches every one of the twelve halves, and both [Counter] Events', () => {
    // Both `[Counter]` halves are in here, which is the sharp part: a Counter
    // Event needs the defender to hold active cost-area DON!! it did not spend
    // on its own turn (CR 7-1-3-2-2 against CR 6-2), and it is the hardest move
    // in this repo for a random game to reach.
    const fired = new Set<string>();
    for (const seed of SEEDS) {
      const game = run(seed);
      for (const id of game.fired) fired.add(id);
      expect(game.state.pending, `seed ${seed}`).toBeNull();
      expect(game.state.stack, `seed ${seed}`).toEqual([]);
      expect(game.state.resume, `seed ${seed}`).toEqual([]);
    }
    expect([...fired].sort()).toEqual([...PURPLE_ABILITIES].sort());
  });

  it('really moves DON!! out of the DON!! deck, in ordinary play', () => {
    // Membership above only says a script resolved. This says the board moved.
    const added = SEEDS.reduce((total, seed) => total + run(seed).added, 0);
    expect(added).toBeGreaterThan(0);
  });

  it('never breaks DON!! conservation, which is what would catch a created card', () => {
    // `assertInvariants` runs after every action inside `run`, so reaching the
    // end of a game is the assertion. Stated as its own case because it is the
    // one this batch could plausibly break: an op that *moves* DON!! and an op
    // that *creates* them look identical from the cost area.
    for (const seed of SEEDS) {
      const game = run(seed);
      for (const player of ['p1', 'p2'] as const) {
        expect(game.state.players[player].don, `seed ${seed}`).toHaveLength(10);
      }
    }
  });
});

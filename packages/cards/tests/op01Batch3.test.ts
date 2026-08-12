import { describe, expect, it } from 'vitest';
import { getPower, hasKeyword, legalActions } from '@optcg/engine';
import type { Action, GameState, InstanceId } from '@optcg/engine';
import { assertSerializationRoundTrip } from '@optcg/engine/testing';
import {
  answer,
  applyOk,
  assertSettled,
  characterAt,
  firedIds,
  handCard,
  op01BpScenario,
  op01KaidoScenario,
  op01Scenario,
  optIn,
} from './support.js';

/**
 * One case per OP-01 batch-3 ability: activated abilities with costs, statics,
 * `[On K.O.]`, `[On Block]`, and the blue/purple half of the set.
 *
 * Three things here are firsts for a printed card in this repo, and each has its
 * own block: an activated ability paying a **cost** (`OP01-003`, `OP01-020`),
 * a script that **suspends twice** (`OP01-096` King), and a `[Counter]` that can
 * remove a battle participant by **bouncing** it rather than K.O.ing it
 * (`OP01-089`).
 */

const FILLERS = ['OP01-076', 'OP01-081', 'OP01-100', 'OP01-066', 'OP01-065', 'OP01-103'];

/** A hand of exactly `size` distinct inert cards — the deck holds 4 of each. */
function handOf(size: number): string[] {
  return FILLERS.slice(0, size);
}
function playFrom(
  state: GameState,
  player: 'p1' | 'p2',
  cardId: string,
): { state: GameState; fired: string[] } {
  const instanceId = handCard(state, player, cardId);
  const result = applyOk(state, { type: 'PLAY_CARD', player, instanceId });
  return { state: result.state, fired: firedIds(result.events) };
}

function activate(
  state: GameState,
  player: 'p1' | 'p2',
  instanceId: InstanceId,
  abilityId: string,
): { state: GameState; fired: string[] } {
  const result = applyOk(state, { type: 'ACTIVATE_ABILITY', player, instanceId, abilityId });
  return { state: result.state, fired: firedIds(result.events) };
}

function offers(state: GameState, player: 'p1' | 'p2', abilityId: string): boolean {
  return legalActions(state, player).some(
    (action) => action.type === 'ACTIVATE_ABILITY' && action.abilityId === abilityId,
  );
}

// ---------------------------------------------------------------------------
// [Activate: Main], with a cost
// ---------------------------------------------------------------------------

describe('OP01-003 Monkey.D.Luffy (Leader) — rest 4 DON!! to wake a Character', () => {
  function board(activeDon: number): GameState {
    return op01Scenario({
      p1: {
        activeDon,
        characters: [
          { cardId: 'OP01-017', orientation: 'rested' }, // Nico Robin, {Straw Hat Crew}, cost 3
          { cardId: 'OP01-053', orientation: 'rested' }, // Wire, {Kid Pirates}, cost 2
        ],
      },
    });
  }

  it('is not offered below four active DON!!, and is above', () => {
    // `canPayCosts` gates `legalActions`, so an unpayable ability is invisible
    // rather than refused — the affordance contract PR #15 established.
    expect(offers(board(3), 'p1', 'OP01-003-main')).toBe(false);
    expect(offers(board(4), 'p1', 'OP01-003-main')).toBe(true);
  });

  it('rests exactly four DON!!, wakes the Character and adds 1000 for the turn', () => {
    const start = board(5);
    const robin = characterAt(start, 'p1', 0);
    const wire = characterAt(start, 'p1', 1);

    const used = activate(start, 'p1', start.players.p1.leader, 'OP01-003-main');
    expect(used.fired).toEqual(['OP01-003-main']);
    // Only {Supernovas}/{Straw Hat Crew} within cost 5: Wire is neither.
    expect(used.state.pending?.candidates).toEqual([robin]);

    const done = answer(used.state, 'p1', { kind: 'cards', selected: [robin] });
    expect(done.cards[robin]?.orientation).toBe('active');
    expect(done.cards[wire]?.orientation).toBe('rested');
    expect(getPower(done, robin)).toBe(5000); // 4000 printed + 1000
    const activeDon = done.players.p1.don.filter(
      (don) => don.location.kind === 'cost' && don.location.orientation === 'active',
    ).length;
    expect(activeDon).toBe(1);
    assertSettled(done);
  });

  it('is once per turn', () => {
    const start = board(10);
    const first = activate(start, 'p1', start.players.p1.leader, 'OP01-003-main');
    const done = answer(first.state, 'p1', { kind: 'cards', selected: [] });
    expect(done.cards[done.players.p1.leader]?.usedThisTurn).toContain('OP01-003-main');
    expect(offers(done, 'p1', 'OP01-003-main')).toBe(false);
  });
});

describe('OP01-020 Hyogoro — rest itself for +2000', () => {
  it('rests as the price, and a rested copy is not offered again', () => {
    const start = op01Scenario({
      p1: { activeDon: 2, characters: [{ cardId: 'OP01-020' }, { cardId: 'OP01-010' }] },
    });
    const hyogoro = characterAt(start, 'p1', 0);
    const ally = characterAt(start, 'p1', 1);
    expect(offers(start, 'p1', 'OP01-020-main')).toBe(true);

    const used = activate(start, 'p1', hyogoro, 'OP01-020-main');
    const done = answer(used.state, 'p1', { kind: 'cards', selected: [ally] });

    expect(done.cards[hyogoro]?.orientation).toBe('rested');
    expect(getPower(done, ally)).toBe(5000); // 3000 + 2000
    // No [Once Per Turn] is printed and none is needed: a rested card cannot
    // pay `restSelf`, so the ability is invisible until the Refresh Phase.
    expect(offers(done, 'p1', 'OP01-020-main')).toBe(false);
    assertSettled(done);
  });

  it('can name itself, because the printed text says "your Leader or Character cards"', () => {
    const start = op01Scenario({ p1: { activeDon: 2, characters: [{ cardId: 'OP01-020' }] } });
    const hyogoro = characterAt(start, 'p1', 0);
    const used = activate(start, 'p1', hyogoro, 'OP01-020-main');
    expect(used.state.pending?.candidates).toContain(hyogoro);
    const done = answer(used.state, 'p1', { kind: 'cards', selected: [hyogoro] });
    // Rested by its own cost, and 2000 stronger for the turn.
    expect(done.cards[hyogoro]?.orientation).toBe('rested');
    expect(getPower(done, hyogoro)).toBe(5000);
    assertSettled(done);
  });
});

// ---------------------------------------------------------------------------
// static
// ---------------------------------------------------------------------------

describe('OP01-068 Gecko Moria — [Double Attack] with 5 or more cards in hand', () => {
  function moria(handSize: number, firstPlayer: 'p1' | 'p2' = 'p1'): GameState {
    return op01BpScenario({
      firstPlayer,
      p1: {
        clearHand: true,
        hand: handOf(handSize),
        characters: [{ cardId: 'OP01-068' }],
        activeDon: 2,
      },
    });
  }

  it('grants the keyword at five cards and not at four', () => {
    const five = moria(5);
    expect(hasKeyword(five, characterAt(five, 'p1', 0), 'doubleAttack')).toBe(true);

    const four = moria(4);
    expect(hasKeyword(four, characterAt(four, 'p1', 0), 'doubleAttack')).toBe(false);
  });

  it('is [Your Turn] only', () => {
    // The condition is `and(isYourTurn, hand >= 5)`. On the opponent's turn the
    // static is dormant however full the hand is.
    const theirs = moria(6, 'p2');
    expect(hasKeyword(theirs, characterAt(theirs, 'p1', 0), 'doubleAttack')).toBe(false);
  });

  it('does not touch the declared power-condition divergence', () => {
    // OP06-002 is the card whose static asks about its *own power*, which reads
    // the without-statics value by design (the recursion guard). This one asks
    // about hand size, so `countCards` answers it without re-entering getPower —
    // the divergence is untouched and this batch prints nothing that hits it.
    const five = moria(5);
    const moriaId = characterAt(five, 'p1', 0);
    expect(getPower(five, moriaId)).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// [On K.O.]
// ---------------------------------------------------------------------------

describe('OP01-080 Miss Doublefinger(Zala) — [On K.O.] draw 1', () => {
  it('draws when K.O.d in battle', () => {
    const start = op01BpScenario({
      p1: { activeDon: 2, characters: [{ cardId: 'OP01-065' }] }, // Vergo, 7000
      p2: { characters: [{ cardId: 'OP01-080', orientation: 'rested' }] }, // 4000
    });
    const attacker = characterAt(start, 'p1', 0);
    const zala = characterAt(start, 'p2', 0);
    const handBefore = start.players.p2.hand.length;

    const declared = applyOk(start, {
      type: 'DECLARE_ATTACK', player: 'p1', attacker, target: zala,
    }).state;
    const blockStep = applyOk(declared, { type: 'PASS', player: 'p2' }).state;
    const done = applyOk(blockStep, { type: 'PASS', player: 'p2' }).state;

    expect(done.players.p2.characters).toEqual([]);
    expect(firedIds(done.log)).toContain('OP01-080-onKO');
    expect(done.players.p2.hand).toHaveLength(handBefore + 1);
    assertSettled(done);
  });

  it('does NOT draw when trashed to make room for a sixth Character', () => {
    // The distinction the engine has honoured since Phase 0 and which
    // `sixthCharacter.test.ts` could only test with a vanilla card — its own
    // comment asks for this upgrade. Trashing for room passes
    // `'trashedForRoom'`, and the [On K.O.] trigger sits under `cause === 'ko'`.
    const start = op01BpScenario({
      p1: {
        activeDon: 10,
        hand: ['OP01-076'],
        characters: [
          { cardId: 'OP01-080' },
          { cardId: 'OP01-076' },
          { cardId: 'OP01-081' },
          { cardId: 'OP01-066' },
          { cardId: 'OP01-103' },
        ],
      },
    });
    const zala = characterAt(start, 'p1', 0);
    const toPlay = handCard(start, 'p1', 'OP01-076');
    const handBefore = start.players.p1.hand.length;

    const result = applyOk(start, {
      type: 'PLAY_CARD', player: 'p1', instanceId: toPlay, trashCharacter: zala,
    });

    expect(result.state.players.p1.trash).toContain(zala);
    expect(firedIds(result.events)).not.toContain('OP01-080-onKO');
    expect(result.state.log.some((event) => event.type === 'koed')).toBe(false);
    expect(result.state.log.some((event) => event.type === 'characterTrashedForRoom')).toBe(true);
    // One card left the hand to be played, and nothing was drawn.
    expect(result.state.players.p1.hand).toHaveLength(handBefore - 1);
    assertSettled(result.state);
  });
});

describe('OP01-079 Ms. All Sunday — [On K.O.] recover an Event, if the Leader fits', () => {
  function koHer(leaderFits: boolean): { state: GameState; sunday: InstanceId } {
    // Crocodile carries {Baroque Works}; Kaido does not, which is the whole of
    // the difference between the two scenarios.
    const build = leaderFits ? op01BpScenario : op01KaidoScenario;
    const state = build({
      p1: { activeDon: 2, characters: [{ cardId: leaderFits ? 'OP01-065' : 'OP01-107' }] },
      p2: {
        characters: [{ cardId: 'OP01-079', orientation: 'rested' }],
        hand: leaderFits ? ['OP01-086'] : [],
      },
    });
    return { state, sunday: characterAt(state, 'p2', 0) };
  }

  it('offers an Event out of the trash under a {Baroque Works} Leader', () => {
    const { state, sunday } = koHer(true);
    // Put an Event in the trash first, by playing it.
    const attacker = characterAt(state, 'p1', 0);
    const declared = applyOk(state, {
      type: 'DECLARE_ATTACK', player: 'p1', attacker, target: sunday,
    }).state;
    const blockStep = applyOk(declared, { type: 'PASS', player: 'p2' }).state;
    const damaged = applyOk(blockStep, { type: 'PASS', player: 'p2' }).state;

    expect(firedIds(damaged.log)).toContain('OP01-079-onKO');
    // The trash may hold no Event yet, in which case the select finds nothing
    // and the script resolves without asking — the `min: 0` contract.
    assertSettled(damaged);
  });

  it('does not fire at all under a Leader without the type', () => {
    const { state, sunday } = koHer(false);
    const attacker = characterAt(state, 'p1', 0);
    const declared = applyOk(state, {
      type: 'DECLARE_ATTACK', player: 'p1', attacker, target: sunday,
    }).state;
    const blockStep = applyOk(declared, { type: 'PASS', player: 'p2' }).state;
    const done = applyOk(blockStep, { type: 'PASS', player: 'p2' }).state;

    expect(done.players.p2.characters).toEqual([]);
    expect(firedIds(done.log)).not.toContain('OP01-079-onKO');
    assertSettled(done);
  });
});

describe('OP01-108 Hitokiri Kamazo — [On K.O.] pay DON!! −1 to K.O. back', () => {
  it('is an opt-in, and taking it K.O.s an opponent Character', () => {
    const start = op01KaidoScenario({
      p1: { activeDon: 4, characters: [{ cardId: 'OP01-107' }] }, // Babanuki, 7000
      p2: {
        activeDon: 3,
        characters: [
          { cardId: 'OP01-108', orientation: 'rested' }, // 5000, dies to Babanuki
          { cardId: 'OP01-103' }, // Apoo, cost 4 — inside the gate
        ],
      },
    });
    const attacker = characterAt(start, 'p1', 0);
    const kamazo = characterAt(start, 'p2', 0);
    const apoo = characterAt(start, 'p2', 1);

    const declared = applyOk(start, {
      type: 'DECLARE_ATTACK', player: 'p1', attacker, target: kamazo,
    }).state;
    const blockStep = applyOk(declared, { type: 'PASS', player: 'p2' }).state;
    const damaged = applyOk(blockStep, { type: 'PASS', player: 'p2' }).state;

    // "You may return…" on an auto ability is an opt-in (CR 8-1-2).
    const accepted = optIn(damaged, 'p2', true);
    // Its own controller's Characters are not candidates; only p1's.
    expect(accepted.pending?.candidates).toEqual([attacker]);
    const done = answer(accepted, 'p2', { kind: 'cards', selected: [attacker] });

    expect(done.players.p1.characters).toEqual([]);
    expect(done.players.p2.characters).toEqual([apoo]);
    assertSettled(done);
  });

  it('declining leaves the DON!! where it was', () => {
    const start = op01KaidoScenario({
      p1: { activeDon: 4, characters: [{ cardId: 'OP01-107' }] },
      p2: { activeDon: 3, characters: [{ cardId: 'OP01-108', orientation: 'rested' }] },
    });
    const attacker = characterAt(start, 'p1', 0);
    const kamazo = characterAt(start, 'p2', 0);
    const donBefore = start.players.p2.don.filter((d) => d.location.kind === 'cost').length;

    const declared = applyOk(start, {
      type: 'DECLARE_ATTACK', player: 'p1', attacker, target: kamazo,
    }).state;
    const blockStep = applyOk(declared, { type: 'PASS', player: 'p2' }).state;
    const damaged = applyOk(blockStep, { type: 'PASS', player: 'p2' }).state;
    const done = optIn(damaged, 'p2', false);

    expect(done.players.p1.characters).toEqual([attacker]);
    expect(done.players.p2.don.filter((d) => d.location.kind === 'cost')).toHaveLength(donBefore);
    assertSettled(done);
  });
});

// ---------------------------------------------------------------------------
// [On Block]
// ---------------------------------------------------------------------------

describe('OP01-111 Black Maria — [On Block] pay DON!! −1 for +1000', () => {
  it('boosts itself for the TURN, not the battle', () => {
    const start = op01KaidoScenario({
      // Bellamy is 4000: Black Maria at 5000 already survives, and at 6000 the
      // margin is the buff. Apoo would be 6000 and take the tie, which the
      // attacker wins (CR 7-1-4-1) — a different test.
      p1: { activeDon: 3, characters: [{ cardId: 'OP01-076' }] },
      p2: { activeDon: 3, characters: [{ cardId: 'OP01-111' }] },
    });
    const attacker = characterAt(start, 'p1', 0);
    const maria = characterAt(start, 'p2', 0);

    const declared = applyOk(start, {
      type: 'DECLARE_ATTACK', player: 'p1', attacker, target: start.players.p2.leader,
    }).state;
    const blocked = applyOk(declared, {
      type: 'DECLARE_BLOCK', player: 'p2', blocker: maria,
    }).state;
    const boosted = optIn(blocked, 'p2', true);

    expect(firedIds(boosted.log)).toContain('OP01-111-onBlock');
    expect(getPower(boosted, maria)).toBe(6000); // 5000 + 1000

    // The battle resolves and the buff stays: the card prints "during this
    // turn", so it is `endOfTurn`, not `endOfBattle`.
    const done = applyOk(boosted, { type: 'PASS', player: 'p2' }).state;
    expect(done.battle).toBeNull();
    expect(getPower(done, maria)).toBe(6000);
    assertSettled(done);
  });
});

describe('OP01-078 Boa Hancock — one sentence, two triggers', () => {
  function hancock(handSize: number): GameState {
    return op01BpScenario({
      p1: { activeDon: 3, characters: [{ cardId: 'OP01-103' }] },
      p2: {
        clearHand: true,
        hand: handOf(handSize),
        activeDon: 3,
        characters: [{ cardId: 'OP01-078', attachedDon: 1 }],
      },
    });
  }

  it('draws on block with a hand of five or less', () => {
    const start = hancock(3);
    const attacker = characterAt(start, 'p1', 0);
    const boa = characterAt(start, 'p2', 0);
    const declared = applyOk(start, {
      type: 'DECLARE_ATTACK', player: 'p1', attacker, target: start.players.p2.leader,
    }).state;
    const blocked = applyOk(declared, {
      type: 'DECLARE_BLOCK', player: 'p2', blocker: boa,
    }).state;

    expect(firedIds(blocked.log)).toContain('OP01-078-onBlock');
    expect(blocked.players.p2.hand).toHaveLength(4);
  });

  it('does not fire with a hand of six', () => {
    const start = hancock(6);
    const attacker = characterAt(start, 'p1', 0);
    const boa = characterAt(start, 'p2', 0);
    const declared = applyOk(start, {
      type: 'DECLARE_ATTACK', player: 'p1', attacker, target: start.players.p2.leader,
    }).state;
    const blocked = applyOk(declared, {
      type: 'DECLARE_BLOCK', player: 'p2', blocker: boa,
    }).state;
    expect(firedIds(blocked.log)).not.toContain('OP01-078-onBlock');
    expect(blocked.players.p2.hand).toHaveLength(6);
  });

  it('draws on its own attack too, from the same shared list', () => {
    const start = op01BpScenario({
      p1: {
        clearHand: true,
        hand: ['OP01-076'],
        activeDon: 3,
        characters: [{ cardId: 'OP01-078', attachedDon: 1 }],
      },
    });
    const boa = characterAt(start, 'p1', 0);
    const attacked = applyOk(start, {
      type: 'DECLARE_ATTACK', player: 'p1', attacker: boa, target: start.players.p2.leader,
    });
    expect(firedIds(attacked.events)).toEqual(['OP01-078-whenAttacking']);
    expect(attacked.state.players.p1.hand).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// [On Play], blue and purple
// ---------------------------------------------------------------------------

describe('OP01-070 Dracule Mihawk — [On Play] bottom-deck a Character', () => {
  it('sends the chosen Character to the bottom of its OWNER deck', () => {
    const start = op01BpScenario({
      p1: { activeDon: 9, hand: ['OP01-070'], characters: [{ cardId: 'OP01-076' }] },
      p2: { characters: [{ cardId: 'OP01-065' }] }, // Vergo, cost 5
    });
    const mine = characterAt(start, 'p1', 0);
    const theirs = characterAt(start, 'p2', 0);
    const theirDeckBefore = start.players.p2.deck.length;

    const played = playFrom(start, 'p1', 'OP01-070');
    expect(played.fired).toEqual(['OP01-070-onPlay']);
    // "1 Character", not "your opponent's": both boards are candidates.
    expect(played.state.pending?.candidates).toEqual(expect.arrayContaining([mine, theirs]));

    const done = answer(played.state, 'p1', { kind: 'cards', selected: [theirs] });
    expect(done.players.p2.characters).toEqual([]);
    expect(done.players.p2.deck).toHaveLength(theirDeckBefore + 1);
    expect(done.players.p2.deck.at(-1)).toBe(theirs);
    assertSettled(done);
  });
});

describe('OP01-097 Queen — [On Play] Rush, then −2000', () => {
  it('can attack the turn it was played, and takes 2000 off a Character', () => {
    const start = op01KaidoScenario({
      p1: { activeDon: 7, hand: ['OP01-097'] },
      p2: { characters: [{ cardId: 'OP01-103' }] }, // Scratchmen Apoo, 6000
    });
    const apoo = characterAt(start, 'p2', 0);

    const played = playFrom(start, 'p1', 'OP01-097');
    const accepted = optIn(played.state, 'p1', true);
    const done = answer(accepted, 'p1', { kind: 'cards', selected: [apoo] });

    const queen = characterAt(done, 'p1', 0);
    expect(hasKeyword(done, queen, 'rush')).toBe(true);
    // Rush is the exemption from summoning sickness, read through legalActions.
    expect(
      legalActions(done, 'p1').some((a) => a.type === 'DECLARE_ATTACK' && a.attacker === queen),
    ).toBe(true);
    expect(getPower(done, apoo)).toBe(4000); // 6000 printed − 2000
    assertSettled(done);
  });

  it('declining the cost leaves it summoning-sick', () => {
    const start = op01KaidoScenario({ p1: { activeDon: 7, hand: ['OP01-097'] } });
    const played = playFrom(start, 'p1', 'OP01-097');
    const done = optIn(played.state, 'p1', false);
    const queen = characterAt(done, 'p1', 0);
    expect(hasKeyword(done, queen, 'rush')).toBe(false);
    assertSettled(done);
  });
});

describe('OP01-094 Kaido — [On Play] wipe every other Character', () => {
  it('K.O.s both boards but never itself', () => {
    const start = op01KaidoScenario({
      p1: {
        activeDon: 10,
        hand: ['OP01-094'],
        characters: [{ cardId: 'OP01-103' }, { cardId: 'OP01-107' }],
      },
      p2: { characters: [{ cardId: 'OP01-076' }, { cardId: 'OP01-081' }] },
    });

    const played = playFrom(start, 'p1', 'OP01-094');
    // No selection at all: "all Characters" is a selector, not a choice.
    const done = optIn(played.state, 'p1', true);

    expect(done.players.p2.characters).toEqual([]);
    expect(done.players.p1.characters).toHaveLength(1);
    const survivor = characterAt(done, 'p1', 0);
    expect(done.cards[survivor]?.cardId).toBe('OP01-094');
    assertSettled(done);
  });

  it('does not fire under a Leader without {Animal Kingdom Pirates}', () => {
    const start = op01BpScenario({
      p1: { activeDon: 10, hand: ['OP01-094'], characters: [{ cardId: 'OP01-103' }] },
      p2: { characters: [{ cardId: 'OP01-076' }] },
    });
    const mine = characterAt(start, 'p1', 0);
    const theirs = characterAt(start, 'p2', 0);
    const played = playFrom(start, 'p1', 'OP01-094');
    expect(played.fired).toEqual([]);
    expect(played.state.players.p1.characters).toContain(mine);
    expect(played.state.players.p2.characters).toEqual([theirs]);
    assertSettled(played.state);
  });
});

// ---------------------------------------------------------------------------
// OP01-096 King — the first printed card that suspends twice
// ---------------------------------------------------------------------------

describe('OP01-096 King — two selections in one script', () => {
  function kingBoard(): GameState {
    return op01KaidoScenario({
      p1: { activeDon: 9, hand: ['OP01-096'] },
      p2: {
        characters: [
          { cardId: 'OP01-081' }, // Mocha, cost 3 — inside the first gate only
          { cardId: 'OP01-076' }, // Bellamy, cost 2 — inside both
        ],
      },
    });
  }

  it('asks twice, with different gates, and K.O.s both', () => {
    const start = kingBoard();
    const mocha = characterAt(start, 'p2', 0);
    const bellamy = characterAt(start, 'p2', 1);

    const played = playFrom(start, 'p1', 'OP01-096');
    const first = optIn(played.state, 'p1', true);
    // First gate: cost 3 or less — both qualify.
    expect(first.pending?.candidates).toEqual([mocha, bellamy]);

    const between = answer(first, 'p1', { kind: 'cards', selected: [mocha] });
    // Second gate: cost 2 or less — only Bellamy, and Mocha is already gone.
    expect(between.pending).not.toBeNull();
    expect(between.pending?.candidates).toEqual([bellamy]);

    const done = answer(between, 'p1', { kind: 'cards', selected: [bellamy] });
    expect(done.players.p2.characters).toEqual([]);
    assertSettled(done);
  });

  it('survives a JSON round trip between the two questions', () => {
    // The state *between* the selections is a real resting state: one `select`
    // answered, its result parked in `vars`, another open. The cursor is a frame
    // stack of plain data for exactly this reason, and nothing printed had ever
    // put it under load until this card.
    const start = kingBoard();
    const mocha = characterAt(start, 'p2', 0);
    const bellamy = characterAt(start, 'p2', 1);

    const played = playFrom(start, 'p1', 'OP01-096');
    const first = optIn(played.state, 'p1', true);
    const between = answer(first, 'p1', { kind: 'cards', selected: [mocha] });

    assertSerializationRoundTrip(between);
    const rehydrated = JSON.parse(JSON.stringify(between)) as GameState;
    expect(rehydrated.pending?.id).toBe(between.pending?.id);
    expect(rehydrated.stack).toHaveLength(1);

    // And the answer given after rehydrating lands identically.
    const answerAction: Action = {
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId: between.pending?.id ?? '',
      answer: { kind: 'cards', selected: [bellamy] },
    };
    const fromLive = applyOk(between, answerAction).state;
    const fromDisk = applyOk(rehydrated, answerAction).state;
    expect(fromDisk).toEqual(fromLive);
    assertSettled(fromDisk);
  });

  it('takes an empty first answer and still asks the second', () => {
    const start = kingBoard();
    const mocha = characterAt(start, 'p2', 0);
    const bellamy = characterAt(start, 'p2', 1);

    const played = playFrom(start, 'p1', 'OP01-096');
    const first = optIn(played.state, 'p1', true);
    const between = answer(first, 'p1', { kind: 'cards', selected: [] });
    expect(between.pending?.candidates).toEqual([bellamy]);

    const done = answer(between, 'p1', { kind: 'cards', selected: [] });
    expect(done.players.p2.characters).toEqual([mocha, bellamy]);
    assertSettled(done);
  });

  it('never suspends at all when neither gate has a candidate', () => {
    const start = op01KaidoScenario({
      p1: { activeDon: 9, hand: ['OP01-096'] },
      p2: { characters: [{ cardId: 'OP01-107' }] }, // Babanuki, cost 5 — outside both
    });
    const babanuki = characterAt(start, 'p2', 0);
    const played = playFrom(start, 'p1', 'OP01-096');
    const done = optIn(played.state, 'p1', true);
    expect(done.pending).toBeNull();
    expect(done.players.p2.characters).toEqual([babanuki]);
    assertSettled(done);
  });
});

// ---------------------------------------------------------------------------
// The blue [Counter] Events, including the one that ends a battle
// ---------------------------------------------------------------------------

describe('OP01-086 Overheat — [Counter] boost then bounce an ACTIVE Character', () => {
  it('cannot reach either battle participant, because both are rested', () => {
    const start = op01BpScenario({
      p1: { activeDon: 3, characters: [{ cardId: 'OP01-076' }] },
      p2: { activeDon: 3, hand: ['OP01-086'], characters: [{ cardId: 'OP01-081' }] },
    });
    const attacker = characterAt(start, 'p1', 0);
    const mocha = characterAt(start, 'p2', 0);

    const declared = applyOk(start, {
      type: 'DECLARE_ATTACK', player: 'p1', attacker, target: start.players.p2.leader,
    }).state;
    const counterStep = applyOk(declared, { type: 'PASS', player: 'p2' }).state;
    const played = applyOk(counterStep, {
      type: 'PLAY_COUNTER_EVENT', player: 'p2', instanceId: handCard(counterStep, 'p2', 'OP01-086'),
    });
    const boosted = answer(played.state, 'p2', { kind: 'cards', selected: [] });

    // `active` is printed, so it is in the selector — and the attacker was
    // rested by declaring. The battle is safe from this card by construction.
    expect(boosted.pending?.candidates).not.toContain(attacker);
    expect(boosted.pending?.candidates).toEqual([mocha]);
    const done = answer(boosted, 'p2', { kind: 'cards', selected: [mocha] });
    expect(done.battle).not.toBeNull();
    expect(done.players.p2.hand).toContain(mocha);
    assertSettled(applyOk(done, { type: 'PASS', player: 'p2' }).state);
  });
});

describe('OP01-089 Crescent Cutlass — the [Counter] that bounces the attacker', () => {
  it('ends the battle at CR 7-1-1-4 by moving the attacker to hand', () => {
    // "Moved areas", not "K.O.d" — the rule the vanished-participant fix reads.
    // This is the first printed card in the repo to end a battle by a bounce.
    const start = op01BpScenario({
      p1: { activeDon: 3, characters: [{ cardId: 'OP01-065' }] }, // Vergo, cost 5
      p2: { activeDon: 3, hand: ['OP01-089'] },
    });
    const attacker = characterAt(start, 'p1', 0);

    const declared = applyOk(start, {
      type: 'DECLARE_ATTACK', player: 'p1', attacker, target: start.players.p2.leader,
    }).state;
    const counterStep = applyOk(declared, { type: 'PASS', player: 'p2' }).state;
    const played = applyOk(counterStep, {
      type: 'PLAY_COUNTER_EVENT', player: 'p2', instanceId: handCard(counterStep, 'p2', 'OP01-089'),
    });
    expect(firedIds(played.events)).toEqual(['OP01-089-counter']);
    expect(played.state.pending?.candidates).toContain(attacker);

    const done = answer(played.state, 'p2', { kind: 'cards', selected: [attacker] });

    expect(done.players.p1.characters).toEqual([]);
    expect(done.players.p1.hand).toContain(attacker);
    expect(done.players.p1.trash).not.toContain(attacker);
    expect(done.battle).toBeNull();
    expect(done.log.some((event) => event.type === 'battleEndedEarly')).toBe(true);
    expect(done.log.some((event) => event.type === 'battleResolved')).toBe(false);
    expect(done.players.p2.life).toHaveLength(start.players.p2.life.length);
    assertSettled(done);
  });

  it('does not fire under a Leader without {The Seven Warlords of the Sea}', () => {
    const start = op01KaidoScenario({
      p1: { activeDon: 3, characters: [{ cardId: 'OP01-103' }] },
      p2: { activeDon: 3, hand: ['OP01-089'] },
    });
    const declared = applyOk(start, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(start, 'p1', 0),
      target: start.players.p2.leader,
    }).state;
    const counterStep = applyOk(declared, { type: 'PASS', player: 'p2' }).state;
    const played = applyOk(counterStep, {
      type: 'PLAY_COUNTER_EVENT', player: 'p2', instanceId: handCard(counterStep, 'p2', 'OP01-089'),
    });
    // The Event is still paid for and trashed — the cost is the play, not the
    // ability (CR 7-1-3-2-2) — and then its condition simply fails.
    expect(firedIds(played.events)).toEqual([]);
    expect(played.state.pending).toBeNull();
    expect(played.state.battle).not.toBeNull();
    assertSettled(applyOk(played.state, { type: 'PASS', player: 'p2' }).state);
  });
});

describe("OP01-117 Sheep's Horn — [Main] pay DON!! −1 to rest", () => {
  it('rests an opponent Character with a cost of 6 or less', () => {
    const start = op01KaidoScenario({
      p1: { activeDon: 3, hand: ['OP01-117'] },
      p2: { characters: [{ cardId: 'OP01-110' }] }, // Fukurokuju, cost 6 — on the gate
    });
    const fukurokuju = characterAt(start, 'p2', 0);
    const played = playFrom(start, 'p1', 'OP01-117');
    const accepted = optIn(played.state, 'p1', true);
    const done = answer(accepted, 'p1', { kind: 'cards', selected: [fukurokuju] });
    expect(done.cards[fukurokuju]?.orientation).toBe('rested');
    assertSettled(done);
  });

  it('declining the DON!! cost resolves the card to nothing', () => {
    const start = op01KaidoScenario({
      p1: { activeDon: 3, hand: ['OP01-117'] },
      p2: { characters: [{ cardId: 'OP01-110' }] },
    });
    const fukurokuju = characterAt(start, 'p2', 0);
    const donBefore = start.players.p1.don.filter((d) => d.location.kind === 'cost').length;
    const played = playFrom(start, 'p1', 'OP01-117');
    const done = optIn(played.state, 'p1', false);
    expect(done.cards[fukurokuju]?.orientation).toBe('active');
    expect(done.players.p1.don.filter((d) => d.location.kind === 'cost')).toHaveLength(donBefore);
    assertSettled(done);
  });
});

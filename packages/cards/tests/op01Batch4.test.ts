import { describe, expect, it } from 'vitest';
import { getPower, getPowerWithoutStatics } from '@optcg/engine';
import type { GameState } from '@optcg/engine';
import {
  answer,
  applyOk,
  assertSettled,
  characterAt,
  firedIds,
  op01Scenario,
  op01ZoroScenario,
} from './support.js';

/**
 * The four cards that completed OP-01 pile A.
 *
 * Two power `static`s, one `[On K.O.]` and one `[On Block]` — shapes batches 1
 * to 3 already covered, which is why these were the ones cut for size. Two of
 * them are new in a narrower way, and each has its own block below:
 *
 * - **`OP01-001` is the first `static` with a selector audience.** Every static
 *   written before it names only its own source.
 * - **`OP01-007` can end a battle two cards deep.** Red Hawk K.O.s it while it
 *   is attacking, its own `[On K.O.]` resolves from the trash mid-battle, and
 *   only then does the battle end at CR 7-1-1-4 for want of an attacker.
 */

// ---------------------------------------------------------------------------
// OP01-001 — the first static that buffs somebody else
// ---------------------------------------------------------------------------

describe('OP01-001 Roronoa Zoro (Leader) — all of your Characters gain +1000', () => {
  /**
   * The DON!! goes on the **Leader**, which is what carries the ability, and
   * `CharacterSpec.attachedDon` can only reach Characters — so it is attached
   * with a real `ATTACH_DON` on p1's own turn.
   */
  function withLeaderDon(attachedDon: number, firstPlayer: 'p1' | 'p2' = 'p1'): GameState {
    const state = op01ZoroScenario({
      firstPlayer,
      p1: { activeDon: 2, characters: [{ cardId: 'OP01-010' }, { cardId: 'OP01-012' }] },
      p2: { characters: [{ cardId: 'OP01-010' }] },
    });
    if (attachedDon === 0) {
      return state;
    }
    // Attaching is a turn-player action, so on a p2-first scenario the DON!!
    // has to be placed before priority moves; `buildScenario` starts on the
    // first player's Main Phase either way, so this is p1 acting only when p1
    // is the turn player.
    const owner = state.activePlayer;
    return applyOk(state, {
      type: 'ATTACH_DON',
      player: owner,
      to: state.players[owner].leader,
      count: attachedDon,
    }).state;
  }

  it('lifts every one of its own Characters, and none of the opponent', () => {
    const state = withLeaderDon(1);
    const mine = state.players.p1.characters;
    const theirs = characterAt(state, 'p2', 0);

    for (const id of mine) {
      // Read through getPower; the without-statics value is the delta's witness.
      expect(getPower(state, id) - getPowerWithoutStatics(state, id)).toBe(1000);
    }
    expect(getPower(state, theirs)).toBe(getPowerWithoutStatics(state, theirs));
  });

  it('does not lift the Leader that carries it', () => {
    // "All of your Characters" — the Leader is not a Character, so the selector
    // is `category: ['character']` and the ability never touches its own source.
    const state = withLeaderDon(1);
    const leader = state.players.p1.leader;
    expect(getPower(state, leader)).toBe(getPowerWithoutStatics(state, leader));
  });

  it('is dormant with no DON!! attached', () => {
    const state = withLeaderDon(0);
    for (const id of state.players.p1.characters) {
      expect(getPower(state, id)).toBe(getPowerWithoutStatics(state, id));
    }
  });

  it('is dormant on the opponent turn', () => {
    // `[Your Turn]` is printed, so the condition is `and(donAttached, isYourTurn)`.
    const state = withLeaderDon(1, 'p2');
    for (const id of state.players.p1.characters) {
      expect(getPower(state, id)).toBe(getPowerWithoutStatics(state, id));
    }
  });

  it('does not touch the declared power-condition divergence', () => {
    // The last of OP-01 pile A's five statics, and the check is now closed for
    // the whole pile: none of them asks about its own power, so the OP06-002
    // recursion guard is never the thing answering.
    const state = withLeaderDon(1);
    expect(getPower(state, characterAt(state, 'p1', 0))).toBe(4000); // 3000 + 1000
  });
});

// ---------------------------------------------------------------------------
// OP01-032 — a static gated on the opponent's board
// ---------------------------------------------------------------------------

describe('OP01-032 Ashura Doji — +2000 against a rested board', () => {
  function board(restedOpponents: number, attachedDon: number): GameState {
    return op01Scenario({
      p1: { activeDon: 2, characters: [{ cardId: 'OP01-032', attachedDon }] },
      p2: {
        characters: Array.from({ length: restedOpponents }, () => ({
          cardId: 'OP01-010' as const,
          orientation: 'rested' as const,
        })),
      },
    });
  }

  it('fires at two rested opponents and not at one', () => {
    const two = board(2, 1);
    expect(getPower(two, characterAt(two, 'p1', 0))).toBe(4000 + 1000 + 2000);

    const one = board(1, 1);
    // 4000 printed + 1000 from the attached DON!!, and no static.
    expect(getPower(one, characterAt(one, 'p1', 0))).toBe(5000);
  });

  it('needs the DON!! as well', () => {
    const state = board(2, 0);
    expect(getPower(state, characterAt(state, 'p1', 0))).toBe(4000);
  });

  it('is live on both turns, because no [Your Turn] is printed', () => {
    const theirs = op01Scenario({
      firstPlayer: 'p2',
      p1: { activeDon: 2, characters: [{ cardId: 'OP01-032', attachedDon: 1 }] },
      p2: {
        characters: [
          { cardId: 'OP01-010', orientation: 'rested' },
          { cardId: 'OP01-012', orientation: 'rested' },
        ],
      },
    });
    // Contrast OP01-001 above, which prints [Your Turn] and is dormant here.
    expect(getPower(theirs, characterAt(theirs, 'p1', 0))).toBe(7000);
  });
});

// ---------------------------------------------------------------------------
// OP01-039 — [On Block] draw
// ---------------------------------------------------------------------------

describe('OP01-039 Killer — [On Block] draw with three or more Characters', () => {
  function blockWith(ownCharacters: number): { state: GameState; before: number } {
    const extras = Array.from({ length: ownCharacters - 1 }, () => ({
      cardId: 'OP01-012' as const,
    }));
    const start = op01Scenario({
      p1: { activeDon: 3, characters: [{ cardId: 'OP01-010' }] },
      p2: {
        activeDon: 3,
        characters: [{ cardId: 'OP01-039', attachedDon: 1 }, ...extras],
      },
    });
    const killer = characterAt(start, 'p2', 0);
    const declared = applyOk(start, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(start, 'p1', 0),
      target: start.players.p2.leader,
    }).state;
    return {
      state: applyOk(declared, { type: 'DECLARE_BLOCK', player: 'p2', blocker: killer }).state,
      before: declared.players.p2.hand.length,
    };
  }

  it('counts itself, so two others are enough', () => {
    // The Raizo shape: blocking does not remove Killer from the field, so it is
    // one of the three. Reading the card alone suggests three *besides* it.
    const { state, before } = blockWith(3);
    expect(firedIds(state.log)).toContain('OP01-039-onBlock');
    expect(state.players.p2.hand).toHaveLength(before + 1);
    assertSettled(applyOk(state, { type: 'PASS', player: 'p2' }).state);
  });

  it('does not fire with only two Characters', () => {
    const { state, before } = blockWith(2);
    expect(firedIds(state.log)).not.toContain('OP01-039-onBlock');
    expect(state.players.p2.hand).toHaveLength(before);
  });

  it('does not fire without a DON!! attached', () => {
    const start = op01Scenario({
      p1: { activeDon: 3, characters: [{ cardId: 'OP01-010' }] },
      p2: {
        activeDon: 3,
        characters: [{ cardId: 'OP01-039' }, { cardId: 'OP01-012' }, { cardId: 'OP01-053' }],
      },
    });
    const killer = characterAt(start, 'p2', 0);
    const declared = applyOk(start, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(start, 'p1', 0),
      target: start.players.p2.leader,
    }).state;
    const before = declared.players.p2.hand.length;
    const blocked = applyOk(declared, {
      type: 'DECLARE_BLOCK',
      player: 'p2',
      blocker: killer,
    }).state;
    expect(firedIds(blocked.log)).not.toContain('OP01-039-onBlock');
    expect(blocked.players.p2.hand).toHaveLength(before);
  });

  it('never ends the battle it is blocking in', () => {
    // Unlike OP01-007 below, this one only draws — it touches no card on the
    // field, so the vanished-participant route can never open from it.
    const { state } = blockWith(3);
    expect(state.battle).not.toBeNull();
    expect(state.log.some((event) => event.type === 'battleEndedEarly')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OP01-007 — [On K.O.], including the chain that ends a battle
// ---------------------------------------------------------------------------

describe('OP01-007 Caribou — [On K.O.] K.O. up to 1 with 4000 power or less', () => {
  it('takes something with it when it loses a battle', () => {
    const start = op01Scenario({
      p1: { activeDon: 3, characters: [{ cardId: 'OP01-053' }, { cardId: 'OP01-010' }] },
      p2: { characters: [{ cardId: 'OP01-007', orientation: 'rested' }] },
    });
    const attacker = characterAt(start, 'p1', 0); // Wire, 4000
    const bystander = characterAt(start, 'p1', 1); // Komachiyo, 3000
    const caribou = characterAt(start, 'p2', 0); // 4000, dies to the tie

    const declared = applyOk(start, {
      type: 'DECLARE_ATTACK', player: 'p1', attacker, target: caribou,
    }).state;
    const blockStep = applyOk(declared, { type: 'PASS', player: 'p2' }).state;
    const damaged = applyOk(blockStep, { type: 'PASS', player: 'p2' }).state;

    expect(firedIds(damaged.log)).toContain('OP01-007-onKO');
    // Both p1 Characters are inside the 4000 gate, and the battle is already
    // closed — `resolveBattle` closes before applying its outcome.
    expect(damaged.battle).toBeNull();
    expect(damaged.pending?.candidates).toEqual([attacker, bystander]);

    const done = answer(damaged, 'p2', { kind: 'cards', selected: [attacker] });
    expect(done.players.p1.characters).toEqual([bystander]);
    expect(done.log.some((event) => event.type === 'battleEndedEarly')).toBe(false);
    assertSettled(done);
  });

  it('fires from inside a live battle, and ends it — two printed cards deep', () => {
    // Caribou attacks. The defender answers with `OP01-026` Red Hawk, whose
    // [Counter] K.O.s an opponent Character with 4000 power or less — and
    // Caribou is exactly 4000, so the attacker itself is a legal choice.
    //
    // Then Caribou's own [On K.O.] resolves *from the trash, mid-battle*, and
    // names one of the defender's Characters. Only after all of that does the
    // engine notice the battle has lost its attacker and route to End of the
    // Battle (CR 7-1-1-4). The order is the point: the [On K.O.] is not
    // cancelled by the battle ending, and the battle does not end early enough
    // to cancel it.
    const start = op01Scenario({
      p1: { activeDon: 3, characters: [{ cardId: 'OP01-007' }] }, // Caribou, 4000
      p2: { activeDon: 3, hand: ['OP01-026'], characters: [{ cardId: 'OP01-010' }] },
    });
    const caribou = characterAt(start, 'p1', 0);
    const theirBody = characterAt(start, 'p2', 0); // Komachiyo, 3000

    const declared = applyOk(start, {
      type: 'DECLARE_ATTACK', player: 'p1', attacker: caribou, target: start.players.p2.leader,
    }).state;
    const counterStep = applyOk(declared, { type: 'PASS', player: 'p2' }).state;
    const redHawk = counterStep.players.p2.hand.find(
      (id) => counterStep.cards[id]?.cardId === 'OP01-026',
    );
    if (redHawk === undefined) {
      throw new Error('expected Red Hawk in hand');
    }
    const played = applyOk(counterStep, {
      type: 'PLAY_COUNTER_EVENT', player: 'p2', instanceId: redHawk,
    }).state;

    // Red Hawk's boost half first, taken empty.
    const boosted = answer(played, 'p2', { kind: 'cards', selected: [] });
    // Then its K.O. half, which names the attacker.
    const koed = answer(boosted, 'p2', { kind: 'cards', selected: [caribou] });

    // Caribou's own [On K.O.] is now asking, and it belongs to p1.
    expect(firedIds(koed.log)).toContain('OP01-007-onKO');
    expect(koed.pending?.player).toBe('p1');
    expect(koed.pending?.candidates).toEqual([theirBody]);

    const done = answer(koed, 'p1', { kind: 'cards', selected: [theirBody] });

    expect(done.players.p1.characters).toEqual([]);
    expect(done.players.p2.characters).toEqual([]);
    // The battle lost its attacker and ended without damage.
    expect(done.battle).toBeNull();
    expect(done.log.some((event) => event.type === 'battleEndedEarly')).toBe(true);
    expect(done.log.some((event) => event.type === 'battleResolved')).toBe(false);
    expect(done.players.p2.life).toHaveLength(start.players.p2.life.length);
    assertSettled(done);
  });

  it('resolves to nothing when the opponent has no Character in the gate', () => {
    const start = op01Scenario({
      p1: { activeDon: 3, characters: [{ cardId: 'OP01-054' }] }, // X.Drake, 6000, [On Play] only
      p2: { characters: [{ cardId: 'OP01-007', orientation: 'rested' }] },
    });
    const attacker = characterAt(start, 'p1', 0);
    const declared = applyOk(start, {
      type: 'DECLARE_ATTACK', player: 'p1', attacker, target: characterAt(start, 'p2', 0),
    }).state;
    const blockStep = applyOk(declared, { type: 'PASS', player: 'p2' }).state;
    const done = applyOk(blockStep, { type: 'PASS', player: 'p2' }).state;

    // It fired — the trigger does not depend on finding targets — and then
    // resolved without ever asking. The `min: 0` contract.
    expect(firedIds(done.log)).toContain('OP01-007-onKO');
    expect(done.pending).toBeNull();
    expect(done.players.p1.characters).toEqual([attacker]);
    assertSettled(done);
  });

  it('accepts an empty selection', () => {
    const start = op01Scenario({
      p1: { activeDon: 3, characters: [{ cardId: 'OP01-053' }] },
      p2: { characters: [{ cardId: 'OP01-007', orientation: 'rested' }] },
    });
    const attacker = characterAt(start, 'p1', 0);
    const declared = applyOk(start, {
      type: 'DECLARE_ATTACK', player: 'p1', attacker, target: characterAt(start, 'p2', 0),
    }).state;
    const blockStep = applyOk(declared, { type: 'PASS', player: 'p2' }).state;
    const damaged = applyOk(blockStep, { type: 'PASS', player: 'p2' }).state;

    expect(damaged.pending?.min).toBe(0);
    const done = answer(damaged, 'p2', { kind: 'cards', selected: [] });
    expect(done.players.p1.characters).toEqual([attacker]);
    assertSettled(done);
  });
});

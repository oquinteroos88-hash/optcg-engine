import { describe, expect, it } from 'vitest';
import { assertInvariants, canActivateBlocker, canAttack, legalActions } from '@optcg/engine';
import type { Action, GameState, InstanceId, PlayerId } from '@optcg/engine';
import {
  answer,
  applyOk,
  assertSettled,
  characterAt,
  handCard,
  op01KaidoScenario,
  op01Scenario,
  optIn,
  starterScenario,
} from './support.js';

/**
 * Batch 8 — modifiable legality, on the printed cards.
 *
 * Four of the mechanism's five shapes have a card behind them, and all four are
 * here: the unconditional `[Blocker]` ban, the ban predicated on the candidate's
 * power, the ban tied to a card you chose that outlives its own battle, and the
 * permission that widens the attack target set. The fifth — K.O. immunity in
 * battle — has no printed card in reach and is pinned by `ABIL-026` in
 * `packages/engine/tests/legality.test.ts`, with the reason written next to it.
 *
 * The starter cards are staged from the real ST-01/ST-02 decks and the OP-01
 * ones from the fixture decks, as every batch before this has done.
 */

function blockOffers(state: GameState, player: PlayerId): InstanceId[] {
  return legalActions(state, player)
    .filter((a): a is Extract<Action, { type: 'DECLARE_BLOCK' }> => a.type === 'DECLARE_BLOCK')
    .map((a) => a.blocker);
}

function attackTargets(state: GameState, player: PlayerId, attacker: InstanceId): InstanceId[] {
  return legalActions(state, player)
    .filter(
      (a): a is Extract<Action, { type: 'DECLARE_ATTACK' }> =>
        a.type === 'DECLARE_ATTACK' && a.attacker === attacker,
    )
    .map((a) => a.target);
}

// ---------------------------------------------------------------------------
// Form 1 — the unconditional ban
// ---------------------------------------------------------------------------

describe('ST01-012 Monkey.D.Luffy — [DON!! x2] [When Attacking] no [Blocker] this battle', () => {
  /**
   * p1 attacks with Luffy carrying two DON!!; p2 holds `ST01-006`, whose whole
   * printed text is the `[Blocker]` reminder.
   */
  function staged(don: number): GameState {
    return starterScenario({
      p1: { characters: [{ cardId: 'ST01-012', attachedDon: don }], activeDon: 4 },
      p2: { characters: [{ cardId: 'ST02-004' }], activeDon: 4 },
    });
  }

  it('withholds the block offer for the whole battle', () => {
    const state = staged(2);
    const attacker = characterAt(state, 'p1', 0);
    const blocker = characterAt(state, 'p2', 0);

    const battle = applyOk(state, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker,
      target: state.players.p2.leader,
    }).state;

    expect(battle.legality).toHaveLength(1);
    expect(battle.legality[0]?.duration).toBe('endOfBattle');
    expect(canActivateBlocker(battle, blocker)).toBe(false);
    expect(blockOffers(battle, 'p2')).toEqual([]);
    // The Block Step still exists; only the one move is gone.
    expect(legalActions(battle, 'p2').map((a) => a.type)).toContain('PASS');
    assertInvariants(battle);
  });

  it('does nothing at all without the two DON!!, which is the printed gate', () => {
    const state = staged(1);
    const attacker = characterAt(state, 'p1', 0);
    const blocker = characterAt(state, 'p2', 0);
    const battle = applyOk(state, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker,
      target: state.players.p2.leader,
    }).state;

    expect(battle.legality).toEqual([]);
    expect(blockOffers(battle, 'p2')).toEqual([blocker]);
  });

  it('lets the ban die with the battle, not with the turn', () => {
    const state = staged(2);
    const attacker = characterAt(state, 'p1', 0);
    let next = applyOk(state, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker,
      target: state.players.p2.leader,
    }).state;
    next = applyOk(next, { type: 'PASS', player: 'p2' }).state;
    next = applyOk(next, { type: 'PASS', player: 'p2' }).state;

    // CR 7-1-5-3 / 7-1-5-4 — "effects that last during this battle" — and the
    // ban is one of them, expiring on the same line the power modifiers do.
    expect(next.battle).toBeNull();
    expect(next.legality).toEqual([]);
    assertInvariants(next);
  });
});

// ---------------------------------------------------------------------------
// Form 2 — the predicate, read against current power
// ---------------------------------------------------------------------------

describe('ST01-002 Usopp — no [Blocker] with 5000 or more power, this battle', () => {
  /**
   * `ST02-004` Capone"Gang"Bege is a 1000-power `[Blocker]`, well under the
   * threshold, and the card the ban has to leave alone until something raises
   * it. What raises it is not part of the claim — the claim is that the
   * predicate reads the power the card has **now** (CR 2-6-3, the PR #9
   * semantics), whether that came from a Counter, an attached DON!!, or a
   * continuous effect on the other side of the board.
   */
  function staged(): GameState {
    return starterScenario({
      p1: { characters: [{ cardId: 'ST01-002', attachedDon: 2 }], activeDon: 4 },
      p2: { characters: [{ cardId: 'ST02-004' }], activeDon: 4 },
    });
  }

  it('leaves a Blocker under the threshold free to block', () => {
    const state = staged();
    const attacker = characterAt(state, 'p1', 0);
    const blocker = characterAt(state, 'p2', 0);
    const battle = applyOk(state, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker,
      target: state.players.p2.leader,
    }).state;

    expect(battle.legality).toHaveLength(1);
    expect(blockOffers(battle, 'p2')).toEqual([blocker]);
  });

  it('catches the same Blocker once something else has pushed it to 5000', () => {
    // 1000 printed. The rule is written when Usopp declares and read when the
    // block is attempted, and between those two moments the Blocker's power can
    // move — so what the ban sees is the value at the attempt, not at the
    // writing.
    const state = staged();
    const attacker = characterAt(state, 'p1', 0);
    const blocker = characterAt(state, 'p2', 0);
    const battle = applyOk(state, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker,
      target: state.players.p2.leader,
    }).state;

    const pushed = JSON.parse(JSON.stringify(battle)) as GameState;
    pushed.modifiers.push({
      id: 'mod-test',
      target: blocker,
      kind: 'power',
      value: 4000,
      duration: 'endOfBattle',
      source: blocker,
    });

    // 1000 + 4000 = 5000, which is "5000 or more".
    expect(canActivateBlocker(pushed, blocker)).toBe(false);
    expect(blockOffers(pushed, 'p2')).toEqual([]);

    // One thousand less, and it blocks: the boundary is the printed one.
    const under = JSON.parse(JSON.stringify(battle)) as GameState;
    under.modifiers.push({
      id: 'mod-test',
      target: blocker,
      kind: 'power',
      value: 3000,
      duration: 'endOfBattle',
      source: blocker,
    });
    expect(blockOffers(under, 'p2')).toEqual([blocker]);
  });

  it('plays itself out of the life area with the [Trigger] half', () => {
    // The other printed half, and the one that had been waiting on batch 6
    // since. Reached the only way a `[Trigger]` can be: real damage.
    const state = starterScenario({
      firstPlayer: 'p2',
      p1: { activeDon: 4, lifeCards: ['ST01-002'] },
      p2: { characters: [{ cardId: 'ST02-002' }], activeDon: 4 },
    });
    const attacker = characterAt(state, 'p2', 0);
    const life = state.players.p1.life[0];
    expect(life).toBeDefined();

    let next = applyOk(state, {
      type: 'DECLARE_ATTACK',
      player: 'p2',
      attacker,
      target: state.players.p1.leader,
    }).state;
    next = applyOk(next, { type: 'PASS', player: 'p1' }).state;
    next = applyOk(next, { type: 'PASS', player: 'p1' }).state;
    next = optIn(next, 'p1', true);

    expect(next.players.p1.characters).toContain(life as InstanceId);
    assertSettled(next);
  });
});

describe('OP01-120 Shanks — no [Blocker] with 2000 or less power, this battle', () => {
  it('reads the inequality the other way round', () => {
    // The mirror of ST01-002 and the reason the predicate is data rather than a
    // pair of hard-coded comparisons: one field flips, nothing else does.
    const state = op01Scenario({
      p1: { characters: [{ cardId: 'OP01-120' }], activeDon: 10 },
      // OP01-100 Kurozumi Higurashi is a 2000-power [Blocker] and nothing else.
      p2: { characters: [{ cardId: 'OP01-014' }], activeDon: 10 },
    });
    const attacker = characterAt(state, 'p1', 0);
    const blocker = characterAt(state, 'p2', 0);
    const battle = applyOk(state, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker,
      target: state.players.p2.leader,
    }).state;

    // Jinbe is a 5000-power [Blocker]: over the line, so untouched.
    expect(battle.legality).toHaveLength(1);
    expect(blockOffers(battle, 'p2')).toEqual([blocker]);

    // Dropped to 2000 by something else, the same Blocker falls under the ban.
    const pushed = JSON.parse(JSON.stringify(battle)) as GameState;
    pushed.modifiers.push({
      id: 'mod-test',
      target: blocker,
      kind: 'power',
      value: -3000,
      duration: 'endOfBattle',
      source: attacker,
    });
    expect(blockOffers(pushed, 'p2')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Form 3 — the rule that lives in the state and waits for a card
// ---------------------------------------------------------------------------

describe('ST01-016 Diable Jambe — no [Blocker] if the card you chose attacks', () => {
  /**
   * p1 fields two attackers, one of them {Straw Hat Crew}; p2 fields a Blocker.
   * The Event is played, names the {Straw Hat Crew} card, and the rule then has
   * to sit inert through the *other* card's attack.
   */
  function staged(): GameState {
    return starterScenario({
      p1: {
        // ST01-013 Roronoa Zoro is {Straw Hat Crew}; ST01-003 Karoo is not.
        characters: [{ cardId: 'ST01-013' }, { cardId: 'ST01-003' }],
        hand: ['ST01-016'],
        activeDon: 6,
        clearHand: true,
      },
      p2: { characters: [{ cardId: 'ST02-004' }], activeDon: 6 },
    });
  }

  function playEventNaming(state: GameState, chosen: InstanceId): GameState {
    const event = handCard(state, 'p1', 'ST01-016');
    const asking = applyOk(state, { type: 'PLAY_CARD', player: 'p1', instanceId: event }).state;
    expect(asking.pending).not.toBeNull();
    return answer(asking, 'p1', { kind: 'cards', selected: [chosen] });
  }

  it('sits inert while a different card attacks, and bites when the chosen one does', () => {
    const state = staged();
    const chosen = characterAt(state, 'p1', 0);
    const other = characterAt(state, 'p1', 1);
    const blocker = characterAt(state, 'p2', 0);

    const armed = playEventNaming(state, chosen);
    expect(armed.legality).toHaveLength(1);
    expect(armed.legality[0]?.duration).toBe('endOfTurn');
    expect(armed.legality[0]?.whileAttacker).toBe(chosen);
    // Nothing is attacking yet, so the rule decides nothing.
    expect(canActivateBlocker(armed, blocker)).toBe(true);

    // Karoo attacks: the Blocker is free, because the rule names the other card.
    let next = applyOk(armed, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: other,
      target: armed.players.p2.leader,
    }).state;
    expect(blockOffers(next, 'p2')).toEqual([blocker]);
    next = applyOk(next, { type: 'PASS', player: 'p2' }).state;
    next = applyOk(next, { type: 'PASS', player: 'p2' }).state;
    // And the rule is still there: it is not a battle's property.
    expect(next.legality).toHaveLength(1);

    // Zoro attacks: now it bites.
    next = applyOk(next, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: chosen,
      target: next.players.p2.leader,
    }).state;
    expect(canActivateBlocker(next, blocker)).toBe(false);
    expect(blockOffers(next, 'p2')).toEqual([]);
    assertInvariants(next);
  });

  it('expires with the turn even if the chosen card never attacked', () => {
    const state = staged();
    const chosen = characterAt(state, 'p1', 0);
    const armed = playEventNaming(state, chosen);
    expect(armed.legality).toHaveLength(1);

    const ended = applyOk(armed, { type: 'END_TURN', player: 'p1' }).state;
    expect(ended.legality).toEqual([]);
    assertInvariants(ended);
  });

  it('writes nothing when the "up to 1" is answered with nothing', () => {
    const state = staged();
    const event = handCard(state, 'p1', 'ST01-016');
    const asking = applyOk(state, { type: 'PLAY_CARD', player: 'p1', instanceId: event }).state;
    const answered = answer(asking, 'p1', { kind: 'cards', selected: [] });
    expect(answered.legality).toEqual([]);
    assertInvariants(answered);
  });

  it("offers only [Blocker] Characters to its [Trigger], through the predicate's keyword field", () => {
    // The half that needed a printed-keyword filter and got one field on
    // `CardPredicate` rather than a mechanism. Reached the only way a
    // `[Trigger]` can be: real damage turning a real life card over.
    //
    // `ST02-004` is a printed `[Blocker]` costing 1 and is the one candidate.
    // `ST02-002` Vito costs 3 and is not a Blocker — inside the cost gate and
    // outside the keyword one, which is the control that matters. `ST02-014`
    // costs 4 and fails both.
    const state = starterScenario({
      firstPlayer: 'p2',
      p1: { activeDon: 6, lifeCards: ['ST01-016'] },
      p2: {
        characters: [
          { cardId: 'ST02-004' },
          { cardId: 'ST02-002' },
          { cardId: 'ST02-014' },
        ],
        activeDon: 6,
      },
    });
    const blocker = characterAt(state, 'p2', 0);
    const attacker = characterAt(state, 'p2', 1);

    let next = applyOk(state, {
      type: 'DECLARE_ATTACK',
      player: 'p2',
      attacker,
      target: state.players.p1.leader,
    }).state;
    next = applyOk(next, { type: 'PASS', player: 'p1' }).state;
    next = applyOk(next, { type: 'PASS', player: 'p1' }).state;

    // The life card is in hand and its [Trigger] is offered as an opt-in.
    next = optIn(next, 'p1', true);
    expect(next.pending).not.toBeNull();
    expect(next.pending?.candidates).toEqual([blocker]);

    next = answer(next, 'p1', { kind: 'cards', selected: [blocker] });
    expect(next.players.p2.trash).toContain(blocker);
    assertSettled(next);
  });
});

// ---------------------------------------------------------------------------
// Form 5 — the permission
// ---------------------------------------------------------------------------

describe('OP01-021 Franky — [DON!! x1] may also attack active Characters', () => {
  function staged(don: number): GameState {
    return op01Scenario({
      p1: { characters: [{ cardId: 'OP01-021', attachedDon: don }], activeDon: 10 },
      p2: {
        // One active, one rested: the rested one is legal by the base rule and
        // must stay legal, which is what makes this a widening and not a swap.
        characters: [{ cardId: 'OP01-010' }, { cardId: 'OP01-012', orientation: 'rested' }],
        activeDon: 10,
      },
    });
  }

  it('offers the attack on an active Character, and only with the DON!! attached', () => {
    const withDon = staged(1);
    const franky = characterAt(withDon, 'p1', 0);
    const active = characterAt(withDon, 'p2', 0);
    const rested = characterAt(withDon, 'p2', 1);
    const leader = withDon.players.p2.leader;

    expect(canAttack(withDon, franky, active)).toBe(true);
    expect(attackTargets(withDon, 'p1', franky).sort()).toEqual([active, rested, leader].sort());

    const withoutDon = staged(0);
    const bare = characterAt(withoutDon, 'p1', 0);
    const stillActive = characterAt(withoutDon, 'p2', 0);
    expect(canAttack(withoutDon, bare, stillActive)).toBe(false);
    expect(attackTargets(withoutDon, 'p1', bare)).not.toContain(stillActive);
  });

  it('widens one card\'s target set and nobody else\'s', () => {
    // The permission comes from `affects: { self: true }`, so a second attacker
    // standing beside Franky gains nothing. This is the property that made the
    // target list per-attacker instead of built once.
    const state = op01Scenario({
      p1: {
        characters: [{ cardId: 'OP01-021', attachedDon: 1 }, { cardId: 'OP01-010' }],
        activeDon: 10,
      },
      p2: { characters: [{ cardId: 'OP01-012' }], activeDon: 10 },
    });
    const franky = characterAt(state, 'p1', 0);
    const other = characterAt(state, 'p1', 1);
    const active = characterAt(state, 'p2', 0);

    expect(attackTargets(state, 'p1', franky)).toContain(active);
    expect(attackTargets(state, 'p1', other)).not.toContain(active);
  });

  it('changes nothing else about the battle it opens', () => {
    // CR 7-1 has one outcome for a Character that loses the Damage Step
    // (7-1-4-1-2, K.O.) and nothing anywhere that rests the card being attacked.
    // So an attack on an active Character is an ordinary battle in every respect
    // except which cards could be named.
    const state = staged(1);
    const franky = characterAt(state, 'p1', 0);
    const active = characterAt(state, 'p2', 0);

    let next = applyOk(state, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: franky,
      target: active,
    }).state;
    // The target is still active — being attacked did not turn it.
    expect(next.cards[active]?.orientation).toBe('active');
    // And the Block Step happened as usual.
    expect(next.battle?.step).toBe('block');
    next = applyOk(next, { type: 'PASS', player: 'p2' }).state;
    next = applyOk(next, { type: 'PASS', player: 'p2' }).state;

    // 4000 against 3000: the Character is K.O.'d like any other loser.
    expect(next.players.p2.trash).toContain(active);
    expect(next.battle).toBeNull();
    assertInvariants(next);
  });
});

describe('OP01-112 Page One — the same permission, bought for a turn', () => {
  it('writes the rule its static twin is read from, and lets it expire', () => {
    const state = op01KaidoScenario({
      p1: { characters: [{ cardId: 'OP01-112' }], activeDon: 4 },
      p2: { characters: [{ cardId: 'OP01-076' }], activeDon: 4 },
    });
    const pageOne = characterAt(state, 'p1', 0);
    const active = characterAt(state, 'p2', 0);

    expect(canAttack(state, pageOne, active)).toBe(false);

    const bought = applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: pageOne,
      abilityId: 'OP01-112-main',
    }).state;

    // `DON!! −1` really was paid, and the rule really was written.
    expect(bought.players.p1.don.filter((d) => d.location.kind === 'donDeck').length).toBe(7);
    expect(bought.legality).toHaveLength(1);
    expect(bought.legality[0]?.effect).toBe('allow');
    expect(bought.legality[0]?.subject).toEqual({ is: pageOne });
    expect(canAttack(bought, pageOne, active)).toBe(true);
    expect(attackTargets(bought, 'p1', pageOne)).toContain(active);

    const ended = applyOk(bought, { type: 'END_TURN', player: 'p1' }).state;
    expect(ended.legality).toEqual([]);
    assertInvariants(ended);
  });
});

import { describe, expect, it } from 'vitest';
import { getPower, legalActions } from '@optcg/engine';
import type { GameState, InstanceId } from '@optcg/engine';
import {
  answer,
  applyOk,
  assertSettled,
  characterAt,
  firedIds,
  handCard,
  op01Scenario,
} from './support.js';

/**
 * One case per OP-01 batch-1 ability: a position built directly, a fixed action
 * sequence, and the exact values the ability is responsible for. Fixed seed, no
 * mocks — the same shape as `abilities.test.ts` and the engine's ABIL table.
 *
 * Every case ends at `assertSettled`, which is where a half-resolved script
 * shows up: without it a test can pass on a value the interpreter happened to
 * write before it stalled.
 *
 * All nine print "up to", so each one also has to survive resolving to nothing.
 * The three cases that matters in are collected in the last describe block
 * rather than repeated nine times: **selects**, **selects nothing**, and **has
 * nothing to select from** — the third being the one where the interpreter
 * never suspends at all.
 */

/** Plays `cardId` from p1's hand, leaving whatever choice it opened. */
function playFromHand(state: GameState, cardId: string): { state: GameState; fired: string[] } {
  const instanceId = handCard(state, 'p1', cardId);
  const result = applyOk(state, { type: 'PLAY_CARD', player: 'p1', instanceId });
  return { state: result.state, fired: firedIds(result.events) };
}

/** Declares an attack from p1's character at index `at` against p2's Leader. */
function attackLeader(state: GameState, at: number): { state: GameState; fired: string[] } {
  const attacker = characterAt(state, 'p1', at);
  const result = applyOk(state, {
    type: 'DECLARE_ATTACK',
    player: 'p1',
    attacker,
    target: state.players.p2.leader,
  });
  return { state: result.state, fired: firedIds(result.events) };
}

// ---------------------------------------------------------------------------
// [On Play]
// ---------------------------------------------------------------------------

describe("OP01-006 Otama — [On Play] give up to 1 opponent Character −2000", () => {
  it('subtracts exactly 2000 for the turn, and nothing else moves', () => {
    const start = op01Scenario({
      p1: { activeDon: 2, hand: ['OP01-006'] },
      p2: { characters: [{ cardId: 'OP01-010' }, { cardId: 'OP01-053' }] },
    });
    const komachiyo = characterAt(start, 'p2', 0);
    const wire = characterAt(start, 'p2', 1);
    expect(getPower(start, komachiyo)).toBe(3000);
    expect(getPower(start, wire)).toBe(4000);

    const played = playFromHand(start, 'OP01-006');
    expect(played.fired).toEqual(['OP01-006-onPlay']);
    const done = answer(played.state, 'p1', { kind: 'cards', selected: [komachiyo] });

    expect(getPower(done, komachiyo)).toBe(1000);
    // The one not chosen is untouched — the modifier is per-target, not a sweep.
    expect(getPower(done, wire)).toBe(4000);
    assertSettled(done);
  });

  it('is a modifier that expires at end of turn, not a permanent change', () => {
    const start = op01Scenario({
      p1: { activeDon: 2, hand: ['OP01-006'] },
      p2: { characters: [{ cardId: 'OP01-010' }] },
    });
    const komachiyo = characterAt(start, 'p2', 0);
    const played = playFromHand(start, 'OP01-006');
    const done = answer(played.state, 'p1', { kind: 'cards', selected: [komachiyo] });
    expect(getPower(done, komachiyo)).toBe(1000);

    const nextTurn = applyOk(done, { type: 'END_TURN', player: 'p1' }).state;
    expect(getPower(nextTurn, komachiyo)).toBe(3000);
  });

  it('can take a Character below zero, because nothing prints a floor', () => {
    // 3000 − 2000 − 2000 with two copies. The rules make power higher or lower
    // than printed (CR 2-6-3) and name no minimum; a clamp here would be an
    // invention, and it would change which Characters survive a battle.
    const start = op01Scenario({
      p1: { activeDon: 4, hand: ['OP01-006', 'OP01-006'] },
      p2: { characters: [{ cardId: 'OP01-010' }] },
    });
    const komachiyo = characterAt(start, 'p2', 0);
    const first = playFromHand(start, 'OP01-006');
    const afterFirst = answer(first.state, 'p1', { kind: 'cards', selected: [komachiyo] });
    const second = playFromHand(afterFirst, 'OP01-006');
    const done = answer(second.state, 'p1', { kind: 'cards', selected: [komachiyo] });

    expect(getPower(done, komachiyo)).toBe(-1000);
    assertSettled(done);
  });
});

describe('OP01-033 Izo — [On Play] rest up to 1 opponent Character, cost 4 or less', () => {
  it('rests the chosen Character and offers only those within the cost gate', () => {
    const start = op01Scenario({
      p1: { activeDon: 4, hand: ['OP01-033'] },
      // Wire costs 2, X.Drake costs 5. Only Wire is inside the gate.
      p2: { characters: [{ cardId: 'OP01-053' }, { cardId: 'OP01-054' }] },
    });
    const wire = characterAt(start, 'p2', 0);
    const drake = characterAt(start, 'p2', 1);

    const played = playFromHand(start, 'OP01-033');
    expect(played.fired).toEqual(['OP01-033-onPlay']);
    expect(played.state.pending?.candidates).toEqual([wire]);

    const done = answer(played.state, 'p1', { kind: 'cards', selected: [wire] });
    expect(done.cards[wire]?.orientation).toBe('rested');
    expect(done.cards[drake]?.orientation).toBe('active');
    assertSettled(done);
  });

  it('offers an already-rested Character, and resting it changes nothing', () => {
    // The printed text names a cost and no orientation, so a rested Character
    // is a legal choice whose effect is nothing (CR 8-4-4-1). This is the
    // opposite of OP01-054 below, where the orientation *is* printed.
    const start = op01Scenario({
      p1: { activeDon: 4, hand: ['OP01-033'] },
      p2: { characters: [{ cardId: 'OP01-053', orientation: 'rested' }] },
    });
    const wire = characterAt(start, 'p2', 0);
    const played = playFromHand(start, 'OP01-033');
    expect(played.state.pending?.candidates).toEqual([wire]);

    const done = answer(played.state, 'p1', { kind: 'cards', selected: [wire] });
    expect(done.cards[wire]?.orientation).toBe('rested');
    assertSettled(done);
  });
});

describe('OP01-048 Nekomamushi — [On Play] rest up to 1 opponent Character, cost 3 or less', () => {
  it('gates one cost tighter than Izo, which is the only thing separating them', () => {
    const start = op01Scenario({
      p1: { activeDon: 3, hand: ['OP01-048'] },
      // Sai costs 2 and is inside; Brook costs 4 and is outside a 3-gate but
      // inside Izo's 4-gate. The pair is chosen to make the difference visible.
      p2: { characters: [{ cardId: 'OP01-012' }, { cardId: 'OP01-022' }] },
    });
    const sai = characterAt(start, 'p2', 0);

    const played = playFromHand(start, 'OP01-048');
    expect(played.fired).toEqual(['OP01-048-onPlay']);
    expect(played.state.pending?.candidates).toEqual([sai]);

    const done = answer(played.state, 'p1', { kind: 'cards', selected: [sai] });
    expect(done.cards[sai]?.orientation).toBe('rested');
    assertSettled(done);
  });
});

describe("OP01-054 X.Drake — [On Play] K.O. up to 1 rested opponent Character, cost 4 or less", () => {
  it('offers only rested Characters, and K.O.s the one chosen', () => {
    const start = op01Scenario({
      p1: { activeDon: 5, hand: ['OP01-054'] },
      p2: {
        characters: [
          { cardId: 'OP01-053', orientation: 'rested' },
          { cardId: 'OP01-012', orientation: 'active' },
        ],
      },
    });
    const restedWire = characterAt(start, 'p2', 0);
    const activeSai = characterAt(start, 'p2', 1);

    const played = playFromHand(start, 'OP01-054');
    expect(played.fired).toEqual(['OP01-054-onPlay']);
    // The active one is not a candidate at all — printed orientation belongs in
    // the selector, so a player is never offered a move the card forbids.
    expect(played.state.pending?.candidates).toEqual([restedWire]);

    const done = answer(played.state, 'p1', { kind: 'cards', selected: [restedWire] });
    expect(done.players.p2.characters).toEqual([activeSai]);
    expect(done.players.p2.trash).toContain(restedWire);
    assertSettled(done);
  });

  it('gates on cost as well, so a big rested Character survives', () => {
    const start = op01Scenario({
      p1: { activeDon: 5, hand: ['OP01-054'] },
      // Zoro costs 3 (inside the 4-gate), X.Drake costs 5 (outside it).
      p2: {
        characters: [
          { cardId: 'OP01-054', orientation: 'rested' },
          { cardId: 'OP01-025', orientation: 'rested' },
        ],
      },
    });
    const bigDrake = characterAt(start, 'p2', 0);
    const zoro = characterAt(start, 'p2', 1);

    const played = playFromHand(start, 'OP01-054');
    expect(played.state.pending?.candidates).toEqual([zoro]);

    const done = answer(played.state, 'p1', { kind: 'cards', selected: [zoro] });
    expect(done.players.p2.characters).toEqual([bigDrake]);
    assertSettled(done);
  });
});

// ---------------------------------------------------------------------------
// [When Attacking]
// ---------------------------------------------------------------------------

describe("OP01-017 Nico Robin — [DON!! x1] [When Attacking] K.O. up to 1 with 3000 power or less", () => {
  it('K.O.s a Character at exactly 3000 and leaves a 4000 alone', () => {
    const start = op01Scenario({
      p1: { activeDon: 2, characters: [{ cardId: 'OP01-017', attachedDon: 1 }] },
      p2: { characters: [{ cardId: 'OP01-010' }, { cardId: 'OP01-053' }] },
    });
    const komachiyo = characterAt(start, 'p2', 0); // 3000
    const wire = characterAt(start, 'p2', 1); // 4000

    const attacked = attackLeader(start, 0);
    expect(attacked.fired).toEqual(['OP01-017-whenAttacking']);
    expect(attacked.state.pending?.candidates).toEqual([komachiyo]);

    const done = answer(attacked.state, 'p1', { kind: 'cards', selected: [komachiyo] });
    expect(done.players.p2.characters).toEqual([wire]);
    assertSettled(done);
  });

  it('reads the power a Character has now, not the printed one', () => {
    // Komachiyo prints 3000. With one DON!! attached it is 4000 and drops out
    // of the gate — CR 2-6-3, and the reason PR #9 made the condition sites
    // read `getPower`.
    const start = op01Scenario({
      p1: { activeDon: 2, characters: [{ cardId: 'OP01-017', attachedDon: 1 }] },
      p2: { activeDon: 1, characters: [{ cardId: 'OP01-010', attachedDon: 1 }] },
    });
    const buffed = characterAt(start, 'p2', 0);
    expect(getPower(start, buffed)).toBe(4000);

    const attacked = attackLeader(start, 0);
    expect(attacked.fired).toEqual(['OP01-017-whenAttacking']);
    // Fired, but with nothing to offer: no suspend, and the Character lives.
    expect(attacked.state.pending).toBeNull();
    expect(attacked.state.players.p2.characters).toEqual([buffed]);
    assertSettled(attacked.state);
  });

  it('does not fire at all without a DON!! attached', () => {
    const start = op01Scenario({
      p1: { activeDon: 2, characters: [{ cardId: 'OP01-017' }] },
      p2: { characters: [{ cardId: 'OP01-010' }] },
    });
    const komachiyo = characterAt(start, 'p2', 0);
    const attacked = attackLeader(start, 0);
    expect(attacked.fired).toEqual([]);
    expect(attacked.state.players.p2.characters).toEqual([komachiyo]);
    assertSettled(attacked.state);
  });
});

describe("OP01-022 Brook — [DON!! x1] [When Attacking] give up to 2 Characters −2000", () => {
  it('hits both chosen Characters in one instruction', () => {
    const start = op01Scenario({
      p1: { activeDon: 2, characters: [{ cardId: 'OP01-022', attachedDon: 1 }] },
      p2: {
        characters: [
          { cardId: 'OP01-010' }, // 3000
          { cardId: 'OP01-053' }, // 4000
          { cardId: 'OP01-025' }, // 5000
        ],
      },
    });
    const komachiyo = characterAt(start, 'p2', 0);
    const wire = characterAt(start, 'p2', 1);
    const zoro = characterAt(start, 'p2', 2);

    const attacked = attackLeader(start, 0);
    expect(attacked.fired).toEqual(['OP01-022-whenAttacking']);
    expect(attacked.state.pending?.max).toBe(2);

    const done = answer(attacked.state, 'p1', { kind: 'cards', selected: [komachiyo, wire] });
    expect(getPower(done, komachiyo)).toBe(1000);
    expect(getPower(done, wire)).toBe(2000);
    expect(getPower(done, zoro)).toBe(5000);
    assertSettled(done);
  });

  it('accepts a single target, because "up to 2" means one is legal too', () => {
    const start = op01Scenario({
      p1: { activeDon: 2, characters: [{ cardId: 'OP01-022', attachedDon: 1 }] },
      p2: { characters: [{ cardId: 'OP01-010' }, { cardId: 'OP01-053' }] },
    });
    const komachiyo = characterAt(start, 'p2', 0);
    const wire = characterAt(start, 'p2', 1);

    const attacked = attackLeader(start, 0);
    const done = answer(attacked.state, 'p1', { kind: 'cards', selected: [wire] });
    expect(getPower(done, wire)).toBe(2000);
    expect(getPower(done, komachiyo)).toBe(3000);
    assertSettled(done);
  });
});

describe("OP01-035 Okiku — [DON!! x1] [When Attacking] [Once Per Turn] rest, cost 5 or less", () => {
  it('rests the chosen Character', () => {
    const start = op01Scenario({
      p1: { activeDon: 2, characters: [{ cardId: 'OP01-035', attachedDon: 1 }] },
      p2: { characters: [{ cardId: 'OP01-054' }] }, // cost 5, exactly on the gate
    });
    const drake = characterAt(start, 'p2', 0);

    const attacked = attackLeader(start, 0);
    expect(attacked.fired).toEqual(['OP01-035-whenAttacking']);
    expect(attacked.state.pending?.candidates).toEqual([drake]);

    const done = answer(attacked.state, 'p1', { kind: 'cards', selected: [drake] });
    expect(done.cards[drake]?.orientation).toBe('rested');
    assertSettled(done);
  });

  it('records the use, which is what stops a second attack firing it again', () => {
    const start = op01Scenario({
      p1: { activeDon: 2, characters: [{ cardId: 'OP01-035', attachedDon: 1 }] },
      p2: { characters: [{ cardId: 'OP01-054' }] },
    });
    const okiku = characterAt(start, 'p1', 0);
    const attacked = attackLeader(start, 0);
    const done = answer(attacked.state, 'p1', { kind: 'cards', selected: [] });

    // A Character can be set active again and attack twice in one turn, which
    // is exactly the position [Once Per Turn] is printed for.
    expect(done.cards[okiku]?.usedThisTurn).toContain('OP01-035-whenAttacking');
    assertSettled(done);
  });
});

describe('OP01-034 Inuarashi — [DON!! x2] [When Attacking] set up to 1 of your DON!! active', () => {
  it('turns one rested DON!! over, and never the ones attached to it', () => {
    const start = op01Scenario({
      // Two DON!! on Inuarashi to meet the condition, plus two rested in the
      // cost area for it to refresh. Attached DON!! are neither active nor
      // rested (CR 4-4-2), so they are not candidates.
      p1: { activeDon: 2, restedDon: 2, characters: [{ cardId: 'OP01-034', attachedDon: 2 }] },
    });
    const restedBefore = start.players.p1.don.filter(
      (don) => don.location.kind === 'cost' && don.location.orientation === 'rested',
    ).length;
    expect(restedBefore).toBe(2);

    const attacked = attackLeader(start, 0);
    expect(attacked.fired).toEqual(['OP01-034-whenAttacking']);

    const state = attacked.state;
    const cost = state.players.p1.don.filter((don) => don.location.kind === 'cost');
    const active = cost.filter(
      (don) => don.location.kind === 'cost' && don.location.orientation === 'active',
    );
    expect(cost).toHaveLength(2);
    expect(active).toHaveLength(1);
    // The two attached to Inuarashi stayed attached; nothing was refreshed out
    // of the Character.
    expect(state.cards[characterAt(state, 'p1', 0)]?.attachedDon).toHaveLength(2);
    assertSettled(state);
  });

  it('does nothing when there is no rested DON!! to turn, and says nothing either', () => {
    const start = op01Scenario({
      p1: { activeDon: 4, restedDon: 0, characters: [{ cardId: 'OP01-034', attachedDon: 2 }] },
    });
    const attacked = attackLeader(start, 0);
    // The ability fires — that is the one event — and then emits nothing,
    // because `orientDon` reports only DON!! that actually turned.
    expect(attacked.fired).toEqual(['OP01-034-whenAttacking']);
    expect(
      attacked.state.log.some((event) => event.type === 'donOrientationChanged'),
    ).toBe(false);
    assertSettled(attacked.state);
  });

  it('does not fire with only one DON!! attached', () => {
    const start = op01Scenario({
      p1: { activeDon: 1, restedDon: 2, characters: [{ cardId: 'OP01-034', attachedDon: 1 }] },
    });
    const attacked = attackLeader(start, 0);
    expect(attacked.fired).toEqual([]);
    assertSettled(attacked.state);
  });
});

describe('OP01-052 Raizo — [When Attacking] [Once Per Turn] draw with 2 or more rested Characters', () => {
  it('counts itself, because declaring the attack rests it first', () => {
    // One other rested Character is enough: the attacker is rested by the
    // declaration (CR 7-1-1-1) before its own trigger resolves (CR 8-4-1).
    // Reading the card alone suggests two Characters *besides* the attacker.
    const start = op01Scenario({
      p1: {
        activeDon: 2,
        characters: [{ cardId: 'OP01-052' }, { cardId: 'OP01-053', orientation: 'rested' }],
      },
    });
    const handBefore = start.players.p1.hand.length;

    const attacked = attackLeader(start, 0);
    expect(attacked.fired).toEqual(['OP01-052-whenAttacking']);
    expect(attacked.state.players.p1.hand).toHaveLength(handBefore + 1);
    assertSettled(attacked.state);
  });

  it('does not fire when it is the only rested Character', () => {
    const start = op01Scenario({
      p1: {
        activeDon: 2,
        characters: [{ cardId: 'OP01-052' }, { cardId: 'OP01-053', orientation: 'active' }],
      },
    });
    const handBefore = start.players.p1.hand.length;
    const attacked = attackLeader(start, 0);
    expect(attacked.fired).toEqual([]);
    expect(attacked.state.players.p1.hand).toHaveLength(handBefore);
    assertSettled(attacked.state);
  });

  it('counts only its controller\'s Characters, never the opponent\'s', () => {
    const start = op01Scenario({
      p1: { activeDon: 2, characters: [{ cardId: 'OP01-052' }] },
      p2: {
        characters: [
          { cardId: 'OP01-053', orientation: 'rested' },
          { cardId: 'OP01-012', orientation: 'rested' },
        ],
      },
    });
    const handBefore = start.players.p1.hand.length;
    const attacked = attackLeader(start, 0);
    expect(attacked.fired).toEqual([]);
    expect(attacked.state.players.p1.hand).toHaveLength(handBefore);
    assertSettled(attacked.state);
  });
});

// ---------------------------------------------------------------------------
// "Up to", in all three of its shapes
// ---------------------------------------------------------------------------

describe('every "up to" in this batch survives resolving to nothing', () => {
  /** The four [On Play] abilities, with a board they could legally hit. */
  const ON_PLAY: Array<{ cardId: string; abilityId: string; don: number; victim: string }> = [
    { cardId: 'OP01-006', abilityId: 'OP01-006-onPlay', don: 2, victim: 'OP01-010' },
    { cardId: 'OP01-033', abilityId: 'OP01-033-onPlay', don: 4, victim: 'OP01-053' },
    { cardId: 'OP01-048', abilityId: 'OP01-048-onPlay', don: 3, victim: 'OP01-012' },
    { cardId: 'OP01-054', abilityId: 'OP01-054-onPlay', don: 5, victim: 'OP01-053' },
  ];

  for (const entry of ON_PLAY) {
    describe(entry.abilityId, () => {
      function withVictim(): GameState {
        return op01Scenario({
          p1: { activeDon: entry.don, hand: [entry.cardId] },
          p2: {
            characters: [
              // Rested so X.Drake's selector has something to see; the other
              // three do not filter on orientation and are unaffected.
              { cardId: entry.victim, orientation: 'rested' },
            ],
          },
        });
      }

      it('suspends and applies when something is chosen', () => {
        const played = playFromHand(withVictim(), entry.cardId);
        expect(played.fired).toEqual([entry.abilityId]);
        const pending = played.state.pending;
        expect(pending).not.toBeNull();
        expect(pending?.min).toBe(0);
        const done = answer(played.state, 'p1', {
          kind: 'cards',
          selected: pending?.candidates.slice(0, 1) ?? [],
        });
        assertSettled(done);
      });

      it('accepts an empty selection and degrades to a no-op', () => {
        const before = withVictim();
        const played = playFromHand(before, entry.cardId);
        const done = answer(played.state, 'p1', { kind: 'cards', selected: [] });
        // The opponent's board is exactly as it was: same ids, same
        // orientations, same power.
        expect(done.players.p2.characters).toEqual(before.players.p2.characters);
        for (const id of done.players.p2.characters) {
          expect(done.cards[id]?.orientation).toBe(before.cards[id]?.orientation);
          expect(getPower(done, id)).toBe(getPower(before, id));
        }
        assertSettled(done);
      });

      it('never suspends at all when there is nothing to select', () => {
        const empty = op01Scenario({
          p1: { activeDon: entry.don, hand: [entry.cardId] },
          p2: { characters: [] },
        });
        const played = playFromHand(empty, entry.cardId);
        // It still fires — the trigger and its condition are independent of
        // whether the script finds targets — and then resolves to nothing
        // without ever asking. That pair is the whole contract of `min: 0`.
        expect(played.fired).toEqual([entry.abilityId]);
        expect(played.state.pending).toBeNull();
        assertSettled(played.state);
      });
    });
  }

  /** The three [When Attacking] abilities that open a selection. */
  const ATTACKING: Array<{ cardId: string; abilityId: string; don: number; victim: string }> = [
    { cardId: 'OP01-017', abilityId: 'OP01-017-whenAttacking', don: 1, victim: 'OP01-010' },
    { cardId: 'OP01-022', abilityId: 'OP01-022-whenAttacking', don: 1, victim: 'OP01-010' },
    { cardId: 'OP01-035', abilityId: 'OP01-035-whenAttacking', don: 1, victim: 'OP01-053' },
  ];

  for (const entry of ATTACKING) {
    describe(entry.abilityId, () => {
      function withVictim(): GameState {
        return op01Scenario({
          p1: { activeDon: 2, characters: [{ cardId: entry.cardId, attachedDon: entry.don }] },
          p2: { characters: [{ cardId: entry.victim }] },
        });
      }

      it('suspends and applies when something is chosen', () => {
        const attacked = attackLeader(withVictim(), 0);
        expect(attacked.fired).toEqual([entry.abilityId]);
        expect(attacked.state.pending?.min).toBe(0);
        const done = answer(attacked.state, 'p1', {
          kind: 'cards',
          selected: attacked.state.pending?.candidates.slice(0, 1) ?? [],
        });
        assertSettled(done);
      });

      it('accepts an empty selection and degrades to a no-op', () => {
        const before = withVictim();
        const attacked = attackLeader(before, 0);
        const done = answer(attacked.state, 'p1', { kind: 'cards', selected: [] });
        expect(done.players.p2.characters).toEqual(before.players.p2.characters);
        for (const id of done.players.p2.characters) {
          expect(done.cards[id]?.orientation).toBe(before.cards[id]?.orientation);
          expect(getPower(done, id)).toBe(getPower(before, id));
        }
        assertSettled(done);
      });

      it('never suspends at all when there is nothing to select', () => {
        const empty = op01Scenario({
          p1: { activeDon: 2, characters: [{ cardId: entry.cardId, attachedDon: entry.don }] },
          p2: { characters: [] },
        });
        const attacked = attackLeader(empty, 0);
        expect(attacked.fired).toEqual([entry.abilityId]);
        expect(attacked.state.pending).toBeNull();
        assertSettled(attacked.state);
      });
    });
  }

  it('leaves the attack itself intact when an ability resolves to nothing', () => {
    // The point of the no-op path: the battle carries on. An ability that
    // finds no target must not swallow the attack that fired it.
    const empty = op01Scenario({
      p1: { activeDon: 2, characters: [{ cardId: 'OP01-017', attachedDon: 1 }] },
      p2: { characters: [] },
    });
    const attacked = attackLeader(empty, 0);
    expect(attacked.state.battle).not.toBeNull();
    expect(attacked.state.battle?.step).toBe('block');
    // And the defender is the one holding priority, as after any declaration.
    expect(attacked.state.priority).toBe('p2');
    expect(legalActions(attacked.state, 'p2').some((a) => a.type === 'PASS')).toBe(true);
  });
});

// Kept out of the loops above: `OP01-034` and `OP01-052` open no selection at
// all, so "up to" lives inside `orientDon` for one and there is no "up to" for
// the other. Both are covered by their own describes.
export type _NoSelectionAbilities = ['OP01-034-whenAttacking', 'OP01-052-whenAttacking'];

/** Unused-import guard: `InstanceId` is used only in type position above. */
export type _Ids = InstanceId;

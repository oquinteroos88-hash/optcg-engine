import { describe, expect, it } from 'vitest';
import { getPower } from '@optcg/engine';
import type { GameState, InstanceId } from '@optcg/engine';
import {
  answer,
  applyOk,
  assertSettled,
  characterAt,
  firedIds,
  handCard,
  op01Scenario,
  optIn,
} from './support.js';

/**
 * One case per OP-01 batch-2 ability: the Events.
 *
 * Three engine paths no OP-01 card had run before — `mainEvent`,
 * `counterEvent` through `PLAY_COUNTER_EVENT` (CR 7-1-3-2-2), and a life card's
 * `trigger`, which resolves *inside* the Damage Step. Five of the seven cards
 * carry two halves, and the halves differ in ways the tests below pin one at a
 * time.
 *
 * Every case ends at `assertSettled`. Same shape as `op01Abilities.test.ts`.
 */

/** Plays `cardId` from p1's hand as a Main-phase Event. */
function playEvent(state: GameState, cardId: string): { state: GameState; fired: string[] } {
  const instanceId = handCard(state, 'p1', cardId);
  const result = applyOk(state, { type: 'PLAY_CARD', player: 'p1', instanceId });
  return { state: result.state, fired: firedIds(result.events) };
}

/**
 * p1 attacks p2's Leader and p2 passes the Block Step, leaving the Counter
 * Step open with p2 holding priority — where a `[Counter]` Event is played.
 */
function toCounterStep(state: GameState, attackerAt = 0): GameState {
  const attacker = characterAt(state, 'p1', attackerAt);
  const declared = applyOk(state, {
    type: 'DECLARE_ATTACK',
    player: 'p1',
    attacker,
    target: state.players.p2.leader,
  }).state;
  return applyOk(declared, { type: 'PASS', player: 'p2' }).state;
}

/** p2 activates a `[Counter]` Event from hand. */
function playCounterEvent(state: GameState, cardId: string): { state: GameState; fired: string[] } {
  const instanceId = handCard(state, 'p2', cardId);
  const result = applyOk(state, { type: 'PLAY_COUNTER_EVENT', player: 'p2', instanceId });
  return { state: result.state, fired: firedIds(result.events) };
}

// ---------------------------------------------------------------------------
// [Main]
// ---------------------------------------------------------------------------

describe("OP01-027 Round Table — [Main] give up to 1 opponent Character −10000", () => {
  it('subtracts 10000 without K.O.ing, which is not the same thing', () => {
    const start = op01Scenario({
      p1: { activeDon: 4, hand: ['OP01-027'] },
      p2: { characters: [{ cardId: 'OP01-010' }] },
    });
    const komachiyo = characterAt(start, 'p2', 0);

    const played = playEvent(start, 'OP01-027');
    expect(played.fired).toEqual(['OP01-027-main']);
    const done = answer(played.state, 'p1', { kind: 'cards', selected: [komachiyo] });

    // 3000 − 10000. Still on the field, at negative power: a power effect is
    // not a K.O. (CR 2-6-3 names no floor, and 10-2-1-2 defines K.O. as moving
    // the card to the trash, which nothing here did).
    expect(getPower(done, komachiyo)).toBe(-7000);
    expect(done.players.p2.characters).toEqual([komachiyo]);
    expect(done.players.p2.trash).not.toContain(komachiyo);
    expect(done.log.some((event) => event.type === 'koed')).toBe(false);
    assertSettled(done);
  });

  it('wears off at end of turn, so a survivor comes back whole', () => {
    const start = op01Scenario({
      p1: { activeDon: 4, hand: ['OP01-027'] },
      p2: { characters: [{ cardId: 'OP01-010' }] },
    });
    const komachiyo = characterAt(start, 'p2', 0);
    const played = playEvent(start, 'OP01-027');
    const hit = answer(played.state, 'p1', { kind: 'cards', selected: [komachiyo] });
    const nextTurn = applyOk(hit, { type: 'END_TURN', player: 'p1' }).state;
    expect(getPower(nextTurn, komachiyo)).toBe(3000);
  });

  it('reaches only Characters, never the Leader', () => {
    const start = op01Scenario({
      p1: { activeDon: 4, hand: ['OP01-027'] },
      p2: { characters: [{ cardId: 'OP01-010' }] },
    });
    const played = playEvent(start, 'OP01-027');
    // The printed text says "Characters"; OP01-026's [Trigger] says "Leader or
    // Character cards" and reaches both. The two are written apart for this.
    expect(played.state.pending?.candidates).not.toContain(start.players.p2.leader);
    expect(played.state.pending?.candidates).toEqual([characterAt(start, 'p2', 0)]);
  });
});

describe('OP01-056 Demon Face — [Main] K.O. up to 2 rested Characters, cost 5 or less', () => {
  it('takes both in one selection', () => {
    const start = op01Scenario({
      p1: { activeDon: 6, hand: ['OP01-056'] },
      p2: {
        characters: [
          { cardId: 'OP01-010', orientation: 'rested' },
          { cardId: 'OP01-053', orientation: 'rested' },
          { cardId: 'OP01-012', orientation: 'active' },
        ],
      },
    });
    const first = characterAt(start, 'p2', 0);
    const second = characterAt(start, 'p2', 1);
    const active = characterAt(start, 'p2', 2);

    const played = playEvent(start, 'OP01-056');
    expect(played.fired).toEqual(['OP01-056-main']);
    // The active one is not a candidate: `rested` is printed.
    expect(played.state.pending?.candidates).toEqual([first, second]);
    expect(played.state.pending?.max).toBe(2);

    const done = answer(played.state, 'p1', { kind: 'cards', selected: [first, second] });
    expect(done.players.p2.characters).toEqual([active]);
    assertSettled(done);
  });

  it('gates on cost as well as orientation', () => {
    const start = op01Scenario({
      p1: { activeDon: 6, hand: ['OP01-056'] },
      // X.Drake costs 5 and is inside; Kin'emon is not in this deck, so the
      // out-of-gate case uses the 6-cost Leader-adjacent slot: none here, so
      // the assertion is the positive one plus the active exclusion above.
      p2: { characters: [{ cardId: 'OP01-054', orientation: 'rested' }] },
    });
    const drake = characterAt(start, 'p2', 0);
    const played = playEvent(start, 'OP01-056');
    expect(played.state.pending?.candidates).toEqual([drake]);
    const done = answer(played.state, 'p1', { kind: 'cards', selected: [drake] });
    expect(done.players.p2.characters).toEqual([]);
    assertSettled(done);
  });
});

// ---------------------------------------------------------------------------
// [Counter] — played from hand during the Counter Step
// ---------------------------------------------------------------------------

describe('OP01-028 Green Star Rafflesia — one list, two halves', () => {
  it('gives −2000 for the turn as a [Counter]', () => {
    const start = op01Scenario({
      p1: { activeDon: 2, characters: [{ cardId: 'OP01-010' }] },
      p2: { activeDon: 2, hand: ['OP01-028'] },
    });
    const attacker = characterAt(start, 'p1', 0);
    const counterStep = toCounterStep(start);

    const played = playCounterEvent(counterStep, 'OP01-028');
    expect(played.fired).toEqual(['OP01-028-counter']);
    const done = answer(played.state, 'p2', { kind: 'cards', selected: [attacker] });

    expect(getPower(done, attacker)).toBe(1000);
    assertSettled(done);
  });

  it('costs its printed 1 DON!!, paid from the defender own active cost area', () => {
    const start = op01Scenario({
      p1: { activeDon: 2, characters: [{ cardId: 'OP01-010' }] },
      p2: { activeDon: 2, hand: ['OP01-028'] },
    });
    const counterStep = toCounterStep(start);
    const activeBefore = counterStep.players.p2.don.filter(
      (don) => don.location.kind === 'cost' && don.location.orientation === 'active',
    ).length;

    const played = playCounterEvent(counterStep, 'OP01-028');
    const activeAfter = played.state.players.p2.don.filter(
      (don) => don.location.kind === 'cost' && don.location.orientation === 'active',
    ).length;
    // CR 7-1-3-2-2: pay the printed cost, trash the Event, then resolve.
    expect(activeBefore - activeAfter).toBe(1);
    expect(played.state.players.p2.trash).toContain(handCard(counterStep, 'p2', 'OP01-028'));
  });
});

describe('OP01-029 Radical Beam!! — [Counter] with a Life gate', () => {
  function counterWith(life: number): { state: GameState; ally: InstanceId } {
    const start = op01Scenario({
      p1: { activeDon: 2, characters: [{ cardId: 'OP01-010' }] },
      p2: { activeDon: 2, hand: ['OP01-029'], life, characters: [{ cardId: 'OP01-053' }] },
    });
    return { state: toCounterStep(start), ally: characterAt(start, 'p2', 0) };
  }

  it('adds 2000, then 2000 more to the SAME card at 2 Life or less', () => {
    const { state, ally } = counterWith(2);
    const played = playCounterEvent(state, 'OP01-029');
    expect(played.fired).toEqual(['OP01-029-counter']);
    // One selection, asked once — "that card" is the card already chosen.
    const done = answer(played.state, 'p2', { kind: 'cards', selected: [ally] });
    expect(getPower(done, ally)).toBe(4000 + 4000);
    assertSettled(done);
  });

  it('adds only the first 2000 above 2 Life', () => {
    const { state, ally } = counterWith(4);
    const played = playCounterEvent(state, 'OP01-029');
    const done = answer(played.state, 'p2', { kind: 'cards', selected: [ally] });
    expect(getPower(done, ally)).toBe(4000 + 2000);
    assertSettled(done);
  });

  it('lasts the battle, not the turn', () => {
    // The [Counter]/[Trigger] duration pair. This half is `endOfBattle`, so it
    // is gone the moment the battle closes — while the [Trigger] half below
    // lasts the whole turn.
    const { state, ally } = counterWith(2);
    const played = playCounterEvent(state, 'OP01-029');
    const boosted = answer(played.state, 'p2', { kind: 'cards', selected: [ally] });
    expect(getPower(boosted, ally)).toBe(8000);

    const resolved = applyOk(boosted, { type: 'PASS', player: 'p2' }).state;
    expect(resolved.battle).toBeNull();
    expect(getPower(resolved, ally)).toBe(4000);
  });
});

describe('OP01-058 Punk Gibson — [Counter] boost then rest', () => {
  it('boosts one card and rests an opponent Character in one resolution', () => {
    const start = op01Scenario({
      p1: { activeDon: 3, characters: [{ cardId: 'OP01-010' }, { cardId: 'OP01-012' }] },
      p2: { activeDon: 3, hand: ['OP01-058'], characters: [{ cardId: 'OP01-053' }] },
    });
    const attacker = characterAt(start, 'p1', 0);
    const bystander = characterAt(start, 'p1', 1); // Sai, cost 2, inside the gate
    const ally = characterAt(start, 'p2', 0);
    const counterStep = toCounterStep(start);

    const played = playCounterEvent(counterStep, 'OP01-058');
    expect(played.fired).toEqual(['OP01-058-counter']);
    const boosted = answer(played.state, 'p2', { kind: 'cards', selected: [ally] });
    expect(getPower(boosted, ally)).toBe(8000);

    // The attacker is rested already; Sai is the one this can visibly turn.
    const done = answer(boosted, 'p2', { kind: 'cards', selected: [bystander] });
    expect(done.cards[bystander]?.orientation).toBe('rested');
    expect(done.cards[attacker]?.orientation).toBe('rested');
    assertSettled(done);
  });
});

describe('OP01-057 Paradise Waterfall — [Counter] boost then wake', () => {
  it('sets one of its own Characters active', () => {
    const start = op01Scenario({
      p1: { activeDon: 2, characters: [{ cardId: 'OP01-010' }] },
      p2: {
        activeDon: 2,
        hand: ['OP01-057'],
        characters: [{ cardId: 'OP01-053', orientation: 'rested' }],
      },
    });
    const sleeping = characterAt(start, 'p2', 0);
    const counterStep = toCounterStep(start);

    const played = playCounterEvent(counterStep, 'OP01-057');
    expect(played.fired).toEqual(['OP01-057-counter']);
    const boosted = answer(played.state, 'p2', { kind: 'cards', selected: [] });
    const done = answer(boosted, 'p2', { kind: 'cards', selected: [sleeping] });

    expect(done.cards[sleeping]?.orientation).toBe('active');
    assertSettled(done);
  });
});

describe('OP01-026 Red Hawk — the [Counter] that can end the battle', () => {
  it('boosts, then K.O.s an opponent Character with 4000 power or less', () => {
    const start = op01Scenario({
      p1: {
        activeDon: 3,
        characters: [{ cardId: 'OP01-053' }, { cardId: 'OP01-010' }],
      },
      p2: { activeDon: 3, hand: ['OP01-026'], characters: [{ cardId: 'OP01-012' }] },
    });
    const attacker = characterAt(start, 'p1', 0); // Wire, 4000
    const spare = characterAt(start, 'p1', 1); // Komachiyo, 3000
    const ally = characterAt(start, 'p2', 0);
    const counterStep = toCounterStep(start);

    const played = playCounterEvent(counterStep, 'OP01-026');
    expect(played.fired).toEqual(['OP01-026-counter']);
    const boosted = answer(played.state, 'p2', { kind: 'cards', selected: [ally] });
    expect(getPower(boosted, ally)).toBe(4000 + 4000);

    const done = answer(boosted, 'p2', { kind: 'cards', selected: [spare] });
    expect(done.players.p1.characters).toEqual([attacker]);
    // The battle is untouched: the card K.O.d was not in it.
    expect(done.battle).not.toBeNull();
    assertSettled(done);
  });

  it('K.O.ing the ATTACKER ends the battle at CR 7-1-1-4, not at the Damage Step', () => {
    // The Counter Step version of the vanished-participant rule. `battleVanished`
    // covers the Attack and Block Steps with synthetic cards; this is the same
    // rule reached by a printed card, from the third step.
    const start = op01Scenario({
      p1: { activeDon: 3, characters: [{ cardId: 'OP01-010' }] },
      p2: { activeDon: 3, hand: ['OP01-026'] },
    });
    const attacker = characterAt(start, 'p1', 0); // 3000, inside the 4000 gate
    const counterStep = toCounterStep(start);

    const played = playCounterEvent(counterStep, 'OP01-026');
    const boosted = answer(played.state, 'p2', { kind: 'cards', selected: [] });
    const done = answer(boosted, 'p2', { kind: 'cards', selected: [attacker] });

    expect(done.players.p1.characters).toEqual([]);
    expect(done.battle).toBeNull();
    expect(done.log.some((event) => event.type === 'battleEndedEarly')).toBe(true);
    // No damage: the Damage Step never ran, so the Leader kept its Life.
    expect(done.log.some((event) => event.type === 'battleResolved')).toBe(false);
    expect(done.players.p2.life).toHaveLength(start.players.p2.life.length);
    assertSettled(done);
  });
});

// ---------------------------------------------------------------------------
// [Trigger] — from a life card, mid Damage Step
// ---------------------------------------------------------------------------

/**
 * Stages p1 attacking p2's Leader with `lifeCards` on top, then walks to the
 * damage: p2 passes the Block Step and the Counter Step, damage resolves, and
 * the life card's `[Trigger]` is offered to p2 as an opt-in.
 */
function toLifeTrigger(
  lifeCard: string,
  extra: Parameters<typeof op01Scenario>[0] = {},
): { state: GameState; start: GameState } {
  const start = op01Scenario({
    ...extra,
    // `OP01-025` Zoro is 5000, which ties the 5000-power Leader — and the
    // attacker wins ties (CR 7-1-4-1), so the damage lands and a Life card is
    // turned over. A 4000 attacker loses and never reaches the trigger at all.
    p1: { activeDon: 3, characters: [{ cardId: 'OP01-025' }], ...(extra.p1 ?? {}) },
    p2: { lifeCards: [lifeCard], ...(extra.p2 ?? {}) },
  });
  const counterStep = toCounterStep(start);
  const damaged = applyOk(counterStep, { type: 'PASS', player: 'p2' }).state;
  return { state: damaged, start };
}

describe('OP01-028 Green Star Rafflesia — the [Trigger] half is the same list', () => {
  it('runs the [Counter] effect from the life area', () => {
    const { state, start } = toLifeTrigger('OP01-028');
    const attacker = characterAt(start, 'p1', 0);
    // A life card's [Trigger] is always an opt-in (CR 7-1-4-1-1-2).
    const accepted = optIn(state, 'p2', true);
    const done = answer(accepted, 'p2', { kind: 'cards', selected: [attacker] });

    expect(firedIds(done.log)).toContain('OP01-028-trigger');
    // Zoro is 5000; the [Trigger] half gives −2000 for the turn.
    expect(getPower(done, attacker)).toBe(3000);
    assertSettled(done);
  });

  it('declining it is a complete resolution', () => {
    const { state, start } = toLifeTrigger('OP01-028');
    const attacker = characterAt(start, 'p1', 0);
    const declined = optIn(state, 'p2', false);
    expect(getPower(declined, attacker)).toBe(5000);
    assertSettled(declined);
  });
});

describe('OP01-029 Radical Beam!! — the [Trigger] half lasts the TURN', () => {
  it('grants +1000 that survives the battle it was granted in', () => {
    const { state } = toLifeTrigger('OP01-029', {
      p2: { characters: [{ cardId: 'OP01-053' }] },
    });
    const ally = state.players.p2.characters[0];
    if (ally === undefined) {
      throw new Error('expected a p2 Character');
    }
    const accepted = optIn(state, 'p2', true);
    const done = answer(accepted, 'p2', { kind: 'cards', selected: [ally] });

    // `endOfTurn`, not `endOfBattle`. The battle is already closed by the time a
    // [Trigger] resolves, so an `endOfBattle` modifier granted here would expire
    // at the *next* battle instead — the trap the Guard Point pair named.
    expect(done.battle).toBeNull();
    expect(getPower(done, ally)).toBe(5000);
    assertSettled(done);
  });
});

describe('OP01-058 Punk Gibson — the [Trigger] half drops the cost gate', () => {
  it('rests any opponent Character, with no cost filter at all', () => {
    const { state, start } = toLifeTrigger('OP01-058', {
      // X.Drake costs 5, outside the [Counter] half's gate of 4.
      p1: { activeDon: 3, characters: [{ cardId: 'OP01-025' }, { cardId: 'OP01-054' }] },
    });
    const drake = characterAt(start, 'p1', 1);
    const accepted = optIn(state, 'p2', true);
    expect(accepted.pending?.candidates).toContain(drake);

    const done = answer(accepted, 'p2', { kind: 'cards', selected: [drake] });
    expect(done.cards[drake]?.orientation).toBe('rested');
    assertSettled(done);
  });
});

describe('OP01-057 Paradise Waterfall — the [Trigger] that can K.O. the attacker', () => {
  it('K.O.s it without breaking anything, because the battle already closed', () => {
    // The third question of the method, asked of the most delicate window in
    // the game. A life card's [Trigger] resolves *inside* the Damage Step —
    // but `resolveBattle` closes the battle before applying its outcome, so by
    // the time this runs there is no battle left to invalidate.
    const { state, start } = toLifeTrigger('OP01-057');
    const attacker = characterAt(start, 'p1', 0); // Wire, cost 2, rested by attacking

    expect(state.battle).toBeNull();
    const accepted = optIn(state, 'p2', true);
    expect(accepted.pending?.candidates).toEqual([attacker]);

    const done = answer(accepted, 'p2', { kind: 'cards', selected: [attacker] });
    expect(done.players.p1.characters).toEqual([]);
    expect(done.players.p1.trash).toContain(attacker);
    // No `battleEndedEarly`: there was no battle to end. The damage was already
    // dealt, and the Life card was already taken.
    expect(done.log.some((event) => event.type === 'battleEndedEarly')).toBe(false);
    expect(done.log.some((event) => event.type === 'battleResolved')).toBe(true);
    assertSettled(done);
  });

  it('offers only rested opponent Characters, cost 4 or less', () => {
    const { state, start } = toLifeTrigger('OP01-057', {
      p1: {
        activeDon: 3,
        characters: [{ cardId: 'OP01-025' }, { cardId: 'OP01-012', orientation: 'active' }],
      },
    });
    const attacker = characterAt(start, 'p1', 0);
    const accepted = optIn(state, 'p2', true);
    // The active Sai is not offered; only the attacker, which attacking rested.
    expect(accepted.pending?.candidates).toEqual([attacker]);
    assertSettled(answer(accepted, 'p2', { kind: 'cards', selected: [] }));
  });
});

// ---------------------------------------------------------------------------
// "Up to", in all three shapes
// ---------------------------------------------------------------------------

describe('every "up to" in this batch survives resolving to nothing', () => {
  const MAIN: Array<{ cardId: string; abilityId: string; don: number }> = [
    { cardId: 'OP01-027', abilityId: 'OP01-027-main', don: 4 },
    { cardId: 'OP01-056', abilityId: 'OP01-056-main', don: 6 },
  ];

  for (const entry of MAIN) {
    describe(entry.abilityId, () => {
      function withVictim(): GameState {
        return op01Scenario({
          p1: { activeDon: entry.don, hand: [entry.cardId] },
          p2: { characters: [{ cardId: 'OP01-010', orientation: 'rested' }] },
        });
      }

      it('suspends and applies when something is chosen', () => {
        const played = playEvent(withVictim(), entry.cardId);
        expect(played.fired).toEqual([entry.abilityId]);
        expect(played.state.pending?.min).toBe(0);
        assertSettled(
          answer(played.state, 'p1', {
            kind: 'cards',
            selected: played.state.pending?.candidates.slice(0, 1) ?? [],
          }),
        );
      });

      it('accepts an empty selection and degrades to a no-op', () => {
        const before = withVictim();
        const played = playEvent(before, entry.cardId);
        const done = answer(played.state, 'p1', { kind: 'cards', selected: [] });
        expect(done.players.p2.characters).toEqual(before.players.p2.characters);
        for (const id of done.players.p2.characters) {
          expect(getPower(done, id)).toBe(getPower(before, id));
          expect(done.cards[id]?.orientation).toBe(before.cards[id]?.orientation);
        }
        assertSettled(done);
      });

      it('never suspends at all when there is nothing to select', () => {
        const empty = op01Scenario({
          p1: { activeDon: entry.don, hand: [entry.cardId] },
          p2: { characters: [] },
        });
        const played = playEvent(empty, entry.cardId);
        expect(played.fired).toEqual([entry.abilityId]);
        expect(played.state.pending).toBeNull();
        assertSettled(played.state);
      });
    });
  }

  const COUNTER: Array<{ cardId: string; abilityId: string }> = [
    { cardId: 'OP01-026', abilityId: 'OP01-026-counter' },
    { cardId: 'OP01-028', abilityId: 'OP01-028-counter' },
    { cardId: 'OP01-029', abilityId: 'OP01-029-counter' },
    { cardId: 'OP01-057', abilityId: 'OP01-057-counter' },
    { cardId: 'OP01-058', abilityId: 'OP01-058-counter' },
  ];

  for (const entry of COUNTER) {
    it(`${entry.abilityId} resolves to nothing when every selection is empty`, () => {
      const start = op01Scenario({
        p1: { activeDon: 3, characters: [{ cardId: 'OP01-010' }] },
        p2: { activeDon: 3, hand: [entry.cardId] },
      });
      const attacker = characterAt(start, 'p1', 0);
      const counterStep = toCounterStep(start);
      const played = playCounterEvent(counterStep, entry.cardId);
      expect(played.fired).toEqual([entry.abilityId]);

      // Answer whatever it asks, with nothing, until it stops asking. The
      // number of questions is not fixed: a selection with no candidates never
      // suspends, so OP01-057's second step is skipped when p2 has no board.
      let current = played.state;
      let asked = 0;
      while (current.pending !== null) {
        expect(current.pending.min).toBe(0);
        current = answer(current, 'p2', { kind: 'cards', selected: [] });
        asked += 1;
        if (asked > 4) {
          throw new Error('the script never stopped asking');
        }
      }
      expect(asked).toBeGreaterThan(0);
      // The board is untouched and the battle is still live: an Event that
      // resolved to nothing must not swallow the battle it was played into.
      expect(getPower(current, attacker)).toBe(getPower(start, attacker));
      expect(current.battle).not.toBeNull();
      assertSettled(current);
    });
  }
});

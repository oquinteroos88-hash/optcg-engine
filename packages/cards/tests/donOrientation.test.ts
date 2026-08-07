import { describe, expect, it } from 'vitest';
import { getPower, legalActions } from '@optcg/engine';
import type { GameState, InstanceId, PlayerId } from '@optcg/engine';
import {
  answer,
  applyOk,
  assertSettled,
  characterAt,
  firedIds,
  handCard,
  starterScenario,
} from './support.js';

/**
 * The three starter cards that change a DON!! card's orientation.
 *
 * ST02-008 Scratchmen Apoo rests the opponent's; ST02-015 Scalpel and ST02-016
 * Repel set their controller's back to active in the middle of the opponent's
 * turn. All three are ST-02 cards, so p2 is the side that plays them throughout.
 *
 * What the last two make possible is the interesting part and has its own case
 * at the bottom: a Counter Event that refunds the DON!! to pay for the next one.
 */

function costDon(state: GameState, player: PlayerId, orientation: 'active' | 'rested'): number {
  return state.players[player].don.filter(
    (don) => don.location.kind === 'cost' && don.location.orientation === orientation,
  ).length;
}

function counterEventsOffered(state: GameState, player: PlayerId): InstanceId[] {
  return legalActions(state, player)
    .filter((action) => action.type === 'PLAY_COUNTER_EVENT')
    .map((action) => (action.type === 'PLAY_COUNTER_EVENT' ? action.instanceId : ''));
}

// ---------------------------------------------------------------------------
// ST02-008 Scratchmen Apoo
// ---------------------------------------------------------------------------

/** Apoo attacking p1's Leader with a DON!! given to it, its choice open. */
function apooAttacking(p1Side: {
  activeDon?: number;
  restedDon?: number;
  hand?: string[];
  clearHand?: boolean;
}): GameState {
  const staged = starterScenario({
    firstPlayer: 'p2',
    p1: p1Side,
    p2: { activeDon: 2, characters: [{ cardId: 'ST02-008' }] },
  });
  const apoo = characterAt(staged, 'p2', 0);
  // `[DON!! x1]` is a condition on DON!! *given* to the card, so one has to be
  // attached before the attack or the ability never fires at all.
  const armed = applyOk(staged, { type: 'ATTACH_DON', player: 'p2', to: apoo, count: 1 }).state;
  return applyOk(armed, {
    type: 'DECLARE_ATTACK',
    player: 'p2',
    attacker: apoo,
    target: armed.players.p1.leader,
  }).state;
}

describe('ST02-008 Scratchmen Apoo rests an opposing DON!!', () => {
  it('takes one active DON!! out of the opponent cost area', () => {
    const asking = apooAttacking({ activeDon: 4 });
    expect(asking.pending?.kind).toBe('yesNo');
    expect(asking.pending?.player).toBe('p2');

    const done = answer(asking, 'p2', { kind: 'yesNo', value: true });

    expect(costDon(done, 'p1', 'active')).toBe(3);
    expect(costDon(done, 'p1', 'rested')).toBe(1);
    // Apoo's own side is untouched: the card names the opponent's cost area.
    expect(costDon(done, 'p2', 'active')).toBe(1);
    assertSettled(done);
  });

  it('costs the opponent a DON!! they would have countered with', () => {
    // The card read the way the defender feels it. Guard Point costs 1, so with
    // exactly one active DON!! the rest is the whole difference between having a
    // Counter Event and not.
    const asking = apooAttacking({ activeDon: 1, hand: ['ST01-014'], clearHand: true });
    const guardPoint = handCard(asking, 'p1', 'ST01-014');

    const rested = answer(asking, 'p2', { kind: 'yesNo', value: true });
    // Walk to the Counter Step, where a Counter Event would be offered.
    const counterStep = applyOk(rested, { type: 'PASS', player: 'p1' }).state;

    expect(costDon(counterStep, 'p1', 'active')).toBe(0);
    expect(counterEventsOffered(counterStep, 'p1')).not.toContain(guardPoint);
    assertSettled(counterStep);
  });

  it('does nothing when every opposing DON!! is already rested', () => {
    // Official Q&A, ST02-008: "Can I rest a DON!! card that is already rested?"
    // — "No, you cannot. You must choose up to 1 active DON!! card from your
    // opponent's cost area." No active DON!! is nothing to choose. The ability
    // still fires and still resolves; it simply has no effect.
    const asking = apooAttacking({ restedDon: 4 });
    const before = asking.players.p1.don.map((don) => JSON.stringify(don.location));

    const done = answer(asking, 'p2', { kind: 'yesNo', value: true });

    expect(done.players.p1.don.map((don) => JSON.stringify(don.location))).toEqual(before);
    expect(done.log.some((event) => event.type === 'donOrientationChanged')).toBe(false);
    assertSettled(done);
  });

  it('leaves the opponent DON!! alone when the "up to" is answered no', () => {
    // "Up to 1" includes 0 (CR 4-8-1), and choosing 0 has to leave nothing
    // behind: no stack, no pending, no half-applied change.
    const asking = apooAttacking({ activeDon: 4 });

    const done = answer(asking, 'p2', { kind: 'yesNo', value: false });

    expect(costDon(done, 'p1', 'active')).toBe(4);
    expect(costDon(done, 'p1', 'rested')).toBe(0);
    expect(done.pending).toBeNull();
    expect(done.stack).toEqual([]);
    expect(done.resume).toEqual([]);
    assertSettled(done);
  });
});

// ---------------------------------------------------------------------------
// ST02-015 Scalpel / ST02-016 Repel
// ---------------------------------------------------------------------------

/**
 * p2 defending at the Counter Step, holding `hand`, with a cost area of
 * `activeDon` active and `restedDon` rested DON!!. Franky (6000) attacks the
 * untouched 5000 Leader, so an unanswered attack takes a life.
 */
function counterStep(hand: string[], activeDon: number, restedDon = 0): GameState {
  const staged = starterScenario({
    p1: { activeDon: 4, characters: [{ cardId: 'ST01-010' }] },
    p2: { hand, activeDon, restedDon, clearHand: true },
  });
  const attacked = applyOk(staged, {
    type: 'DECLARE_ATTACK',
    player: 'p1',
    attacker: characterAt(staged, 'p1', 0),
    target: staged.players.p2.leader,
  }).state;
  return applyOk(attacked, { type: 'PASS', player: 'p2' }).state;
}

describe.each([
  { cardId: 'ST02-015', name: 'Scalpel', abilityId: 'ST02-015-counter', cost: 1, power: 2000 },
  { cardId: 'ST02-016', name: 'Repel', abilityId: 'ST02-016-counter', cost: 2, power: 4000 },
])('$cardId $name [Counter]', ({ cardId, abilityId, cost, power }) => {
  it('resolves the power half and then the DON!! half, in that order', () => {
    // Played with exactly its cost in active DON!!, so after paying, the cost
    // area holds `cost` freshly rested DON!! and nothing else — and the second
    // half of the card sets one of those back to active.
    const staged = counterStep([cardId], cost);
    const event = handCard(staged, 'p2', cardId);
    const leader = staged.players.p2.leader;
    const basePower = getPower(staged, leader);

    const played = applyOk(staged, {
      type: 'PLAY_COUNTER_EVENT',
      player: 'p2',
      instanceId: event,
    });
    expect(firedIds(played.events)).toContain(abilityId);
    // "Then" is an order, and the order is observable: the power target is asked
    // first, the DON!! second.
    expect(played.state.pending?.kind).toBe('selectCards');
    // Pay, trash, activate (CR 7-1-3-2-2): the Event is already in the trash
    // when its own effect starts asking questions.
    expect(played.state.players.p2.trash[0]).toBe(event);
    expect(played.state.players.p2.hand).not.toContain(event);
    expect(costDon(played.state, 'p2', 'rested')).toBe(cost);
    expect(costDon(played.state, 'p2', 'active')).toBe(0);

    const buffed = answer(played.state, 'p2', { kind: 'cards', selected: [leader] });
    expect(getPower(buffed, leader)).toBe(basePower + power);
    expect(buffed.pending?.kind).toBe('yesNo');

    const done = answer(buffed, 'p2', { kind: 'yesNo', value: true });
    expect(costDon(done, 'p2', 'active')).toBe(1);
    expect(costDon(done, 'p2', 'rested')).toBe(cost - 1);
    // The power half is still standing after the DON!! half ran.
    expect(getPower(done, leader)).toBe(basePower + power);
    assertSettled(done);
  });

  it('resolves both halves as zero when both "up to" choices are declined', () => {
    // Official Q&A for both cards: "Can I choose not to set any DON!! cards as
    // active when using this [Counter] effect?" — "Yes, you can." Declining is a
    // complete resolution, not an abandoned one.
    const staged = counterStep([cardId], cost);
    const event = handCard(staged, 'p2', cardId);
    const leader = staged.players.p2.leader;
    const basePower = getPower(staged, leader);

    const played = applyOk(staged, {
      type: 'PLAY_COUNTER_EVENT',
      player: 'p2',
      instanceId: event,
    }).state;
    const noTarget = answer(played, 'p2', { kind: 'cards', selected: [] });
    const done = answer(noTarget, 'p2', { kind: 'yesNo', value: false });

    expect(getPower(done, leader)).toBe(basePower);
    expect(done.modifiers).toEqual([]);
    expect(costDon(done, 'p2', 'active')).toBe(0);
    expect(costDon(done, 'p2', 'rested')).toBe(cost);
    // The cost stays spent: declining the effect is not taking the card back.
    expect(done.players.p2.trash[0]).toBe(event);
    assertSettled(done);
  });

  it('suspends on the DON!! question mid-battle and survives a JSON round trip', () => {
    const staged = counterStep([cardId], cost);
    const event = handCard(staged, 'p2', cardId);
    const leader = staged.players.p2.leader;

    const played = applyOk(staged, {
      type: 'PLAY_COUNTER_EVENT',
      player: 'p2',
      instanceId: event,
    }).state;
    // Answer the first choice so the suspension under test is the DON!! one —
    // the half this change added — paused with the battle still open.
    const asking = answer(played, 'p2', { kind: 'cards', selected: [leader] });
    expect(asking.battle?.step).toBe('counter');
    expect(asking.pending?.kind).toBe('yesNo');

    const rehydrated = JSON.parse(JSON.stringify(asking)) as GameState;
    expect(rehydrated).toEqual(asking);

    const fromMemory = answer(asking, 'p2', { kind: 'yesNo', value: true });
    const fromDisk = answer(rehydrated, 'p2', { kind: 'yesNo', value: true });
    expect(fromDisk).toEqual(fromMemory);
    assertSettled(fromMemory);
  });
});

describe('ST02-015 Scalpel [Trigger] sets up to 2 DON!! active', () => {
  /** Scalpel as p2's top life card, turned over by an attack on the Leader. */
  function triggerOffered(activeDon: number, restedDon: number): GameState {
    const staged = starterScenario({
      p1: { activeDon: 4, characters: [{ cardId: 'ST01-010' }] },
      p2: { lifeCards: ['ST02-015'], activeDon, restedDon, clearHand: true },
    });
    const attacked = applyOk(staged, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(staged, 'p1', 0),
      target: staged.players.p2.leader,
    }).state;
    const toCounter = applyOk(attacked, { type: 'PASS', player: 'p2' }).state;
    // Damage turns the life card over and offers its [Trigger] as an opt-in.
    return applyOk(toCounter, { type: 'PASS', player: 'p2' }).state;
  }

  it('reaches every count in 0..2 through the two confirms', () => {
    // "Up to 2" is a quantity, and the DSL chooses cards or yes/no, never a
    // number — so it is two confirms, one DON!! each, which is the only encoding
    // where 1 is reachable at all. The Q&A insists 1 is a real answer: asked
    // about this [Trigger] with too few DON!! in the cost area, "you can choose
    // to set 0 or 1 DON!! cards as active."
    for (const [first, second, expected] of [
      [false, false, 0],
      [true, false, 1],
      [false, true, 1],
      [true, true, 2],
    ] as const) {
      const label = `${String(first)}/${String(second)}`;
      const offered = triggerOffered(0, 4);
      const accepted = answer(offered, 'p2', { kind: 'yesNo', value: true });
      const afterFirst = answer(accepted, 'p2', { kind: 'yesNo', value: first });
      const done = answer(afterFirst, 'p2', { kind: 'yesNo', value: second });

      expect(costDon(done, 'p2', 'active'), label).toBe(expected);
      expect(costDon(done, 'p2', 'rested'), label).toBe(4 - expected);
      assertSettled(done);
    }
  });

  it('turns only what it can when a single rested DON!! is left', () => {
    const offered = triggerOffered(3, 1);
    const accepted = answer(offered, 'p2', { kind: 'yesNo', value: true });
    const afterFirst = answer(accepted, 'p2', { kind: 'yesNo', value: true });
    const done = answer(afterFirst, 'p2', { kind: 'yesNo', value: true });

    // Both confirms said yes; only one DON!! was rested to turn. Fewer than
    // asked is a smaller number, not a failed effect (CR 4-8-1, 8-4-4-1).
    expect(costDon(done, 'p2', 'active')).toBe(4);
    expect(costDon(done, 'p2', 'rested')).toBe(0);
    assertSettled(done);
  });
});

describe('a Counter Event pays for the next one', () => {
  it('lets the DON!! Scalpel sets active fund a second Scalpel in the same battle', () => {
    // The rules question this change had to answer, and the reason it matters.
    //
    // CR 7-1-3-2-2 has the defender "pay the cost of an Event card with
    // [Counter] in their hand", and paying a cost is resting that many active
    // DON!! in your own cost area (CR 2-7-3, 8-3-1-5). Neither rule is scoped by
    // whose turn it is, and a DON!! set active by an effect is an ordinary
    // active DON!! — 4-4-1 knows only two states and nothing marks one as spent
    // or as belonging to a past turn. So the refund is spendable immediately, in
    // the battle that produced it.
    //
    // Staged with exactly 1 active DON!! and two Scalpels, each costing 1: the
    // second is affordable only if the first one handed the DON!! back.
    const staged = counterStep(['ST02-015', 'ST02-015'], 1, 2);
    const [first, second] = staged.players.p2.hand.filter(
      (id) => staged.cards[id]?.cardId === 'ST02-015',
    );
    if (first === undefined || second === undefined) {
      throw new Error('expected two Scalpels in hand');
    }
    const leader = staged.players.p2.leader;
    const basePower = getPower(staged, leader);
    const lifeBefore = staged.players.p2.life.length;

    const played = applyOk(staged, {
      type: 'PLAY_COUNTER_EVENT',
      player: 'p2',
      instanceId: first,
    }).state;
    const buffed = answer(played, 'p2', { kind: 'cards', selected: [leader] });

    // Mid-effect the cost area has no active DON!! left: the first Scalpel ate
    // the only one, so right now the second is unaffordable.
    expect(costDon(buffed, 'p2', 'active')).toBe(0);

    const refunded = answer(buffed, 'p2', { kind: 'yesNo', value: true });
    expect(costDon(refunded, 'p2', 'active')).toBe(1);

    // That refunded DON!! is what makes the second Event legal at all.
    expect(counterEventsOffered(refunded, 'p2')).toContain(second);

    const again = applyOk(refunded, {
      type: 'PLAY_COUNTER_EVENT',
      player: 'p2',
      instanceId: second,
    });
    expect(firedIds(again.events)).toContain('ST02-015-counter');
    const buffedTwice = answer(again.state, 'p2', { kind: 'cards', selected: [leader] });
    const done = answer(buffedTwice, 'p2', { kind: 'yesNo', value: true });

    // Both Counters landed on the same Leader in the same battle: 5000 + 2000 +
    // 2000, paid for with what started as a single active DON!!.
    expect(getPower(done, leader)).toBe(basePower + 4000);
    expect(done.players.p2.trash.slice(0, 2)).toEqual([second, first]);
    assertSettled(done);

    // And the chain changed the outcome: 9000 against Franky's 6000 takes no
    // life, where one Scalpel alone (7000) would also have held — so the test
    // that the second Event happened at all is the `toContain` above, and this
    // is the board agreeing.
    const resolved = applyOk(done, { type: 'PASS', player: 'p2' });
    expect(resolved.state.players.p2.life.length).toBe(lifeBefore);
    expect(
      resolved.events.some(
        (event) => event.type === 'battleResolved' && event.outcome === 'noEffect',
      ),
    ).toBe(true);
  });
});

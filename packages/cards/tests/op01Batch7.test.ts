import { describe, expect, it } from 'vitest';
import type { GameState, InstanceId } from '@optcg/engine';
import {
  answer,
  applyOk,
  assertSettled,
  characterAt,
  firedIds,
  handCard,
  op01BpScenario,
  op01Scenario,
} from './support.js';

/**
 * The two cards that watch what somebody else did.
 *
 * Backlog A, not backlog B: neither was a DSL gap. Both could be written
 * perfectly and neither could ever run, because `applyPlayCard` told the Event
 * about itself and nothing else. An OP-01 Crocodile deck built before this ran
 * a Leader whose printed ability never fired — and that deck has dealt every
 * blue/purple manifestation game since batch 3.
 *
 * Both markers are **prose**. No bracket search finds them, which is exactly how
 * they survived `docs/trigger-reachability.md`'s sweep of the eleven triggers.
 */

function pendingOf(state: GameState): NonNullable<GameState['pending']> {
  const pending = state.pending;
  if (pending === null) {
    throw new Error('expected a choice to be open');
  }
  return pending;
}

function handSize(state: GameState, player: 'p1' | 'p2'): number {
  return state.players[player].hand.length;
}

// ---------------------------------------------------------------------------
// OP01-004 — the watcher on the other side of the Counter Step
// ---------------------------------------------------------------------------

describe('OP01-004 Usopp — draw when your opponent activates an Event', () => {
  /**
   * p1 attacks with Usopp on the board; p2 holds a `[Counter]` Event.
   *
   * `[Your Turn]` on a card that watches the opponent reads like a
   * contradiction and is not: a `[Counter]` Event is activated by the
   * *defender*, during the attacker's turn (CR 7-1-3-2-2). This position is the
   * only one the card was printed for.
   */
  function counterStep(donOnUsopp = 1): GameState {
    const staged = op01Scenario({
      p1: {
        activeDon: 4,
        characters: [
          { cardId: 'OP01-025' },
          { cardId: 'OP01-004', attachedDon: donOnUsopp },
        ],
      },
      p2: { clearHand: true, activeDon: 2, hand: ['OP01-028', 'OP01-012'] },
    });
    const attacking = applyOk(staged, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(staged, 'p1', 0),
      target: staged.players.p2.leader,
    }).state;
    return applyOk(attacking, { type: 'PASS', player: 'p2' }).state;
  }

  it('draws for the attacker when the defender plays a [Counter] Event', () => {
    const staged = counterStep();
    const before = handSize(staged, 'p1');

    const played = applyOk(staged, {
      type: 'PLAY_COUNTER_EVENT',
      player: 'p2',
      instanceId: handCard(staged, 'p2', 'OP01-028'),
    }).state;
    // Green Star Rafflesia opens its own choice first; Usopp's draw is queued
    // underneath it and resolves after (CR 8-6-3).
    const done = answer(played, 'p2', { kind: 'cards', selected: [] });

    expect(firedIds(done.log)).toContain('OP01-004-onEnemyEvent');
    expect(handSize(done, 'p1')).toBe(before + 1);
    assertSettled(done);
  });

  it('resolves after the Event it heard, not before', () => {
    // CR 8-6-3: an effect whose timing is fulfilled by activating a card is
    // activated "after the resolution of the effect of the previously activated
    // card". Read off the log, which is what a client renders.
    const staged = counterStep();
    const played = applyOk(staged, {
      type: 'PLAY_COUNTER_EVENT',
      player: 'p2',
      instanceId: handCard(staged, 'p2', 'OP01-028'),
    }).state;
    const done = answer(played, 'p2', { kind: 'cards', selected: [] });

    const order = firedIds(done.log);
    expect(order.indexOf('OP01-028-counter')).toBeLessThan(
      order.indexOf('OP01-004-onEnemyEvent'),
    );
  });

  it('needs its DON!! before it hears anything', () => {
    const staged = counterStep(0);
    const before = handSize(staged, 'p1');

    const played = applyOk(staged, {
      type: 'PLAY_COUNTER_EVENT',
      player: 'p2',
      instanceId: handCard(staged, 'p2', 'OP01-028'),
    }).state;
    const done = answer(played, 'p2', { kind: 'cards', selected: [] });

    expect(firedIds(done.log)).not.toContain('OP01-004-onEnemyEvent');
    expect(handSize(done, 'p1')).toBe(before);
  });

  it('does not hear its own controller playing an Event', () => {
    // `whenOpponentActivatesEvent` fires on the field of whoever did *not* use
    // the card, so the side is settled before the ability is consulted. Usopp
    // cannot hear the wrong one, because he cannot be sent the wrong one.
    const staged = op01Scenario({
      p1: {
        clearHand: true,
        activeDon: 6,
        hand: ['OP01-027'],
        characters: [{ cardId: 'OP01-004', attachedDon: 1 }],
      },
      p2: { characters: [{ cardId: 'OP01-012' }] },
    });
    const before = handSize(staged, 'p1');

    const played = applyOk(staged, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: handCard(staged, 'p1', 'OP01-027'),
    }).state;
    const done = played.pending === null
      ? played
      : answer(played, 'p1', { kind: 'cards', selected: [] });

    expect(firedIds(done.log)).toContain('OP01-027-main');
    expect(firedIds(done.log)).not.toContain('OP01-004-onEnemyEvent');
    // −1 for the Event played, and nothing drawn back.
    expect(handSize(done, 'p1')).toBe(before - 1);
    assertSettled(done);
  });

  it('is once per turn', () => {
    const staged = counterStep();
    const first = applyOk(staged, {
      type: 'PLAY_COUNTER_EVENT',
      player: 'p2',
      instanceId: handCard(staged, 'p2', 'OP01-028'),
    }).state;
    const settled = answer(first, 'p2', { kind: 'cards', selected: [] });
    const usopp = characterAt(settled, 'p1', 1);

    expect(settled.cards[usopp]?.usedThisTurn).toContain('OP01-004-onEnemyEvent');
  });
});

// ---------------------------------------------------------------------------
// OP01-062 — the Leader that has been leading with nothing since batch 3
// ---------------------------------------------------------------------------

describe('OP01-062 Crocodile (Leader) — you may draw when you activate an Event', () => {
  function withEvent(hand: readonly string[], donOnLeader = 1): GameState {
    const staged = op01BpScenario({
      p1: { clearHand: true, activeDon: 6, hand: [...hand] },
      p2: { characters: [{ cardId: 'OP01-076' }] },
    });
    if (donOnLeader === 0) {
      return staged;
    }
    return applyOk(staged, {
      type: 'ATTACH_DON',
      player: 'p1',
      to: staged.players.p1.leader,
      count: donOnLeader,
    }).state;
  }

  /**
   * Plays Sheep's Horn and resolves it completely.
   *
   * It carries its own `optional: true` and a `returnDon` cost, so its opt-in
   * and its target choice both come first — Crocodile's question is queued
   * underneath the whole Event and cannot be reached until the Event is done.
   * That ordering is CR 8-6-3 and is the point of the second case below.
   */
  function playSheepsHorn(state: GameState): GameState {
    const played = applyOk(state, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: handCard(state, 'p1', 'OP01-117'),
    }).state;
    const accepted = answer(played, 'p1', { kind: 'yesNo', value: true });
    return answer(accepted, 'p1', { kind: 'cards', selected: [] });
  }

  it('asks, and draws when the controller accepts', () => {
    // "You may" on an auto effect is `optional: true` (CR 8-1-2) — nothing else
    // asks the controller, and without it the once-per-turn use would be spent
    // by an ability they never agreed to.
    const staged = withEvent(['OP01-117', 'OP01-076']);
    const afterEvent = playSheepsHorn(staged);

    expect(pendingOf(afterEvent).sink).toEqual({ kind: 'optIn' });
    const before = handSize(afterEvent, 'p1');
    const done = answer(afterEvent, 'p1', { kind: 'yesNo', value: true });

    expect(firedIds(done.log)).toContain('OP01-062-onOwnEvent');
    expect(handSize(done, 'p1')).toBe(before + 1);
    assertSettled(done);
  });

  it('draws nothing when the controller declines, and stays spent', () => {
    // CR 10-2-13-x: declining is not activating, so a declined [Once Per Turn]
    // is not consumed — the ability was never resolved.
    const staged = withEvent(['OP01-117', 'OP01-076']);
    const afterEvent = playSheepsHorn(staged);
    const before = handSize(afterEvent, 'p1');

    const done = answer(afterEvent, 'p1', { kind: 'yesNo', value: false });

    expect(handSize(done, 'p1')).toBe(before);
    expect(firedIds(done.log)).not.toContain('OP01-062-onOwnEvent');
    assertSettled(done);
  });

  it('is silent with five or more cards in hand', () => {
    // "If you have 4 or less cards in your hand", checked before the draw — so a
    // hand of exactly 4 becomes 5, and a hand of 5 hears nothing.
    const staged = withEvent([
      'OP01-117',
      'OP01-076',
      'OP01-081',
      'OP01-066',
      'OP01-065',
      'OP01-100',
    ]);
    const done = playSheepsHorn(staged);

    expect(done.pending).toBeNull();
    expect(firedIds(done.log)).not.toContain('OP01-062-onOwnEvent');
    assertSettled(done);
  });

  it('is silent without its DON!!', () => {
    const staged = withEvent(['OP01-117', 'OP01-076'], 0);
    const done = playSheepsHorn(staged);

    expect(done.pending).toBeNull();
    expect(firedIds(done.log)).not.toContain('OP01-062-onOwnEvent');
    assertSettled(done);
  });

  it('hears a [Counter] Event as readily as a [Main] one', () => {
    // CR 8-5-2 defines card activation as "using an Event card from your hand"
    // and says nothing about the phase, so the Counter Step counts.
    const staged = op01BpScenario({
      p1: { clearHand: true, activeDon: 3, hand: ['OP01-086'], characters: [] },
      p2: { activeDon: 4, characters: [{ cardId: 'OP01-081' }] },
    });
    const withDon = applyOk(staged, {
      type: 'ATTACH_DON',
      player: 'p1',
      to: staged.players.p1.leader,
      count: 1,
    }).state;
    const passed = applyOk(withDon, { type: 'END_TURN', player: 'p1' }).state;
    const attacking = applyOk(passed, {
      type: 'DECLARE_ATTACK',
      player: 'p2',
      attacker: characterAt(passed, 'p2', 0),
      target: passed.players.p1.leader,
    }).state;
    const counterStep = applyOk(attacking, { type: 'PASS', player: 'p1' }).state;

    const played = applyOk(counterStep, {
      type: 'PLAY_COUNTER_EVENT',
      player: 'p1',
      instanceId: handCard(counterStep, 'p1', 'OP01-086'),
    }).state;
    const afterEvent = answer(played, 'p1', { kind: 'cards', selected: [] });

    expect(pendingOf(afterEvent).sink).toEqual({ kind: 'optIn' });
    const done = answer(afterEvent, 'p1', { kind: 'yesNo', value: true });
    expect(firedIds(done.log)).toContain('OP01-062-onOwnEvent');
  });

  it('does not hear the opponent activating one', () => {
    const staged = op01BpScenario({
      p1: { clearHand: true, activeDon: 6, characters: [] },
      p2: { clearHand: true, activeDon: 6, hand: ['OP01-117'], characters: [] },
    });
    const withDon = applyOk(staged, {
      type: 'ATTACH_DON',
      player: 'p1',
      to: staged.players.p1.leader,
      count: 1,
    }).state;
    const passed = applyOk(withDon, { type: 'END_TURN', player: 'p1' }).state;

    const played = applyOk(passed, {
      type: 'PLAY_CARD',
      player: 'p2',
      instanceId: handCard(passed, 'p2', 'OP01-117'),
    }).state;
    // Drain whatever the Event opens, whichever kind it is: this case is about
    // who was *not* notified, and the Event's own questions are incidental.
    let done = played;
    for (let guard = 0; guard < 8 && done.pending !== null; guard += 1) {
      const open = done.pending;
      done =
        open.kind === 'yesNo'
          ? answer(done, open.player, { kind: 'yesNo', value: true })
          : answer(done, open.player, { kind: 'cards', selected: [] });
    }

    expect(firedIds(done.log)).toContain('OP01-117-main');
    expect(firedIds(done.log)).not.toContain('OP01-062-onOwnEvent');
    assertSettled(done);
  });
});

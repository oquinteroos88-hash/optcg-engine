import { describe, expect, it } from 'vitest';
import type { GameState, PlayerId } from '../src/index.js';
import { assertInvariants } from '../src/invariants.js';
import { ABIL_DECK } from '../src/testdata/abilityDecks.js';
import { buildScenario, characterAt } from '../src/testdata/scenarios.js';
import { applyOk } from './helpers.js';

/**
 * `orientDon` — turning cost-area DON!! from one orientation to the other.
 *
 * The op works by quantity rather than by `Ref`, so what needs pinning is not
 * "did it hit the right card" but the three things a count-based op can get
 * wrong: which DON!! are candidates, how many it turns when it cannot have all
 * it asked for, and that it leaves everything else exactly where it was.
 */

const decks = { p1: ABIL_DECK, p2: ABIL_DECK };

function assertSettled(state: GameState): void {
  expect(state.pending).toBeNull();
  expect(state.stack).toEqual([]);
  expect(state.resume).toEqual([]);
  assertInvariants(state);
}

function costDon(state: GameState, player: PlayerId, orientation: 'active' | 'rested'): number {
  return state.players[player].don.filter(
    (don) => don.location.kind === 'cost' && don.location.orientation === orientation,
  ).length;
}

function attachedDon(state: GameState, player: PlayerId): number {
  return state.players[player].don.filter((don) => don.location.kind === 'attached').length;
}

/** Stages a p1 Quartermaster and activates one of its orientDon abilities. */
function activate(state: GameState, abilityId: string): GameState {
  return applyOk(state, {
    type: 'ACTIVATE_ABILITY',
    player: 'p1',
    instanceId: characterAt(state, 'p1', 0),
    abilityId,
  }).state;
}

describe('orientDon rests the opponent DON!!', () => {
  it('turns as many active DON!! as it asked for', () => {
    const staged = buildScenario({
      decks,
      p1: { activeDon: 3, characters: [{ cardId: 'ABIL-018' }] },
      p2: { activeDon: 4 },
    });
    expect(costDon(staged, 'p2', 'active')).toBe(4);

    const done = activate(staged, 'ABIL-018-restFoe');

    // Asked for 2, had 4 to take from.
    expect(costDon(done, 'p2', 'active')).toBe(2);
    expect(costDon(done, 'p2', 'rested')).toBe(2);
    // The controller's own cost area is not what this ability names.
    expect(costDon(done, 'p1', 'active')).toBe(3);
    assertSettled(done);
  });

  it('turns what there is when the opponent has fewer active DON!! than asked', () => {
    // CR 4-8-1 / 8-4-4-1: a short supply is a smaller number, not a failed
    // effect. Same rule the rested-only giveDon follows.
    const staged = buildScenario({
      decks,
      p1: { activeDon: 3, characters: [{ cardId: 'ABIL-018' }] },
      p2: { activeDon: 1, restedDon: 3 },
    });

    const done = activate(staged, 'ABIL-018-restFoe');

    expect(costDon(done, 'p2', 'active')).toBe(0);
    expect(costDon(done, 'p2', 'rested')).toBe(4);
    assertSettled(done);
  });

  it('does nothing at all against an all-rested cost area', () => {
    // Official Q&A, ST02-008: "Can I rest a DON!! card that is already rested?"
    // — "No, you cannot. You must choose up to 1 active DON!! card from your
    // opponent's cost area." With no active DON!! there is nothing to choose,
    // so this is a silent no-op like any other instruction without targets.
    const staged = buildScenario({
      decks,
      p1: { activeDon: 3, characters: [{ cardId: 'ABIL-018' }] },
      p2: { restedDon: 4 },
    });

    const done = activate(staged, 'ABIL-018-restFoe');

    expect(costDon(done, 'p2', 'rested')).toBe(4);
    expect(costDon(done, 'p2', 'active')).toBe(0);
    // A no-op emits nothing rather than an event claiming zero DON!! turned.
    expect(done.log.some((event) => event.type === 'donOrientationChanged')).toBe(false);
    assertSettled(done);
  });
});

describe('orientDon sets your own DON!! active', () => {
  it('turns rested DON!! back to active, and leaves the already-active alone', () => {
    const staged = buildScenario({
      decks,
      p1: { activeDon: 1, restedDon: 3, characters: [{ cardId: 'ABIL-018' }] },
    });

    const done = activate(staged, 'ABIL-018-refresh');

    // `count` is a budget of DON!! *changed*: the one already active is not
    // spent against it, so 2 rested turn and 1 stays rested.
    expect(costDon(done, 'p1', 'active')).toBe(3);
    expect(costDon(done, 'p1', 'rested')).toBe(1);
    assertSettled(done);
  });

  it('reports how many actually turned, not how many were asked for', () => {
    const staged = buildScenario({
      decks,
      p1: { activeDon: 2, restedDon: 1, characters: [{ cardId: 'ABIL-018' }] },
    });

    const done = activate(staged, 'ABIL-018-refresh');

    const turned = done.log.filter((event) => event.type === 'donOrientationChanged');
    expect(turned).toHaveLength(1);
    expect(turned[0]).toMatchObject({ player: 'p1', orientation: 'active', count: 1 });
    assertSettled(done);
  });
});

describe('orientDon cannot reach a given DON!!', () => {
  it('leaves attached DON!! on both sides exactly where they were', () => {
    // CR 4-4-2: "given DON!! cards are neither active nor rested." There is no
    // orientation on an attached DON!! to change, which the state models as a
    // location union with no orientation field on that side. The Q&A for
    // ST02-008 says the same thing from the card's side: a DON!! given to an
    // opponent's Character cannot be rested by that effect.
    //
    // Both sides carry attached DON!!, so one op run has to leave the
    // controller's alone as well as the opponent's.
    const staged = buildScenario({
      decks,
      p1: { activeDon: 2, restedDon: 2, characters: [{ cardId: 'ABIL-018' }] },
      p2: { activeDon: 2, restedDon: 2, characters: [{ cardId: 'ABIL-018' }] },
    });

    // ABIL-018-main gives the bearer one rested DON!!; run it on each side so
    // both cost areas have a DON!! that has left them.
    const p1Source = characterAt(staged, 'p1', 0);
    const p2Source = characterAt(staged, 'p2', 0);
    const withP1Don = applyOk(staged, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: p1Source,
      abilityId: 'ABIL-018-main',
    }).state;
    // p2's attachment is staged directly: p2 cannot activate an ability during
    // p1's turn, and whose turn it is has nothing to do with what this proves.
    const withBothDon = structuredClone(withP1Don) as GameState;
    const p2Don = withBothDon.players.p2.don.find(
      (don) => don.location.kind === 'cost' && don.location.orientation === 'rested',
    );
    if (p2Don === undefined) throw new Error('p2 has no rested DON!! to attach');
    p2Don.location = { kind: 'attached', to: p2Source };
    withBothDon.cards[p2Source]?.attachedDon.push(p2Don.instanceId);
    assertInvariants(withBothDon);

    expect(attachedDon(withBothDon, 'p1')).toBe(1);
    expect(attachedDon(withBothDon, 'p2')).toBe(1);
    const p1Attached = [...(withBothDon.cards[p1Source]?.attachedDon ?? [])];
    const p2Attached = [...(withBothDon.cards[p2Source]?.attachedDon ?? [])];

    // Rest the opponent's DON!!, then refresh your own: between them the two
    // directions touch every cost area on the board.
    const rested = applyOk(withBothDon, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: p1Source,
      abilityId: 'ABIL-018-restFoe',
    }).state;
    const done = applyOk(rested, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: p1Source,
      abilityId: 'ABIL-018-refresh',
    }).state;

    // The DON!! that were given are still given, still on the same cards, and
    // never appeared in a cost area to be counted.
    expect(attachedDon(done, 'p1')).toBe(1);
    expect(attachedDon(done, 'p2')).toBe(1);
    expect(done.cards[p1Source]?.attachedDon).toEqual(p1Attached);
    expect(done.cards[p2Source]?.attachedDon).toEqual(p2Attached);
    // And the op still did its job on the cost areas either side of them.
    expect(costDon(done, 'p2', 'active')).toBe(0);
    assertSettled(done);
  });
});

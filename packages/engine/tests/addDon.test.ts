import { describe, expect, it } from 'vitest';
import type { GameState, PlayerId } from '../src/index.js';
import { assertInvariants, checkInvariants } from '../src/invariants.js';
import { ABIL_DECK } from '../src/testdata/abilityDecks.js';
import { buildScenario, characterAt } from '../src/testdata/scenarios.js';
import { applyOk } from './helpers.js';

/**
 * `addDon`, engine side.
 *
 * The eight printed cards are two packages over and every one of them adds
 * exactly one DON!! ; what is here is the op's bounds, which no OP-01 card can
 * reach — a partial add needs a card asking for more than one, and the empty
 * DON!! deck needs a player with all ten already in play.
 */

const decks = { p1: ABIL_DECK, p2: ABIL_DECK };

function where(state: GameState, player: PlayerId) {
  const don = state.players[player].don;
  return {
    deck: don.filter((d) => d.location.kind === 'donDeck').length,
    active: don.filter((d) => d.location.kind === 'cost' && d.location.orientation === 'active')
      .length,
    rested: don.filter((d) => d.location.kind === 'cost' && d.location.orientation === 'rested')
      .length,
    attached: don.filter((d) => d.location.kind === 'attached').length,
  };
}

/** `activeDon: n` leaves `10 - n` in the DON!! deck; this puts more back. */
function withDonDeck(state: GameState, player: PlayerId, inDeck: number): GameState {
  const draft = JSON.parse(JSON.stringify(state)) as GameState;
  const don = draft.players[player].don;
  let toDeck = inDeck;
  for (const card of don) {
    card.location = toDeck > 0 ? { kind: 'donDeck' } : { kind: 'cost', orientation: 'active' };
    toDeck -= 1;
  }
  return draft;
}

function staged(cardId: string, inDeck: number): GameState {
  const base = buildScenario({
    decks,
    p1: { characters: [{ cardId }], activeDon: 10 },
    p2: { activeDon: 5 },
  });
  return withDonDeck(base, 'p1', inDeck);
}

function activate(state: GameState, abilityId: string): GameState {
  return applyOk(state, {
    type: 'ACTIVATE_ABILITY',
    player: 'p1',
    instanceId: characterAt(state, 'p1', 0),
    abilityId,
  }).state;
}

describe('adding DON!! from the DON!! deck', () => {
  it('takes the full count when the deck can cover it, in the printed orientation', () => {
    const state = staged('ABIL-030', 6);
    const before = where(state, 'p1');
    const after = where(activate(state, 'ABIL-030-main'), 'p1');

    expect(after.deck).toBe(before.deck - 2);
    expect(after.rested).toBe(before.rested + 2);
    // Nothing arrived active: the card said "rest them".
    expect(after.active).toBe(before.active);
  });

  it('adds active when the card says active', () => {
    const state = staged('ABIL-031', 6);
    const before = where(state, 'p1');
    const after = where(activate(state, 'ABIL-031-main'), 'p1');

    expect(after.deck).toBe(before.deck - 1);
    expect(after.active).toBe(before.active + 1);
    expect(after.rested).toBe(before.rested);
  });

  it('takes what there is when the DON!! deck is short of the count', () => {
    // CR 1-3-2 performs "as many of the actions as possible", and the DON!!
    // Phase reads the same way in the rules themselves: CR 6-4-2 places 1 from a
    // 1-card deck rather than nothing.
    const state = staged('ABIL-030', 1);
    const before = where(state, 'p1');
    const after = where(activate(state, 'ABIL-030-main'), 'p1');

    expect(after.deck).toBe(0);
    expect(after.rested).toBe(before.rested + 1);
  });

  it('does nothing at all on an empty DON!! deck', () => {
    // CR 6-4-3 for the phase's own version of this, and it is not a corner
    // case: a player with all ten DON!! in play *has* an empty DON!! deck, which
    // is the ordinary late-game state.
    const state = staged('ABIL-030', 0);
    const before = where(state, 'p1');
    const next = activate(state, 'ABIL-030-main');

    expect(where(next, 'p1')).toEqual(before);
    expect(next.pending).toBeNull();
    expect(next.stack).toEqual([]);
    assertInvariants(next);
  });

  it('cannot overfill the cost area, because there is no eleventh DON!! card', () => {
    // Not a cap and not a clamp. CR 5-1-2 gives each player "a 10-card DON!!
    // deck" and those ten are the whole supply, so a cost area of eleven would
    // need an eleventh card to exist. With all ten already in the cost area the
    // DON!! deck is empty by arithmetic, and the op adds nothing for that reason
    // rather than for a bound it checks.
    const full = staged('ABIL-030', 0);
    expect(where(full, 'p1').active + where(full, 'p1').rested).toBe(10);
    const after = activate(full, 'ABIL-030-main');
    expect(where(after, 'p1').active + where(after, 'p1').rested).toBe(10);
    expect(checkInvariants(after)).toEqual([]);
  });

  it('moves DON!! rather than creating them, after every step', () => {
    // The phase-0 conservation invariant, which is the one this op could
    // plausibly break: from the cost area, an op that moves and an op that
    // creates look identical.
    const state = staged('ABIL-030', 4);
    const after = activate(state, 'ABIL-030-main');
    expect(after.players.p1.don).toHaveLength(10);
    const seen = new Set(after.players.p1.don.map((don) => don.instanceId));
    expect(seen.size).toBe(10);
    expect(checkInvariants(after)).toEqual([]);
  });

  it('emits its own event and never the one that means the opposite', () => {
    // Sixteen cards in the full set watch for a DON!! *returning* to the deck.
    // None of them may wake on this.
    const state = staged('ABIL-031', 6);
    const { events } = applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: characterAt(state, 'p1', 0),
      abilityId: 'ABIL-031-main',
    });
    const added = events.find((event) => event.type === 'donAdded');
    expect(added).toBeDefined();
    expect(added?.type === 'donAdded' && added.orientation).toBe('active');
    expect(added?.type === 'donAdded' && added.count).toBe(1);
    expect(events.some((event) => event.type === 'donReturnedToDeck')).toBe(false);
    // And not the DON!! Phase's own event either: that one is a phase step.
    expect(events.some((event) => event.type === 'donGained')).toBe(false);
  });

  it('emits nothing when it adds nothing', () => {
    const state = staged('ABIL-030', 0);
    const { events } = applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: characterAt(state, 'p1', 0),
      abilityId: 'ABIL-030-main',
    });
    expect(events.some((event) => event.type === 'donAdded')).toBe(false);
  });
});

describe('a DON!! added by an effect is an ordinary DON!!', () => {
  it('pays a cost the same turn it arrived', () => {
    const state = staged('ABIL-031', 6);
    const added = activate(state, 'ABIL-031-main');
    const before = where(added, 'p1');
    expect(before.active).toBeGreaterThan(0);

    // ABIL-009's ability rests a DON!! to pay for itself; any active DON!! in
    // the cost area can be the one, added or dealt.
    const played = applyOk(added, {
      type: 'ATTACH_DON',
      player: 'p1',
      to: characterAt(added, 'p1', 0),
      count: 1,
    }).state;
    expect(where(played, 'p1').attached).toBe(1);
    expect(where(played, 'p1').active).toBe(before.active - 1);
    assertInvariants(played);
  });

  it('comes back active in the Refresh Phase like any other rested DON!!', () => {
    const state = staged('ABIL-030', 6);
    const added = activate(state, 'ABIL-030-main');
    expect(where(added, 'p1').rested).toBe(2);

    // Round the turn back: p1 ends, p2 ends, and p1's Refresh sets every rested
    // DON!! in the cost area active again (CR 6-2-4). Nothing about the two that
    // arrived by effect is different.
    let next = applyOk(added, { type: 'END_TURN', player: 'p1' }).state;
    next = applyOk(next, { type: 'END_TURN', player: 'p2' }).state;

    expect(where(next, 'p1').rested).toBe(0);
    assertInvariants(next);
  });
});

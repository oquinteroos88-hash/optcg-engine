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
  op01DoflamingoScenario,
  op01OdenScenario,
  op01Scenario,
  starterScenario,
} from './support.js';

/**
 * The ten cards that put cards on the field.
 *
 * Six of them are the whole text of their card — "[Trigger] Play this card" —
 * and were the most expensive cards in the set to reach, because the DSL had no
 * way to say the one thing they do. `moveCard` moves between zones; `ZoneRef`
 * has no `field` member; and putting a card on the field is a *routine*, not a
 * destination.
 *
 * The rules that routine owes, each with a case below:
 *
 * - **No cost is paid** (CR 3-7-3's sense of "play" against CR 6-5-3-1's).
 * - **It enters active** (CR 3-7-5) and **cannot attack this turn** (CR 3-7-4).
 * - **Its `[On Play]` fires** (official Q&A), after the script that played it.
 * - **A full board asks**, the entering card is not a candidate (CR 3-7-6-1),
 *   and the Character trashed is **not** K.O.'d (CR 3-7-6-1-1, and the Q&A in
 *   as many words).
 */

function pendingOf(state: GameState): NonNullable<GameState['pending']> {
  const pending = state.pending;
  if (pending === null) {
    throw new Error('expected a choice to be open');
  }
  return pending;
}

function cardIdOf(state: GameState, id: InstanceId): string {
  const card = state.cards[id];
  if (card === undefined) {
    throw new Error(`missing instance ${id}`);
  }
  return card.cardId;
}

function boardIds(state: GameState, player: 'p1' | 'p2'): string[] {
  return state.players[player].characters.map((id) => cardIdOf(state, id));
}

/** Damages `player`'s Leader once, so the top life card offers its [Trigger]. */
function takeOneDamage(state: GameState, attacker: 'p1' | 'p2'): GameState {
  const defender = attacker === 'p1' ? 'p2' : 'p1';
  const attacking = applyOk(state, {
    type: 'DECLARE_ATTACK',
    player: attacker,
    attacker: characterAt(state, attacker, 0),
    target: state.players[defender].leader,
  }).state;
  const past = applyOk(attacking, { type: 'PASS', player: defender }).state;
  return applyOk(past, { type: 'PASS', player: defender }).state;
}

// ---------------------------------------------------------------------------
// "[Trigger] Play this card" — the six-card shape, pinned once on each colour
// ---------------------------------------------------------------------------

describe('a [Trigger] that plays its own card', () => {
  /** p2's top life card is `cardId`; p1 has a 5000 attacker to turn it over. */
  function lifeTrigger(cardId: string): GameState {
    return op01Scenario({
      p1: { characters: [{ cardId: 'OP01-025' }], activeDon: 5 },
      p2: { lifeCards: [cardId, 'OP01-010'], characters: [] },
    });
  }

  it('puts the card onto the field instead of leaving it in hand', () => {
    const staged = lifeTrigger('OP01-009');
    const damaged = takeOneDamage(staged, 'p1');

    // The life card is offered as an opt-in, as every [Trigger] is.
    expect(pendingOf(damaged).sink).toEqual({ kind: 'optIn' });
    const accepted = answer(damaged, 'p2', { kind: 'yesNo', value: true });

    expect(boardIds(accepted, 'p2')).toEqual(['OP01-009']);
    expect(accepted.players.p2.hand.map((id) => cardIdOf(accepted, id))).not.toContain('OP01-009');
    assertSettled(accepted);
  });

  it('enters active, and cannot attack on the turn it arrived', () => {
    // CR 3-7-5 for the orientation; CR 3-7-4 for the sickness. A card put down
    // by an effect is played, so both apply exactly as they do to a hand play.
    const damaged = takeOneDamage(lifeTrigger('OP01-009'), 'p1');
    const accepted = answer(damaged, 'p2', { kind: 'yesNo', value: true });
    const arrived = characterAt(accepted, 'p2', 0);

    expect(accepted.cards[arrived]?.orientation).toBe('active');
    expect(accepted.cards[arrived]?.playedOnTurn).toBe(accepted.turn);
  });

  it('leaves the card in hand when the [Trigger] is declined', () => {
    const damaged = takeOneDamage(lifeTrigger('OP01-009'), 'p1');
    const declined = answer(damaged, 'p2', { kind: 'yesNo', value: false });

    expect(declined.players.p2.characters).toEqual([]);
    expect(declined.players.p2.hand.map((id) => cardIdOf(declined, id))).toContain('OP01-009');
    assertSettled(declined);
  });

  it('costs nothing, on a turn that is not even yours', () => {
    // The clearest reading of CR 3-7-3 against CR 6-5-3-1: this resolves in the
    // *attacker's* Damage Step, and the defender's cost area is untouched.
    const staged = op01Scenario({
      p1: { characters: [{ cardId: 'OP01-025' }], activeDon: 5 },
      p2: { lifeCards: ['OP01-009', 'OP01-010'], characters: [], activeDon: 0 },
    });
    const damaged = takeOneDamage(staged, 'p1');
    const accepted = answer(damaged, 'p2', { kind: 'yesNo', value: true });

    expect(boardIds(accepted, 'p2')).toEqual(['OP01-009']);
    expect(
      accepted.players.p2.don.filter((don) => don.location.kind === 'cost'),
    ).toHaveLength(0);
    assertSettled(accepted);
  });

  it('fires the [On Play] of the card it just put down', () => {
    // `ST02-005` Killer plays itself and then K.O.s a rested Character — an
    // effect nesting inside an effect, and the reason these two halves waited
    // for each other for four batches.
    const staged = starterScenario({
      p1: { characters: [{ cardId: 'ST01-005' }], activeDon: 5 },
      p2: {
        lifeCards: ['ST02-005', 'ST02-002'],
        characters: [{ cardId: 'ST02-002', orientation: 'rested' }],
      },
    });
    const attacker = characterAt(staged, 'p1', 0);
    const damaged = takeOneDamage(staged, 'p1');

    const accepted = answer(damaged, 'p2', { kind: 'yesNo', value: true });
    // Killer's [On Play] names the *opponent's* rested Characters, and the one
    // rested Character in reach is the attacker itself — rested to declare
    // (CR 7-1-1-1) and still there, because the battle is over by the time a
    // life card's [Trigger] resolves.
    const target = pendingOf(accepted);
    expect(target.candidates).toEqual([attacker]);
    const done = answer(accepted, 'p2', { kind: 'cards', selected: [attacker] });

    expect(boardIds(done, 'p2')).toContain('ST02-005');
    expect(done.players.p1.trash).toContain(attacker);
    // The order the two halves resolve in: the [Trigger] finishes putting the
    // card down, and only then does the [On Play] it woke get its turn.
    expect(firedIds(done.log)).toEqual(['ST02-005-trigger', 'ST02-005-onPlay']);
    assertSettled(done);
  });

  it('runs the [On Play] on the board it has just joined', () => {
    // `OP01-071` Jinbe bottom-decks a Character costing 3 or less. Played by its
    // own [Trigger], the [On Play] sees a field that already includes it — and
    // it costs 4, so it can never sink itself.
    const staged = op01BpScenario({
      p1: { characters: [{ cardId: 'OP01-081' }], activeDon: 5 },
      p2: { lifeCards: ['OP01-071', 'OP01-076'], characters: [{ cardId: 'OP01-076' }] },
    });
    const damaged = takeOneDamage(staged, 'p1');

    const accepted = answer(damaged, 'p2', { kind: 'yesNo', value: true });
    const target = pendingOf(accepted);
    // Both boards are in reach — "1 Character", not "1 of your opponent's" —
    // and Jinbe itself is not, at cost 4.
    expect(target.candidates.map((id) => cardIdOf(accepted, id)).sort()).toEqual([
      'OP01-076',
      'OP01-081',
    ]);

    const sunk = target.candidates[0] as InstanceId;
    const done = answer(accepted, 'p2', { kind: 'cards', selected: [sunk] });

    expect(boardIds(done, 'p2')).toContain('OP01-071');
    expect(done.players[done.cards[sunk]?.owner ?? 'p1'].deck.at(-1)).toBe(sunk);
    assertSettled(done);
  });
});

// ---------------------------------------------------------------------------
// A full board, which is where the instruction has to stop and ask
// ---------------------------------------------------------------------------

describe('a full board when an effect plays a card', () => {
  /** p2 has five Characters and `OP01-009` on top of Life. */
  function fullDefender(): GameState {
    return op01Scenario({
      p1: { characters: [{ cardId: 'OP01-025' }], activeDon: 5 },
      p2: {
        lifeCards: ['OP01-009', 'OP01-010'],
        characters: [
          { cardId: 'OP01-007' },
          { cardId: 'OP01-012' },
          { cardId: 'OP01-053' },
          { cardId: 'OP01-036' },
          { cardId: 'OP01-018' },
        ],
      },
    });
  }

  it('asks which Character makes room, and does not offer the arriving one', () => {
    const damaged = takeOneDamage(fullDefender(), 'p1');
    const accepted = answer(damaged, 'p2', { kind: 'yesNo', value: true });

    const pending = pendingOf(accepted);
    expect(pending.sink.kind).toBe('play');
    expect(pending.min).toBe(1);
    expect(pending.max).toBe(1);
    // CR 3-7-6-1 trashes a Character "already in" the Character area.
    expect(pending.candidates).toEqual(accepted.players.p2.characters);
    expect(accepted.players.p2.characters).toHaveLength(5);
  });

  it('does not K.O. the Character it trashes for room', () => {
    // CR 3-7-6-1-1: the trash is "processing a rule, and no effect can be
    // applied", and the Q&A says it outright — "the trashed Character is not
    // K.O.'d, but directly moved to your trash". `OP01-007` Caribou K.O.s
    // something on its own K.O., so a board that lost nothing else is the
    // witness.
    const damaged = takeOneDamage(fullDefender(), 'p1');
    const accepted = answer(damaged, 'p2', { kind: 'yesNo', value: true });
    const caribou = pendingOf(accepted).candidates.find(
      (id) => cardIdOf(accepted, id) === 'OP01-007',
    );
    if (caribou === undefined) {
      throw new Error('staging bug: no Caribou on the board');
    }

    const done = answer(accepted, 'p2', { kind: 'cards', selected: [caribou] });

    expect(done.players.p2.trash).toContain(caribou);
    expect(done.log.some((event) => event.type === 'koed')).toBe(false);
    expect(firedIds(done.log)).not.toContain('OP01-007-onKO');
    expect(boardIds(done, 'p2')).toContain('OP01-009');
    expect(done.players.p2.characters).toHaveLength(5);
    assertSettled(done);
  });

  it('round-trips a state whose open choice is a card coming onto the field', () => {
    const damaged = takeOneDamage(fullDefender(), 'p1');
    const accepted = answer(damaged, 'p2', { kind: 'yesNo', value: true });

    expect(JSON.parse(JSON.stringify(accepted))).toEqual(accepted);

    const victim = pendingOf(accepted).candidates[2] as InstanceId;
    const live = answer(accepted, 'p2', { kind: 'cards', selected: [victim] });
    const rehydrated = answer(
      JSON.parse(JSON.stringify(accepted)) as GameState,
      'p2',
      { kind: 'cards', selected: [victim] },
    );
    expect(rehydrated).toEqual(live);
  });
});

// ---------------------------------------------------------------------------
// Playing another card out of hand
// ---------------------------------------------------------------------------

describe('OP01-014 Jinbe — [On Block] play a red 2-drop from hand', () => {
  it('fires while blocking, on the opponent turn, and pays nothing', () => {
    const staged = op01Scenario({
      p1: { characters: [{ cardId: 'OP01-025' }], activeDon: 5 },
      p2: {
        clearHand: true,
        // One DON!!, and it goes onto Jinbe to meet [DON!! x1] — so the cost
        // area is empty by the time the [On Block] resolves.
        activeDon: 1,
        hand: ['OP01-010', 'OP01-018'],
        characters: [{ cardId: 'OP01-014', attachedDon: 1 }],
      },
    });
    const blocker = characterAt(staged, 'p2', 0);
    const attacking = applyOk(staged, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(staged, 'p1', 0),
      target: staged.players.p2.leader,
    }).state;

    const blocked = applyOk(attacking, { type: 'DECLARE_BLOCK', player: 'p2', blocker }).state;

    const pending = pendingOf(blocked);
    // Komachiyo is red at cost 1; Hajrudin is red at cost 4 and out of reach.
    expect(pending.candidates.map((id) => cardIdOf(blocked, id))).toEqual(['OP01-010']);

    const done = answer(blocked, 'p2', { kind: 'cards', selected: [...pending.candidates] });

    expect(boardIds(done, 'p2')).toEqual(['OP01-014', 'OP01-010']);
    // The defender's cost area is empty — its one DON!! is attached to Jinbe —
    // and a 1-cost Character still came down. That is the whole argument for
    // the no-payment reading, on a printed card.
    expect(done.players.p2.don.filter((don) => don.location.kind === 'cost')).toHaveLength(0);
  });

  it('needs its DON!! before it fires at all', () => {
    const staged = op01Scenario({
      p1: { characters: [{ cardId: 'OP01-025' }], activeDon: 5 },
      p2: { clearHand: true, hand: ['OP01-010'], characters: [{ cardId: 'OP01-014' }] },
    });
    const attacking = applyOk(staged, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(staged, 'p1', 0),
      target: staged.players.p2.leader,
    }).state;

    const blocked = applyOk(attacking, {
      type: 'DECLARE_BLOCK',
      player: 'p2',
      blocker: characterAt(staged, 'p2', 0),
    }).state;

    expect(blocked.pending).toBeNull();
    expect(boardIds(blocked, 'p2')).toEqual(['OP01-014']);
  });
});

describe('OP01-087 Officer Agents — one list, two triggers', () => {
  it('plays a {Baroque Works} 3-drop from hand as a [Counter]', () => {
    const staged = op01BpScenario({
      p1: { characters: [{ cardId: 'OP01-081' }], activeDon: 5 },
      p2: { clearHand: true, activeDon: 2, hand: ['OP01-087', 'OP01-079', 'OP01-066'] },
    });
    const event = handCard(staged, 'p2', 'OP01-087');
    const attacking = applyOk(staged, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(staged, 'p1', 0),
      target: staged.players.p2.leader,
    }).state;
    const counterStep = applyOk(attacking, { type: 'PASS', player: 'p2' }).state;

    const played = applyOk(counterStep, {
      type: 'PLAY_COUNTER_EVENT',
      player: 'p2',
      instanceId: event,
    }).state;

    const pending = pendingOf(played);
    // Ms. All Sunday is {Baroque Works} at cost 3; Krieg is neither.
    expect(pending.candidates.map((id) => cardIdOf(played, id))).toEqual(['OP01-079']);

    const done = answer(played, 'p2', { kind: 'cards', selected: [...pending.candidates] });
    expect(boardIds(done, 'p2')).toEqual(['OP01-079']);
    assertSettled(done);
  });
});

// ---------------------------------------------------------------------------
// The one that plays from the deck, rested
// ---------------------------------------------------------------------------

describe('OP01-060 Doflamingo (Leader) — reveal, then maybe play it rested', () => {
  function attackingWith(topCard: string): GameState {
    const staged = op01DoflamingoScenario({
      p1: { activeDon: 4, characters: [] },
      p2: { characters: [] },
    });
    // Put the card the effect is about on top of p1's deck, by hand: the whole
    // ability turns on what is there, so a scenario that leaves it to the
    // shuffle is a scenario that tests something else.
    const deck = staged.players.p1.deck;
    const at = deck.findIndex((id) => cardIdOf(staged, id) === topCard);
    if (at === -1) {
      throw new Error(`no ${topCard} in the Doflamingo deck`);
    }
    const moved = JSON.parse(JSON.stringify(staged)) as GameState;
    const [picked] = moved.players.p1.deck.splice(at, 1);
    moved.players.p1.deck.unshift(picked as InstanceId);
    return applyOk(moved, {
      type: 'ATTACH_DON',
      player: 'p1',
      to: moved.players.p1.leader,
      count: 2,
    }).state;
  }

  function declare(state: GameState): GameState {
    return applyOk(state, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: state.players.p1.leader,
      target: state.players.p2.leader,
    }).state;
  }

  it('offers the play when the revealed card matches, and puts it down rested', () => {
    const staged = attackingWith('OP01-078');
    const top = staged.players.p1.deck[0] as InstanceId;

    const attacked = declare(staged);
    // Auto effect with an optional cost, so the opt-in comes first (CR 8-1-2).
    const accepted = answer(attacked, 'p1', { kind: 'yesNo', value: true });
    // Then the second "you may", on the play itself.
    expect(pendingOf(accepted).kind).toBe('yesNo');
    const done = answer(accepted, 'p1', { kind: 'yesNo', value: true });

    expect(done.players.p1.characters).toEqual([top]);
    // CR 3-7-5's "unless otherwise specified", and the only printed card in the
    // repo that specifies otherwise.
    expect(done.cards[top]?.orientation).toBe('rested');
    expect(done.log.some((event) => event.type === 'cardsRevealed')).toBe(true);
  });

  it('leaves the card on top of the deck when the play is declined', () => {
    const staged = attackingWith('OP01-078');
    const top = staged.players.p1.deck[0] as InstanceId;

    const attacked = declare(staged);
    const accepted = answer(attacked, 'p1', { kind: 'yesNo', value: true });
    const done = answer(accepted, 'p1', { kind: 'yesNo', value: false });

    expect(done.players.p1.characters).toEqual([]);
    expect(done.players.p1.deck[0]).toBe(top);
  });

  it('never asks when the revealed card is the wrong type or too expensive', () => {
    // Alvida is blue at cost 2 but carries no {The Seven Warlords of the Sea}.
    const staged = attackingWith('OP01-064');
    const attacked = declare(staged);
    const accepted = answer(attacked, 'p1', { kind: 'yesNo', value: true });

    expect(accepted.pending).toBeNull();
    expect(accepted.players.p1.characters).toEqual([]);
    expect(accepted.log.some((event) => event.type === 'cardsRevealed')).toBe(true);
  });

  it('charges nothing when the whole effect is declined', () => {
    const staged = attackingWith('OP01-078');
    const restedBefore = staged.players.p1.don.filter(
      (don) => don.location.kind === 'cost' && don.location.orientation === 'rested',
    ).length;

    const declined = answer(declare(staged), 'p1', { kind: 'yesNo', value: false });

    expect(
      declined.players.p1.don.filter(
        (don) => don.location.kind === 'cost' && don.location.orientation === 'rested',
      ),
    ).toHaveLength(restedBefore);
    expect(declined.pending).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The green one, which needed its own Leader for a different reason
// ---------------------------------------------------------------------------

describe('OP01-037 Kawamatsu — the whole card is its [Trigger]', () => {
  it('plays itself out of the life area', () => {
    const staged = op01OdenScenario({
      p1: { characters: [{ cardId: 'OP01-035' }], activeDon: 5 },
      p2: { lifeCards: ['OP01-037', 'OP01-036'], characters: [] },
    });
    const damaged = takeOneDamage(staged, 'p1');
    const done = answer(damaged, 'p2', { kind: 'yesNo', value: true });

    expect(boardIds(done, 'p2')).toEqual(['OP01-037']);
    assertSettled(done);
  });
});

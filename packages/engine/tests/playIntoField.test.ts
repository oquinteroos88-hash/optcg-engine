import { describe, expect, it } from 'vitest';
import { applyAction, getPower, legalActions, REASONS } from '../src/index.js';
import type { Action, GameState, InstanceId } from '../src/index.js';
import { assertInvariants } from '../src/invariants.js';
import { assertSerializationRoundTrip } from '../src/testing/index.js';
import { ABIL_DECK } from '../src/testdata/abilityDecks.js';
import { buildScenario, characterAt } from '../src/testdata/scenarios.js';
import { applyFail, applyOk } from './helpers.js';

/**
 * The `play` instruction: a card effect putting a card on the field.
 *
 * `moveCard` could never do this and `ZoneRef` has no `field` member, which was
 * the visible half of the gap. The other half is that "play this card" is a
 * *routine*, not a destination — an `[On Play]` to fire, a summoning-sickness
 * stamp, and a 6th-Character sacrifice the player has to be asked about, in the
 * middle of a step the interpreter used to be unable to suspend in.
 *
 * Six rules were read off the Comprehensive Rules v1.2.0 before any of this was
 * written, and each has a case below.
 *
 * - **No cost is paid.** CR 6-5-3-1's "you can pay the cost and play a
 *   Character card" is the Main Phase *action*; CR 3-7-3 calls the bare placing
 *   of a card in the Character area "playing" it, with no payment anywhere near
 *   it. Behind `rules.playFromEffectPaysCost`, which is false.
 * - **It enters active** — CR 3-7-5, "when placing cards in the Character area,
 *   they should be set as active unless otherwise specified" — and **it is
 *   summoning-sick**: CR 3-7-4, "played cards cannot attack on the turn in which
 *   they are played unless otherwise specified".
 * - **Its `[On Play]` fires.** Official Q&A: "Can I play a Character card with
 *   an [On Play] effect without activating this [On Play] effect?" — "No, you
 *   must activate the [On Play] effect whenever possible."
 * - **A full board asks.** CR 3-7-6-1: reveal the card, "trash 1 of the
 *   Character cards **already in** their Character area, and then play the new
 *   Character card" — so the entering card is never a candidate to be
 *   sacrificed for itself. CR 3-7-6-1-1 makes that trash "processing a rule",
 *   which is why it is not a K.O.
 * - **From your hand**, which is the only zone the cards in this batch use.
 * - **An impossible target is a silent no-op**, like every other instruction
 *   whose target moved on.
 */

const decks = { p1: ABIL_DECK, p2: ABIL_DECK };

const SUMMON = 'ABIL-018-summon';
const SUMMON_RESTED = 'ABIL-018-summonRested';

function assertSettled(state: GameState): void {
  expect(state.pending).toBeNull();
  expect(state.stack).toEqual([]);
  expect(state.resume).toEqual([]);
  assertInvariants(state);
}

function openChoice(state: GameState): NonNullable<GameState['pending']> {
  const pending = state.pending;
  if (pending === null) {
    throw new Error('expected a choice to be open');
  }
  return pending;
}

function answerCards(state: GameState, selected: readonly InstanceId[]): GameState {
  const pending = openChoice(state);
  return applyOk(state, {
    type: 'ANSWER_CHOICE',
    player: pending.player,
    choiceId: pending.id,
    answer: { kind: 'cards', selected: [...selected] },
  }).state;
}

function cardIdOf(state: GameState, id: InstanceId): string {
  const card = state.cards[id];
  if (card === undefined) {
    throw new Error(`missing instance ${id}`);
  }
  return card.cardId;
}

function handOf(state: GameState, cardId: string): InstanceId {
  const id = state.players.p1.hand.find((instance) => cardIdOf(state, instance) === cardId);
  if (id === undefined) {
    throw new Error(`no ${cardId} in p1's hand`);
  }
  return id;
}

/** The Quartermaster on the field, plus a hand the caller controls. */
function withSummoner(hand: readonly string[], others: readonly string[] = []): GameState {
  return buildScenario({
    decks,
    p1: {
      clearHand: true,
      activeDon: 6,
      characters: [{ cardId: 'ABIL-018' }, ...others.map((cardId) => ({ cardId }))],
      hand: [...hand],
    },
  });
}

function activate(state: GameState, abilityId = SUMMON): Action {
  return {
    type: 'ACTIVATE_ABILITY',
    player: 'p1',
    instanceId: characterAt(state, 'p1', 0),
    abilityId,
  };
}

/** Runs the ability up to its own `select`, then names the card to play. */
function summon(state: GameState, cardId: string, abilityId = SUMMON): GameState {
  const started = applyOk(state, activate(state, abilityId)).state;
  return answerCards(started, [handOf(started, cardId)]);
}

describe('a card an effect plays', () => {
  it('goes onto the field, out of the hand, without paying its cost', () => {
    // ABIL-008 costs 2. The cost area is untouched: CR 6-5-3-1's payment
    // belongs to the Main Phase action, and no instruction pays.
    const staged = withSummoner(['ABIL-008']);
    const donBefore = staged.players.p1.don.filter(
      (don) => don.location.kind === 'cost' && don.location.orientation === 'active',
    ).length;
    const handBefore = staged.players.p1.hand.length;

    const done = summon(staged, 'ABIL-008');

    expect(done.players.p1.characters).toHaveLength(2);
    expect(cardIdOf(done, characterAt(done, 'p1', 1))).toBe('ABIL-008');
    expect(done.players.p1.hand).toHaveLength(handBefore - 1);
    expect(
      done.players.p1.don.filter(
        (don) => don.location.kind === 'cost' && don.location.orientation === 'active',
      ),
    ).toHaveLength(donBefore);
    expect(done.log.some((event) => event.type === 'cardPlayed')).toBe(true);
    assertSettled(done);
  });

  it('enters active, and cannot attack the turn it arrives', () => {
    // CR 3-7-5 for the orientation, CR 3-7-4 for the sickness. Both are the
    // same properties a hand-played card has, which is the point of sharing the
    // routine rather than writing a second one.
    const staged = withSummoner(['ABIL-008']);
    const done = summon(staged, 'ABIL-008');
    const arrived = characterAt(done, 'p1', 1);

    expect(done.cards[arrived]?.orientation).toBe('active');
    expect(done.cards[arrived]?.playedOnTurn).toBe(done.turn);
    expect(
      legalActions(done, 'p1').some(
        (action) => action.type === 'DECLARE_ATTACK' && action.attacker === arrived,
      ),
    ).toBe(false);
  });

  it('enters rested when the instruction says so', () => {
    const done = summon(withSummoner(['ABIL-008']), 'ABIL-008', SUMMON_RESTED);
    expect(done.cards[characterAt(done, 'p1', 1)]?.orientation).toBe('rested');
    assertSettled(done);
  });

  it('runs the [On Play] of the card it put down, after the script that played it', () => {
    // ABIL-002 draws 1 and discards 1 on entry. It fires because the Q&A says
    // it must, and it fires *after* the summoning script finishes, because a
    // trigger raised mid-resolution queues underneath the running item.
    const staged = withSummoner(['ABIL-002']);
    const done = summon(staged, 'ABIL-002');

    const ids = done.log
      .filter((event) => event.type === 'cardPlayed' || event.type === 'abilityTriggered')
      .map((event) => (event.type === 'abilityTriggered' ? event.abilityId : 'played'));
    expect(ids).toEqual([SUMMON, 'played', 'ABIL-002-onPlay']);
    expect(done.log.some((event) => event.type === 'cardDrawn')).toBe(true);
    assertSettled(done);
  });
});

describe('a full board asks which Character makes room', () => {
  /** Five Characters, the Quartermaster among them, and a body in hand. */
  function fullBoard(): GameState {
    return withSummoner(
      ['ABIL-008'],
      ['ABIL-011', 'ABIL-011', 'ABIL-003', 'ABIL-004'],
    );
  }

  it('opens the choice before anything moves', () => {
    const staged = fullBoard();
    const started = applyOk(staged, activate(staged)).state;
    const naming = answerCards(started, [handOf(started, 'ABIL-008')]);

    const pending = openChoice(naming);
    expect(pending.player).toBe('p1');
    expect(pending.min).toBe(1);
    expect(pending.max).toBe(1);
    // CR 3-7-6-1 trashes a Character "already in" the area, so the card coming
    // in is not among the candidates — it cannot be sacrificed for itself.
    expect(pending.candidates).toEqual(staged.players.p1.characters);
    expect(pending.candidates).not.toContain(handOf(started, 'ABIL-008'));
    // And nothing has happened yet: still in hand, still five on the board.
    expect(naming.players.p1.hand).toContain(handOf(started, 'ABIL-008'));
    expect(naming.players.p1.characters).toHaveLength(5);
    expect(naming.players.p1.trash).toEqual([]);
  });

  it('lets the choice decide who leaves, and the states differ', () => {
    const staged = fullBoard();
    const started = applyOk(staged, activate(staged)).state;
    const naming = answerCards(started, [handOf(started, 'ABIL-008')]);
    const [first, , third] = openChoice(naming).candidates;

    const lostFirst = answerCards(naming, [first as InstanceId]);
    const lostThird = answerCards(naming, [third as InstanceId]);

    expect(lostFirst.players.p1.characters).not.toContain(first);
    expect(lostFirst.players.p1.characters).toContain(third);
    expect(lostThird.players.p1.characters).toContain(first);
    expect(lostThird.players.p1.characters).not.toContain(third);
    expect(lostFirst.players.p1.characters).toHaveLength(5);
    assertSettled(lostFirst);
    assertSettled(lostThird);
  });

  it('does not K.O. the Character it trashes', () => {
    // CR 3-7-6-1-1: that trash is "processing a rule, and no effect can be
    // applied". ABIL-011 draws a card on K.O., so a hand that did not grow is
    // the witness — and the official Q&A says the same in as many words: "the
    // trashed Character is not K.O.'d, but directly moved to your trash".
    const staged = fullBoard();
    const started = applyOk(staged, activate(staged)).state;
    const naming = answerCards(started, [handOf(started, 'ABIL-008')]);
    const scout = openChoice(naming).candidates.find(
      (id) => cardIdOf(naming, id) === 'ABIL-011',
    );
    if (scout === undefined) {
      throw new Error('staging bug: no ABIL-011 on the board');
    }
    const handBefore = naming.players.p1.hand.length;

    const done = answerCards(naming, [scout]);

    expect(done.players.p1.trash).toContain(scout);
    expect(done.log.some((event) => event.type === 'koed')).toBe(false);
    expect(
      done.log.some((event) => event.type === 'characterTrashedForRoom'),
    ).toBe(true);
    expect(
      done.log.some(
        (event) => event.type === 'abilityTriggered' && event.abilityId === 'ABIL-011-onKO',
      ),
    ).toBe(false);
    // −1 played out of hand, and no [On K.O.] draw to put one back.
    expect(done.players.p1.hand).toHaveLength(handBefore - 1);
    assertSettled(done);
  });

  it('round-trips a state whose open choice is a card coming onto the field', () => {
    const staged = fullBoard();
    const started = applyOk(staged, activate(staged)).state;
    const naming = answerCards(started, [handOf(started, 'ABIL-008')]);
    const entering = handOf(started, 'ABIL-008');

    expect(openChoice(naming).sink).toEqual({ kind: 'play', entering, rested: false });
    assertSerializationRoundTrip(naming);
    expect(JSON.parse(JSON.stringify(naming))).toEqual(naming);
  });

  it('answers the same way after a round trip as before one', () => {
    const staged = fullBoard();
    const started = applyOk(staged, activate(staged)).state;
    const naming = answerCards(started, [handOf(started, 'ABIL-008')]);
    const victim = openChoice(naming).candidates[1] as InstanceId;

    const live = answerCards(naming, [victim]);
    const rehydrated = answerCards(JSON.parse(JSON.stringify(naming)) as GameState, [victim]);

    expect(rehydrated).toEqual(live);
    assertSettled(rehydrated);
  });

  it('leaves the other player exactly [CONCEDE] while it is open', () => {
    const staged = fullBoard();
    const started = applyOk(staged, activate(staged)).state;
    const naming = answerCards(started, [handOf(started, 'ABIL-008')]);

    expect(naming.priority).toBe('p1');
    expect(legalActions(naming, 'p2')).toEqual([{ type: 'CONCEDE', player: 'p2' }]);
    expect(legalActions(naming, 'p1').map((action) => action.type)).toEqual([
      'ANSWER_CHOICE',
      'CONCEDE',
    ]);
  });

  it('refuses a sacrifice that is not on the board', () => {
    const staged = fullBoard();
    const started = applyOk(staged, activate(staged)).state;
    const naming = answerCards(started, [handOf(started, 'ABIL-008')]);
    const pending = openChoice(naming);

    expect(
      applyFail(naming, {
        type: 'ANSWER_CHOICE',
        player: 'p1',
        choiceId: pending.id,
        // The Leader is on the field and is not a candidate: the sacrifice
        // comes from the Character area (CR 3-7-6-1), never the Leader area.
        answer: { kind: 'cards', selected: [naming.players.p1.leader] },
      }),
    ).toBe(REASONS.choiceCandidateUnknown);
    expect(
      applyFail(naming, {
        type: 'ANSWER_CHOICE',
        player: 'p1',
        choiceId: pending.id,
        answer: { kind: 'cards', selected: [] },
      }),
    ).toBe(REASONS.choiceCardinality);
  });
});

describe('a target that cannot be played is skipped, not an error', () => {
  it('does nothing when the selection is empty', () => {
    // "Up to 1" with nothing chosen. The instruction has no target and the
    // script simply continues — rule 1 of the interpreter.
    const staged = withSummoner(['ABIL-008']);
    const started = applyOk(staged, activate(staged)).state;

    const done = answerCards(started, []);

    expect(done.players.p1.characters).toHaveLength(1);
    expect(done.players.p1.hand).toHaveLength(staged.players.p1.hand.length);
    assertSettled(done);
  });

  it('is not offered a hand card that is not a Character', () => {
    // The Stage is in hand and the selector's own `category` filter excludes
    // it, which is where a card's text does the work. The instruction's guard
    // is the second line of defence, for a `Ref` that names one anyway.
    const staged = withSummoner(['ABIL-024', 'ABIL-008']);
    const started = applyOk(staged, activate(staged)).state;

    const offered = openChoice(started).candidates.map((id) => cardIdOf(started, id));
    expect(offered).toEqual(['ABIL-008']);
  });

  it('never touches the opponent, even with a board full of their cards', () => {
    const staged = buildScenario({
      decks,
      p1: { clearHand: true, activeDon: 6, characters: [{ cardId: 'ABIL-018' }] },
      p2: { characters: [{ cardId: 'ABIL-008' }] },
    });
    const started = applyOk(staged, activate(staged)).state;

    // The selector says `owner: 'you'`, so an empty hand has nothing to offer
    // and the choice never opens at all.
    expect(started.pending).toBeNull();
    expect(started.players.p2.characters).toHaveLength(1);
    assertSettled(started);
  });
});

describe('nothing is left hanging', () => {
  it('walks a full-board entry through applyAction with invariants at every step', () => {
    let state: GameState = withSummoner(
      ['ABIL-008'],
      ['ABIL-011', 'ABIL-011', 'ABIL-003', 'ABIL-004'],
    );
    const steps: Action[] = [activate(state)];

    for (const action of steps) {
      const result = applyAction(state, action);
      if (!result.ok) {
        throw new Error(`unexpected rejection: ${result.reason}`);
      }
      state = result.state;
      assertInvariants(state);
      assertSerializationRoundTrip(state);
    }

    for (const selected of [[handOf(state, 'ABIL-008')], null]) {
      const pending = openChoice(state);
      const answer =
        selected === null ? [openChoice(state).candidates[0] as InstanceId] : selected;
      const result = applyAction(state, {
        type: 'ANSWER_CHOICE',
        player: 'p1',
        choiceId: pending.id,
        answer: { kind: 'cards', selected: answer },
      });
      if (!result.ok) {
        throw new Error(`unexpected rejection: ${result.reason}`);
      }
      state = result.state;
      assertInvariants(state);
      assertSerializationRoundTrip(state);
    }

    assertSettled(state);
    expect(state.players.p1.characters).toHaveLength(5);
    expect(getPower(state, characterAt(state, 'p1', 0))).toBeGreaterThan(0);
  });
});

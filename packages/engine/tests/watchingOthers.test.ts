import { describe, expect, it } from 'vitest';
import { legalActions } from '../src/index.js';
import type { GameState, InstanceId } from '../src/index.js';
import { assertInvariants } from '../src/invariants.js';
import { ABIL_DECK } from '../src/testdata/abilityDecks.js';
import { buildScenario, characterAt, handCard } from '../src/testdata/scenarios.js';
import { applyOk } from './helpers.js';

/**
 * Abilities that watch what somebody *else* did.
 *
 * Every trigger the engine had named something the source did or had done to
 * it. Two printed markers do not fit that shape — "when your opponent activates
 * an Event" and "when your opponent's Character is K.O.'d" — and neither was a
 * DSL gap: the vocabulary was not short a word, the engine did not have the
 * event. `applyPlayCard` told the Event about itself and nothing else;
 * `leaveField` told the K.O.'d card and nothing else.
 *
 * Five rules were read off the Comprehensive Rules v1.2.0 before any of this
 * was written, and each has a case below.
 *
 * - **What counts as activating an Event.** CR 8-5-1/8-5-2: "card activation
 *   and effect activation are different… card activation refers to **using an
 *   Event card from your hand**." Both the `[Main]` and `[Counter]` routes are
 *   that; an Event's `[Trigger]` fired from the Life area is not, and the
 *   official Q&A says so outright.
 * - **When it fires.** CR 8-6-3: an effect whose timing is fulfilled by
 *   activating a card "can be activated **after the resolution of the effect of
 *   the previously activated card**".
 * - **Which K.O.s.** Every route into `leaveField(cause: 'ko')`, and none of
 *   the three that are not K.O.s — CR 3-7-6-1-1 makes the 6th-Character trash
 *   "processing a rule, and no effect can be applied".
 * - **Simultaneous timing.** CR 8-6-1: when both players' timing is fulfilled
 *   at once, the turn player resolves first. That is what
 *   `orderedFieldSources` has always given, and these cards make it observable.
 * - **The observer has to be there when it happens**, which is a consequence of
 *   firing at the site rather than at resolution.
 */

const decks = { p1: ABIL_DECK, p2: ABIL_DECK };

const OWN_EVENT = 'ABIL-013-onOwnEvent';
const ENEMY_EVENT = 'ABIL-013-onEnemyEvent';
const ENEMY_KO = 'ABIL-013-onEnemyKO';

function assertSettled(state: GameState): void {
  expect(state.pending).toBeNull();
  expect(state.stack).toEqual([]);
  expect(state.resume).toEqual([]);
  assertInvariants(state);
}

function firedIds(state: GameState): string[] {
  return state.log
    .filter((event) => event.type === 'abilityTriggered')
    .map((event) => (event.type === 'abilityTriggered' ? event.abilityId : ''));
}

function handSize(state: GameState, player: 'p1' | 'p2'): number {
  return state.players[player].hand.length;
}

describe('when an Event is activated', () => {
  /** A watcher on each side, and a `[Main]` Event in p1's hand. */
  function bothWatching(): GameState {
    return buildScenario({
      decks,
      p1: { activeDon: 6, characters: [{ cardId: 'ABIL-013' }], hand: ['ABIL-017'] },
      p2: { characters: [{ cardId: 'ABIL-013' }] },
    });
  }

  it('tells both fields, each by its own trigger', () => {
    const staged = bothWatching();
    const before = { p1: handSize(staged, 'p1'), p2: handSize(staged, 'p2') };

    const done = applyOk(staged, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: handCard(staged, 'p1', 'ABIL-017'),
    }).state;

    // p1 activated, so p1's card hears `whenActivatingEvent` and p2's hears
    // `whenOpponentActivatesEvent`. The side is in the trigger name, following
    // `whenOpponentAttacks`, so neither card can hear the wrong one.
    expect(firedIds(done)).toContain(OWN_EVENT);
    expect(firedIds(done)).toContain(ENEMY_EVENT);
    // −1 for the Event played, +1 for the watcher's draw.
    expect(handSize(done, 'p1')).toBe(before.p1);
    expect(handSize(done, 'p2')).toBe(before.p2 + 1);
    assertSettled(done);
  });

  it('fires after the Event resolves, not before', () => {
    // CR 8-6-3. `ABIL-017` bottom-decks the top three cards; if a watcher ran
    // first the deck it looked at would be a different deck. Read off the log
    // order, which is what a client renders.
    const staged = bothWatching();
    const done = applyOk(staged, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: handCard(staged, 'p1', 'ABIL-017'),
    }).state;

    const order = firedIds(done);
    expect(order[0]).toBe('ABIL-017-main');
    expect(order.slice(1).sort()).toEqual([ENEMY_EVENT, OWN_EVENT].sort());
  });

  it('fires on the [Counter] route too', () => {
    // CR 8-5-2 says "using an Event card from your hand" and says nothing about
    // the phase, so the Counter Step counts.
    const staged = buildScenario({
      decks,
      turn: 3,
      p1: { activeDon: 3, characters: [{ cardId: 'ABIL-005' }] },
      p2: { activeDon: 3, characters: [{ cardId: 'ABIL-013' }], hand: ['ABIL-016'] },
    });
    const event = handCard(staged, 'p2', 'ABIL-016');
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

    // p2 activated it, so p2's own watcher hears it.
    expect(firedIds(played)).toContain(OWN_EVENT);
    expect(firedIds(played).indexOf('ABIL-016-counter')).toBeLessThan(
      firedIds(played).indexOf(OWN_EVENT),
    );
  });

  it('says nothing when a Character or Stage is played', () => {
    // Card activation is about Event cards. Playing a Character is a different
    // Main Phase action (CR 6-5-3-1 lists them separately).
    const staged = buildScenario({
      decks,
      p1: { activeDon: 6, characters: [{ cardId: 'ABIL-013' }], hand: ['ABIL-008'] },
      p2: { characters: [{ cardId: 'ABIL-013' }] },
    });
    const done = applyOk(staged, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: handCard(staged, 'p1', 'ABIL-008'),
    }).state;

    expect(firedIds(done)).not.toContain(OWN_EVENT);
    expect(firedIds(done)).not.toContain(ENEMY_EVENT);
    assertSettled(done);
  });

  it('does not hear an Event whose [Trigger] fires out of the Life area', () => {
    // Official Q&A, in as many words: "the Event card had a [Trigger] effect so
    // I activated that Event card's [Trigger] effect instead of adding it to my
    // hand. In this case, will effects that state 'when you activate an Event'
    // be activated?" — "No, they will not." The card never came from a hand,
    // which is what CR 8-5-2 asks for.
    //
    // No ABIL Event carries a [Trigger], so this asserts the mechanism rather
    // than a card: a life card resolving its [Trigger] fires `trigger`, and the
    // Event-activation site is nowhere near it.
    const staged = buildScenario({
      decks,
      turn: 3,
      // 4000 plus two DON!! beats the 5000 Leader, which is what turns a life
      // card over at all.
      p1: { activeDon: 3, characters: [{ cardId: 'ABIL-005', attachedDon: 2 }] },
      p2: { characters: [{ cardId: 'ABIL-013' }], lifeCards: ['ABIL-021', 'ABIL-008'] },
    });
    const attacking = applyOk(staged, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(staged, 'p1', 0),
      target: staged.players.p2.leader,
    }).state;
    const blocked = applyOk(attacking, { type: 'PASS', player: 'p2' }).state;
    const damaged = applyOk(blocked, { type: 'PASS', player: 'p2' }).state;

    const pending = damaged.pending;
    if (pending === null) {
      throw new Error('expected the life [Trigger] to be offered');
    }
    const done = applyOk(damaged, {
      type: 'ANSWER_CHOICE',
      player: 'p2',
      choiceId: pending.id,
      answer: { kind: 'yesNo', value: true },
    }).state;

    expect(firedIds(done)).toContain('ABIL-021-trigger');
    expect(firedIds(done)).not.toContain(OWN_EVENT);
    expect(firedIds(done)).not.toContain(ENEMY_EVENT);
    assertSettled(done);
  });
});

describe('when a Character is K.O.d', () => {
  /** p1 watches; p2 owns the Characters that die. */
  function watchingEnemyBoard(victims: readonly string[]): GameState {
    return buildScenario({
      decks,
      p1: { activeDon: 6, characters: [{ cardId: 'ABIL-013' }], hand: ['ABIL-012'] },
      p2: { characters: victims.map((cardId) => ({ cardId })) },
    });
  }

  it('hears a K.O. from a script', () => {
    // ABIL-012's [On Play] K.O.s every opponent Character costing 2 or less.
    const staged = watchingEnemyBoard(['ABIL-008']);
    const before = handSize(staged, 'p1');

    const done = applyOk(staged, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: handCard(staged, 'p1', 'ABIL-012'),
    }).state;

    expect(firedIds(done)).toContain(ENEMY_KO);
    // −1 played, +1 drawn by the watcher.
    expect(handSize(done, 'p1')).toBe(before);
    expect(done.players.p2.characters).toEqual([]);
    assertSettled(done);
  });

  it('hears a K.O. from a battle', () => {
    const staged = buildScenario({
      decks,
      turn: 3,
      p1: { activeDon: 6, characters: [{ cardId: 'ABIL-006' }, { cardId: 'ABIL-013' }] },
      p2: { characters: [{ cardId: 'ABIL-008', orientation: 'rested' }] },
    });
    const before = handSize(staged, 'p1');

    const attacking = applyOk(staged, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(staged, 'p1', 0),
      target: characterAt(staged, 'p2', 0),
    }).state;
    const blocked = applyOk(attacking, { type: 'PASS', player: 'p2' }).state;
    const done = applyOk(blocked, { type: 'PASS', player: 'p2' }).state;

    expect(done.log.some((event) => event.type === 'koed')).toBe(true);
    expect(firedIds(done)).toContain(ENEMY_KO);
    expect(handSize(done, 'p1')).toBe(before + 1);
    assertSettled(done);
  });

  it('says nothing when a Character is trashed to make room for a sixth', () => {
    // CR 3-7-6-1-1: that trash is "processing a rule, and no effect can be
    // applied", and the official Q&A repeats it — "the trashed Character is not
    // K.O.'d, but directly moved to your trash". The engine already honoured
    // this for the K.O.'d card's own `[On K.O.]`; it has to honour it for a
    // watcher too, and firing at the one `cause === 'ko'` branch is what makes
    // that true by construction rather than by a second check.
    const staged = buildScenario({
      decks,
      p1: { activeDon: 6, characters: [{ cardId: 'ABIL-013' }] },
      p2: {
        activeDon: 6,
        hand: ['ABIL-008'],
        characters: [
          { cardId: 'ABIL-011' },
          { cardId: 'ABIL-010' },
          { cardId: 'ABIL-003' },
          { cardId: 'ABIL-004' },
          { cardId: 'ABIL-002' },
        ],
      },
    });
    const before = handSize(staged, 'p1');
    const sacrifice = characterAt(staged, 'p2', 0);

    const passed = applyOk(staged, { type: 'END_TURN', player: 'p1' }).state;
    const done = applyOk(passed, {
      type: 'PLAY_CARD',
      player: 'p2',
      instanceId: handCard(passed, 'p2', 'ABIL-008'),
      trashCharacter: sacrifice,
    }).state;

    expect(done.players.p2.trash).toContain(sacrifice);
    expect(done.log.some((event) => event.type === 'characterTrashedForRoom')).toBe(true);
    expect(done.log.some((event) => event.type === 'koed')).toBe(false);
    expect(firedIds(done)).not.toContain(ENEMY_KO);
    expect(handSize(done, 'p1')).toBe(before);
    assertSettled(done);
  });

  it('says nothing when a Stage is replaced or a cost trashes its own source', () => {
    // The other two non-K.O. exits from the field. `ABIL-019` Martyr pays
    // `trashSelf`; neither route reaches the `cause === 'ko'` branch.
    const staged = buildScenario({
      decks,
      p1: { activeDon: 6, characters: [{ cardId: 'ABIL-013' }] },
      p2: { activeDon: 6, characters: [{ cardId: 'ABIL-019' }] },
    });
    const before = handSize(staged, 'p1');
    const passed = applyOk(staged, { type: 'END_TURN', player: 'p1' }).state;

    const done = applyOk(passed, {
      type: 'ACTIVATE_ABILITY',
      player: 'p2',
      instanceId: characterAt(passed, 'p2', 0),
      abilityId: 'ABIL-019-main',
    }).state;

    expect(done.players.p2.characters).toEqual([]);
    expect(done.log.some((event) => event.type === 'koed')).toBe(false);
    expect(firedIds(done)).not.toContain(ENEMY_KO);
    expect(handSize(done, 'p1')).toBe(before);
    assertSettled(done);
  });

  it('fires once per K.O., in the order the K.O.s happen', () => {
    // Two Characters die to one script. The engine K.O.s targets one at a time,
    // so the watcher hears twice — and CR 8-6-1's "turn player first" is what
    // `orderedFieldSources` already gives simultaneous triggers. Chosen order
    // between a player's own simultaneous triggers is the documented `TODO`,
    // and these cards make it observable for the first time; this pins the
    // deterministic order rather than changing it.
    const staged = watchingEnemyBoard(['ABIL-008', 'ABIL-004']);
    const before = handSize(staged, 'p1');

    const done = applyOk(staged, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: handCard(staged, 'p1', 'ABIL-012'),
    }).state;

    expect(done.players.p2.characters).toEqual([]);
    expect(firedIds(done).filter((id) => id === ENEMY_KO)).toHaveLength(2);
    // −1 played, +2 drawn.
    expect(handSize(done, 'p1')).toBe(before + 1);
    assertSettled(done);
  });

  it('does not hear a K.O. it was not on the field for', () => {
    // The watcher has to be there when it happens: `fireTriggers` reads the
    // field at the firing site, which is CR 8-1-3-1-3's shape seen from the
    // other side — an auto effect whose card has moved on does not activate.
    const staged = buildScenario({
      decks,
      p1: { activeDon: 6, characters: [{ cardId: 'ABIL-013' }], hand: ['ABIL-012'] },
      p2: { characters: [{ cardId: 'ABIL-008' }] },
    });
    const watcher = characterAt(staged, 'p1', 0);
    // Take the watcher off the field first, by hand: this is about the firing
    // site's audience, not about any card's ability.
    const withoutWatcher = JSON.parse(JSON.stringify(staged)) as GameState;
    withoutWatcher.players.p1.characters = withoutWatcher.players.p1.characters.filter(
      (id: InstanceId) => id !== watcher,
    );
    withoutWatcher.players.p1.trash.unshift(watcher);
    // Off-field cards are normalized, and the invariant checker says so.
    const moved = withoutWatcher.cards[watcher];
    if (moved !== undefined) {
      moved.orientation = 'active';
      moved.playedOnTurn = null;
      moved.attachedDon = [];
    }

    const done = applyOk(withoutWatcher, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: handCard(withoutWatcher, 'p1', 'ABIL-012'),
    }).state;

    expect(done.players.p2.characters).toEqual([]);
    expect(firedIds(done)).not.toContain(ENEMY_KO);
    assertSettled(done);
  });

  it('keeps the vanished-participant route working when it fires mid-battle', () => {
    // A watcher drawing a card cannot itself end a battle, but the K.O. that
    // woke it can — and PR #24's route has to survive a second trigger being
    // queued at the same moment. Nico Robin's shape, in the ABIL set: the
    // attacker K.O.s the card it is attacking.
    const staged = buildScenario({
      decks,
      turn: 3,
      p1: { activeDon: 6, characters: [{ cardId: 'ABIL-006' }, { cardId: 'ABIL-013' }] },
      p2: { characters: [{ cardId: 'ABIL-008', orientation: 'rested' }] },
    });
    const target = characterAt(staged, 'p2', 0);

    const attacking = applyOk(staged, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(staged, 'p1', 0),
      target,
    }).state;
    const blocked = applyOk(attacking, { type: 'PASS', player: 'p2' }).state;
    const done = applyOk(blocked, { type: 'PASS', player: 'p2' }).state;

    expect(done.battle).toBeNull();
    expect(firedIds(done)).toContain(ENEMY_KO);
    expect(legalActions(done, 'p2')).toEqual([{ type: 'CONCEDE', player: 'p2' }]);
    assertSettled(done);
  });
});

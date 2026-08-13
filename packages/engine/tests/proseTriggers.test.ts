import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '../src/index.js';
import type { GameState, InstanceId, PlayerId } from '../src/index.js';
import { assertInvariants } from '../src/invariants.js';
import { assertSerializationRoundTrip, decide } from '../src/testing/index.js';
import { ABIL_DECK } from '../src/testdata/abilityDecks.js';
import { buildScenario, characterAt, handCard } from '../src/testdata/scenarios.js';
import { applyOk, cloneWith } from './helpers.js';

/**
 * The five prose trigger families.
 *
 * None of them is printed with a bracket tag, which is the only reason they
 * survived every sweep this project ran: `docs/trigger-reachability.md` found
 * them by clustering prose `when …` clauses across all 2665 cards, and four of
 * the five are larger than either family PR #30 built.
 *
 * | Family | Full set | Shape |
 * | --- | --- | --- |
 * | "a DON!! card on your field is returned to your DON!! deck" | 16 | new trigger |
 * | "when this Character becomes rested" | 8 | new trigger |
 * | "K.O.'d **by your opponent's effect**" | 6 | *not* a trigger — a question for `onKO` |
 * | "when your opponent activates [Blocker]" | 4 | new trigger |
 * | "when your opponent plays a Character" | 2 | new trigger |
 *
 * **No card in OP-01 or in either starter deck prints any of them**, which was
 * checked row by row before any of this was written and is the reason this file
 * is the whole visible surface of the change: the ABIL set is where these
 * behave, and a real deck cannot yet reach them. That is a fact about the
 * sample, not about the mechanism — the same fact PR #11 recorded when a
 * 140-card DON!! family turned out to be invisible to a 34-card inventory.
 *
 * Five rules were read off the Comprehensive Rules v1.2.0 before the code, and
 * each one has cases here:
 *
 * - **Which routes rest a card.** The trigger is printed with no cause on any of
 *   the eight cards, so it answers to all of them: an attack (CR 7-1-1-1), a
 *   `[Blocker]` activation (CR 10-1-4-1), a `restSelf` cost, and a `rest`
 *   instruction. The Refresh Phase sets cards **active** (CR 6-2-4) and is the
 *   inverse movement, so it can never fire this.
 * - **What caused a K.O.** CR 10-2-1-3 puts "K.O.'d by an effect" and "due to
 *   the result of a battle" on the two sides of an `or`, so a battle is nobody's
 *   effect and the six cards reading "by your opponent's effect" stay asleep for
 *   one. CR 8-1-1 makes an effect belong to the player who activated it.
 * - **What "activates [Blocker]" is.** CR 10-1-4-1 defines the keyword as
 *   activated "by resting this card during the Block Step" and CR 7-1-2-1 lets
 *   the defender do it "only once during that battle" — the declaration, not CR
 *   7-1-2-2's retargeting that follows. The same act `canActivateBlocker`
 *   forbids, which is what makes PR #31 and this answer the same question.
 * - **What "plays a Character" is.** CR 3-7-3 calls the bare placing of a card
 *   in the Character area "playing" it, so both routes into `enterCharacterArea`
 *   count. CR 3-7-6-1-1 makes the 6th-Character trash "processing a rule", so
 *   that half of the same act is not a play in either direction.
 * - **Order.** CR 8-6-1 for simultaneous timings and CR 8-6-3 for firing after
 *   the current effect resolves — one door, `fireSidedTriggers`, for all four
 *   sided facts.
 */

const decks = { p1: ABIL_DECK, p2: ABIL_DECK };

const DON_RETURNED = 'ABIL-013-onDonReturned';
const BECAME_RESTED = 'ABIL-013-onRested';
const ENEMY_BLOCKER = 'ABIL-013-onEnemyBlocker';
const ENEMY_PLAY = 'ABIL-013-onEnemyPlay';
const WHEN_ATTACKING = 'ABIL-013-whenAttacking';
const REST_SELF = 'ABIL-013-restSelf';
const PLAIN_KO = 'ABIL-011-onKO';
const ENEMY_EFFECT_KO = 'ABIL-011-onKOByEnemyEffect';

function firedIds(state: GameState): string[] {
  return state.log
    .filter((event) => event.type === 'abilityTriggered')
    .map((event) => (event.type === 'abilityTriggered' ? event.abilityId : ''));
}

function firedCount(state: GameState, abilityId: string): number {
  return firedIds(state).filter((id) => id === abilityId).length;
}

function handSize(state: GameState, player: PlayerId): number {
  return state.players[player].hand.length;
}

function assertSettled(state: GameState): void {
  expect(state.pending).toBeNull();
  expect(state.stack).toEqual([]);
  expect(state.resume).toEqual([]);
  assertInvariants(state);
  assertSerializationRoundTrip(state);
}

/** Answers whatever `pending` is asking with the given card ids. */
function answerCards(state: GameState, ...cards: InstanceId[]): GameState {
  const pending = state.pending;
  if (pending === null) {
    throw new Error('expected an open choice');
  }
  return applyOk(state, {
    type: 'ANSWER_CHOICE',
    player: pending.player,
    choiceId: pending.id,
    answer: { kind: 'cards', selected: cards },
  }).state;
}

// ---------------------------------------------------------------------------
// Family 1 — "when a DON!! card on your field is returned to your DON!! deck"
// ---------------------------------------------------------------------------

describe('a DON!! card returned to the DON!! deck', () => {
  it('wakes the watcher on the field of the player whose DON!! it was', () => {
    // `ABIL-010` Tactician pays `returnDon 1`. That cost is the **only** place
    // in the engine where a DON!! card's location becomes `donDeck`, which is
    // why sixteen printed cards can be served from one firing site — and why
    // this family needed no routine extracted the way "becomes rested" did.
    const staged = buildScenario({
      decks,
      p1: {
        activeDon: 4,
        characters: [{ cardId: 'ABIL-010' }, { cardId: 'ABIL-013' }],
      },
      p2: { characters: [{ cardId: 'ABIL-005' }] },
    });
    const tactician = characterAt(staged, 'p1', 0);
    const foe = characterAt(staged, 'p2', 0);
    const before = handSize(staged, 'p1');

    const asked = applyOk(staged, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: tactician,
      abilityId: 'ABIL-010-main',
    }).state;
    const done = answerCards(asked, foe);

    expect(firedIds(done)).toContain(DON_RETURNED);
    expect(handSize(done, 'p1')).toBe(before + 1);
    assertSettled(done);
  });

  it('tells only that player: the opponent has no DON!! returned to hear about', () => {
    // A DON!! belongs to one player and goes back to that player's deck, so
    // "a DON!! card on **your** field is returned to **your** DON!! deck" has
    // exactly one audience. There is no second side to this fact and no
    // opponent-facing trigger for it.
    const staged = buildScenario({
      decks,
      p1: { activeDon: 4, characters: [{ cardId: 'ABIL-010' }] },
      p2: { characters: [{ cardId: 'ABIL-013' }, { cardId: 'ABIL-005' }] },
    });
    const tactician = characterAt(staged, 'p1', 0);
    const foe = characterAt(staged, 'p2', 1);
    const before = handSize(staged, 'p2');

    const asked = applyOk(staged, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: tactician,
      abilityId: 'ABIL-010-main',
    }).state;
    const done = answerCards(asked, foe);

    expect(firedIds(done)).not.toContain(DON_RETURNED);
    expect(handSize(done, 'p2')).toBe(before);
    assertSettled(done);
  });

  it('is not woken by adding DON!!, which is the inverse movement', () => {
    // The guarantee PR #33 wrote from the far side, now checkable from this
    // one: `addDon` emits `donAdded` and never `donReturnedToDeck`, so the
    // observer cannot wake on a card that *added* DON!! `addDon.test.ts` pins
    // the event; this pins the trigger.
    const staged = buildScenario({
      decks,
      p1: { activeDon: 4, characters: [{ cardId: 'ABIL-030' }, { cardId: 'ABIL-013' }] },
    });
    const ledger = characterAt(staged, 'p1', 0);
    const before = handSize(staged, 'p1');

    const done = applyOk(staged, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: ledger,
      abilityId: 'ABIL-030-main',
    }).state;

    expect(done.log.some((event) => event.type === 'donAdded')).toBe(true);
    expect(done.log.some((event) => event.type === 'donReturnedToDeck')).toBe(false);
    expect(firedIds(done)).not.toContain(DON_RETURNED);
    expect(handSize(done, 'p1')).toBe(before);
    assertSettled(done);
  });
});

// ---------------------------------------------------------------------------
// Family 2 — "when this Character becomes rested"
// ---------------------------------------------------------------------------

describe('a Character becoming rested', () => {
  it('fires when the card rests to attack (CR 7-1-1-1)', () => {
    const staged = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-013' }] },
    });
    const watcher = characterAt(staged, 'p1', 0);
    const before = handSize(staged, 'p1');

    const done = applyOk(staged, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: watcher,
      target: staged.players.p2.leader,
    }).state;

    expect(firedIds(done)).toContain(BECAME_RESTED);
    expect(handSize(done, 'p1')).toBe(before + 1);
    expect(done.cards[watcher]?.orientation).toBe('rested');
  });

  it('fires when the card rests to block (CR 10-1-4-1)', () => {
    // `ABIL-004` Shield Caller grants `[Blocker]` to its controller's cost-2
    // Characters, and `ABIL-013` is one — so the same card that watches for the
    // rest is the card that can be made to block.
    const staged = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-005' }] },
      p2: { characters: [{ cardId: 'ABIL-004' }, { cardId: 'ABIL-013' }] },
    });
    const attacker = characterAt(staged, 'p1', 0);
    const blocker = characterAt(staged, 'p2', 1);
    const before = handSize(staged, 'p2');

    const attacked = applyOk(staged, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker,
      target: staged.players.p2.leader,
    }).state;
    const done = applyOk(attacked, {
      type: 'DECLARE_BLOCK',
      player: 'p2',
      blocker,
    }).state;

    expect(firedIds(done)).toContain(BECAME_RESTED);
    expect(handSize(done, 'p2')).toBe(before + 1);
  });

  it('fires when the card rests to pay for its own ability (CR 8-4-1-3)', () => {
    const staged = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-013' }] },
    });
    const watcher = characterAt(staged, 'p1', 0);
    const before = handSize(staged, 'p1');

    const done = applyOk(staged, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: watcher,
      abilityId: REST_SELF,
    }).state;

    expect(firedIds(done)).toContain(BECAME_RESTED);
    expect(handSize(done, 'p1')).toBe(before + 1);
    assertSettled(done);
  });

  it('fires when an opponent instruction rests it', () => {
    // `ABIL-010`'s script rests an opponent Character. The fourth route, and the
    // one that proves the trigger is not about *who* rested the card — the
    // printed text names no cause, so neither does the firing site.
    const staged = buildScenario({
      decks,
      p1: { activeDon: 4, characters: [{ cardId: 'ABIL-010' }] },
      p2: { characters: [{ cardId: 'ABIL-013' }] },
    });
    const tactician = characterAt(staged, 'p1', 0);
    const watcher = characterAt(staged, 'p2', 0);
    const before = handSize(staged, 'p2');

    const asked = applyOk(staged, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: tactician,
      abilityId: 'ABIL-010-main',
    }).state;
    const done = answerCards(asked, watcher);

    expect(firedIds(done)).toContain(BECAME_RESTED);
    expect(handSize(done, 'p2')).toBe(before + 1);
    assertSettled(done);
  });

  it('does NOT fire in the Refresh Phase, which sets cards active (CR 6-2-4)', () => {
    // The clearest confirmation that this is a transition with a direction. The
    // Refresh Phase touches every rested card the player owns and moves all of
    // them the *other* way; a trigger that fired there would be a trigger
    // reading "becomes active".
    const staged = buildScenario({
      decks,
      turn: 3,
      p1: { characters: [{ cardId: 'ABIL-013', orientation: 'rested' }] },
      p2: { characters: [{ cardId: 'ABIL-005' }] },
    });
    const watcher = characterAt(staged, 'p1', 0);

    const passed = applyOk(staged, { type: 'END_TURN', player: 'p1' }).state;
    const back = applyOk(passed, { type: 'END_TURN', player: 'p2' }).state;

    expect(back.cards[watcher]?.orientation).toBe('active');
    expect(firedIds(back)).not.toContain(BECAME_RESTED);
    assertSettled(back);
  });

  it('does NOT fire when there is no transition to make', () => {
    // "Becomes" is a change of state and a rested card has none to make. The
    // `rest` instruction's own early return was there before this trigger
    // existed; it is now the trigger's definition rather than a tidy-up.
    //
    // Staged from the far end, because the engine will not even offer the case:
    // `ABIL-010`'s selector reads `orientation: 'active'`, so an all-rested
    // opponent board is nothing to choose from and nothing is rested. What this
    // pins is that a turn with no transition in it produces no
    // `orientationChanged` for the watcher and no wake — the two halves of
    // "nothing happened", asserted rather than assumed.
    const staged = buildScenario({
      decks,
      p1: { activeDon: 4, characters: [{ cardId: 'ABIL-010' }] },
      p2: { characters: [{ cardId: 'ABIL-013', orientation: 'rested' }] },
    });
    const tactician = characterAt(staged, 'p1', 0);
    const before = handSize(staged, 'p2');

    const result = applyOk(staged, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: tactician,
      abilityId: 'ABIL-010-main',
    }).state;

    // The selector asks for an *active* opponent Character and the only one on
    // the board is already rested, so nothing is offered and nothing is rested.
    const watcher = characterAt(staged, 'p2', 0);
    const done = result.pending === null ? result : answerCards(result);
    expect(done.cards[watcher]?.orientation).toBe('rested');
    expect(
      done.log.some(
        (event) => event.type === 'orientationChanged' && event.instanceId === watcher,
      ),
    ).toBe(false);
    expect(firedIds(done)).not.toContain(BECAME_RESTED);
    expect(handSize(done, 'p2')).toBe(before);
    assertSettled(done);
  });

  it('does NOT fire for a Character placed rested, under the default reading', () => {
    // `rules.placedRestedBecomesRested` is false: CR 3-7-5 words this as
    // **placing** a card, and a card arriving rested was never active on the
    // field to change from. The flag exists because the other reading is
    // arguable; this pins which one ships.
    expect(buildScenario({ decks }).rules.placedRestedBecomesRested).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Family 3 — "K.O.'d by your opponent's effect" (a question, not a trigger)
// ---------------------------------------------------------------------------

describe("an [On K.O.] that asks who caused the K.O.", () => {
  it("wakes for the opponent's effect, alongside the unguarded [On K.O.]", () => {
    // `ABIL-012` Purge is p1's script and it K.O.s p2's cost-2 Characters, so
    // from the scout's side this is the opponent's effect. Both abilities on the
    // card fire — which is the shape of the family: it is `onKO` with a
    // question, never a second trigger with a second firing site.
    const staged = buildScenario({
      decks,
      p1: { activeDon: 4, clearHand: true, hand: ['ABIL-012'] },
      p2: { characters: [{ cardId: 'ABIL-011' }] },
    });
    const purge = handCard(staged, 'p1', 'ABIL-012');
    const before = handSize(staged, 'p2');

    const done = applyOk(staged, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: purge,
    }).state;

    expect(firedCount(done, PLAIN_KO)).toBe(1);
    expect(firedCount(done, ENEMY_EFFECT_KO)).toBe(1);
    expect(handSize(done, 'p2')).toBe(before + 2);
    assertSettled(done);
  });

  it('stays asleep for a K.O. in battle, which is nobody’s effect (CR 10-2-1-3)', () => {
    // The Damage Step is the whole reason the cause has three answers and not
    // two. A card that fired here would be a card firing on every trade, which
    // is not what "by your opponent's effect" says.
    const staged = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-007' }] }, // 6000 power
      p2: { characters: [{ cardId: 'ABIL-011', orientation: 'rested' }] }, // 2000
    });
    const attacker = characterAt(staged, 'p1', 0);
    const scout = characterAt(staged, 'p2', 0);
    const before = handSize(staged, 'p2');

    const attacked = applyOk(staged, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker,
      target: scout,
    }).state;
    let done = applyOk(attacked, { type: 'PASS', player: 'p2' }).state;
    while (done.battle !== null) {
      done = applyOk(done, { type: 'PASS', player: done.priority }).state;
    }

    expect(done.log.some((event) => event.type === 'koed')).toBe(true);
    expect(firedCount(done, PLAIN_KO)).toBe(1);
    expect(firedCount(done, ENEMY_EFFECT_KO)).toBe(0);
    expect(handSize(done, 'p2')).toBe(before + 1);
    assertSettled(done);
  });

  it("stays asleep when the K.O. came from the card's own controller", () => {
    // The third of the three answers, and the one that makes `by: 'opponent'`
    // a *relative* reading rather than a synonym for "by an effect". CR 8-1-1
    // reads an effect as belonging to the player who activated it, so a player
    // K.O.ing their own Character with their own script wakes the unguarded
    // half only. `ABIL-011-selfKo` exists for exactly this case.
    const staged = buildScenario({
      decks,
      // Three attached DON!!, because the instrument is gated on them — see
      // `ABIL-011-selfKo`, whose condition exists to stop it distorting the
      // random-play population the last case in this file measures.
      p1: { activeDon: 3, characters: [{ cardId: 'ABIL-011', attachedDon: 3 }] },
    });
    const scout = characterAt(staged, 'p1', 0);
    const before = handSize(staged, 'p1');

    const done = applyOk(staged, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: scout,
      abilityId: 'ABIL-011-selfKo',
    }).state;

    expect(done.players.p1.trash).toContain(scout);
    expect(firedCount(done, PLAIN_KO)).toBe(1);
    expect(firedCount(done, ENEMY_EFFECT_KO)).toBe(0);
    expect(handSize(done, 'p1')).toBe(before + 1);
    assertSettled(done);
  });
});

// ---------------------------------------------------------------------------
// Family 4 — "when your opponent activates [Blocker]"
// ---------------------------------------------------------------------------

describe('the opponent activating [Blocker]', () => {
  it("wakes the attacker's field on the declaration", () => {
    const staged = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-005' }, { cardId: 'ABIL-013' }] },
      p2: { characters: [{ cardId: 'ABIL-008' }] },
    });
    const attacker = characterAt(staged, 'p1', 0);
    const wall = characterAt(staged, 'p2', 0);
    const before = handSize(staged, 'p1');

    const attacked = applyOk(staged, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker,
      target: staged.players.p2.leader,
    }).state;
    const done = applyOk(attacked, { type: 'DECLARE_BLOCK', player: 'p2', blocker: wall }).state;

    expect(done.log.some((event) => event.type === 'blockDeclared')).toBe(true);
    expect(firedIds(done)).toContain(ENEMY_BLOCKER);
    expect(handSize(done, 'p1')).toBe(before + 1);
  });

  it('never wakes when the block was forbidden, which is the same act (PR #31)', () => {
    // The consistency case. `canActivateBlocker` refuses the declaration, and
    // this trigger observes the declaration — so a prohibition that stopped a
    // block must also have stopped everything watching for it. Two answers to
    // one CR 10-1-4-1 question, checked in the same position.
    const staged = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-005' }, { cardId: 'ABIL-013' }] },
      p2: { characters: [{ cardId: 'ABIL-008' }] },
    });
    const attacker = characterAt(staged, 'p1', 0);
    const wall = characterAt(staged, 'p2', 0);
    const before = handSize(staged, 'p1');

    const forbidden = cloneWith(staged, (draft) => {
      draft.legality.push({
        id: 'rule-test-blocker',
        source: draft.players.p1.leader,
        effect: 'forbid',
        subject: { player: 'p2' },
        clause: { question: 'activateBlocker' },
        duration: 'endOfTurn',
      });
    });
    const attacked = applyOk(forbidden, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker,
      target: forbidden.players.p2.leader,
    }).state;

    const refused = applyOk(attacked, { type: 'PASS', player: 'p2' }).state;
    expect(refused.log.some((event) => event.type === 'blockDeclared')).toBe(false);
    expect(firedIds(refused)).not.toContain(ENEMY_BLOCKER);
    expect(handSize(refused, 'p1')).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Family 5 — "when your opponent plays a Character"
// ---------------------------------------------------------------------------

describe('the opponent playing a Character', () => {
  it('wakes on the paid Main Phase action (CR 6-5-3-1)', () => {
    const staged = buildScenario({
      decks,
      p1: { activeDon: 4, clearHand: true, hand: ['ABIL-005'] },
      p2: { characters: [{ cardId: 'ABIL-013' }] },
    });
    const rusher = handCard(staged, 'p1', 'ABIL-005');
    const before = handSize(staged, 'p2');

    const done = applyOk(staged, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: rusher,
    }).state;

    expect(firedIds(done)).toContain(ENEMY_PLAY);
    expect(handSize(done, 'p2')).toBe(before + 1);
    assertSettled(done);
  });

  it('wakes on a Character an effect put down, under the default reading (CR 3-7-3)', () => {
    // `ABIL-018` Quartermaster's `[Trigger]`-shaped play and `ABIL-020`'s script
    // both reach `enterCharacterArea` without paying. The routes are told apart
    // by `route`, and `effectPlayIsPlayingACharacter` decides whether that
    // difference reaches the trigger — it is true, so it does not.
    expect(buildScenario({ decks }).rules.effectPlayIsPlayingACharacter).toBe(true);

    const staged = buildScenario({
      decks,
      p1: { activeDon: 6, clearHand: true, hand: ['ABIL-022'] },
      p2: { characters: [{ cardId: 'ABIL-013' }] },
    });
    const before = handSize(staged, 'p2');
    const bulwark = handCard(staged, 'p1', 'ABIL-022');
    const done = applyOk(staged, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: bulwark,
    }).state;

    // One play, one wake — the card `PLAY_CARD` put down. Whether the *effect*
    // route also wakes it is the flag's question and is asserted above; the
    // paid route is a play under both readings.
    expect(firedCount(done, ENEMY_PLAY)).toBe(1);
    expect(handSize(done, 'p2')).toBe(before + 1);
  });

  it('does not wake for a Stage or an Event, which are not Characters', () => {
    const staged = buildScenario({
      decks,
      p1: { activeDon: 6, clearHand: true, hand: ['ABIL-024'] },
      p2: { characters: [{ cardId: 'ABIL-013' }] },
    });
    const stage = handCard(staged, 'p1', 'ABIL-024');
    const before = handSize(staged, 'p2');

    const done = applyOk(staged, { type: 'PLAY_CARD', player: 'p1', instanceId: stage }).state;

    expect(done.players.p1.stage).toBe(stage);
    expect(firedIds(done)).not.toContain(ENEMY_PLAY);
    expect(handSize(done, 'p2')).toBe(before);
    assertSettled(done);
  });
});

// ---------------------------------------------------------------------------
// Order, suspension and serialization
// ---------------------------------------------------------------------------

describe('the order observers resolve in', () => {
  it('rests before it declares: CR 7-1-1-1 then CR 7-1-1-3, on one card', () => {
    // `ABIL-013` carries both `whenBecomingRested` and `whenAttacking`, and one
    // attack fulfils both timings. CR 7-1-1-1 rests the attacker *and* declares;
    // CR 7-1-1-3 activates [When Attacking] after. `enqueue` resolves in call
    // order, so the rest's observer comes first — a rule with a witness rather
    // than a comment.
    const staged = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-013' }] },
    });
    const watcher = characterAt(staged, 'p1', 0);

    const done = applyOk(staged, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: watcher,
      target: staged.players.p2.leader,
    }).state;

    const order = firedIds(done);
    expect(order.indexOf(BECAME_RESTED)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(WHEN_ATTACKING)).toBeGreaterThan(order.indexOf(BECAME_RESTED));
  });

  it("puts the blocker's own [On Block] ahead of the attacker's watcher", () => {
    // The one door, seen from the [Blocker] side: the side the fact happened to
    // goes first and the other field's watchers underneath. `ABIL-013` on p2
    // blocks (it is cost 2 and `ABIL-004` grants it the keyword) and wakes its
    // own "becomes rested"; p1's `ABIL-013` hears the activation.
    const staged = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-005' }, { cardId: 'ABIL-013' }] },
      p2: { characters: [{ cardId: 'ABIL-004' }, { cardId: 'ABIL-013' }] },
    });
    const attacker = characterAt(staged, 'p1', 0);
    const blocker = characterAt(staged, 'p2', 1);

    const attacked = applyOk(staged, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker,
      target: staged.players.p2.leader,
    }).state;
    const done = applyOk(attacked, { type: 'DECLARE_BLOCK', player: 'p2', blocker }).state;

    const order = firedIds(done);
    // The rest is part of the activation (CR 10-1-4-1) and precedes everything
    // the activation notifies.
    expect(order.indexOf(BECAME_RESTED)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(ENEMY_BLOCKER)).toBeGreaterThan(order.indexOf(BECAME_RESTED));
  });

  it('survives a JSON round trip with an observer queued and priority suspended', () => {
    // An observer is an ordinary stack item, so the guarantee is the one every
    // other effect already had — but it is worth pinning here, because these
    // five fire from places nothing used to fire from: a cost being paid, an
    // orientation changing, a block being declared.
    const staged = buildScenario({
      decks,
      p1: { activeDon: 4, characters: [{ cardId: 'ABIL-010' }, { cardId: 'ABIL-013' }] },
      p2: { characters: [{ cardId: 'ABIL-005' }] },
    });
    const tactician = characterAt(staged, 'p1', 0);

    const asked = applyOk(staged, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: tactician,
      abilityId: 'ABIL-010-main',
    }).state;

    // Paused mid-effect: the cost has been paid, the observer is on the stack
    // underneath the paying ability, and the state is waiting for an answer.
    expect(asked.pending).not.toBeNull();
    expect(asked.stack.length).toBeGreaterThan(1);
    expect(asked.stack.some((item) => item.abilityId === DON_RETURNED)).toBe(true);
    assertSerializationRoundTrip(asked);
    assertInvariants(asked);

    const revived = JSON.parse(JSON.stringify(asked)) as GameState;
    expect(revived).toEqual(asked);

    const done = answerCards(asked, characterAt(asked, 'p2', 0));
    expect(firedIds(done)).toContain(DON_RETURNED);
    assertSettled(done);
  });
});

// ---------------------------------------------------------------------------
// Manifestation in games nobody staged
// ---------------------------------------------------------------------------

/**
 * The cases above build every position by hand, which proves each script is
 * right and proves nothing about whether a game ever reaches it. `counterEvent`
 * is the standing reminder: a trigger can be expressible, wired, and
 * unreachable, and only playing finds out.
 *
 * So the same question is asked of random play. The assertion is an **exact
 * set**: a family that silently stops firing fails here, and so does one that
 * starts firing without being listed.
 */
const OBSERVED_IN_RANDOM_PLAY = [
  BECAME_RESTED,
  DON_RETURNED,
  ENEMY_BLOCKER,
  ENEMY_PLAY,
  ENEMY_EFFECT_KO,
] as const;

/**
 * Nothing. All five families are reached by bots that know no rules.
 *
 * That is not luck and it is worth naming why, because the two rarest almost
 * were. Over 2000 marked games `trigger.opponentActivatesBlocker` fired 165
 * times against `trigger.becameRested`'s 5658, and the ratio is the rule rather
 * than the deck: a `[Blocker]` activation needs an attack, a defender holding
 * the keyword, and the defender *choosing* to spend it — three coincidences,
 * against one for a card that rests itself by attacking.
 *
 * `play.restedCountsAsBecoming` is the one mark this change added that no game
 * reaches, and it is dead **by decision, not by luck**:
 * `rules.placedRestedBecomesRested` is false, so a Character placed rested
 * never counts as having become rested and the branch behind the flag is
 * unreachable while the default stands. A mark that would go live the moment
 * somebody flips the flag is the cheapest possible witness that the flag is
 * doing something.
 */
const UNOBSERVED_IN_RANDOM_PLAY: readonly string[] = [];

describe('the five families in games nobody staged', () => {
  // 200 games, well past the rarest family: over 300 the `[Blocker]` watcher
  // fired 11 times against the rested watcher's 235, and 200 keeps a margin on
  // the smaller number without paying for a margin on the larger.
  it('every one of them is reached by random play', { timeout: 60_000 }, () => {
    const fired = new Set<string>();
    for (let seed = 1; seed <= 200; seed += 1) {
      let state: GameState = createGame({ seed, decks, firstPlayer: 'p1' });
      let decision = 0;
      let actions = 0;
      while (state.status !== 'finished' && actions < 1500) {
        const player = state.priority;
        const action = decide(state, player, seed, decision);
        decision += 1;
        if (action === undefined) {
          break;
        }
        const result = applyAction(state, action);
        if (!result.ok) {
          throw new Error(`seed ${seed}: ${result.reason} for ${JSON.stringify(action)}`);
        }
        state = result.state;
        actions += 1;
      }
      for (const id of firedIds(state)) {
        fired.add(id);
      }
    }

    const seen = OBSERVED_IN_RANDOM_PLAY.filter((id) => fired.has(id));
    expect([...seen].sort()).toEqual([...OBSERVED_IN_RANDOM_PLAY].sort());
    for (const id of UNOBSERVED_IN_RANDOM_PLAY) {
      expect(fired.has(id)).toBe(false);
    }
  });
});

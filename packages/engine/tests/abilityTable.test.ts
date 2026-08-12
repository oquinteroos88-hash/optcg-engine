import { describe, expect, it } from 'vitest';
import { getPower, hasKeyword, legalActions } from '../src/index.js';
import type { GameState, InstanceId } from '../src/index.js';
import { assertInvariants } from '../src/invariants.js';
import { ABIL_DECK } from '../src/testdata/abilityDecks.js';
import { buildScenario, characterAt } from '../src/testdata/scenarios.js';
import { applyOk } from './helpers.js';

/**
 * Acceptance test 6: one case per ABIL card.
 *
 * Every case builds its position directly, applies a fixed action sequence, and
 * asserts the exact resulting values — fixed seed, no mocks, no randomness
 * beyond the deterministic shuffle the scenario builder already pins.
 *
 * The assertions name the values the ability is responsible for rather than
 * comparing a whole serialized state. A full-state golden would be strictly
 * equal and strictly useless: it would break on every unrelated change and tell
 * you nothing about which rule moved. Each case additionally asserts the
 * interpreter came to a complete stop, which is where a half-resolved effect
 * would show up.
 */

const decks = { p1: ABIL_DECK, p2: ABIL_DECK };

/** Nothing is left half-resolved and the state is still sound. */
function assertSettled(state: GameState): void {
  expect(state.pending).toBeNull();
  expect(state.stack).toEqual([]);
  expect(state.resume).toEqual([]);
  assertInvariants(state);
}

function lastInHand(state: GameState, player: 'p1' | 'p2'): InstanceId {
  const id = state.players[player].hand.at(-1);
  if (id === undefined) {
    throw new Error(`${player} has an empty hand`);
  }
  return id;
}

function answer(
  state: GameState,
  player: 'p1' | 'p2',
  payload: { kind: 'cards'; selected: InstanceId[] } | { kind: 'yesNo'; value: boolean },
): GameState {
  const pending = state.pending;
  if (pending === null) {
    throw new Error('expected an open choice');
  }
  return applyOk(state, {
    type: 'ANSWER_CHOICE',
    player,
    choiceId: pending.id,
    answer: payload,
  }).state;
}

describe('ABIL-001 — optional onPlay, select, ko', () => {
  function setup(): { state: GameState; card: InstanceId; victim: InstanceId } {
    const staged = buildScenario({
      decks,
      p1: { activeDon: 3, hand: ['ABIL-001'] },
      p2: { characters: [{ cardId: 'ABIL-002' }] },
    });
    const card = lastInHand(staged, 'p1');
    const played = applyOk(staged, { type: 'PLAY_CARD', player: 'p1', instanceId: card }).state;
    return { state: played, card, victim: characterAt(staged, 'p2', 0) };
  }

  it('asks whether to activate at all before asking for a target', () => {
    const { state } = setup();
    expect(state.pending?.kind).toBe('yesNo');
    expect(state.pending?.player).toBe('p1');
    expect(state.stack[0]?.status).toBe('optIn');
  });

  it('KOs the chosen character when accepted', () => {
    const { state, victim } = setup();
    const targeting = answer(state, 'p1', { kind: 'yesNo', value: true });
    expect(targeting.pending?.kind).toBe('selectCards');
    expect(targeting.pending?.candidates).toEqual([victim]);

    const done = answer(targeting, 'p1', { kind: 'cards', selected: [victim] });
    expect(done.players.p2.characters).toEqual([]);
    expect(done.players.p2.trash[0]).toBe(victim);
    assertSettled(done);
  });

  it('does nothing at all when declined', () => {
    const { state, victim } = setup();
    const done = answer(state, 'p1', { kind: 'yesNo', value: false });
    expect(done.players.p2.characters).toEqual([victim]);
    expect(done.players.p2.trash).toEqual([]);
    assertSettled(done);
  });
});

describe('ABIL-002 — draw then discard', () => {
  it('draws one and discards one, leaving the hand size unchanged', () => {
    const staged = buildScenario({ decks, p1: { activeDon: 3, hand: ['ABIL-002'] } });
    const card = lastInHand(staged, 'p1');
    const handBefore = staged.players.p1.hand.length;
    const deckBefore = staged.players.p1.deck.length;
    const drawnCard = staged.players.p1.deck[0];

    const done = applyOk(staged, { type: 'PLAY_CARD', player: 'p1', instanceId: card }).state;

    // -1 for the card played, +1 drawn, -1 discarded.
    expect(done.players.p1.hand).toHaveLength(handBefore - 1);
    expect(done.players.p1.deck).toHaveLength(deckBefore - 1);
    expect(done.players.p1.hand).toContain(drawnCard);
    expect(done.players.p1.trash).toHaveLength(1);
    assertSettled(done);
  });
});

describe('ABIL-003 / ABIL-004 / ABIL-024 — continuous', () => {
  it('applies power and keyword statics without writing a modifier', () => {
    const state = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-003' }, { cardId: 'ABIL-004' }], stage: 'ABIL-024' },
    });
    const bearer = characterAt(state, 'p1', 0);
    const shieldCaller = characterAt(state, 'p1', 1);
    // ABIL-004: printed 2000, +1000 from ABIL-003, +1000 from the stage.
    expect(getPower(state, shieldCaller)).toBe(4000);
    // ABIL-003 is cost 2, so ABIL-004's static grants it Blocker.
    expect(hasKeyword(state, bearer, 'blocker')).toBe(true);
    expect(state.modifiers).toEqual([]);
  });
});

describe('ABIL-005 / 006 / 007 / 008 — printed keywords', () => {
  it('reports each keyword through hasKeyword', () => {
    const state = buildScenario({
      decks,
      p1: {
        characters: [
          { cardId: 'ABIL-005' },
          { cardId: 'ABIL-006' },
          { cardId: 'ABIL-007' },
          { cardId: 'ABIL-008' },
        ],
      },
    });
    expect(hasKeyword(state, characterAt(state, 'p1', 0), 'rush')).toBe(true);
    expect(hasKeyword(state, characterAt(state, 'p1', 1), 'doubleAttack')).toBe(true);
    expect(hasKeyword(state, characterAt(state, 'p1', 2), 'banish')).toBe(true);
    expect(hasKeyword(state, characterAt(state, 'p1', 3), 'blocker')).toBe(true);
  });
});

describe('ABIL-009 — activateMain, oncePerTurn, restDon cost, donAttached condition', () => {
  function staged(): GameState {
    return buildScenario({
      decks,
      p1: { activeDon: 3, characters: [{ cardId: 'ABIL-009', attachedDon: 1 }] },
    });
  }

  it('is offered only while the DON!! condition holds', () => {
    const withDon = staged();
    const source = characterAt(withDon, 'p1', 0);
    expect(
      legalActions(withDon, 'p1').some(
        (a) => a.type === 'ACTIVATE_ABILITY' && a.instanceId === source,
      ),
    ).toBe(true);

    const withoutDon = buildScenario({
      decks,
      p1: { activeDon: 3, characters: [{ cardId: 'ABIL-009' }] },
    });
    expect(legalActions(withoutDon, 'p1').filter((a) => a.type === 'ACTIVATE_ABILITY')).toEqual([]);
  });

  it('rests a DON!!, adds the power, and cannot be used twice in the turn', () => {
    const state = staged();
    const source = characterAt(state, 'p1', 0);
    const before = getPower(state, source);

    const done = applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: source,
      abilityId: 'ABIL-009-main',
    }).state;

    expect(getPower(done, source)).toBe(before + 2000);
    expect(done.cards[source]?.usedThisTurn).toEqual(['ABIL-009-main']);
    expect(
      done.players.p1.don.filter(
        (d) => d.location.kind === 'cost' && d.location.orientation === 'rested',
      ),
    ).toHaveLength(1);
    expect(legalActions(done, 'p1').filter((a) => a.type === 'ACTIVATE_ABILITY')).toEqual([]);
    assertSettled(done);
  });
});

describe('ABIL-010 — returnDon cost, isYourTurn, rest, setActive', () => {
  it('returns a DON!! to the deck, rests the chosen enemy, and stands itself up', () => {
    const state = buildScenario({
      decks,
      p1: { activeDon: 2, characters: [{ cardId: 'ABIL-010', orientation: 'rested' }] },
      p2: { characters: [{ cardId: 'ABIL-002' }] },
    });
    const source = characterAt(state, 'p1', 0);
    const foe = characterAt(state, 'p2', 0);

    const asking = applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: source,
      abilityId: 'ABIL-010-main',
    }).state;

    // The cost is paid before the script asks anything.
    expect(asking.players.p1.don.filter((d) => d.location.kind === 'donDeck')).toHaveLength(9);
    expect(asking.pending?.candidates).toEqual([foe]);

    const done = answer(asking, 'p1', { kind: 'cards', selected: [foe] });
    expect(done.cards[foe]?.orientation).toBe('rested');
    expect(done.cards[source]?.orientation).toBe('active');
    assertSettled(done);
  });
});

describe('ABIL-011 / ABIL-012 — onKO and a chained trigger', () => {
  it('resolves the KO first, then the [On K.O.] it woke', () => {
    const staged = buildScenario({
      decks,
      p1: { activeDon: 4, hand: ['ABIL-012'] },
      p2: { characters: [{ cardId: 'ABIL-011' }, { cardId: 'ABIL-005' }] },
    });
    const purge = lastInHand(staged, 'p1');
    const scout = characterAt(staged, 'p2', 0); // cost 2 - inside the selector
    const rusher = characterAt(staged, 'p2', 1); // cost 3 - outside it
    const p2HandBefore = staged.players.p2.hand.length;

    const done = applyOk(staged, { type: 'PLAY_CARD', player: 'p1', instanceId: purge }).state;

    expect(done.players.p2.characters).toEqual([rusher]);
    expect(done.players.p2.trash[0]).toBe(scout);
    // The chained [On K.O.] drew a card for the scout's controller.
    expect(done.players.p2.hand).toHaveLength(p2HandBefore + 1);
    assertSettled(done);
  });
});

describe('ABIL-013 — forEach with a nested if', () => {
  it('takes the then-branch for every character when the board has two', () => {
    const state = buildScenario({
      decks,
      turn: 3,
      p1: { characters: [{ cardId: 'ABIL-013' }, { cardId: 'ABIL-002' }] },
    });
    const attacker = characterAt(state, 'p1', 0);
    const ally = characterAt(state, 'p1', 1);

    const attacking = applyOk(state, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker,
      target: state.players.p2.leader,
    }).state;

    // Two characters, so the countCards>=2 branch fires: +1000 each, not +2000.
    expect(getPower(attacking, attacker)).toBe(3000);
    expect(getPower(attacking, ally)).toBe(3000);
    expect(attacking.modifiers).toHaveLength(2);
    expect(attacking.modifiers.every((m) => m.duration === 'endOfBattle')).toBe(true);
  });

  it('takes the else-branch with a single character on the board', () => {
    const state = buildScenario({
      decks,
      turn: 3,
      p1: { characters: [{ cardId: 'ABIL-013' }] },
    });
    const attacker = characterAt(state, 'p1', 0);
    const attacking = applyOk(state, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker,
      target: state.players.p2.leader,
    }).state;
    expect(getPower(attacking, attacker)).toBe(4000); // 2000 + 2000
    expect(attacking.modifiers).toHaveLength(1);
  });

  it('expires the whole batch when the battle ends', () => {
    const state = buildScenario({
      decks,
      turn: 3,
      p1: { characters: [{ cardId: 'ABIL-013' }, { cardId: 'ABIL-002' }] },
    });
    const attacker = characterAt(state, 'p1', 0);
    const attacking = applyOk(state, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker,
      target: state.players.p2.leader,
    }).state;
    const blocked = applyOk(attacking, { type: 'PASS', player: 'p2' }).state;
    const resolved = applyOk(blocked, { type: 'PASS', player: 'p2' }).state;
    expect(resolved.modifiers).toEqual([]);
    assertSettled(resolved);
  });
});

describe('ABIL-014 — whenOpponentAttacks with confirm and varTrue', () => {
  function underAttack(): { state: GameState; guard: InstanceId } {
    const staged = buildScenario({
      decks,
      turn: 3,
      p1: { characters: [{ cardId: 'ABIL-005' }] },
      p2: { characters: [{ cardId: 'ABIL-014' }] },
    });
    const attacking = applyOk(staged, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(staged, 'p1', 0),
      target: staged.players.p2.leader,
    }).state;
    return { state: attacking, guard: characterAt(staged, 'p2', 0) };
  }

  it('adds the power when the defender confirms', () => {
    const { state, guard } = underAttack();
    expect(state.pending?.kind).toBe('yesNo');
    expect(state.pending?.player).toBe('p2');
    const done = answer(state, 'p2', { kind: 'yesNo', value: true });
    expect(getPower(done, guard)).toBe(4000); // 2000 + 2000
  });

  it('skips the branch when the defender declines', () => {
    const { state, guard } = underAttack();
    const done = answer(state, 'p2', { kind: 'yesNo', value: false });
    expect(getPower(done, guard)).toBe(2000);
    expect(done.modifiers).toEqual([]);
  });
});

describe('ABIL-015 — endOfTurn', () => {
  it('stands the controller rested characters up as the turn closes', () => {
    const state = buildScenario({
      decks,
      turn: 3,
      p1: {
        characters: [
          { cardId: 'ABIL-015', orientation: 'rested' },
          { cardId: 'ABIL-002', orientation: 'rested' },
        ],
      },
    });
    const watch = characterAt(state, 'p1', 0);
    const ally = characterAt(state, 'p1', 1);

    const done = applyOk(state, { type: 'END_TURN', player: 'p1' }).state;

    // p1's refresh is a whole turn away, so this can only be the trigger.
    expect(done.activePlayer).toBe('p2');
    expect(done.cards[watch]?.orientation).toBe('active');
    expect(done.cards[ally]?.orientation).toBe('active');
    assertSettled(done);
  });
});

describe('ABIL-016 — counterEvent', () => {
  it('is activated with PLAY_COUNTER_EVENT, paying its cost and buffing the battle target', () => {
    const staged = buildScenario({
      decks,
      turn: 3,
      p1: { characters: [{ cardId: 'ABIL-005' }] },
      // A [Counter] Event has no printed value: it is paid by its cost (1) from
      // the defender's active cost-area DON!!, not discarded for a counter value.
      p2: { hand: ['ABIL-016'], activeDon: 1 },
    });
    const counterCard = lastInHand(staged, 'p2');
    const defenderLeader = staged.players.p2.leader;

    const attacking = applyOk(staged, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(staged, 'p1', 0),
      target: defenderLeader,
    }).state;
    const counterStep = applyOk(attacking, { type: 'PASS', player: 'p2' }).state;
    const countered = applyOk(counterStep, {
      type: 'PLAY_COUNTER_EVENT',
      player: 'p2',
      instanceId: counterCard,
    }).state;

    // 5000 leader + 2000 from the effect. No printed counter to add: the Event
    // has none, which is exactly what the fixed card shape now reflects.
    expect(getPower(countered, defenderLeader)).toBe(7000);
    // Paid: the one active DON!! is now rested, and the card sits in the trash
    // where its effect resolved from.
    expect(countered.players.p2.don.filter((d) => d.location.kind === 'cost' && d.location.orientation === 'active')).toEqual([]);
    expect(countered.players.p2.trash[0]).toBe(counterCard);
    expect(countered.players.p2.hand).not.toContain(counterCard);
    assertSettled(countered);
  });
});

describe('ABIL-017 — mainEvent, reveal, moveCard', () => {
  it('moves the revealed top three to the bottom of the deck in order', () => {
    const staged = buildScenario({ decks, p1: { activeDon: 3, hand: ['ABIL-017'] } });
    const event = lastInHand(staged, 'p1');
    const deckBefore = [...staged.players.p1.deck];
    const topThree = deckBefore.slice(0, 3);

    const done = applyOk(staged, { type: 'PLAY_CARD', player: 'p1', instanceId: event }).state;

    expect(done.players.p1.deck).toHaveLength(deckBefore.length);
    expect(done.players.p1.deck.slice(0, 3)).toEqual(deckBefore.slice(3, 6));
    expect(done.players.p1.deck.slice(-3)).toEqual(topThree);
    expect(done.log.some((e) => e.type === 'cardsRevealed')).toBe(true);
    assertSettled(done);
  });
});

describe('ABIL-018 — giveDon', () => {
  it('attaches one rested DON!!, never an active one', () => {
    // Cost 2, so playing it rests 2 of the 3 active DON!! before the [On Play]
    // fires: at giveDon time the cost area holds 1 active and 2 rested DON!!.
    const staged = buildScenario({ decks, p1: { activeDon: 3, hand: ['ABIL-018'] } });
    const card = lastInHand(staged, 'p1');
    const done = applyOk(staged, { type: 'PLAY_CARD', player: 'p1', instanceId: card }).state;

    expect(done.cards[card]?.attachedDon).toHaveLength(1);
    expect(getPower(done, card)).toBe(3000); // 2000 printed + 1000 for the DON
    expect(done.players.p1.don.filter((d) => d.location.kind === 'attached')).toHaveLength(1);
    // The DON!! it took was a rested one: the lone active DON!! is left alone,
    // and the rested pool dropped from 2 to 1. Rested is a restriction here.
    const cost = (o: 'active' | 'rested') =>
      done.players.p1.don.filter((d) => d.location.kind === 'cost' && d.location.orientation === o);
    expect(cost('active')).toHaveLength(1);
    expect(cost('rested')).toHaveLength(1);
    assertSettled(done);
  });

  it('gives nothing from an all-active cost area', () => {
    // The rested-only rule lives in interpreter.ts, so its guard belongs in this
    // package: the ABIL-018 case above always has rested DON!! from paying the
    // play cost, so it passes whether giveDon takes rested-only or rested-first.
    // Activating the cost-free giveDon on an untouched, all-active cost area is
    // the case that separates them — rested-first would hand over an active
    // DON!! here; rested-only gives none.
    const staged = buildScenario({
      decks,
      p1: { activeDon: 3, characters: [{ cardId: 'ABIL-018' }] },
    });
    const source = characterAt(staged, 'p1', 0);
    const done = applyOk(staged, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: source,
      abilityId: 'ABIL-018-main',
    }).state;

    expect(done.cards[source]?.attachedDon).toHaveLength(0);
    expect(done.players.p1.don.filter((d) => d.location.kind === 'attached')).toHaveLength(0);
    expect(
      done.players.p1.don.filter(
        (d) => d.location.kind === 'cost' && d.location.orientation === 'active',
      ),
    ).toHaveLength(3);
    assertSettled(done);
  });
});

describe('ABIL-019 — trashSelf cost', () => {
  it('trashes itself to pay, then still resolves its script', () => {
    const state = buildScenario({
      decks,
      p1: { activeDon: 3, characters: [{ cardId: 'ABIL-019' }] },
    });
    const source = characterAt(state, 'p1', 0);
    const handBefore = state.players.p1.hand.length;

    const done = applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: source,
      abilityId: 'ABIL-019-main',
    }).state;

    expect(done.players.p1.characters).toEqual([]);
    expect(done.players.p1.trash[0]).toBe(source);
    // The script runs from the trash: the source leaving is not an abort.
    expect(done.players.p1.hand).toHaveLength(handBefore + 1);
    assertSettled(done);
  });
});

describe('ABIL-020 — discardHand cost with and/or/lifeAtMost/countCards', () => {
  it('pays the discard and draws once the condition holds', () => {
    const staged = buildScenario({
      decks,
      p1: { activeDon: 5, characters: [{ cardId: 'ABIL-002' }], hand: ['ABIL-020'] },
    });
    const card = lastInHand(staged, 'p1');
    const handBefore = staged.players.p1.hand.length;

    const paying = applyOk(staged, { type: 'PLAY_CARD', player: 'p1', instanceId: card }).state;

    // The cost stops and asks now (CR 8-4-1-3 determines the cost before it
    // pays it), so this case walks the choice rather than reading the front of
    // the hand. `chosenCosts.test.ts` owns the mechanism; this stays a card case.
    const choice = paying.pending;
    if (choice === null) {
      throw new Error('expected the discard cost to open a choice');
    }
    const done = applyOk(paying, {
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId: choice.id,
      answer: { kind: 'cards', selected: [choice.candidates[0] as InstanceId] },
    }).state;

    // -1 played, -1 discarded as the cost, +1 drawn by the script.
    expect(done.players.p1.hand).toHaveLength(handBefore - 1);
    expect(done.players.p1.trash).toHaveLength(1);
    expect(done.log.some((e) => e.type === 'cardDiscarded')).toBe(true);
    assertSettled(done);
  });

  it('does not fire at all when the hand cannot pay', () => {
    const staged = buildScenario({
      decks,
      p1: {
        clearHand: true,
        activeDon: 5,
        characters: [{ cardId: 'ABIL-002' }],
        hand: ['ABIL-020'],
      },
    });
    const card = lastInHand(staged, 'p1');
    // The card itself is the whole hand, so paying leaves nothing to discard.
    const done = applyOk(staged, { type: 'PLAY_CARD', player: 'p1', instanceId: card }).state;
    expect(done.players.p1.hand).toEqual([]);
    expect(done.players.p1.trash).toEqual([]);
    assertSettled(done);
  });
});

describe('ABIL-022 — onBlock', () => {
  it('buffs the blocker when it steps in', () => {
    const staged = buildScenario({
      decks,
      turn: 3,
      p1: { characters: [{ cardId: 'ABIL-005' }] },
      p2: { characters: [{ cardId: 'ABIL-022' }] },
    });
    const blocker = characterAt(staged, 'p2', 0);
    const attacking = applyOk(staged, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(staged, 'p1', 0),
      target: staged.players.p2.leader,
    }).state;

    const blocked = applyOk(attacking, { type: 'DECLARE_BLOCK', player: 'p2', blocker }).state;

    expect(blocked.battle?.target).toBe(blocker);
    expect(blocked.battle?.originalTarget).toBe(staged.players.p2.leader);
    expect(getPower(blocked, blocker)).toBe(4000); // 2000 + 2000
  });
});

describe('ABIL-023 — grantKeyword', () => {
  it('writes a keyword modifier that hasKeyword picks up', () => {
    const staged = buildScenario({ decks, turn: 3, p1: { activeDon: 3, hand: ['ABIL-023'] } });
    const card = lastInHand(staged, 'p1');
    const done = applyOk(staged, { type: 'PLAY_CARD', player: 'p1', instanceId: card }).state;

    expect(hasKeyword(done, card, 'rush')).toBe(true);
    expect(done.modifiers).toHaveLength(1);
    expect(done.modifiers[0]?.kind).toBe('grantKeyword');
    expect(done.modifiers[0]?.duration).toBe('endOfTurn');
    assertSettled(done);
  });
});

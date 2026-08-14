import { describe, expect, it } from 'vitest';
import { getCardDef, hasName } from '../src/index.js';
import type { GameState, InstanceId } from '../src/index.js';
import { ABIL_CARDS } from '../src/testdata/abilities.js';
import { ABIL_DECK } from '../src/testdata/abilityDecks.js';
import { buildScenario, characterAt, handCard } from '../src/testdata/scenarios.js';
import { applyFail, applyOk } from './helpers.js';

/**
 * Reference by name — one field on the shared predicate, and the two things it
 * is not.
 *
 * The census that commissioned it (`docs/op01-closing-census.md`) counted six
 * printed shapes and found **five of them are one field**: "other than [X]", "if
 * your Leader is [X]", "play/add [X]", "if you don't have [X]", and a static's
 * audience. They differ in where the predicate is read, not in what it says, so
 * `names` and `excludeNames` sit on `CardFilter` beside `types` and `colors` and
 * every site inherits them. The card-level proof that all five really do enter
 * through the one field is in `packages/cards/tests/op01NameReference.test.ts`,
 * on real printed text; this file is the mechanism.
 *
 * Two distinctions carry the whole design, and both are pinned below:
 *
 * - **A name is not an instance.** `excludeSelf` drops the one card whose
 *   ability is running. "Other than [X]" drops every card called X, the source
 *   included and other copies included.
 * - **A name is not a card number.** CR 2-1-2 refers to "cards with the card
 *   name specified in the brackets"; CR 2-14-2 counts deck copies by *card
 *   number*. `ABIL-032` and `ABIL-033` are two numbers with one name so the
 *   engine can say the difference without the card package.
 */

const decks = { p1: ABIL_DECK, p2: ABIL_DECK };

function candidates(state: GameState): InstanceId[] {
  const pending = state.pending;
  if (pending === null) {
    throw new Error('expected an open choice');
  }
  return [...pending.candidates];
}

function nameOf(state: GameState, id: InstanceId): string {
  const card = state.cards[id];
  if (card === undefined) {
    throw new Error(`unknown instance ${id}`);
  }
  return getCardDef(card.cardId).name;
}

function activate(state: GameState, index: number, abilityId: string): GameState {
  return applyOk(state, {
    type: 'ACTIVATE_ABILITY',
    player: 'p1',
    instanceId: characterAt(state, 'p1', index),
    abilityId,
  }).state;
}

// ---------------------------------------------------------------------------
// The two card numbers that share a name, before anything is asked of them
// ---------------------------------------------------------------------------

describe('the ABIL set holds a name on two card numbers', () => {
  it('gives ABIL-032 and ABIL-033 one name and two numbers', () => {
    const flags = ABIL_CARDS.filter((card) => card.name === 'Signal Flag');
    expect(flags.map((card) => card.cardId)).toEqual(['ABIL-032', 'ABIL-033']);
    // Different in every other printed respect, so a test that passes by name
    // cannot be passing by cost or power instead.
    expect(new Set(flags.map((card) => card.cost)).size).toBe(2);
    expect(new Set(flags.map((card) => card.power)).size).toBe(2);
  });

  it('leaves every other name on exactly one number, so the pair is the only one', () => {
    const counts = new Map<string, number>();
    for (const card of ABIL_CARDS) {
      counts.set(card.name, (counts.get(card.name) ?? 0) + 1);
    }
    const shared = [...counts].filter(([, n]) => n > 1).map(([name]) => name);
    expect(shared).toEqual(['Signal Flag']);
  });
});

// ---------------------------------------------------------------------------
// hasName — the one reader
// ---------------------------------------------------------------------------

describe('hasName is the single question, and it answers for both numbers', () => {
  function staged(): GameState {
    return buildScenario({
      decks,
      p1: {
        characters: [{ cardId: 'ABIL-033' }, { cardId: 'ABIL-032' }, { cardId: 'ABIL-034' }],
        activeDon: 6,
      },
      p2: { activeDon: 5 },
    });
  }

  it('says yes to both Signal Flags and no to the Boatswain beside them', () => {
    const state = staged();
    expect(hasName(state, characterAt(state, 'p1', 0), 'Signal Flag')).toBe(true);
    expect(hasName(state, characterAt(state, 'p1', 1), 'Signal Flag')).toBe(true);
    expect(hasName(state, characterAt(state, 'p1', 2), 'Signal Flag')).toBe(false);
    expect(hasName(state, characterAt(state, 'p1', 2), 'Boatswain')).toBe(true);
  });

  it('matches exactly, never as a prefix or a case-folded guess', () => {
    // CR 2-1-2-1 defines a *substring* form as well — "part of a card name in
    // " " quotation marks" — and exactly one card in the entire game prints it
    // (`OP16-015`, "If your Leader's card name includes "Ace""). One asker and
    // no second is a declared row by this project's standard, so this field is
    // exact and says so out loud.
    const state = staged();
    const flag = characterAt(state, 'p1', 0);
    expect(hasName(state, flag, 'Signal')).toBe(false);
    expect(hasName(state, flag, 'signal flag')).toBe(false);
    expect(hasName(state, flag, 'Signal Flag ')).toBe(false);
  });

  it('answers no for an id the state does not hold, rather than throwing', () => {
    // `hasKeywordWithoutStatics`' reading, not `getPowerWithoutStatics`': a
    // predicate that has already survived its own `state.cards` lookup cannot
    // reach this, so the answer is the quiet one.
    expect(hasName(staged(), 'no-such-instance' as InstanceId, 'Signal Flag')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// excludeNames — "other than [X]"
// ---------------------------------------------------------------------------

describe('ABIL-033 Signal Flag — rest one of your Characters other than [Signal Flag]', () => {
  /**
   * Three bodies: the source, a second Signal Flag of the *other* number, and
   * one card that is neither. The board is the whole test — what comes back is
   * the candidate list.
   */
  function staged(extra: Array<{ cardId: string }> = []): GameState {
    return buildScenario({
      decks,
      p1: {
        characters: [{ cardId: 'ABIL-033' }, { cardId: 'ABIL-032' }, { cardId: 'ABIL-034' }, ...extra],
        activeDon: 6,
      },
      p2: { activeDon: 5 },
    });
  }

  it('offers the Boatswain and neither Signal Flag', () => {
    const state = staged();
    const asking = activate(state, 0, 'ABIL-033-muster');
    expect(candidates(asking)).toEqual([characterAt(state, 'p1', 2)]);
  });

  it('excludes the *other* card number, which is the name doing the work', () => {
    // ABIL-032 is a different card number, a different cost and a different
    // power. The only thing it shares with the source is the printed name, and
    // it is out.
    const state = staged();
    const asking = activate(state, 0, 'ABIL-033-muster');
    const offered = candidates(asking).map((id) => nameOf(asking, id));
    expect(offered).not.toContain('Signal Flag');
  });

  it('excludes a second copy of the source card itself, which excludeSelf would not', () => {
    // The sharp case, and `OP01-099`'s: two instances of one number, each of
    // them a [Signal Flag]. `excludeSelf` drops exactly one — the source — and
    // would leave the twin standing in the list. The printed words drop both.
    const state = staged([{ cardId: 'ABIL-033' }]);
    const source = characterAt(state, 'p1', 0);
    const twin = characterAt(state, 'p1', 3);
    expect(nameOf(state, source)).toBe(nameOf(state, twin));

    const asking = activate(state, 0, 'ABIL-033-muster');
    expect(candidates(asking)).not.toContain(twin);
    expect(candidates(asking)).not.toContain(source);
    expect(candidates(asking)).toEqual([characterAt(state, 'p1', 2)]);
  });

  it('reads the same from the twin, so each copy exempts both', () => {
    // Asked from the other end. `OP01-099` Kurozumi Semimaru is the printed card
    // that needs this: with two out, each one's static must exempt the pair, and
    // a rule that only worked from one side would be silently half-right.
    const state = staged([{ cardId: 'ABIL-033' }]);
    const asking = activate(state, 3, 'ABIL-033-muster');
    expect(candidates(asking)).toEqual([characterAt(state, 'p1', 2)]);
  });

  it('rests the card that was chosen, so the filter is not the end of it', () => {
    const state = staged();
    const target = characterAt(state, 'p1', 2);
    const asking = activate(state, 0, 'ABIL-033-muster');
    const done = applyOk(asking, {
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId: asking.pending?.id ?? '',
      answer: { kind: 'cards', selected: [target] },
    }).state;

    expect(done.cards[target]?.orientation).toBe('rested');
    expect(done.pending).toBeNull();
  });

  it('takes nothing, because "up to 1" may take nothing', () => {
    // CR 8-4-4-1: the player chooses up to the specified number and may choose
    // 0. `min: 0` is the printed "up to", not a convenience.
    const state = staged();
    const asking = activate(state, 0, 'ABIL-033-muster');
    expect(asking.pending?.min).toBe(0);
    const done = applyOk(asking, {
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId: asking.pending?.id ?? '',
      answer: { kind: 'cards', selected: [] },
    }).state;
    expect(done.pending).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// names — "play [X]", and the gate that reads the same list
// ---------------------------------------------------------------------------

describe("ABIL-034 Boatswain — if you don't have [Signal Flag], play one from your hand", () => {
  function staged(field: Array<{ cardId: string }>): GameState {
    return buildScenario({
      decks,
      p1: {
        characters: [{ cardId: 'ABIL-034' }, ...field],
        hand: ['ABIL-032', 'ABIL-030'],
        clearHand: true,
        activeDon: 6,
      },
      p2: { activeDon: 5 },
    });
  }

  it('offers only the [Signal Flag] in hand, not the card beside it', () => {
    const state = staged([]);
    const asking = activate(state, 0, 'ABIL-034-call');
    expect(candidates(asking)).toEqual([handCard(state, 'p1', 'ABIL-032')]);
  });

  it('puts it onto the field when chosen', () => {
    const state = staged([]);
    const flag = handCard(state, 'p1', 'ABIL-032');
    const asking = activate(state, 0, 'ABIL-034-call');
    const done = applyOk(asking, {
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId: asking.pending?.id ?? '',
      answer: { kind: 'cards', selected: [flag] },
    }).state;

    expect(done.players.p1.characters).toContain(flag);
    expect(done.players.p1.hand).not.toContain(flag);
    expect(done.pending).toBeNull();
  });

  function refuse(state: GameState): string {
    return applyFail(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: characterAt(state, 'p1', 0),
      abilityId: 'ABIL-034-call',
    });
  }

  it('cannot be activated at all with a [Signal Flag] already on the field', () => {
    // The `max: 0` half. `countCards` has taken a `max` since Phase 2A, so "if
    // you don't have [X]" needed a name and no negation — the census said so and
    // this is the check.
    //
    // Refused rather than resolved into nothing, which is CR 8-4-1-1 exactly:
    // "If there are conditions for activation, those conditions must be met. The
    // effect cannot be activated if the conditions are not met."
    expect(refuse(staged([{ cardId: 'ABIL-032' }]))).toBe('abilityConditionUnmet');
  });

  it('is closed by the *other* card number just as well', () => {
    // The gate counts names, not numbers: an `ABIL-033` on the field shuts it
    // exactly as an `ABIL-032` does.
    expect(refuse(staged([{ cardId: 'ABIL-033' }]))).toBe('abilityConditionUnmet');
  });

  it('is not closed by a [Signal Flag] the *opponent* has, because the gate says "you"', () => {
    const state = buildScenario({
      decks,
      p1: {
        characters: [{ cardId: 'ABIL-034' }],
        hand: ['ABIL-032'],
        clearHand: true,
        activeDon: 6,
      },
      p2: { characters: [{ cardId: 'ABIL-033' }], activeDon: 5 },
    });
    const asking = activate(state, 0, 'ABIL-034-call');
    expect(candidates(asking)).toEqual([handCard(state, 'p1', 'ABIL-032')]);
  });

  it('is not closed by a [Signal Flag] in hand, because "have" is the field', () => {
    // CR 3-1-2 collects the Leader, Character, Stage and cost areas under "the
    // field"; the hand is not one of them. The Signal Flag this ability is about
    // to play is in hand while the gate is read, so a gate that counted the hand
    // would make the card unable to ever fire.
    const state = staged([]);
    expect(state.players.p1.hand.map((id) => nameOf(state, id))).toContain('Signal Flag');
    const asking = activate(state, 0, 'ABIL-034-call');
    expect(candidates(asking)).toHaveLength(1);
  });
});

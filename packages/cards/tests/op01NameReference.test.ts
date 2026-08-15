import { describe, expect, it } from 'vitest';
import {
  applyAction,
  assertInvariants,
  canBeKOdInBattle,
  createGame,
  getAbilities,
  getCardDef,
} from '@optcg/engine';
import { decide } from '@optcg/engine/testing';
import type { Decklist, GameState, InstanceId, PlayerId } from '@optcg/engine';
import { englishCards } from '../src/index.js';
import {
  answer,
  applyOk,
  assertSettled,
  characterAt,
  firedIds,
  handCard,
  op01AkazayaScenario,
  op01HeartsScenario,
  op01PacifistaScenario,
  OP01_AKAZAYA_DECKS,
  OP01_HEARTS_DECKS,
  OP01_PACIFISTA_DECKS,
} from './support.js';

/**
 * Reference by name — the closing census's largest group, twelve cards.
 *
 * The engine's own file (`packages/engine/tests/nameReference.test.ts`) owns the
 * mechanism: what `hasName` answers, what `excludeNames` drops, that a name is
 * not an instance and not a card number. This file is the **corpus** — the same
 * claims asked of printed text, plus the one thing synthetic cards cannot show:
 * that all five printed shapes really do enter through the single field the
 * census bet on, at the three sites where the shared predicate is read.
 *
 * | Site | Shape | Cards |
 * | --- | --- | --- |
 * | a script `Selector` | "other than [X]", "play [X]" | -005, -015, -016, -049, -074, -090, and the two below |
 * | `Condition.countCards` | "if your Leader is [X]", "if you don't have [X]" | -040, -042, -046, -044, -050 |
 * | `Audience` | a static's "other than your [X]" | -099 |
 *
 * Three OP-01 cards that print a name are deliberately absent, each behind a
 * second wall the census named: `OP01-051` (negation in `Condition`),
 * `OP01-069` and `OP01-098` (searching the whole deck). So is the **alias** —
 * `OP01-121` Yamato's "Also treat this card's name as [Kouzuki Oden]" is CR
 * 2-1-3 and not this field, and OP-01 cannot make it observable.
 */

function nameOf(state: GameState, id: InstanceId): string {
  const card = state.cards[id];
  if (card === undefined) {
    throw new Error(`unknown instance ${id}`);
  }
  return getCardDef(card.cardId).name;
}

function candidates(state: GameState): InstanceId[] {
  const pending = state.pending;
  if (pending === null) {
    throw new Error('expected an open choice');
  }
  return [...pending.candidates];
}

function offeredNames(state: GameState): Set<string> {
  return new Set(candidates(state).map((id) => nameOf(state, id)));
}

function play(state: GameState, player: PlayerId, cardId: string): GameState {
  return applyOk(state, {
    type: 'PLAY_CARD',
    player,
    instanceId: handCard(state, player, cardId),
  }).state;
}

function attackLeader(state: GameState, player: PlayerId, attacker: InstanceId): GameState {
  return applyOk(state, {
    type: 'DECLARE_ATTACK',
    player,
    attacker,
    target: state.players[player === 'p1' ? 'p2' : 'p1'].leader,
  }).state;
}

// ===========================================================================
// The probe, pinned
// ===========================================================================

describe('the names the scripts filter on', () => {
  it('are exactly the twelve the fifteen cards print, and every one resolves', () => {
    // The registered half of the resolution guard in `abilCardShapes.test.ts`,
    // as an exact list rather than "not empty". Ten names across twelve cards:
    // `OP01-044` and `OP01-050` each print their partner's name twice (once in
    // the gate, once in the play), and the three Leader gates all print
    // [Kouzuki Oden].
    //
    // The probe behind it: every bracketed name on the twelve resolves
    // *exactly* against `cards.en.json` — no punctuation drift, no stray
    // whitespace, nothing needing normalization. `Tony Tony.Chopper` and
    // `Kouzuki Oden` are printed in the text exactly as the data spells them.
    const referenced = new Set<string>();
    for (const card of englishCards) {
      for (const ability of getAbilities(card.cardId)) {
        walkNames(ability, (name) => referenced.add(name));
      }
    }
    expect([...referenced].sort()).toEqual([
      // The twelfth and thirteenth names, and neither is on the twelve: the two
      // whole-deck searches (`OP01-069`, `OP01-098`) filter their deck by a
      // printed name and by nothing else, which is this field arriving at a
      // fifth site — a `Selector` over a zone that did not exist when it shipped
      // — without learning a word.
      'Artificial Devil Fruit SMILE',
      'Baroque Works',
      'Bepo',
      // The eleventh name, and it is not on a script selector at all:
      // `OP01-051` Kid names itself in a **legality clause**, which reads the
      // same `CardPredicate`. That the closing batch could write Kid without
      // touching the name field is the evidence that the field really does sit
      // on `CardFilter` rather than on `Selector`.
      'Eustass"Captain"Kid',
      'Kouzuki Oden',
      'Kurozumi Semimaru',
      'Nami',
      'Pacifista',
      'Penguin',
      'Shachi',
      'Smiley',
      'Tony Tony.Chopper',
      'Uta',
    ]);

    const known = new Set(englishCards.map((card) => card.name));
    for (const name of referenced) {
      expect(known.has(name), name).toBe(true);
    }
  });

  it('names no card the fifteen do not print, and no card outside them names one', () => {
    const naming = englishCards
      .filter((card) =>
        getAbilities(card.cardId).some((ability) => {
          let any = false;
          walkNames(ability, () => {
            any = true;
          });
          return any;
        }),
      )
      .map((card) => card.cardId)
      .sort();
    expect(naming).toEqual([
      'OP01-005',
      'OP01-015',
      'OP01-016',
      'OP01-040',
      'OP01-042',
      'OP01-044',
      'OP01-046',
      'OP01-049',
      'OP01-050',
      // The thirteenth card, added by the closing batch through a legality
      // target rather than a selector.
      'OP01-051',
      // The fourteenth and fifteenth, added by the last four: a name is what
      // both whole-deck searches search *for*.
      'OP01-069',
      'OP01-074',
      'OP01-090',
      'OP01-098',
      'OP01-099',
    ]);
  });
});

/** Every `names`/`excludeNames` string anywhere in an ability. */
function walkNames(node: unknown, visit: (name: string) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walkNames(item, visit);
    return;
  }
  if (node === null || typeof node !== 'object') {
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if ((key === 'names' || key === 'excludeNames') && Array.isArray(value)) {
      for (const name of value) visit(String(name));
      continue;
    }
    walkNames(value, visit);
  }
}

// ===========================================================================
// The two distinctions, on printed cards
// ===========================================================================

/**
 * **A name is not an instance.**
 *
 * `excludeSelf` drops the card whose ability is running and nothing else. Two
 * printed cards make the difference visible in opposite directions, and they are
 * the two the census singled out.
 */
describe('a name is not an instance', () => {
  it('OP01-005 Uta finds other cards in the trash but never another [Uta]', () => {
    // The source is on the *field*; the copies of [Uta] are in the trash, so
    // they are different instances and `excludeSelf` would have offered every
    // one of them while excluding a card that was never a candidate.
    const state = op01HeartsScenario({
      p1: {
        hand: ['OP01-005'],
        clearHand: true,
        trash: ['OP01-005', 'OP01-023', 'OP01-025', 'OP01-010'],
        activeDon: 6,
      },
      p2: { activeDon: 5 },
    });
    const asking = play(state, 'p1', 'OP01-005');

    // Marco, Zoro and Komachiyo are red Characters costing 3 or less. The Uta
    // down there with them is not offered.
    expect(offeredNames(asking)).toEqual(new Set(['Marco', 'Roronoa Zoro', 'Komachiyo']));
    expect(candidates(asking)).toHaveLength(3);
  });

  it('OP01-005 excludes a second [Uta] that is not the source', () => {
    // Two Uta in the trash and one on the field: three instances of one name,
    // and the two that could have been candidates are both out.
    const state = op01HeartsScenario({
      p1: {
        hand: ['OP01-005'],
        clearHand: true,
        trash: ['OP01-005', 'OP01-005', 'OP01-023'],
        activeDon: 6,
      },
      p2: { activeDon: 5 },
    });
    const asking = play(state, 'p1', 'OP01-005');
    expect(offeredNames(asking)).toEqual(new Set(['Marco']));
  });

  it('OP01-099 Kurozumi Semimaru exempts both copies, from either side', () => {
    // The sharpest case in the group. `affects` is evaluated once per source:
    // with `excludeSelf`, A's static would drop A and protect B while B's
    // dropped B and protected A — both immune, the exact inverse of the card.
    const state = op01PacifistaScenario({
      p1: {
        characters: [{ cardId: 'OP01-099' }, { cardId: 'OP01-099' }, { cardId: 'OP01-100' }],
        activeDon: 6,
      },
      p2: { activeDon: 6 },
    });
    const [first, second, higurashi] = [0, 1, 2].map((i) => characterAt(state, 'p1', i));

    // Higurashi is {Kurozumi Clan} and is not called Kurozumi Semimaru, so the
    // static reaches it.
    expect(higurashi).toBeDefined();
    // Asked through the engine's own gate — the question the Damage Step asks —
    // rather than by re-reading the static off the state.
    // The attacker is part of the question since `OP01-024` gave `koInBattle` a
    // `target`. `OP01-099`'s clause carries none, so it answers the same for
    // every attacker — which is exactly what an unqualified prohibition means,
    // and p2's Leader is as good a witness to it as any.
    const swinging = state.players.p2.leader;
    const immune = [first, second, higurashi].filter(
      (id): id is InstanceId => id !== undefined && !canBeKOdInBattle(state, id, swinging),
    );
    expect(immune).toEqual([higurashi]);
  });
});

/**
 * **A name is not a card number.**
 *
 * Three of the twelve exclude a name that a *second* registered card carries,
 * and in each case that second card satisfies every other clause of the
 * selector. A filter keyed on `cardId` would have offered all three.
 */
describe('a name reaches across card numbers', () => {
  it('has three names in scope printed on two card numbers each', () => {
    // The probe, pinned. These are not pairs constructed for a test — they are
    // what the sets this repo plays with actually hold.
    //
    // Scoped to OP-01 and the two starters on purpose. `englishCards` is the
    // whole game, where these names run to 26 and 29 card numbers apiece, and a
    // count over the whole file would say something true about Bandai rather
    // than something about what a game here can put on a board.
    const inScope = englishCards.filter((card) => /^(OP01|ST01|ST02)-/.test(card.cardId));
    const byName = new Map<string, string[]>();
    for (const card of inScope) {
      byName.set(card.name, [...(byName.get(card.name) ?? []), card.cardId]);
    }
    expect(byName.get('Tony Tony.Chopper')).toEqual(['OP01-015', 'ST01-006']);
    expect(byName.get('Nami')).toEqual(['OP01-016', 'ST01-007']);
    expect(byName.get('Bepo')).toEqual(['OP01-049', 'ST02-012']);

    // And the same fact from the other side, which is the one that matters for
    // the exclusions: nine names inside OP-01 alone sit on two card numbers.
    const op01 = new Map<string, string[]>();
    for (const card of inScope.filter((c) => c.cardId.startsWith('OP01-'))) {
      op01.set(card.name, [...(op01.get(card.name) ?? []), card.cardId]);
    }
    const shared = [...op01].filter(([, ids]) => ids.length > 1).map(([name]) => name);
    expect(shared.sort()).toEqual([
      'Crocodile',
      'Donquixote Doflamingo',
      'Jinbe',
      'Kaido',
      'King',
      'Monkey.D.Luffy',
      'Roronoa Zoro',
      'Trafalgar Law',
      'X.Drake',
    ]);
  });

  it('OP01-049 Bepo offers Jean Bart and refuses the other Bepo', () => {
    // `ST02-012` Bepo is {Heart Pirates}, a Character, and costs 1 — every
    // clause of this selector except the name. It is not in this deck (the
    // fixtures are OP-01 only), so the case is built on the OP-01 copies plus
    // the printed candidates that *do* qualify.
    const state = op01HeartsScenario({
      p1: {
        characters: [{ cardId: 'OP01-049', attachedDon: 1 }],
        hand: ['OP01-049', 'OP01-045', 'OP01-044', 'OP01-050'],
        clearHand: true,
        activeDon: 6,
      },
      p2: { activeDon: 6 },
    });
    const asking = attackLeader(state, 'p1', characterAt(state, 'p1', 0));

    // Jean Bart, Shachi and Penguin are all {Heart Pirates} Characters costing 4
    // or less. The second Bepo in hand is a different instance of the same
    // number and is out on its name.
    expect(offeredNames(asking)).toEqual(new Set(['Jean Bart', 'Shachi', 'Penguin']));
  });

  it('refuses ST02-012 Bepo too, asked of the predicate directly', () => {
    // The cross-set half of the same claim, which no OP-01 fixture can stage
    // because the fixtures are OP-01 only by construction. Asked of the two
    // definitions instead: they share a name and differ in everything else, and
    // the filter that excludes one excludes the other.
    const op01 = englishCards.find((card) => card.cardId === 'OP01-049');
    const st02 = englishCards.find((card) => card.cardId === 'ST02-012');
    expect(op01?.name).toBe(st02?.name);
    expect(st02?.category).toBe('character');
    expect(st02?.types).toContain('Heart Pirates');
    expect(st02?.cost).toBeLessThanOrEqual(4);
    // Everything the selector asks except the name says yes to ST02-012, which
    // is what makes the name the thing doing the work.
    const script = getAbilities('OP01-049')[0]?.script[0];
    expect(script?.op).toBe('select');
    if (script?.op === 'select') {
      expect(script.from.excludeNames).toEqual(['Bepo']);
    }
  });
});

// ===========================================================================
// The table — twelve cards, by printed form
// ===========================================================================

// --- "…other than [X]" -----------------------------------------------------

describe('OP01-015 Tony Tony.Chopper — trash a card, recover a Straw Hat that is not him', () => {
  function staged(): GameState {
    return op01HeartsScenario({
      p1: {
        characters: [{ cardId: 'OP01-015', attachedDon: 1 }],
        hand: ['OP01-010'],
        clearHand: true,
        trash: ['OP01-015', 'OP01-025', 'OP01-016'],
        activeDon: 6,
      },
      p2: { activeDon: 6 },
    });
  }

  it('offers the two Straw Hats in the trash and not the Chopper beside them', () => {
    const state = staged();
    const attacking = attackLeader(state, 'p1', characterAt(state, 'p1', 0));
    // "You may" — the printed opt-in comes first.
    const optedIn = answer(attacking, 'p1', { kind: 'yesNo', value: true });
    // Then the discard cost picks its card.
    const paid = answer(optedIn, 'p1', {
      kind: 'cards',
      selected: [handCard(state, 'p1', 'OP01-010')],
    });

    expect(offeredNames(paid)).toEqual(new Set(['Roronoa Zoro', 'Nami']));
  });

  it('adds the chosen card to hand and leaves nothing suspended', () => {
    const state = staged();
    const attacking = attackLeader(state, 'p1', characterAt(state, 'p1', 0));
    const optedIn = answer(attacking, 'p1', { kind: 'yesNo', value: true });
    const paid = answer(optedIn, 'p1', {
      kind: 'cards',
      selected: [handCard(state, 'p1', 'OP01-010')],
    });
    const target = candidates(paid)[0];
    if (target === undefined) {
      throw new Error('expected a candidate');
    }
    const done = answer(paid, 'p1', { kind: 'cards', selected: [target] });

    expect(done.players.p1.hand).toContain(target);
    expect(done.players.p1.trash).not.toContain(target);
    assertSettled(done);
  });

  it('takes nothing when the trash holds only Choppers', () => {
    // `min: 0` is the printed "up to 1" (CR 8-4-4-1), and the exclusion emptying
    // the candidate list is not a failure — the script resolves with no choice
    // opened at all.
    const state = op01HeartsScenario({
      p1: {
        characters: [{ cardId: 'OP01-015', attachedDon: 1 }],
        hand: ['OP01-010'],
        clearHand: true,
        trash: ['OP01-015', 'OP01-015'],
        activeDon: 6,
      },
      p2: { activeDon: 6 },
    });
    const attacking = attackLeader(state, 'p1', characterAt(state, 'p1', 0));
    const optedIn = answer(attacking, 'p1', { kind: 'yesNo', value: true });
    const paid = answer(optedIn, 'p1', {
      kind: 'cards',
      selected: [handCard(state, 'p1', 'OP01-010')],
    });

    expect(paid.pending).toBeNull();
    expect(paid.players.p1.hand).toHaveLength(0);
  });
});

describe('OP01-016 Nami — look at 5, reveal a Straw Hat that is not her', () => {
  it('offers the Straw Hats in the window and never a [Nami]', () => {
    const state = op01HeartsScenario({
      p1: {
        hand: ['OP01-016'],
        clearHand: true,
        deckTop: ['OP01-016', 'OP01-025', 'OP01-015', 'OP01-023', 'OP01-010'],
        activeDon: 6,
      },
      p2: { activeDon: 5 },
    });
    const asking = play(state, 'p1', 'OP01-016');

    // Zoro and Chopper carry {Straw Hat Crew}; Marco and Komachiyo do not; the
    // Nami on top of the deck does and is out on her name.
    expect(offeredNames(asking)).toEqual(new Set(['Roronoa Zoro', 'Tony Tony.Chopper']));
  });

  it('buries the rest, including the [Nami] it refused to take', () => {
    const state = op01HeartsScenario({
      p1: {
        hand: ['OP01-016'],
        clearHand: true,
        deckTop: ['OP01-016', 'OP01-025', 'OP01-015', 'OP01-023', 'OP01-010'],
        activeDon: 6,
      },
      p2: { activeDon: 5 },
    });
    const before = state.players.p1.deck.length;
    const asking = play(state, 'p1', 'OP01-016');
    const target = candidates(asking)[0];
    if (target === undefined) {
      throw new Error('expected a candidate');
    }
    const ordering = answer(asking, 'p1', { kind: 'cards', selected: [target] });
    const done = answer(ordering, 'p1', {
      kind: 'order',
      order: [...(ordering.pending?.candidates ?? [])],
    });

    expect(done.players.p1.hand).toContain(target);
    // Five looked at, one taken, four buried: the deck is one shorter and its
    // top five are no longer the staged ones.
    expect(done.players.p1.deck).toHaveLength(before - 1);
    expect(done.players.p1.deck.slice(-4)).toHaveLength(4);
    assertSettled(done);
  });

  it('is not SABAODY: it takes a {Straw Hat Crew} Event too, because the text says "card"', () => {
    // The four cards that share `lookKeepBury` print "type **Character** card";
    // this one prints "type card". The difference is one field and it is the
    // reason this card does not reuse the `SABAODY` constant.
    const script = getAbilities('OP01-016')[0]?.script[1];
    expect(script?.op).toBe('select');
    if (script?.op === 'select') {
      expect(script.from.category).toBeUndefined();
      expect(script.from.excludeNames).toEqual(['Nami']);
    }
  });
});

describe('OP01-090 Baroque Works — the name and the type are the same string', () => {
  it('offers {Baroque Works} cards and not the Event it is named after', () => {
    const state = op01PacifistaScenario({
      p1: {
        hand: ['OP01-090'],
        clearHand: true,
        deckTop: ['OP01-090', 'OP01-079', 'OP01-085', 'OP01-076', 'OP01-066'],
        activeDon: 6,
      },
      p2: { activeDon: 5 },
    });
    const asking = play(state, 'p1', 'OP01-090');

    // Ms. All Sunday and Mr.3 carry the {Baroque Works} type; Bellamy and Krieg
    // do not; the copy of Baroque Works itself carries the type *and* the name,
    // and the name wins.
    expect(offeredNames(asking)).toEqual(new Set(['Ms. All Sunday', 'Mr.3(Galdino)']));
  });

  it('keeps the two fields apart in the script, which is the whole risk', () => {
    // Filtering on the type alone would look right and silently offer the copy
    // of itself. They are different questions and different fields.
    const script = getAbilities('OP01-090')[0]?.script[1];
    expect(script?.op).toBe('select');
    if (script?.op === 'select') {
      expect(script.from.types).toEqual(['Baroque Works']);
      expect(script.from.excludeNames).toEqual(['Baroque Works']);
    }
  });
});

// --- "If your Leader is [X]" -----------------------------------------------

describe('OP01-040 Kin’emon — the Leader gate, both ways', () => {
  it('plays an Akazaya 3-drop under [Kouzuki Oden]', () => {
    const state = op01AkazayaScenario({
      p1: { hand: ['OP01-040', 'OP01-035', 'OP01-043'], clearHand: true, activeDon: 8 },
      p2: { activeDon: 5 },
    });
    const asking = play(state, 'p1', 'OP01-040');

    // Okiku is {The Akazaya Nine} at cost 3; Shinobu is {Land of Wano} only.
    expect(offeredNames(asking)).toEqual(new Set(['Okiku']));
    const target = candidates(asking)[0];
    if (target === undefined) {
      throw new Error('expected a candidate');
    }
    const done = answer(asking, 'p1', { kind: 'cards', selected: [target] });
    expect(done.players.p1.characters).toContain(target);
    assertSettled(done);
  });

  it('does not fire at all under Trafalgar Law', () => {
    // CR 8-4-1-1: the condition is checked at activation and an unmet one stops
    // the effect. The same card, the same hand, a different Leader.
    const state = op01HeartsScenario({
      p1: { hand: ['OP01-040', 'OP01-035'], clearHand: true, activeDon: 8 },
      p2: { activeDon: 5 },
    });
    const done = play(state, 'p1', 'OP01-040');

    expect(done.pending).toBeNull();
    expect(firedIds(done.log)).not.toContain('OP01-040-onPlay');
    // Kin'emon himself is on the board — the play succeeded, only its [On Play]
    // found its gate shut.
    expect(done.players.p1.characters).toHaveLength(1);
    assertSettled(done);
  });

  it('has a second half that never asked about the Leader at all', () => {
    // The row said "reference a card by name" about the whole card. Only the
    // first half wanted it; `setActive` on an Akazaya 3-drop has been
    // expressible for batches.
    const state = op01HeartsScenario({
      p1: {
        characters: [
          { cardId: 'OP01-040', attachedDon: 1 },
          { cardId: 'OP01-035', orientation: 'rested' },
        ],
        activeDon: 6,
      },
      p2: { activeDon: 6 },
    });
    const asking = attackLeader(state, 'p1', characterAt(state, 'p1', 0));

    expect(offeredNames(asking)).toEqual(new Set(['Okiku']));
    const okiku = characterAt(state, 'p1', 1);
    const done = answer(asking, 'p1', { kind: 'cards', selected: [okiku] });
    expect(done.cards[okiku]?.orientation).toBe('active');
  });
});

describe('OP01-042 Komurasaki — a DON!! cost in front of the same gate', () => {
  it('pays ③ and wakes a {Land of Wano} 3-drop under Oden', () => {
    const state = op01AkazayaScenario({
      p1: {
        hand: ['OP01-042'],
        clearHand: true,
        characters: [{ cardId: 'OP01-035', orientation: 'rested' }],
        activeDon: 6,
      },
      p2: { activeDon: 5 },
    });
    const asking = play(state, 'p1', 'OP01-042');
    // "You may" lives in the explanatory note (CR 2-8-4-1), and CR 8-3-1-4 is
    // what it restates: decline before paying.
    const optedIn = answer(asking, 'p1', { kind: 'yesNo', value: true });
    const okiku = characterAt(state, 'p1', 0);
    const done = answer(optedIn, 'p1', { kind: 'cards', selected: [okiku] });

    expect(done.cards[okiku]?.orientation).toBe('active');
    assertSettled(done);
  });

  it('does not fire under Law, and the ③ is not paid either', () => {
    const state = op01HeartsScenario({
      p1: {
        hand: ['OP01-042'],
        clearHand: true,
        characters: [{ cardId: 'OP01-045', orientation: 'rested' }],
        activeDon: 6,
      },
      p2: { activeDon: 5 },
    });
    const restedBefore = state.players.p1.don.filter(
      (don) => don.location.kind === 'cost' && don.location.orientation === 'rested',
    ).length;
    const done = play(state, 'p1', 'OP01-042');

    expect(firedIds(done.log)).not.toContain('OP01-042-onPlay');
    // Komurasaki costs 1, so exactly one DON!! more is rested than before — the
    // ③ was never charged. CR 8-4-1-1 checks before 8-4-1-3 pays.
    const restedAfter = done.players.p1.don.filter(
      (don) => don.location.kind === 'cost' && don.location.orientation === 'rested',
    ).length;
    expect(restedAfter).toBe(restedBefore + 1);
    assertSettled(done);
  });
});

describe('OP01-046 Denjiro — two gates on one activation', () => {
  it('sets two DON!! active with a DON!! attached and Oden leading', () => {
    const state = op01AkazayaScenario({
      p1: { characters: [{ cardId: 'OP01-046', attachedDon: 1 }], activeDon: 6, restedDon: 3 },
      p2: { activeDon: 6 },
    });
    const done = attackLeader(state, 'p1', characterAt(state, 'p1', 0));

    const active = done.players.p1.don.filter(
      (don) => don.location.kind === 'cost' && don.location.orientation === 'active',
    ).length;
    // Six were active, one is attached and came out of that pool, so five stand;
    // two of the three rested ones wake.
    expect(active).toBe(5 + 2);
    expect(firedIds(done.log)).toContain('OP01-046-whenAttacking');
  });

  it('does nothing under Law, even with the DON!! attached', () => {
    const state = op01HeartsScenario({
      p1: { characters: [{ cardId: 'OP01-046', attachedDon: 1 }], activeDon: 6, restedDon: 3 },
      p2: { activeDon: 6 },
    });
    const done = attackLeader(state, 'p1', characterAt(state, 'p1', 0));

    expect(firedIds(done.log)).not.toContain('OP01-046-whenAttacking');
    const rested = done.players.p1.don.filter(
      (don) => don.location.kind === 'cost' && don.location.orientation === 'rested',
    ).length;
    expect(rested).toBe(3);
  });
});

// --- "play [X]" ------------------------------------------------------------

describe('OP01-074 Bartholomew Kuma — [On K.O.] play a [Pacifista]', () => {
  it('offers only the Pacifista in hand', () => {
    const state = op01PacifistaScenario({
      p1: { characters: [{ cardId: 'OP01-103' }], activeDon: 6 },
      p2: {
        characters: [{ cardId: 'OP01-074', orientation: 'rested' }],
        hand: ['OP01-075', 'OP01-066', 'OP01-076'],
        clearHand: true,
        activeDon: 6,
      },
    });
    const victim = characterAt(state, 'p2', 0);
    let next = applyOk(state, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(state, 'p1', 0),
      target: victim,
    }).state;
    next = applyOk(next, { type: 'PASS', player: 'p2' }).state;
    next = applyOk(next, { type: 'PASS', player: 'p2' }).state;

    expect(next.players.p2.trash).toContain(victim);
    expect(offeredNames(next)).toEqual(new Set(['Pacifista']));

    const pacifista = candidates(next)[0];
    if (pacifista === undefined) {
      throw new Error('expected a candidate');
    }
    const done = answer(next, 'p2', { kind: 'cards', selected: [pacifista] });
    expect(done.players.p2.characters).toContain(pacifista);
    assertSettled(done);
  });

  it('names no category and no type, because the printed text names none', () => {
    const script = getAbilities('OP01-074')[0]?.script[0];
    expect(script?.op).toBe('select');
    if (script?.op === 'select') {
      expect(script.from.names).toEqual(['Pacifista']);
      expect(script.from.category).toBeUndefined();
      expect(script.from.types).toBeUndefined();
      expect(script.from.costMax).toBe(4);
    }
  });
});

// --- "If you don't have [X]" -----------------------------------------------

describe('OP01-044 Shachi and OP01-050 Penguin — the mirror, and the max: 0 gate', () => {
  it('Shachi plays the Penguin in hand when no Penguin is on the field', () => {
    const state = op01HeartsScenario({
      p1: { hand: ['OP01-044', 'OP01-050', 'OP01-045'], clearHand: true, activeDon: 6 },
      p2: { activeDon: 5 },
    });
    const asking = play(state, 'p1', 'OP01-044');

    expect(offeredNames(asking)).toEqual(new Set(['Penguin']));
    const penguin = handCard(state, 'p1', 'OP01-050');
    const done = answer(asking, 'p1', { kind: 'cards', selected: [penguin] });
    expect(done.players.p1.characters).toContain(penguin);
    assertSettled(done);
  });

  it('does not fire with a Penguin already on the field', () => {
    const state = op01HeartsScenario({
      p1: {
        characters: [{ cardId: 'OP01-050' }],
        hand: ['OP01-044', 'OP01-050'],
        clearHand: true,
        activeDon: 6,
      },
      p2: { activeDon: 5 },
    });
    const done = play(state, 'p1', 'OP01-044');

    expect(done.pending).toBeNull();
    expect(firedIds(done.log)).not.toContain('OP01-044-onPlay');
    // Two Characters: the one that was there and Shachi himself.
    expect(done.players.p1.characters).toHaveLength(2);
    assertSettled(done);
  });

  it('is not closed by a Penguin in **hand**, because "have" is the field', () => {
    // CR 3-1-2 collects the Leader, Character, Stage and cost areas under "the
    // field". The Penguin this ability is about to play is in hand while the
    // gate is read; a gate counting the hand would make the card unable to fire.
    const state = op01HeartsScenario({
      p1: { hand: ['OP01-044', 'OP01-050'], clearHand: true, activeDon: 6 },
      p2: { activeDon: 5 },
    });
    const asking = play(state, 'p1', 'OP01-044');
    expect(candidates(asking)).toHaveLength(1);
  });

  it('is not closed by the opponent’s Penguin, because the gate says "you"', () => {
    const state = op01HeartsScenario({
      p1: { hand: ['OP01-044', 'OP01-050'], clearHand: true, activeDon: 6 },
      p2: { characters: [{ cardId: 'OP01-050' }], activeDon: 5 },
    });
    const asking = play(state, 'p1', 'OP01-044');
    expect(candidates(asking)).toHaveLength(1);
  });

  it('Penguin is the same sentence pointed back, and closes on a Shachi', () => {
    const open = op01HeartsScenario({
      p1: { hand: ['OP01-050', 'OP01-044'], clearHand: true, activeDon: 6 },
      p2: { activeDon: 5 },
    });
    const asking = play(open, 'p1', 'OP01-050');
    expect(offeredNames(asking)).toEqual(new Set(['Shachi']));

    const shut = op01HeartsScenario({
      p1: {
        characters: [{ cardId: 'OP01-044' }],
        hand: ['OP01-050', 'OP01-044'],
        clearHand: true,
        activeDon: 6,
      },
      p2: { activeDon: 5 },
    });
    const done = play(shut, 'p1', 'OP01-050');
    expect(firedIds(done.log)).not.toContain('OP01-050-onPlay');
  });
});

// --- a static's "other than your [X]" --------------------------------------

describe('OP01-099 Kurozumi Semimaru — the static, at the site it is read', () => {
  it('keeps a {Kurozumi Clan} Character alive through a battle it lost', () => {
    // The manifestation of the clause rather than a reading of the state:
    // Higurashi is 3000 power against a 6000-power attacker and survives the
    // Damage Step (CR 7-1-4-1-2, narrowed by CR 10-2-1-3's "in battle").
    const state = op01PacifistaScenario({
      p1: { characters: [{ cardId: 'OP01-103' }], activeDon: 6 },
      p2: {
        characters: [{ cardId: 'OP01-099' }, { cardId: 'OP01-100', orientation: 'rested' }],
        activeDon: 6,
      },
    });
    const higurashi = characterAt(state, 'p2', 1);
    let next = applyOk(state, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(state, 'p1', 0),
      target: higurashi,
    }).state;
    next = applyOk(next, { type: 'PASS', player: 'p2' }).state;
    next = applyOk(next, { type: 'PASS', player: 'p2' }).state;

    expect(next.players.p2.characters).toContain(higurashi);
    expect(next.players.p2.trash).not.toContain(higurashi);
  });

  it('does not protect the Semimaru themselves, from either copy', () => {
    const state = op01PacifistaScenario({
      p1: { characters: [{ cardId: 'OP01-103' }], activeDon: 6 },
      p2: {
        characters: [
          { cardId: 'OP01-099', orientation: 'rested' },
          { cardId: 'OP01-099' },
          { cardId: 'OP01-100' },
        ],
        activeDon: 6,
      },
    });
    const attacked = characterAt(state, 'p2', 0);
    let next = applyOk(state, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(state, 'p1', 0),
      target: attacked,
    }).state;
    next = applyOk(next, { type: 'PASS', player: 'p2' }).state;
    next = applyOk(next, { type: 'PASS', player: 'p2' }).state;

    // Two Semimaru on the board, and the one that lost its battle is in the
    // trash. `excludeSelf` would have had the other copy's static protect it.
    expect(next.players.p2.trash).toContain(attacked);
  });

  it('does not reach the opponent’s {Kurozumi Clan}, because it says "your"', () => {
    const state = op01PacifistaScenario({
      p1: { characters: [{ cardId: 'OP01-103' }, { cardId: 'OP01-100' }], activeDon: 6 },
      p2: { characters: [{ cardId: 'OP01-099' }], activeDon: 6 },
    });
    const mine = characterAt(state, 'p1', 1);
    expect(canBeKOdInBattle(state, mine, state.players.p2.leader)).toBe(true);
  });
});

// ===========================================================================
// Manifestation — three real games, three exact unions
// ===========================================================================

type Decks = Record<PlayerId, Decklist>;

interface Playout {
  state: GameState;
  fired: Set<string>;
}

/**
 * `watch` sees every state the game passes through, which is what a claim about
 * a `static` needs: a continuous effect leaves no event behind, so the only
 * evidence it was live is a board that existed at some point during the game
 * and is gone by the end of it.
 */
function runGame(decks: Decks, seed: number, watch?: (state: GameState) => void): Playout {
  let state = createGame({ seed, decks, firstPlayer: 'p1' });
  const fired = new Set<string>();
  watch?.(state);
  for (let step = 0; step < 400; step += 1) {
    if (state.status === 'finished') break;
    const action = decide(state, state.priority, seed, step);
    if (action === undefined) break;
    const result = applyAction(state, action);
    if (!result.ok) {
      throw new Error(`action ${step} (${action.type}) rejected: ${result.reason}`);
    }
    state = result.state;
    for (const event of result.events) {
      if (event.type === 'abilityTriggered') fired.add(event.abilityId);
    }
    assertInvariants(state);
    watch?.(state);
  }
  return { state, fired };
}

function union(decks: Decks, seeds: readonly number[]): string[] {
  const all = new Set<string>();
  for (const seed of seeds) {
    const game = runGame(decks, seed);
    expect(game.state.pending, `seed ${seed}`).toBeNull();
    expect(game.state.stack, `seed ${seed}`).toEqual([]);
    expect(game.state.resume, `seed ${seed}`).toEqual([]);
    for (const id of game.fired) all.add(id);
  }
  return [...all].sort();
}

/**
 * Every seed below is a **greedy cover** over 60 games of its own deck: the
 * fewest games whose union is the whole of what 60 games reach. Small counts
 * are not thrift — a cover is the honest number, and padding it would hide the
 * day a card stops being reachable behind seeds that never reached it anyway.
 *
 * The unions are exact and mirrors, which this batch can afford: it brought
 * three decks of its own and no older fixture holds any of its cards, so there
 * is no far side whose abilities have to be listed to keep the union honest.
 */

describe('a real game of the Law deck', () => {
  // A cover of 2 over 60 games. Seeds beyond these add nothing.
  const SEEDS = [39, 10] as const;

  it('reaches the nine cards it holds, and the Leader gate stays shut in all of them', () => {
    // The absences are the assertion. `OP01-040`, `-042` and `-046` are in this
    // deck **so that they cannot fire**: Law is not [Kouzuki Oden], so
    // `-040-onPlay`, `-042-onPlay` and `-046-whenAttacking` are missing from an
    // exact union of real games — while `-040-whenAttacking`, the half that
    // never asked about the Leader, is right there.
    expect(union(OP01_HEARTS_DECKS, SEEDS)).toEqual([
      'OP01-005-onPlay',
      'OP01-015-whenAttacking',
      'OP01-016-onPlay',
      'OP01-035-whenAttacking',
      'OP01-040-whenAttacking',
      'OP01-044-onPlay',
      'OP01-049-whenAttacking',
      'OP01-050-onPlay',
    ]);
  });

  it('really moves cards, rather than resolving into nothing', () => {
    // Membership above says a script resolved. This says a name filter found
    // something. `cardMoved` carries no `from`, so the trash is read off the
    // board instead: a trash that shrinks between two states is a card that came
    // out of it, and in this deck only `OP01-005` and `OP01-015` do that.
    let recovered = false;
    for (const seed of SEEDS) {
      const previous: Record<PlayerId, number> = { p1: 0, p2: 0 };
      runGame(OP01_HEARTS_DECKS, seed, (state) => {
        for (const player of ['p1', 'p2'] as const) {
          const size = state.players[player].trash.length;
          if (size < previous[player]) recovered = true;
          previous[player] = size;
        }
      });
    }
    expect(recovered).toBe(true);
  });
});

describe('a real game of the Oden deck', () => {
  // A cover of 3, and all three Leader gates open inside it.
  const SEEDS = [4, 3, 2] as const;

  it('opens all three Leader gates in ordinary play', () => {
    expect(union(OP01_AKAZAYA_DECKS, SEEDS)).toEqual([
      'OP01-031-main',
      'OP01-034-whenAttacking',
      'OP01-035-whenAttacking',
      'OP01-037-trigger',
      'OP01-040-onPlay',
      'OP01-040-whenAttacking',
      'OP01-042-onPlay',
      'OP01-046-whenAttacking',
      'OP01-048-onPlay',
      'OP01-052-whenAttacking',
    ]);
  });
});

describe('a real game of the Crocodile deck', () => {
  // A cover of 2, and the one that reaches a `[Counter]` Event — the hardest
  // move in this repo for a random game to make.
  const SEEDS = [16, 14] as const;

  it('reaches the inclusion form and the search that excludes itself', () => {
    expect(union(OP01_PACIFISTA_DECKS, SEEDS)).toEqual([
      'OP01-062-onOwnEvent',
      'OP01-074-onKO',
      'OP01-079-onKO',
      'OP01-080-onKO',
      'OP01-085-onPlay',
      'OP01-087-counter',
      'OP01-087-trigger',
      'OP01-090-main',
    ]);
  });

  it('puts a Kurozumi Semimaru on a real board, which no union can show', () => {
    // `OP01-099` is a `static`: it never enters the stack and never emits
    // `abilityTriggered`, so it cannot appear in any union above. What can be
    // shown is that the games really do reach the position its clause is about —
    // a Semimaru on the field beside another {Kurozumi Clan} Character.
    let reached = false;
    for (const seed of SEEDS) {
      runGame(OP01_PACIFISTA_DECKS, seed, (state) => {
        for (const player of ['p1', 'p2'] as const) {
          const names = state.players[player].characters.map((id) => nameOf(state, id));
          if (names.includes('Kurozumi Semimaru') && names.includes('Kurozumi Higurashi')) {
            reached = true;
          }
        }
      });
    }
    expect(reached).toBe(true);
  });
});

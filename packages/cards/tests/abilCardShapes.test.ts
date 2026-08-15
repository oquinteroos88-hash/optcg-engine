import { describe, expect, it } from 'vitest';
import { getAbilities } from '@optcg/engine';
import type { Ability, Instruction } from '@optcg/engine';
import { ABIL_CARDS } from '@optcg/engine/testdata/abilities';
import { englishCards, registerEnglishCards } from '../src/index.js';

registerEnglishCards();

/**
 * The ABIL set may be synthetic, but it must not be *impossible*.
 *
 * The `counterEvent` trigger looked reachable for a year because ABIL-016 was an
 * Event with a printed Counter value AND a [Counter] ability — a combination no
 * printed card has (no real Event, Leader, or Stage carries a Counter value).
 * That invented shape stood in for a card the game actually prints and hid a
 * missing engine move.
 *
 * This guard pins the reachability-relevant printed fields — category and
 * whether a Counter value is printed — and asserts that every ABIL card's
 * combination has a real counterpart in `cards.en.json`. The set stays free to
 * be synthetic in its effects and its stat lines; it may not invent a
 * category/counter shape the game never prints. Re-introducing ABIL-016's old
 * shape (or any Event/Leader/Stage with a printed Counter) flips the list below
 * off empty and fails here, loudly, before anyone reads it as reachability.
 */

/** The printed fields that decide how a card enters the Counter Step. */
function shapeOf(card: { category: string; counter: number | null }): string {
  return `${card.category}|${card.counter !== null ? 'counter' : 'noCounter'}`;
}

describe('the ABIL set prints only shapes the real set also prints', () => {
  const realShapes = new Set(englishCards.map(shapeOf));

  it('has no Event, Leader, or Stage with a printed Counter value in the real set', () => {
    // The teeth of the guard: these are the shapes ABIL-016 used to fake.
    expect(realShapes.has('event|counter')).toBe(false);
    expect(realShapes.has('leader|counter')).toBe(false);
    expect(realShapes.has('stage|counter')).toBe(false);
    // And the shapes that legitimately exist, so the guard is not vacuous.
    expect(realShapes.has('event|noCounter')).toBe(true);
    expect(realShapes.has('character|counter')).toBe(true);
  });

  it('lists no ABIL card whose category/counter shape the real set never prints', () => {
    const unreal = ABIL_CARDS.filter((card) => !realShapes.has(shapeOf(card)))
      .map((card) => card.cardId)
      .sort();

    // Empty since ABIL-016 became a `counter: null` [Counter] Event. It was the
    // sole member while it carried `counter: 1000`.
    expect(unreal).toEqual([]);
  });
});

/**
 * `counterEvent` fires from two sites, and only one of them is reachable.
 *
 * `applyPlayCounterEvent` (PLAY_COUNTER_EVENT) is the live one — an Event
 * activated from hand for its printed cost. `applyPlayCounter` (PLAY_COUNTER)
 * also fires the trigger after discarding a card for its printed Counter value,
 * on the reasonable rule that a Counter card with an effect resolves it. No
 * printed card can take that path: the two shapes do not intersect anywhere in
 * the set.
 *
 * That is not a reason to delete the line. It is a reason to pin the fact, the
 * way the guard above pins ABIL-016's old shape: the day a card prints both, the
 * path stops being unreachable and this test says so out loud instead of the
 * behaviour appearing unannounced.
 */
describe('the PLAY_COUNTER firing site for counterEvent is unreachable', () => {
  const withCounterMarker = englishCards.filter(
    (card) =>
      (card.effectText ?? '').includes('[Counter]') ||
      (card.triggerText ?? '').includes('[Counter]'),
  );

  it('has no card with both a printed Counter value and a [Counter] ability', () => {
    // The measurement, over the whole set rather than the starter decks: 184
    // cards carry the marker, all of them Events, none with a Counter value.
    expect(withCounterMarker).toHaveLength(184);
    expect([...new Set(withCounterMarker.map((card) => card.category))]).toEqual(['event']);
    expect(withCounterMarker.filter((card) => card.counter !== null)).toEqual([]);
  });

  it('routes no registered card into the trigger through a printed Counter value', () => {
    // The same claim asked of the engine's own predicate rather than of the
    // text: a card is offered as a Counter Event when it has a `counterEvent`
    // ability, and is discardable for its value when `counter !== null`.
    const both = englishCards.filter(
      (card) =>
        card.counter !== null &&
        getAbilities(card.cardId).some((ability) => ability.trigger === 'counterEvent'),
    );
    expect(both.map((card) => card.cardId)).toEqual([]);
  });

  it('lets no ABIL card fake the combination either', () => {
    // ABIL-016 held exactly this shape once, which is what made the trigger look
    // reachable through PLAY_COUNTER while the real move was missing.
    const faking = ABIL_CARDS.filter(
      (card) =>
        card.counter !== null &&
        (card.abilities ?? []).some((ability) => ability.trigger === 'counterEvent'),
    );
    expect(faking.map((card) => card.cardId)).toEqual([]);
  });
});

/**
 * `lookAt` and the selector that reads the same window must agree on the count.
 *
 * Nothing in the type system says so. The script writes the top N into a
 * variable and then offers a `deckTop` selector over the same N, and "the rest"
 * is the difference between them — so a script whose two numbers disagree
 * silently buries the wrong set: too few and a looked-at card is left on top of
 * the deck, too many and the select offers a card the look never saw.
 *
 * It is safe today because `lookAt` does not suspend, so nothing can run
 * between the two instructions. This is the part that is checkable, and it is
 * checked rather than asserted in a comment.
 */
describe('a look-at window and the selector over it name the same number of cards', () => {
  it('holds for every registered card and every ABIL card', () => {
    const mismatches: string[] = [];
    const scripts: Array<{ id: string; script: readonly Instruction[] }> = [];
    for (const card of englishCards) {
      for (const ability of getAbilities(card.cardId)) {
        scripts.push({ id: `${card.cardId}/${ability.id}`, script: ability.script });
      }
    }
    for (const card of ABIL_CARDS) {
      for (const ability of card.abilities ?? []) {
        scripts.push({ id: `${card.cardId}/${ability.id}`, script: ability.script });
      }
    }

    for (const { id, script } of scripts) {
      const looked = script.find((op) => op.op === 'lookAt');
      if (looked === undefined || looked.op !== 'lookAt') {
        continue;
      }
      for (const step of script) {
        if (step.op !== 'select' || step.from.zone !== 'deckTop') {
          continue;
        }
        if ((step.from.count ?? 1) !== looked.count) {
          mismatches.push(`${id}: lookAt ${looked.count} against deckTop ${step.from.count ?? 1}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });
});

/**
 * **Every card name a script names must be a name some card actually has.**
 *
 * `names` and `excludeNames` are free strings, and a free string is a typo
 * waiting to happen — one that no type checks and no test notices, because a
 * filter matching nobody does not throw. It quietly narrows: "other than
 * [Nam]" excludes nothing and the card silently offers itself; "play up to 1
 * [Pacifist]" offers an empty list and the ability resolves into nothing. Both
 * look exactly like a card that legitimately found no target.
 *
 * So the resolution is pinned as a guard rather than performed once by hand.
 * `nameReferences` walks the ability tree **structurally** instead of naming the
 * fields that can hold a predicate — a script is plain JSON with no functions
 * and no cycles, so a deep walk reaches every one, including the ones on ops
 * that do not exist yet. A predicate-carrying op added tomorrow is covered
 * without this file being touched.
 *
 * Each set is checked against **its own** registry: a typo in an ABIL script
 * must not be rescued by a real card that happens to be called that.
 */

/** Every string in `names`/`excludeNames` anywhere in an ability, with a path. */
function nameReferences(ability: Ability): Array<{ where: string; name: string }> {
  const found: Array<{ where: string; name: string }> = [];

  function walk(node: unknown, path: string): void {
    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        walk(item, `${path}[${index}]`);
      });
      return;
    }
    if (node === null || typeof node !== 'object') {
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if ((key === 'names' || key === 'excludeNames') && Array.isArray(value)) {
        for (const name of value) {
          found.push({ where: `${path}.${key}`, name: String(name) });
        }
        continue;
      }
      walk(value, `${path}.${key}`);
    }
  }

  walk(ability, ability.id);
  return found;
}

/** Every string in an `attributes` filter anywhere in an ability. */
function walkAttributes(ability: Ability, visit: (attribute: string) => void): void {
  function walk(node: unknown): void {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node === null || typeof node !== 'object') {
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'attributes' && Array.isArray(value)) {
        for (const attribute of value) {
          visit(String(attribute));
        }
        continue;
      }
      walk(value);
    }
  }
  walk(ability);
}

/** Names that no card in `defs` carries. Empty is the only passing answer. */
function unresolved(
  defs: readonly { cardId: string; name: string }[],
  abilities: Array<{ id: string; ability: Ability }>,
): string[] {
  const known = new Set(defs.map((def) => def.name));
  const misses: string[] = [];
  for (const { id, ability } of abilities) {
    for (const reference of nameReferences(ability)) {
      if (!known.has(reference.name)) {
        misses.push(`${id}/${reference.where}: no card is named "${reference.name}"`);
      }
    }
  }
  return misses;
}

describe('every name a script filters on resolves to a real card', () => {
  const registered: Array<{ id: string; ability: Ability }> = englishCards.flatMap((card) =>
    getAbilities(card.cardId).map((ability) => ({ id: card.cardId, ability })),
  );
  const synthetic: Array<{ id: string; ability: Ability }> = ABIL_CARDS.flatMap((card) =>
    (card.abilities ?? []).map((ability) => ({ id: card.cardId, ability })),
  );

  it('holds for every registered card', () => {
    expect(unresolved(englishCards, registered)).toEqual([]);
  });

  it('holds for every ABIL card, against the ABIL set alone', () => {
    expect(unresolved(ABIL_CARDS, synthetic)).toEqual([]);
  });

  it('is not vacuous — the ABIL set really does filter on a name', () => {
    // A guard over an empty set passes for the wrong reason. The registered
    // half of that claim is pinned as an exact list in
    // `op01NameReference.test.ts`, where the cards that put names into scripts
    // live; this is the synthetic half.
    const names = synthetic.flatMap((entry) => nameReferences(entry.ability)).map((r) => r.name);
    expect(new Set(names)).toEqual(new Set(['Signal Flag']));
  });

  it('catches a typo, which is the whole point', () => {
    // The teeth, shown rather than asserted about. One letter off a real card
    // name is a filter that matches nobody and fails nothing — unless something
    // resolves it, and this is that something.
    const typo: Ability = {
      id: 'TYPO-onPlay',
      trigger: 'onPlay',
      script: [
        {
          op: 'select',
          as: 'x',
          from: { zone: 'hand', owner: 'you', names: ['Kouzuki Ode'] },
          min: 0,
          max: 1,
          prompt: 'never printed',
        },
      ],
    };
    expect(unresolved(englishCards, [{ id: 'TYPO', ability: typo }])).toEqual([
      'TYPO/TYPO-onPlay.script[0].from.names: no card is named "Kouzuki Ode"',
    ]);
    // And the correctly spelled name it was one letter away from does resolve,
    // so the guard is discriminating rather than merely strict.
    const correct: Ability = {
      ...typo,
      script: [
        {
          op: 'select',
          as: 'x',
          from: { zone: 'hand', owner: 'you', names: ['Kouzuki Oden'] },
          min: 0,
          max: 1,
          prompt: 'never printed',
        },
      ],
    };
    expect(unresolved(englishCards, [{ id: 'TYPO', ability: correct }])).toEqual([]);
  });

  it('resolves every attribute a script filters on, for the same reason', () => {
    // `attributes` is the second free-string field on the shared predicate, and
    // it fails exactly the way `names` does: "＜Strke＞" matches nobody, narrows
    // silently, and looks like a card that legitimately found no target. The
    // walk is the same structural one, so a predicate-carrying op added tomorrow
    // is covered without this file being touched.
    const printed = new Set(englishCards.flatMap((card) => card.attributes));
    const referenced = new Set<string>();
    for (const card of englishCards) {
      for (const ability of getAbilities(card.cardId)) {
        walkAttributes(ability, (attribute) => referenced.add(attribute));
      }
    }
    // One card asks, and it is `OP01-024`. Pinned as an exact list rather than
    // "all resolve", so the day a second card asks it is a line in a diff.
    expect([...referenced].sort()).toEqual(['Strike']);
    for (const attribute of referenced) {
      expect(printed.has(attribute), attribute).toBe(true);
    }
    // Not vacuous: the set really does print five attributes, and a misspelling
    // of the one in scope really would fail.
    expect(printed.size).toBeGreaterThan(1);
    expect(printed.has('Strke')).toBe(false);
  });

  it('reaches a name nested inside an if, a forEach and a condition', () => {
    // The structural walk, exercised on the three places a hand-written field
    // list would be most likely to forget.
    const nested: Ability = {
      id: 'NESTED-main',
      trigger: 'activateMain',
      condition: {
        kind: 'countCards',
        selector: { zone: 'field', owner: 'you', names: ['Deep In Condition'] },
        min: 1,
      },
      cost: [{ kind: 'discardHand', count: 1, filter: { excludeNames: ['Deep In Cost'] } }],
      script: [
        {
          op: 'forEach',
          in: { selector: { zone: 'field', owner: 'you', excludeNames: ['Deep In Loop'] } },
          do: [
            {
              op: 'if',
              cond: {
                kind: 'countCards',
                selector: { zone: 'trash', owner: 'you', names: ['Deep In Branch'] },
                min: 1,
              },
              then: [{ op: 'rest', target: { var: 'it' } }],
            },
          ],
        },
      ],
    };
    expect(nameReferences(nested).map((reference) => reference.name).sort()).toEqual([
      'Deep In Branch',
      'Deep In Condition',
      'Deep In Cost',
      'Deep In Loop',
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { applyAction, canBeKOdInBattle, createGame, getPower } from '../src/index.js';
import type { GameState, InstanceId } from '../src/index.js';
import { assertInvariants } from '../src/invariants.js';
import { ABIL_DECK } from '../src/testdata/abilityDecks.js';
import type { SideSpec } from '../src/testdata/scenarios.js';
import { buildScenario, characterAt } from '../src/testdata/scenarios.js';
import { applyOk } from './helpers.js';

/**
 * The four mechanisms that finish both sets.
 *
 * | Mechanism | Printed by | Shape |
 * | --- | --- | --- |
 * | filter by attribute | `OP01-024` | `CardFilter.attributes` |
 * | a `koInBattle` that names the attacker | `OP01-024` | `LegalityClause.target` |
 * | search the whole deck, then shuffle | `OP01-069`, `OP01-098` | `Selector` zone `deck`, `shuffleDeck` |
 * | the moment a card battles | `ST02-010` | the `whenBattling` trigger |
 *
 * `ABIL-038` Vanguard carries all four. The cards' own file
 * (`packages/cards/tests/lastFour.test.ts`) is the corpus; this one is the
 * engine, and it owns the two claims a card cannot make on its own: that the
 * attribute filter reaches **every** site the shared predicate is read at, and
 * that a shuffle inside a game leaves the game byte-for-byte deterministic.
 */

const decks = { p1: ABIL_DECK, p2: ABIL_DECK };

/**
 * A side with nothing dealt into it that a staged card might be hiding in.
 *
 * `ABIL-038` has **one copy per deck** — the ABIL deck is 50 cards and the
 * eleven `PAIRED` entries are the only ones with a second — so a scenario that
 * asks for it must first make sure the copy is not sitting in the opening hand
 * or, worse, face down in the life area, where nothing can reach it. `clearHand`
 * returns the hand; naming `lifeCards` returns the life area and then takes
 * exactly what is named.
 *
 * `ABIL-002` is the set's life-card filler for the same reason `keywords.test.ts`
 * uses it: it prints no `[Trigger]`, so damage in these cases opens no question
 * nobody asked.
 */
function bare(): SideSpec {
  return { hand: [], clearHand: true, lifeCards: ['ABIL-002', 'ABIL-002'] };
}

function candidates(state: GameState): InstanceId[] {
  const pending = state.pending;
  if (pending === null) {
    throw new Error('expected an open choice');
  }
  return [...pending.candidates];
}

function answer(state: GameState, player: 'p1' | 'p2', selected: InstanceId[]): GameState {
  return applyOk(state, {
    type: 'ANSWER_CHOICE',
    player,
    choiceId: state.pending?.id ?? '',
    answer: { kind: 'cards', selected },
  }).state;
}

function assertSettled(state: GameState): void {
  expect(state.pending).toBeNull();
  expect(state.stack).toEqual([]);
  expect(state.resume).toEqual([]);
  assertInvariants(state);
}

// ===========================================================================
// The attribute filter, at all four sites at once
// ===========================================================================

/**
 * **The lesson of `OP01-051` Kid, applied before it costs anything.**
 *
 * `names` went onto `CardFilter` in PR #38 and arrived in a `LegalityClause` the
 * same day — and no test noticed until a card was written against it two PRs
 * later. A field on the shared predicate is a claim about four readers, and only
 * one of the four has a printed card asking. So all four are written here now.
 */
describe('CardFilter.attributes reaches every reader of the shared predicate', () => {
  /**
   * p1 holds Vanguard; p2 fields one ＜Strike＞ body and one ＜Slash＞ body.
   *
   * ＜Slash＞ is the default every `character()` in the ABIL set carries;
   * `ABIL-038` is the one that prints ＜Strike＞.
   */
  function staged(): GameState {
    return buildScenario({
      decks,
      p1: { ...bare(), characters: [{ cardId: 'ABIL-038' }], activeDon: 6 },
      p2: {
        ...bare(),
        characters: [{ cardId: 'ABIL-038' }, { cardId: 'ABIL-032' }],
        activeDon: 6,
      },
    });
  }

  it('site 1 — a script Selector offers only the ＜Strike＞ Character', () => {
    const state = staged();
    const opened = applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: characterAt(state, 'p1', 0),
      abilityId: 'ABIL-038-muster',
    }).state;
    // Two enemy Characters on the board and exactly one of them is offered.
    expect(candidates(opened)).toEqual([characterAt(state, 'p2', 0)]);

    const done = answer(opened, 'p1', [characterAt(state, 'p2', 0)]);
    expect(done.cards[characterAt(state, 'p2', 0)]?.orientation).toBe('rested');
    expect(done.cards[characterAt(state, 'p2', 1)]?.orientation).toBe('active');
    assertSettled(done);
  });

  it('site 2 — Condition.countCards gates on the same filter', () => {
    // The condition is the ability's own, so "no ＜Strike＞ over there" has to
    // make the ability unactivatable rather than make it resolve into nothing.
    const noStrike = buildScenario({
      decks,
      p1: { ...bare(), characters: [{ cardId: 'ABIL-038' }], activeDon: 6 },
      p2: { ...bare(), characters: [{ cardId: 'ABIL-032' }], activeDon: 6 },
    });
    const refused = applyAction(noStrike, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: characterAt(noStrike, 'p1', 0),
      abilityId: 'ABIL-038-muster',
    });
    expect(refused.ok).toBe(false);

    // And it is the attribute doing the refusing, not the absence of a body:
    // the same board with a ＜Strike＞ Character on it opens the choice.
    const withStrike = staged();
    const opened = applyAction(withStrike, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: characterAt(withStrike, 'p1', 0),
      abilityId: 'ABIL-038-muster',
    });
    expect(opened.ok).toBe(true);
  });

  it('site 3 — a static Audience selects by attribute, outside any script', () => {
    // `forEachStatic` walks this one with no script frame and no zone of its
    // own, which is the reader most likely to have been left behind.
    const state = staged();
    // ABIL-038 is ＜Strike＞ and gets its own banner: 3000 printed + 1000.
    expect(getPower(state, characterAt(state, 'p1', 0))).toBe(3000 + 1000);
    // p2's ＜Strike＞ body gets p2's own copy of the banner, and p2's ＜Slash＞
    // body gets nothing from either side — which is the filter deciding, since
    // both are in the same zone under the same `owner: 'you'`.
    expect(getPower(state, characterAt(state, 'p2', 0))).toBe(3000 + 1000);
    expect(getPower(state, characterAt(state, 'p2', 1))).toBe(2000);
  });

  it('site 4 — a LegalityClause target reads it, which is OP01-024’s own site', () => {
    const state = buildScenario({
      decks,
      p1: { ...bare(), characters: [{ cardId: 'ABIL-038', attachedDon: 2 }], activeDon: 4 },
      p2: {
        ...bare(),
        characters: [{ cardId: 'ABIL-038' }, { cardId: 'ABIL-032' }],
        activeDon: 4,
      },
    });
    const guarded = characterAt(state, 'p1', 0);
    // Immune to the ＜Strike＞ Character, and to nothing else on that board.
    expect(canBeKOdInBattle(state, guarded, characterAt(state, 'p2', 0))).toBe(false);
    expect(canBeKOdInBattle(state, guarded, characterAt(state, 'p2', 1))).toBe(true);
  });
});

// ===========================================================================
// The K.O. that is prevented — a whole battle, with a citation
// ===========================================================================

/**
 * **What the Damage Step does when the K.O. is suppressed, step by step.**
 *
 * CR 7-1-4-1-2 K.O.s the Character that lost and then "proceed to End of the
 * Battle" — and it proceeds there *either way*. So the prevention removes
 * exactly one step and nothing else: the powers are still compared, the attacker
 * still won, the attacker is still rested (CR 7-1-1-1 rests it to declare and
 * nothing in 7-1-5 gives it back), and every "during this battle" effect still
 * expires on CR 7-1-5-3 / 7-1-5-4.
 *
 * Pinned by rule rather than by expectation, because "the battle just ends
 * normally" is exactly the kind of claim that stays true until somebody adds a
 * special case.
 */
describe('a K.O. prevented in battle removes one step and no others', () => {
  /** p2's Vanguard, `[DON!! x2]` satisfied, attacked by one of p1's cards. */
  function battle(attackerId: string, attackerDon = 0): {
    before: GameState;
    after: GameState;
    attacker: InstanceId;
    guarded: InstanceId;
  } {
    const before = buildScenario({
      decks,
      firstPlayer: 'p1',
      turn: 3,
      p1: {
        ...bare(),
        characters: [{ cardId: attackerId, attachedDon: attackerDon }],
        activeDon: 8,
      },
      p2: {
        ...bare(),
        characters: [{ cardId: 'ABIL-038', attachedDon: 2, orientation: 'rested' }],
        activeDon: 8,
      },
    });
    const attacker = characterAt(before, 'p1', 0);
    const guarded = characterAt(before, 'p2', 0);
    let after = applyOk(before, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker,
      target: guarded,
    }).state;
    after = applyOk(after, { type: 'PASS', player: 'p2' }).state;
    after = applyOk(after, { type: 'PASS', player: 'p2' }).state;
    return { before, after, attacker, guarded };
  }

  it('survives a ＜Strike＞ Character that outpowered it', () => {
    const { before, after, attacker, guarded } = battle('ABIL-038', 4);
    // The attacker really did win: 3000 + 1000 banner + 4000 of DON!! against
    // 3000 + 1000 + 2000. Stated so the survival cannot be a losing attack.
    expect(getPower(before, attacker)).toBeGreaterThan(getPower(before, guarded));
    expect(after.players.p2.characters).toContain(guarded);
    expect(after.players.p2.trash).not.toContain(guarded);
    const resolved = after.log.filter((event) => event.type === 'battleResolved');
    expect(resolved.at(-1)).toMatchObject({ outcome: 'koPrevented' });
  });

  it('is a battle that ended normally, not one that never happened', () => {
    const { after, attacker } = battle('ABIL-038', 4);
    // CR 7-1-5-5: the battle is over and priority is back with the turn player.
    expect(after.battle).toBeNull();
    expect(after.priority).toBe('p1');
    // CR 7-1-1-1 rested the attacker to declare and CR 7-1-5 does not give it
    // back. A survived hit still cost the tap.
    expect(after.cards[attacker]?.orientation).toBe('rested');
    // CR 7-1-5-3 / 7-1-5-4: "during this battle" effects expire on both exits.
    expect(after.modifiers.filter((m) => m.duration === 'endOfBattle')).toEqual([]);
    // And the outcome is its own rather than borrowing `noEffect` — the attacker
    // *won*, which is a different fact from a battle with no result.
    const resolved = after.log.filter((event) => event.type === 'battleResolved');
    expect(resolved.at(-1)).not.toMatchObject({ outcome: 'noEffect' });
    assertSettled(after);
  });

  it('dies to a ＜Slash＞ Character, because the clause names the attribute', () => {
    const { before, after, attacker, guarded } = battle('ABIL-032', 6);
    // 2000 + 6000 of DON!! against 3000 + 1000 + 2000: the attacker wins, and
    // nothing about it matches the clause.
    expect(getPower(before, attacker)).toBeGreaterThan(getPower(before, guarded));
    expect(after.players.p2.trash).toContain(guarded);
  });

  it('dies to a ＜Strike＞ **Leader**, because "Characters" is the printed noun', () => {
    // `ABIL-L01` is ＜Strike＞ and is not a Character. Reachable rather than
    // pedantic: `OP01-003` is a ＜Strike＞ red/green Leader and `OP01-024` is a
    // red Character, so this is an ordinary game of the real set.
    const before = buildScenario({
      decks,
      firstPlayer: 'p1',
      turn: 3,
      p1: { ...bare(), activeDon: 8 },
      p2: {
        ...bare(),
        characters: [{ cardId: 'ABIL-038', attachedDon: 2, orientation: 'rested' }],
        activeDon: 8,
      },
    });
    const leader = before.players.p1.leader;
    const guarded = characterAt(before, 'p2', 0);
    // Asked of the gate first, so the reason is the category and not the
    // arithmetic — and then played out, so it is not only the gate.
    expect(canBeKOdInBattle(before, guarded, leader)).toBe(true);
    // 5000 against 3000 + 1000 + 2000: the attacker wins the tie (CR 7-1-4-1).
    expect(getPower(before, leader)).toBe(5000);
    expect(getPower(before, guarded)).toBe(6000);

    // So the Leader needs a DON!! to actually win it. The immunity is unrelated
    // to that and is the thing being measured.
    const armed = buildScenario({
      decks,
      firstPlayer: 'p1',
      turn: 3,
      p1: { ...bare(), activeDon: 8 },
      p2: {
        ...bare(),
        characters: [{ cardId: 'ABIL-038', attachedDon: 2, orientation: 'rested' }],
        activeDon: 8,
      },
    });
    let after = applyOk(armed, {
      type: 'ATTACH_DON',
      player: 'p1',
      to: armed.players.p1.leader,
      count: 2,
    }).state;
    after = applyOk(after, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: after.players.p1.leader,
      target: characterAt(after, 'p2', 0),
    }).state;
    after = applyOk(after, { type: 'PASS', player: 'p2' }).state;
    after = applyOk(after, { type: 'PASS', player: 'p2' }).state;
    expect(after.players.p2.trash).toContain(characterAt(armed, 'p2', 0));
  });

  it('is only about battle: a script `ko` kills it anyway', () => {
    // CR 10-2-1-3 puts "by an effect" and "due to the result of a battle" on the
    // two sides of an `or`, and this card prints the narrower half. The same
    // reading `OP01-099` got in PR #31, now asked of the **targeted** clause —
    // which is the case that test could not reach.
    const state = buildScenario({
      decks,
      p1: { ...bare(), characters: [{ cardId: 'ABIL-038' }], hand: ['ABIL-012'], activeDon: 6 },
      p2: { ...bare(), characters: [{ cardId: 'ABIL-038', attachedDon: 2 }], activeDon: 6 },
    });
    const guarded = characterAt(state, 'p2', 0);
    // The immunity is live: p1's own ＜Strike＞ Character could not K.O. it in a
    // battle, which is the state this case is about to kill it in anyway.
    expect(canBeKOdInBattle(state, guarded, characterAt(state, 'p1', 0))).toBe(false);
    // `ABIL-012` Purge K.O.s every enemy Character costing 2 or less on entry.
    // It never asks the battle gate, so the guard never gets a say.
    const done = applyOk(state, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: state.players.p1.hand[0] ?? '',
    }).state;
    expect(done.players.p2.trash).toContain(guarded);
  });
});

// ===========================================================================
// Searching the whole deck, and shuffling it
// ===========================================================================

describe('a Selector over `deck` searches the whole deck', () => {
  function staged(seed?: number): GameState {
    return buildScenario({
      decks,
      ...(seed === undefined ? {} : { seed }),
      p1: { ...bare(), characters: [{ cardId: 'ABIL-038' }], activeDon: 6 },
      p2: { ...bare(), activeDon: 6 },
    });
  }

  function search(state: GameState): GameState {
    return applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: characterAt(state, 'p1', 0),
      abilityId: 'ABIL-038-dive',
    }).state;
  }

  function flagsInDeck(state: GameState): InstanceId[] {
    return state.players.p1.deck.filter((id) => {
      const cardId = state.cards[id]?.cardId;
      return cardId === 'ABIL-032' || cardId === 'ABIL-033';
    });
  }

  it('offers every matching card in the deck, not a window of it', () => {
    const state = staged();
    const offered = candidates(search(state));
    // Both card numbers answer to "Signal Flag", and every copy still in the
    // deck is a candidate — a name is not a card number, asked of forty cards.
    expect(new Set(offered)).toEqual(new Set(flagsInDeck(state)));
    expect(offered.length).toBeGreaterThan(1);
    // And the candidate list is genuinely deeper than any window: this is the
    // widest choice the engine produces, which is the fact the client's overlay
    // had to grow a scroll for.
    expect(state.players.p1.deck.length).toBeGreaterThan(30);
  });

  it('takes the chosen card to hand and shuffles', () => {
    const state = staged();
    const opened = search(state);
    const [picked] = candidates(opened);
    if (picked === undefined) {
      throw new Error('expected at least one candidate');
    }
    const done = answer(opened, 'p1', [picked]);
    expect(done.players.p1.hand).toContain(picked);
    expect(done.players.p1.deck).not.toContain(picked);
    expect(done.log.some((event) => event.type === 'deckShuffled')).toBe(true);
    assertSettled(done);
  });

  it('shuffles even when the player takes nothing — "then" is sequence', () => {
    // CR 4-10-2: the clause after a "then" resolves even when the one before it
    // did not. And the reason it matters is not grammar — the player has *read
    // the deck*, so the shuffle is what takes that knowledge back.
    const state = staged();
    const done = answer(search(state), 'p1', []);
    expect(done.players.p1.hand).toEqual([]);
    expect(done.log.some((event) => event.type === 'deckShuffled')).toBe(true);
    assertSettled(done);
  });

  it('asks nothing when no card in the deck matches, and shuffles regardless', () => {
    const state = staged();
    // Move every Signal Flag out of the deck and into the trash — same player,
    // so card conservation and the engine's own invariants keep holding.
    const stripped = JSON.parse(JSON.stringify(state)) as GameState;
    const flags = flagsInDeck(stripped);
    stripped.players.p1.deck = stripped.players.p1.deck.filter((id) => !flags.includes(id));
    stripped.players.p1.trash.unshift(...flags);
    assertInvariants(stripped);

    const done = search(stripped);
    expect(done.pending).toBeNull();
    expect(done.log.some((event) => event.type === 'deckShuffled')).toBe(true);
    assertSettled(done);
  });

  it('moves the deck without losing or inventing a card', () => {
    const state = staged();
    const before = [...state.players.p1.deck];
    const done = answer(search(state), 'p1', []);
    expect(new Set(done.players.p1.deck)).toEqual(new Set(before));
    expect(done.players.p1.deck).toHaveLength(before.length);
    // And it really did move: a shuffle that returned the deck unchanged would
    // pass every assertion above it.
    expect(done.players.p1.deck).not.toEqual(before);
  });

  it('leaves the opponent’s deck alone — the op has no player field', () => {
    const state = staged();
    const before = [...state.players.p2.deck];
    const done = answer(search(state), 'p1', []);
    expect(done.players.p2.deck).toEqual(before);
  });
});

describe('a shuffle inside a game keeps the game deterministic', () => {
  function play(seed: number): GameState {
    const state = buildScenario({
      decks,
      seed,
      p1: { ...bare(), characters: [{ cardId: 'ABIL-038' }], activeDon: 6 },
      p2: { ...bare(), activeDon: 6 },
    });
    const opened = applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: characterAt(state, 'p1', 0),
      abilityId: 'ABIL-038-dive',
    }).state;
    return answer(opened, 'p1', []);
  }

  it('produces the same state byte for byte', () => {
    // Determinism by construction rather than by hope: `shuffleDeck` draws from
    // `state.rng`, which is the same stream and the same cursor `createGame`
    // opened. Compared as serialized JSON, which is this engine's own definition
    // of "the same state".
    expect(JSON.stringify(play(1234))).toBe(JSON.stringify(play(1234)));
  });

  it('advances the RNG cursor, so the shuffle is really drawing from it', () => {
    const state = buildScenario({
      decks,
      seed: 1234,
      p1: { ...bare(), characters: [{ cardId: 'ABIL-038' }], activeDon: 6 },
      p2: { ...bare(), activeDon: 6 },
    });
    const after = play(1234);
    expect(after.rng.seed).toBe(state.rng.seed);
    expect(after.rng.cursor).toBeGreaterThan(state.rng.cursor);
  });

  it('leaves a different seed with a different order', () => {
    // The other half of the claim: identical inputs give identical games, and
    // different ones do not. Without this the test above would pass on a shuffle
    // that ignored the RNG entirely.
    expect(play(1234).players.p1.deck).not.toEqual(play(4321).players.p1.deck);
  });
});

// ===========================================================================
// The moment a card battles
// ===========================================================================

describe('whenBattling fires at the Damage Step, on both participants', () => {
  function opened(): GameState {
    return buildScenario({
      decks,
      firstPlayer: 'p1',
      turn: 3,
      p1: { ...bare(), characters: [{ cardId: 'ABIL-038' }], activeDon: 8 },
      p2: {
        ...bare(),
        characters: [{ cardId: 'ABIL-038', orientation: 'rested' }],
        activeDon: 8,
      },
    });
  }

  function clashes(state: GameState): number {
    return state.log.filter(
      (event) => event.type === 'abilityTriggered' && event.abilityId === 'ABIL-038-clash',
    ).length;
  }

  function fight(before: GameState, target: InstanceId): GameState {
    let after = applyOk(before, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(before, 'p1', 0),
      target,
    }).state;
    after = applyOk(after, { type: 'PASS', player: 'p2' }).state;
    return applyOk(after, { type: 'PASS', player: 'p2' }).state;
  }

  it('reaches the attacker and the defender, each seeded with the other', () => {
    const before = opened();
    const after = fight(before, characterAt(before, 'p2', 0));
    // Both cards are Characters, so both conditions hold and both draw.
    expect(clashes(after)).toBe(2);
  });

  it('does not fire against a Leader, because the seed is what it asks about', () => {
    const before = opened();
    const after = fight(before, before.players.p2.leader);
    // The attacker's condition fails — the card it battled is a Leader — and the
    // Leader has no such ability of its own. `BATTLE_OPPONENT_VAR` is the whole
    // of the question: nothing here reads `state.battle`, which is closed by the
    // time the ability resolves.
    expect(clashes(after)).toBe(0);
  });

  // The other half of the timing — a battle that **ends early** and therefore
  // never battles at all — is in `battleVanished.test.ts`, which already owns
  // the cards that can remove a participant mid-battle. Nothing in the ABIL set
  // can, and duplicating that set here would be a second place to keep it.

  it('is not the declaration: nothing fires before the Counter Step is over', () => {
    // The heart of PR #35's Hawkins ruling. CR 7-1-2-2 makes a [Blocker] the new
    // target, so a reading at declaration would be about a card that is not the
    // one battled — and it would fire before the battle it names had happened.
    const before = opened();
    const declared = applyOk(before, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(before, 'p1', 0),
      target: characterAt(before, 'p2', 0),
    }).state;
    expect(clashes(declared)).toBe(0);
    const countering = applyOk(declared, { type: 'PASS', player: 'p2' }).state;
    expect(clashes(countering)).toBe(0);
    const resolved = applyOk(countering, { type: 'PASS', player: 'p2' }).state;
    expect(clashes(resolved)).toBe(2);
  });
});

describe('a game with both new mechanisms in the deck still round-trips', () => {
  it('serializes and rebuilds without loss', () => {
    // The cheapest guard against a new op or a new trigger breaking
    // serialization: the ABIL deck now carries both.
    const state = createGame({ seed: 7, decks, firstPlayer: 'p1' });
    assertInvariants(state);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

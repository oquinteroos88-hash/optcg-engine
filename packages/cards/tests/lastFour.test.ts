import { describe, expect, it } from 'vitest';
import {
  applyAction,
  assertInvariants,
  canBeKOdInBattle,
  createGame,
  getAbilities,
  getPower,
} from '@optcg/engine';
import { decide } from '@optcg/engine/testing';
import type { Decklist, GameState, InstanceId, PlayerId } from '@optcg/engine';
import {
  answer,
  applyOk,
  assertSettled,
  characterAt,
  firedIds,
  handCard,
  op01SearchScenario,
  op01StrikeScenario,
  starterScenario,
  OP01_SEARCH_DECKS,
  OP01_STRIKE_DECKS,
  STARTER_DECKS,
} from './support.js';

/**
 * **The last four cards, and with them both sets are complete.**
 *
 * | Card | What it needed | What it prints |
 * | --- | --- | --- |
 * | `OP01-024` Monkey.D.Luffy | an attribute filter **and** a targeted `koInBattle` | cannot be K.O.'d in battle by ＜Strike＞ Characters |
 * | `OP01-069` Caesar Clown | the whole deck as a zone, and a shuffle | `[On K.O.]` play up to 1 [Smiley] from your deck |
 * | `OP01-098` Kurozumi Orochi | the same two | `[On Play]` reveal up to 1 [SMILE] and take it |
 * | `ST02-010` Basil Hawkins | the moment a card battles | set this card as active |
 *
 * Every one of the four was a **declared row** — three by
 * `docs/op01-closing-census.md` and one by PR #35's ruling — and all four were
 * declared for the same reason: a mechanism with one asker is not worth the
 * opportunity cost. What changed is the opportunity, not the standard. The
 * queue behind them is empty, so there is nothing the build is instead of.
 *
 * The engine's own file (`packages/engine/tests/lastFourMechanisms.test.ts`)
 * owns the four mechanisms. This is the corpus: the cards, and the two claims
 * only printed cards can make — that the noun in "＜Strike＞ **Characters**"
 * decides a real game, and that a search really does read forty cards.
 */

function candidates(state: GameState): InstanceId[] {
  const pending = state.pending;
  if (pending === null) {
    throw new Error('expected an open choice');
  }
  return [...pending.candidates];
}

/** Declares an attack and passes both steps, landing on the Damage Step. */
function fight(
  state: GameState,
  player: PlayerId,
  attacker: InstanceId,
  target: InstanceId,
): GameState {
  const defender: PlayerId = player === 'p1' ? 'p2' : 'p1';
  let next = applyOk(state, { type: 'DECLARE_ATTACK', player, attacker, target }).state;
  next = applyOk(next, { type: 'PASS', player: defender }).state;
  return applyOk(next, { type: 'PASS', player: defender }).state;
}

// ===========================================================================
// OP01-024 Monkey.D.Luffy — the attribute, and the noun beside it
// ===========================================================================

/**
 * "[DON!! x2] This Character cannot be K.O.'d in battle by ＜Strike＞ attribute
 * Characters."
 *
 * The census's two-capabilities-one-card, and the second capability is the one
 * nobody had written down: `LegalityClause.koInBattle` carried no `target`,
 * where `attack` had carried one since PR #31. An attribute filter alone would
 * not have let this card be written.
 */
describe('OP01-024 Monkey.D.Luffy — cannot be K.O.’d by ＜Strike＞ Characters', () => {
  /** p2's Luffy with its `[DON!! x2]` satisfied, rested and attackable. */
  function staged(don = 2): GameState {
    return op01StrikeScenario({
      firstPlayer: 'p1',
      turn: 3,
      p1: {
        characters: [{ cardId: 'OP01-018' }, { cardId: 'OP01-023' }],
        activeDon: 8,
      },
      p2: {
        characters: [{ cardId: 'OP01-024', attachedDon: don, orientation: 'rested' }],
        activeDon: 8,
      },
    });
  }

  it('survives a ＜Strike＞ Character that beat it in the Damage Step', () => {
    const state = staged();
    const hajrudin = characterAt(state, 'p1', 0);
    const luffy = characterAt(state, 'p2', 0);
    // 6000 against 3000 + 2000: the attacker wins outright, which is what makes
    // this a prevention rather than a survived tie.
    expect(getPower(state, hajrudin)).toBe(6000);
    expect(getPower(state, luffy)).toBe(5000);

    const after = fight(state, 'p1', hajrudin, luffy);
    expect(after.players.p2.characters).toContain(luffy);
    expect(after.players.p2.trash).not.toContain(luffy);
    expect([...after.log].reverse().find((e) => e.type === 'battleResolved')).toMatchObject({
      outcome: 'koPrevented',
    });
  });

  it('dies to a ＜Special＞ Character of the same power', () => {
    // `OP01-023` Marco is 5000 ＜Special＞ against 5000: CR 7-1-4-1 gives the
    // tie to the attacker, and nothing about Marco matches the clause.
    const state = staged();
    const luffy = characterAt(state, 'p2', 0);
    const after = fight(state, 'p1', characterAt(state, 'p1', 1), luffy);
    expect(after.players.p2.trash).toContain(luffy);
  });

  it('dies to the ＜Strike＞ **Leader**, because "Characters" is the printed noun', () => {
    // `OP01-003` Monkey.D.Luffy is a ＜Strike＞ Leader and is this deck's own,
    // so the case is an ordinary game rather than a constructed one. Both sides
    // of the noun are fixed here: the Character above is stopped, the Leader is
    // not.
    const state = staged();
    const leader = state.players.p1.leader;
    const luffy = characterAt(state, 'p2', 0);
    expect(canBeKOdInBattle(state, luffy, leader)).toBe(true);
    expect(canBeKOdInBattle(state, luffy, characterAt(state, 'p1', 0))).toBe(false);

    // And played out, so it is the Damage Step agreeing and not only the gate.
    const armed = applyOk(state, {
      type: 'ATTACH_DON',
      player: 'p1',
      to: leader,
      count: 2,
    }).state;
    const after = fight(armed, 'p1', leader, luffy);
    expect(after.players.p2.trash).toContain(luffy);
  });

  it('needs its two DON!!: with one it is an ordinary 4000 body', () => {
    const state = staged(1);
    const luffy = characterAt(state, 'p2', 0);
    expect(canBeKOdInBattle(state, luffy, characterAt(state, 'p1', 0))).toBe(true);
    const after = fight(state, 'p1', characterAt(state, 'p1', 0), luffy);
    expect(after.players.p2.trash).toContain(luffy);
  });

  it('is only about battle: an opponent’s `ko` script kills it regardless', () => {
    // CR 10-2-1-3 puts "by an effect" and "due to the result of a battle" on the
    // two sides of an `or`. This card prints the narrower half, so the gate is
    // never asked — the same reading `OP01-099` got, now with a target on it.
    const state = op01StrikeScenario({
      firstPlayer: 'p1',
      turn: 6,
      p1: { characters: [{ cardId: 'OP01-018' }], hand: ['OP01-054'], activeDon: 9 },
      p2: {
        characters: [{ cardId: 'OP01-024', attachedDon: 2, orientation: 'rested' }],
        activeDon: 8,
      },
    });
    const luffy = characterAt(state, 'p2', 0);
    // The immunity is live: the ＜Strike＞ Character on the other side could not
    // K.O. it in a battle.
    expect(canBeKOdInBattle(state, luffy, characterAt(state, 'p1', 0))).toBe(false);

    // `OP01-054` X.Drake K.O.s a rested Character costing 4 or less from a
    // script. The gate is never asked, so the immunity never gets a say.
    const done = applyOk(state, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: handCard(state, 'p1', 'OP01-054'),
    }).state;
    const asking = done.pending === null ? done : answer(done, 'p1', { kind: 'cards', selected: [luffy] });
    expect(asking.players.p2.trash).toContain(luffy);
  });

  it('gives itself the two rested DON!! its own gate wants', () => {
    // The second printed half, and the route a real game takes to the first:
    // `[Activate: Main] [Once Per Turn] Give this Character up to 2 rested DON!!
    // cards`. `giveDon` draws from **rested** DON!! only, which is the printed
    // word — so a cost area of active DON!! hands over nothing.
    const state = op01StrikeScenario({
      firstPlayer: 'p2',
      turn: 4,
      p2: { characters: [{ cardId: 'OP01-024' }], activeDon: 2, restedDon: 4 },
      p1: { activeDon: 4 },
    });
    const luffy = characterAt(state, 'p2', 0);
    const after = applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p2',
      instanceId: luffy,
      abilityId: 'OP01-024-main',
    }).state;
    expect(after.cards[luffy]?.attachedDon).toHaveLength(2);
    // Which is exactly the gate its own static wants, so the card arms itself.
    expect(canBeKOdInBattle(after, luffy, after.players.p1.leader)).toBe(true);
    assertSettled(after);
  });

  it('takes only rested DON!!, so an all-active cost area gives nothing', () => {
    const state = op01StrikeScenario({
      firstPlayer: 'p2',
      turn: 4,
      p2: { characters: [{ cardId: 'OP01-024' }], activeDon: 6 },
      p1: { activeDon: 4 },
    });
    const luffy = characterAt(state, 'p2', 0);
    const after = applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p2',
      instanceId: luffy,
      abilityId: 'OP01-024-main',
    }).state;
    expect(after.cards[luffy]?.attachedDon).toEqual([]);
  });
});

// ===========================================================================
// OP01-069 Caesar Clown — the whole deck, on death
// ===========================================================================

/**
 * "[On K.O.] Play up to 1 [Smiley] from your deck, then shuffle your deck."
 */
describe('OP01-069 Caesar Clown — searches the deck when it dies', () => {
  /** p1's Caesar, rested, with p2's Leader about to take it in a battle. */
  function staged(): GameState {
    return op01SearchScenario({
      firstPlayer: 'p2',
      turn: 3,
      p1: { characters: [{ cardId: 'OP01-069', orientation: 'rested' }], activeDon: 6 },
      p2: { activeDon: 6 },
    });
  }

  function kill(state: GameState): GameState {
    // 5000 Leader against a 5000 Character: the attacker wins ties (CR 7-1-4-1).
    return fight(state, 'p2', state.players.p2.leader, characterAt(state, 'p1', 0));
  }

  it('offers every [Smiley] left in the deck — not a window of it', () => {
    const state = staged();
    const asking = kill(state);
    const smileys = state.players.p1.deck.filter(
      (id) => state.cards[id]?.cardId === 'OP01-072',
    );
    expect(smileys.length).toBeGreaterThan(0);
    expect(new Set(candidates(asking))).toEqual(new Set(smileys));
    // The choice belongs to Caesar's controller, not to the player who killed it.
    expect(asking.pending?.player).toBe('p1');
    // And it is the widest choice this repo produces: a search reads the deck.
    expect(state.players.p1.deck.length).toBeGreaterThan(30);
  });

  it('plays the chosen [Smiley] and shuffles', () => {
    const state = staged();
    const asking = kill(state);
    const picked = candidates(asking)[0];
    if (picked === undefined) {
      throw new Error('expected a [Smiley]');
    }
    const done = answer(asking, 'p1', { kind: 'cards', selected: [picked] });
    expect(done.players.p1.characters).toContain(picked);
    expect(done.players.p1.deck).not.toContain(picked);
    expect(done.log.some((event) => event.type === 'deckShuffled')).toBe(true);
    assertSettled(done);
  });

  it('lets the player take nothing, and shuffles anyway', () => {
    // "Up to 1" is `min: 0`, and neither card prints an obligation. The shuffle
    // is unconditional because "then" is sequence and not dependency (CR 4-10-2)
    // — and because the player has read the deck either way, which is the thing
    // the shuffle takes back.
    const state = staged();
    const done = answer(kill(state), 'p1', { kind: 'cards', selected: [] });
    expect(done.players.p1.characters).toHaveLength(0);
    expect(done.log.some((event) => event.type === 'deckShuffled')).toBe(true);
    assertSettled(done);
  });

  it('asks nothing when no [Smiley] is left, and still shuffles', () => {
    const state = staged();
    // Move every Smiley out of the deck and into the trash: same player, so
    // card conservation and the engine's invariants keep holding.
    const stripped = JSON.parse(JSON.stringify(state)) as GameState;
    const smileys = stripped.players.p1.deck.filter(
      (id) => stripped.cards[id]?.cardId === 'OP01-072',
    );
    stripped.players.p1.deck = stripped.players.p1.deck.filter((id) => !smileys.includes(id));
    stripped.players.p1.trash.unshift(...smileys);
    assertInvariants(stripped);

    const done = kill(stripped);
    expect(done.pending).toBeNull();
    expect(done.log.some((event) => event.type === 'deckShuffled')).toBe(true);
    assertSettled(done);
  });

  it('shuffles its own deck and nobody else’s', () => {
    const state = staged();
    const before = [...state.players.p2.deck];
    const done = answer(kill(state), 'p1', { kind: 'cards', selected: [] });
    expect(done.players.p2.deck).toEqual(before);
    expect(done.players.p1.deck).not.toEqual(state.players.p1.deck);
  });
});

// ===========================================================================
// OP01-098 Kurozumi Orochi — the whole deck, on arrival
// ===========================================================================

/**
 * "[On Play] Reveal up to 1 [Artificial Devil Fruit SMILE] from your deck and
 * add it to your hand. Then, shuffle your deck."
 *
 * Caesar's twin on the other side of the search: same zone, same "up to 1", same
 * unconditional shuffle, and a different destination.
 */
describe('OP01-098 Kurozumi Orochi — reveals a SMILE out of the deck', () => {
  function staged(): GameState {
    return op01SearchScenario({
      firstPlayer: 'p1',
      turn: 3,
      p1: { hand: ['OP01-098'], activeDon: 6 },
      p2: { activeDon: 6 },
    });
  }

  function play(state: GameState): GameState {
    return applyOk(state, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: handCard(state, 'p1', 'OP01-098'),
    }).state;
  }

  it('offers every [Artificial Devil Fruit SMILE] in the deck', () => {
    const state = staged();
    const asking = play(state);
    const smiles = state.players.p1.deck.filter(
      (id) => state.cards[id]?.cardId === 'OP01-116',
    );
    expect(smiles.length).toBeGreaterThan(0);
    expect(new Set(candidates(asking))).toEqual(new Set(smiles));
  });

  it('reveals it, takes it to hand, and shuffles', () => {
    const state = staged();
    const asking = play(state);
    const picked = candidates(asking)[0];
    if (picked === undefined) {
      throw new Error('expected a SMILE');
    }
    const done = answer(asking, 'p1', { kind: 'cards', selected: [picked] });
    // The reveal is a real step: CR 11-2-1 makes a deck-to-hand move revealed
    // whether the card asks or not, and this card asks outright.
    expect(
      done.log.some(
        (event) => event.type === 'cardsRevealed' && event.instanceIds.includes(picked),
      ),
    ).toBe(true);
    expect(done.players.p1.hand).toContain(picked);
    expect(done.players.p1.deck).not.toContain(picked);
    expect(done.log.some((event) => event.type === 'deckShuffled')).toBe(true);
    assertSettled(done);
  });

  it('takes nothing, reveals nothing, and shuffles regardless', () => {
    // The empty branch says two things at once: an "up to 1" may be declined,
    // and **revealing nothing is not revealing** — no public act happened, so
    // no `cardsRevealed` is logged.
    const state = staged();
    const done = answer(play(state), 'p1', { kind: 'cards', selected: [] });
    expect(done.log.some((event) => event.type === 'cardsRevealed')).toBe(false);
    expect(done.log.some((event) => event.type === 'deckShuffled')).toBe(true);
    assertSettled(done);
  });

  it('finds the Event even though nothing else in the game carries the name', () => {
    // `OP01-116` is the only card in all 2665 named "Artificial Devil Fruit
    // SMILE", and it is an **Event** — a card the search finds and could not
    // play. The filter is a name and nothing else, which is what the text says.
    const state = staged();
    const asking = play(state);
    for (const id of candidates(asking)) {
      expect(state.cards[id]?.cardId).toBe('OP01-116');
    }
  });
});

// ===========================================================================
// ST02-010 Basil Hawkins — the moment a card battles
// ===========================================================================

/**
 * "[DON!! x1] [Once Per Turn] [Your Turn] If this Character battles your
 * opponent's Character, set this card as active."
 *
 * The ruling is PR #35's and lives in `docs/starter-card-inventory.md`. Both of
 * its open questions are fixed here, in both directions.
 */
describe('ST02-010 Basil Hawkins — sets itself active after battling a Character', () => {
  /** Hawkins on p2's board with a DON!!; p1 fields one rested body. */
  function staged(first: PlayerId, don = 1): GameState {
    return starterScenario({
      firstPlayer: first,
      turn: 5,
      p2: { characters: [{ cardId: 'ST02-010', attachedDon: don }], activeDon: 8 },
      p1: { characters: [{ cardId: 'ST01-003', orientation: 'rested' }], activeDon: 8 },
    });
  }

  it('stands back up after taking a Character, on its own turn', () => {
    const state = staged('p2');
    const hawkins = characterAt(state, 'p2', 0);
    const karoo = characterAt(state, 'p1', 0);
    const after = fight(state, 'p2', hawkins, karoo);

    expect(after.players.p1.trash).toContain(karoo);
    // CR 7-1-1-1 rested it to declare; its own ability gives it back.
    expect(after.cards[hawkins]?.orientation).toBe('active');
    expect(firedIds(after.log.slice(state.log.length))).toContain('ST02-010-whenBattling');
    assertSettled(after);
  });

  it('does nothing when the battle is against a Leader', () => {
    // "your opponent's **Character**" is `varMatches` over the card the trigger
    // was seeded with. A Leader is not one, so the condition fails and the
    // ability never fires — which is a different thing from firing into nothing.
    const state = staged('p2');
    const hawkins = characterAt(state, 'p2', 0);
    const after = fight(state, 'p2', hawkins, state.players.p1.leader);
    expect(after.cards[hawkins]?.orientation).toBe('rested');
    expect(firedIds(after.log.slice(state.log.length))).not.toContain('ST02-010-whenBattling');
  });

  it('does nothing on the opponent’s turn, which is what [Your Turn] settles', () => {
    // The ruling's question 2, and it went by rule rather than by inference:
    // CR 8-3-2-4 meets `[Your Turn]` "during your turn", so a Hawkins caught in
    // a battle it did not start has an unmet condition. The exclusion is the
    // card's own — the trigger reaches both participants.
    const state = starterScenario({
      firstPlayer: 'p1',
      turn: 5,
      p2: { characters: [{ cardId: 'ST02-010', attachedDon: 1, orientation: 'rested' }], activeDon: 8 },
      p1: { characters: [{ cardId: 'ST01-010' }], activeDon: 8 },
    });
    const hawkins = characterAt(state, 'p2', 0);
    const after = fight(state, 'p1', characterAt(state, 'p1', 0), hawkins);
    // It battled a Character and stayed exactly as it was.
    expect(after.players.p2.characters).toContain(hawkins);
    expect(after.cards[hawkins]?.orientation).toBe('rested');
    expect(firedIds(after.log.slice(state.log.length))).not.toContain('ST02-010-whenBattling');
  });

  it('needs its DON!!, so a bare Hawkins stays rested', () => {
    const state = staged('p2', 0);
    const hawkins = characterAt(state, 'p2', 0);
    const after = fight(state, 'p2', hawkins, characterAt(state, 'p1', 0));
    expect(after.cards[hawkins]?.orientation).toBe('rested');
  });

  it('is once per turn, so the second battle leaves it rested', () => {
    // CR 10-2-13-5: the use is spent when the effect activates. Two rested
    // bodies to swing into, and only the first attack gives the card back.
    const state = starterScenario({
      firstPlayer: 'p2',
      turn: 5,
      p2: { characters: [{ cardId: 'ST02-010', attachedDon: 1 }], activeDon: 8 },
      p1: {
        characters: [
          { cardId: 'ST01-003', orientation: 'rested' },
          { cardId: 'ST01-009', orientation: 'rested' },
        ],
        activeDon: 8,
      },
    });
    const hawkins = characterAt(state, 'p2', 0);
    const once = fight(state, 'p2', hawkins, characterAt(state, 'p1', 0));
    expect(once.cards[hawkins]?.orientation).toBe('active');

    const twice = fight(once, 'p2', hawkins, characterAt(state, 'p1', 1));
    expect(twice.cards[hawkins]?.orientation).toBe('rested');
  });

  it('fires at the Damage Step, not at the declaration', () => {
    // The half of the ruling that made the cheap approximation **wrong** rather
    // than rough: CR 7-1-2-2 lets a [Blocker] become the new target, so a card
    // that declared against the Leader can end up battling a Character. Reading
    // this as `[When Attacking]` would set Hawkins active before the battle it
    // names had happened.
    const state = staged('p2');
    const hawkins = characterAt(state, 'p2', 0);
    const declared = applyOk(state, {
      type: 'DECLARE_ATTACK',
      player: 'p2',
      attacker: hawkins,
      target: characterAt(state, 'p1', 0),
    }).state;
    expect(declared.cards[hawkins]?.orientation).toBe('rested');
    const counterStep = applyOk(declared, { type: 'PASS', player: 'p1' }).state;
    expect(counterStep.cards[hawkins]?.orientation).toBe('rested');
    const resolved = applyOk(counterStep, { type: 'PASS', player: 'p1' }).state;
    expect(resolved.cards[hawkins]?.orientation).toBe('active');
  });
});

// ===========================================================================
// Manifestation — real games nobody staged
// ===========================================================================

type Decks = Record<PlayerId, Decklist>;

function runGame(decks: Decks, seed: number): { state: GameState; fired: Set<string> } {
  let state = createGame({ seed, decks, firstPlayer: 'p1' });
  const fired = new Set<string>();
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

describe('a real game of the Luffy ＜Strike＞ deck', () => {
  /**
   * Two seeds, and they are **not** a cover of two over eighty.
   *
   * The immunity is a `static` and cannot appear in a union — a continuous
   * effect emits no event — so the thing worth covering here is the *outcome*,
   * and it is rare on purpose: a `koPrevented` needs `OP01-024` on the board
   * with two DON!! given to it, and then an attack it loses. Over 400 games the
   * bots reach that in **seven**. 380 and 271 are two of the seven, chosen so the
   * ability union is also covered.
   */
  const SEEDS = [380, 271] as const;

  it('reaches the activated half in ordinary play', () => {
    expect(union(OP01_STRIKE_DECKS, SEEDS)).toEqual([
      'OP01-003-main',
      'OP01-009-trigger',
      'OP01-024-main',
      'OP01-037-trigger',
      'OP01-054-onPlay',
    ]);
  });

  it('really prevents a K.O. in both of them', () => {
    // The claim the union cannot make. A `koPrevented` outcome in a game nobody
    // staged is the immunity doing its job at the table — and the card armed
    // itself to get there, because `OP01-024-main` is what put the two DON!! on
    // it. That pairing is the whole card working end to end.
    for (const seed of SEEDS) {
      const log = runGame(OP01_STRIKE_DECKS, seed).state.log;
      expect(
        log.some((event) => event.type === 'battleResolved' && event.outcome === 'koPrevented'),
        `seed ${seed}`,
      ).toBe(true);
    }
  });
});

describe('a real game of the Kaido search deck', () => {
  // A cover of 2 over 120 games. Both searches are common here — Orochi is a
  // 1-cost `[On Play]` — and Caesar's `[On K.O.]` is the one that needs a
  // battle to go badly first.
  const SEEDS = [2, 4] as const;

  it('reaches both searches in ordinary play', () => {
    expect(union(OP01_SEARCH_DECKS, SEEDS)).toEqual([
      'OP01-061-onEnemyKO',
      'OP01-069-onKO',
      'OP01-098-onPlay',
      'OP01-104-trigger',
      'OP01-116-main',
      'OP01-116-trigger',
    ]);
  });

  it('really shuffles a deck mid-game, in both of them', () => {
    for (const seed of SEEDS) {
      const log = runGame(OP01_SEARCH_DECKS, seed).state.log;
      expect(log.some((event) => event.type === 'deckShuffled'), `seed ${seed}`).toBe(true);
    }
  });
});

describe('a real game of the two starter decks', () => {
  // Hawkins is a 5-cost body that has to survive to attack a Character with a
  // DON!! on it, which a random game reaches in roughly one in eight. These two
  // are the first two of twenty-four over 200 games.
  const SEEDS = [6, 45] as const;

  it('reaches Hawkins, the last starter card to be written', () => {
    for (const seed of SEEDS) {
      expect(runGame(STARTER_DECKS, seed).fired.has('ST02-010-whenBattling'), `seed ${seed}`).toBe(
        true,
      );
    }
  });
});

// ===========================================================================
// No regression, and the milestone
// ===========================================================================

describe('the last four leave the rest of the corpus where it was', () => {
  it('adds four cards to the registry and takes none away', () => {
    for (const id of ['OP01-024', 'OP01-069', 'OP01-098', 'ST02-010']) {
      expect(getAbilities(id).length, id).toBeGreaterThan(0);
    }
  });

  it('is the first moment "every card in both sets works" is literally true', () => {
    // The milestone, stated where a test can hold it: 121 + 34 = 155, and the
    // per-set guards are in `schema.test.ts` and `startersComplete.test.ts`.
    expect(getAbilities('ST02-010')[0]?.trigger).toBe('whenBattling');
    expect(getAbilities('OP01-024')).toHaveLength(2);
  });
});

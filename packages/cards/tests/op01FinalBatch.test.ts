import { describe, expect, it } from 'vitest';
import {
  applyAction,
  assertInvariants,
  canAttack,
  createGame,
  getAbilities,
  getCost,
  getPower,
  legalActions,
} from '@optcg/engine';
import { decide } from '@optcg/engine/testing';
import type { CardPredicate, Decklist, GameState, InstanceId, PlayerId } from '@optcg/engine';
import {
  answer,
  applyOk,
  assertSettled,
  characterAt,
  firedIds,
  handCard,
  op01SurgeonScenario,
  op01WarlordScenario,
  OP01_SURGEON_DECKS,
  OP01_WARLORD_DECKS,
} from './support.js';

/**
 * The last eight OP-01 cards that can be written, and with them the set closes
 * at **118 of 121**.
 *
 * The engine's own file (`packages/engine/tests/finalMechanisms.test.ts`) owns
 * the five mechanisms. This one is the corpus, and it carries the two claims
 * only printed cards can make: that `OP01-051` Kid needed nothing from this
 * batch except the negation, and that the three cards left over are declared
 * rows rather than a queue.
 */

function candidates(state: GameState): InstanceId[] {
  const pending = state.pending;
  if (pending === null) {
    throw new Error('expected an open choice');
  }
  return [...pending.candidates];
}

function play(state: GameState, player: PlayerId, cardId: string): GameState {
  return applyOk(state, {
    type: 'PLAY_CARD',
    player,
    instanceId: handCard(state, player, cardId),
  }).state;
}

// ===========================================================================
// Negation
// ===========================================================================

describe('OP01-019 Bartolomeo — +3000 only on the opponent’s turn', () => {
  function staged(first: PlayerId): GameState {
    return op01SurgeonScenario({
      firstPlayer: first,
      p1: { characters: [{ cardId: 'OP01-019', attachedDon: 2 }], activeDon: 4 },
      p2: { activeDon: 4 },
    });
  }

  it('is off on its controller’s turn and on during the opponent’s', () => {
    const mine = staged('p1');
    const theirs = staged('p2');
    // 2000 printed + 2000 from the two attached DON!!.
    expect(getPower(mine, characterAt(mine, 'p1', 0))).toBe(2000 + 2000);
    expect(getPower(theirs, characterAt(theirs, 'p1', 0))).toBe(2000 + 2000 + 3000);
  });

  it('still needs its two DON!!, so both printed clauses are gates', () => {
    const oneDon = op01SurgeonScenario({
      firstPlayer: 'p2',
      p1: { characters: [{ cardId: 'OP01-019', attachedDon: 1 }], activeDon: 4 },
      p2: { activeDon: 4 },
    });
    expect(getPower(oneDon, characterAt(oneDon, 'p1', 0))).toBe(2000 + 1000);
  });

  it('writes no modifier either way', () => {
    expect(staged('p2').modifiers).toEqual([]);
  });
});

// ===========================================================================
// Scaling grants
// ===========================================================================

describe('OP01-072 Smiley — +1000 for every card in your hand', () => {
  function staged(hand: string[]): GameState {
    return op01WarlordScenario({
      p1: {
        characters: [{ cardId: 'OP01-072', attachedDon: 1 }],
        activeDon: 5,
        clearHand: true,
        hand,
      },
      p2: { activeDon: 4 },
    });
  }

  it('counts the hand card by card', () => {
    for (const hand of [[], ['OP01-076'], ['OP01-076', 'OP01-081', 'OP01-103']]) {
      const state = staged(hand);
      // 1000 printed + 1000 from the attached DON!! + 1000 per card in hand.
      expect(getPower(state, characterAt(state, 'p1', 0)), `${hand.length} in hand`).toBe(
        1000 + 1000 + hand.length * 1000,
      );
    }
  });

  it('follows the hand the instant it changes, with modifiers untouched', () => {
    // The property that makes it continuous rather than written: play a card out
    // of hand and the number is different the next time anyone asks.
    const state = staged(['OP01-076', 'OP01-081']);
    const smiley = characterAt(state, 'p1', 0);
    expect(getPower(state, smiley)).toBe(1000 + 1000 + 2000);

    const played = play(state, 'p1', 'OP01-076');
    expect(played.players.p1.hand).toHaveLength(1);
    expect(getPower(played, smiley)).toBe(1000 + 1000 + 1000);
    expect(played.modifiers).toEqual([]);
  });
});

describe('OP01-083 Mr.1(Daz.Bonez) — +1000 for every 2 Events in your trash', () => {
  function staged(events: number): GameState {
    return op01WarlordScenario({
      p1: {
        characters: [{ cardId: 'OP01-083', attachedDon: 1 }],
        activeDon: 5,
        trash: ['OP01-087', 'OP01-088', 'OP01-090'].slice(0, events),
      },
      p2: { activeDon: 4 },
    });
  }

  it('floors: one Event is worth nothing, three are worth the same as two', () => {
    // "For every 2" describes complete groups, and a partial group is not one.
    for (const [events, bonus] of [
      [0, 0],
      [1, 0],
      [2, 1000],
      [3, 1000],
    ] as const) {
      const state = staged(events);
      // 3000 printed + 1000 from the attached DON!! + the counted bonus.
      expect(getPower(state, characterAt(state, 'p1', 0)), `${events} events`).toBe(
        3000 + 1000 + bonus,
      );
    }
  });

  it('needs the {Baroque Works} Leader, which this deck has', () => {
    // Crocodile carries the type, so the gate is open rather than decorative —
    // the reason the fixture is Crocodile-led.
    const state = staged(2);
    expect(getPower(state, characterAt(state, 'p1', 0))).toBe(3000 + 1000 + 1000);
  });

  it('counts Events only, not every card in the trash', () => {
    const withBodies = op01WarlordScenario({
      p1: {
        characters: [{ cardId: 'OP01-083', attachedDon: 1 }],
        activeDon: 5,
        trash: ['OP01-076', 'OP01-081', 'OP01-103', 'OP01-066'],
      },
      p2: { activeDon: 4 },
    });
    expect(getPower(withBodies, characterAt(withBodies, 'p1', 0))).toBe(3000 + 1000);
  });
});

// ===========================================================================
// Cost modification
// ===========================================================================

describe('OP01-067 Crocodile — blue Events in your hand cost 1 less', () => {
  function staged(don: number): GameState {
    return op01WarlordScenario({
      p1: {
        characters: [{ cardId: 'OP01-067', attachedDon: don }],
        activeDon: 4,
        clearHand: true,
        hand: ['OP01-087', 'OP01-090', 'OP01-076'],
      },
      p2: { activeDon: 4 },
    });
  }

  it('reduces the blue Events and leaves the Character alone', () => {
    const state = staged(1);
    // Officer Agents is a 2-cost blue Event; Baroque Works a 1-cost one.
    expect(getCost(state, handCard(state, 'p1', 'OP01-087'))).toBe(1);
    expect(getCost(state, handCard(state, 'p1', 'OP01-090'))).toBe(0);
    // Bellamy is a blue *Character* — the audience says Events.
    expect(getCost(state, handCard(state, 'p1', 'OP01-076'))).toBe(2);
  });

  it('applies nothing without the DON!!', () => {
    const state = staged(0);
    expect(getCost(state, handCard(state, 'p1', 'OP01-087'))).toBe(2);
    expect(getCost(state, handCard(state, 'p1', 'OP01-090'))).toBe(1);
  });

  it('floors at zero, never below', () => {
    // CR 1-3-6-2: "outside of such calculations, the cost of a card whose value
    // becomes negative is treated as being 0". Baroque Works costs 1 and the
    // grant is −1.
    const state = staged(1);
    expect(getCost(state, handCard(state, 'p1', 'OP01-090'))).toBe(0);
  });

  it('makes an unpayable Event playable, which is the whole point', () => {
    // Legality reading the aggregated cost. Zero active cost-area DON!! in both
    // positions — the attached one comes out of that pool — so the only
    // difference is whether the grant is live.
    const without = op01WarlordScenario({
      p1: {
        characters: [{ cardId: 'OP01-067' }],
        activeDon: 0,
        clearHand: true,
        hand: ['OP01-090'],
      },
      p2: { activeDon: 4 },
    });
    const with_ = op01WarlordScenario({
      p1: {
        characters: [{ cardId: 'OP01-067', attachedDon: 1 }],
        activeDon: 1,
        clearHand: true,
        hand: ['OP01-090'],
      },
      p2: { activeDon: 4 },
    });
    const offered = (s: GameState): boolean =>
      legalActions(s, 'p1').some(
        (action) =>
          action.type === 'PLAY_CARD' && action.instanceId === handCard(s, 'p1', 'OP01-090'),
      );
    expect(offered(without)).toBe(false);
    expect(offered(with_)).toBe(true);
  });

  it('stops applying when Crocodile leaves the field', () => {
    const state = staged(1);
    const event = handCard(state, 'p1', 'OP01-087');
    expect(getCost(state, event)).toBe(1);

    const gone: GameState = JSON.parse(JSON.stringify(state)) as GameState;
    gone.players.p1.characters = [];
    expect(getCost(gone, event)).toBe(2);
  });
});

// ===========================================================================
// Reveal what was chosen
// ===========================================================================

describe('OP01-105 Bao Huang — reveal two cards out of the opponent’s hand', () => {
  function staged(theirHand: string[]): GameState {
    return op01WarlordScenario({
      p1: { hand: ['OP01-105'], clearHand: true, activeDon: 5 },
      p2: { activeDon: 4, clearHand: true, hand: theirHand },
    });
  }

  it('reveals exactly the two chosen, and nothing else in the hand', () => {
    const state = staged(['OP01-076', 'OP01-081', 'OP01-103', 'OP01-066']);
    const asking = play(state, 'p1', 'OP01-105');
    expect(candidates(asking)).toEqual(asking.players.p2.hand);
    expect(asking.pending?.min).toBe(2);

    const [a, , c] = candidates(asking);
    if (a === undefined || c === undefined) {
      throw new Error('expected candidates');
    }
    const result = applyAction(asking, {
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId: asking.pending?.id ?? '',
      answer: { kind: 'cards', selected: [a, c] },
    });
    if (!result.ok) {
      throw new Error(result.reason);
    }
    const revealed = result.events.filter((event) => event.type === 'cardsRevealed');
    expect(revealed).toEqual([
      { type: 'cardsRevealed', player: 'p1', instanceIds: [a, c] },
    ]);
    // Nothing moved: revealing leaves the cards where they are.
    expect(result.state.players.p2.hand).toEqual(asking.players.p2.hand);
    assertSettled(result.state);
  });

  it('takes what there is when the hand is shorter than two', () => {
    // CR 8-4-4-1: as many as they can, up to the number specified.
    const state = staged(['OP01-076']);
    const asking = play(state, 'p1', 'OP01-105');
    expect(candidates(asking)).toHaveLength(1);
    expect(asking.pending?.min).toBe(1);
  });

  it('asks nothing against an empty hand', () => {
    const state = staged([]);
    const done = play(state, 'p1', 'OP01-105');
    expect(done.pending).toBeNull();
    assertSettled(done);
  });
});

// ===========================================================================
// A predicate about a card a variable names
// ===========================================================================

describe('OP01-002 Trafalgar Law (Leader) — swap a Character for another colour', () => {
  function staged(hand: string[]): GameState {
    return op01SurgeonScenario({
      p1: {
        characters: [
          { cardId: 'OP01-010' }, // red
          { cardId: 'OP01-012' }, // red
          { cardId: 'OP01-023' }, // red
          { cardId: 'OP01-036' }, // green
          { cardId: 'OP01-043' }, // green
        ],
        activeDon: 6,
        clearHand: true,
        hand,
      },
      p2: { activeDon: 4 },
    });
  }

  function activate(state: GameState): GameState {
    return applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: state.players.p1.leader,
      abilityId: 'OP01-002-main',
    }).state;
  }

  it('needs a full board of five Characters', () => {
    const four = op01SurgeonScenario({
      p1: {
        characters: [
          { cardId: 'OP01-010' },
          { cardId: 'OP01-012' },
          { cardId: 'OP01-023' },
          { cardId: 'OP01-036' },
        ],
        activeDon: 6,
      },
      p2: { activeDon: 4 },
    });
    expect(
      legalActions(four, 'p1').some(
        (action) => action.type === 'ACTIVATE_ABILITY' && action.abilityId === 'OP01-002-main',
      ),
    ).toBe(false);
  });

  it('offers only candidates of a different colour than the one returned', () => {
    const state = staged(['OP01-025', 'OP01-045']); // red Zoro, green Jean Bart
    const asking = answer(activate(state), 'p1', { kind: 'yesNo', value: true });
    const red = characterAt(state, 'p1', 0); // Komachiyo, red

    const afterReturn = answer(asking, 'p1', { kind: 'cards', selected: [red] });
    // Returning a red Character leaves only the green candidate.
    expect(afterReturn.pending?.kind).toBe('selectCards');
    expect(candidates(afterReturn)).toEqual([handCard(state, 'p1', 'OP01-045')]);
  });

  it('flips which candidate qualifies when a green Character is returned', () => {
    // The comparison really reads the variable rather than a constant.
    const state = staged(['OP01-025', 'OP01-045']);
    const asking = answer(activate(state), 'p1', { kind: 'yesNo', value: true });
    const green = characterAt(state, 'p1', 3); // Otsuru, green

    const afterReturn = answer(asking, 'p1', { kind: 'cards', selected: [green] });
    expect(candidates(afterReturn)).toEqual([handCard(state, 'p1', 'OP01-025')]);
  });

  it('returns the card and plays the replacement', () => {
    const state = staged(['OP01-045']);
    const asking = answer(activate(state), 'p1', { kind: 'yesNo', value: true });
    const red = characterAt(state, 'p1', 0);
    const afterReturn = answer(asking, 'p1', { kind: 'cards', selected: [red] });
    const recruit = handCard(state, 'p1', 'OP01-045');
    const done = answer(afterReturn, 'p1', { kind: 'cards', selected: [recruit] });

    expect(done.players.p1.hand).toContain(red);
    expect(done.players.p1.characters).toContain(recruit);
    expect(done.players.p1.characters).not.toContain(red);
    // Still five: one left, one arrived.
    expect(done.players.p1.characters).toHaveLength(5);
    assertSettled(done);
  });
});

describe('OP01-063 Arlong — reveal one, and bury a Life card only if it was an Event', () => {
  function staged(theirHand: string[]): GameState {
    return op01WarlordScenario({
      p1: { characters: [{ cardId: 'OP01-063', attachedDon: 1 }], activeDon: 5 },
      p2: { activeDon: 4, clearHand: true, hand: theirHand, life: 3 },
    });
  }

  function activate(state: GameState): GameState {
    return applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: characterAt(state, 'p1', 0),
      abilityId: 'OP01-063-main',
    }).state;
  }

  it('buries a Life card when the revealed card is an Event', () => {
    const state = staged(['OP01-090']);
    const asking = answer(activate(state), 'p1', { kind: 'yesNo', value: true });
    const chosen = candidates(asking)[0];
    if (chosen === undefined) {
      throw new Error('expected a candidate');
    }
    const lifeChoice = answer(asking, 'p1', { kind: 'cards', selected: [chosen] });

    // Only the top Life card is offered — CR 3-10-2, and `count: 1` is what says
    // so. The printed "up to 1" is the `min: 0`.
    expect(lifeChoice.pending?.kind).toBe('selectCards');
    expect(candidates(lifeChoice)).toEqual([state.players.p2.life[0]]);
    expect(lifeChoice.pending?.min).toBe(0);

    const top = candidates(lifeChoice)[0];
    if (top === undefined) {
      throw new Error('expected a life card');
    }
    const done = answer(lifeChoice, 'p1', { kind: 'cards', selected: [top] });
    // It goes under the **owner's** deck, which is p2's.
    expect(done.players.p2.life).not.toContain(top);
    expect(done.players.p2.deck.at(-1)).toBe(top);
    assertSettled(done);
  });

  it('does nothing further when the revealed card is a Character', () => {
    const state = staged(['OP01-076']);
    const asking = answer(activate(state), 'p1', { kind: 'yesNo', value: true });
    const chosen = candidates(asking)[0];
    if (chosen === undefined) {
      throw new Error('expected a candidate');
    }
    const done = answer(asking, 'p1', { kind: 'cards', selected: [chosen] });

    expect(done.pending).toBeNull();
    expect(done.players.p2.life).toHaveLength(3);
    assertSettled(done);
  });

  it('may decline the "up to 1" and leave the Life area alone', () => {
    const state = staged(['OP01-090']);
    const asking = answer(activate(state), 'p1', { kind: 'yesNo', value: true });
    const chosen = candidates(asking)[0];
    if (chosen === undefined) {
      throw new Error('expected a candidate');
    }
    const lifeChoice = answer(asking, 'p1', { kind: 'cards', selected: [chosen] });
    const done = answer(lifeChoice, 'p1', { kind: 'cards', selected: [] });

    expect(done.players.p2.life).toHaveLength(3);
    assertSettled(done);
  });
});

// ===========================================================================
// Kid — the card whose other two walls fell without this batch
// ===========================================================================

describe('OP01-051 Eustass"Captain"Kid — the attack lock', () => {
  /** Kid rested on p1's board, with p2 to attack into it. */
  function staged(extra: Array<{ cardId: string; orientation?: 'rested' }> = []): GameState {
    return op01SurgeonScenario({
      firstPlayer: 'p2',
      p1: {
        characters: [
          { cardId: 'OP01-051', orientation: 'rested', attachedDon: 1 },
          { cardId: 'OP01-010', orientation: 'rested' },
          ...extra,
        ],
        activeDon: 4,
      },
      p2: { characters: [{ cardId: 'OP01-012' }], activeDon: 4 },
    });
  }

  it('lets the opponent attack Kid and nothing else', () => {
    const state = staged();
    const attacker = characterAt(state, 'p2', 0);
    const kid = characterAt(state, 'p1', 0);
    const other = characterAt(state, 'p1', 1);

    expect(canAttack(state, attacker, kid)).toBe(true);
    expect(canAttack(state, attacker, other)).toBe(false);
    expect(canAttack(state, attacker, state.players.p1.leader)).toBe(false);
  });

  it('names Kid by **name**, which is PR #38’s field reaching a legality clause', () => {
    // The census gave Kid three walls. Put-into-play closed one (PR #29) and
    // `selfOrientation` another (PR #35); the third closed when the name field
    // went onto `CardFilter`, because `LegalityClause.attack.target` is a
    // `CardPredicate`. All this batch owed Kid was the negation.
    const abilities = getKidClauses();
    expect(abilities).toContainEqual({
      category: ['character'],
      excludeNames: ['Eustass"Captain"Kid'],
    });
  });

  it('still forbids a Leader that happens to share the name', () => {
    // The exemption is "the **Character** [Kid]" — a negated conjunction one
    // predicate cannot say. `ST02-001` is a green Kid *Leader* and `OP01-051` a
    // green Kid Character, so the position is legal and reachable; the second
    // clause is what keeps the Leader covered.
    const clauses = getKidClauses();
    expect(clauses).toContainEqual({ category: ['leader'] });
  });

  it('lifts the moment Kid stands up, or the DON!! comes off', () => {
    const active = op01SurgeonScenario({
      firstPlayer: 'p2',
      p1: {
        characters: [
          { cardId: 'OP01-051', attachedDon: 1 },
          { cardId: 'OP01-010', orientation: 'rested' },
        ],
        activeDon: 4,
      },
      p2: { characters: [{ cardId: 'OP01-012' }], activeDon: 4 },
    });
    const attacker = characterAt(active, 'p2', 0);
    expect(canAttack(active, attacker, characterAt(active, 'p1', 1))).toBe(true);

    const noDon = op01SurgeonScenario({
      firstPlayer: 'p2',
      p1: {
        characters: [
          { cardId: 'OP01-051', orientation: 'rested' },
          { cardId: 'OP01-010', orientation: 'rested' },
        ],
        activeDon: 4,
      },
      p2: { characters: [{ cardId: 'OP01-012' }], activeDon: 4 },
    });
    expect(canAttack(noDon, characterAt(noDon, 'p2', 0), characterAt(noDon, 'p1', 1))).toBe(true);
  });

  it('does not lock anything on its controller’s own turn', () => {
    // `[Opponent's Turn]` is the negation, and it is what stops Kid protecting
    // its own side while its controller is attacking.
    const mine = op01SurgeonScenario({
      firstPlayer: 'p1',
      p1: {
        characters: [
          { cardId: 'OP01-051', orientation: 'rested', attachedDon: 1 },
          { cardId: 'OP01-010', orientation: 'rested' },
        ],
        activeDon: 4,
      },
      p2: { characters: [{ cardId: 'OP01-012' }], activeDon: 4 },
    });
    expect(canAttack(mine, characterAt(mine, 'p2', 0), characterAt(mine, 'p1', 1))).toBe(true);
  });
});

/** The attack targets Kid's two legality grants name, read off the registry. */
function getKidClauses(): Array<CardPredicate | undefined> {
  return getAbilities('OP01-051')
    .map((ability) => ability.grants?.legality?.clause)
    .filter((clause) => clause !== undefined && clause.question === 'attack')
    .map((clause) => (clause?.question === 'attack' ? clause.target : undefined));
}

// ===========================================================================
// Manifestation
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

describe('a real game of the Law deck', () => {
  // A cover of 1 over 80 games, plus one for volume.
  const SEEDS = [32, 1] as const;

  it('reaches the Leader swap and Kid’s activated half', () => {
    // `OP01-019` and Kid's lock are **statics** and cannot appear here — a
    // continuous effect emits no event. Their reachability is the table above.
    expect(union(OP01_SURGEON_DECKS, SEEDS)).toEqual([
      'OP01-002-main',
      'OP01-009-trigger',
      'OP01-037-trigger',
      'OP01-051-main',
    ]);
  });
});

describe('a real game of the Crocodile deck', () => {
  // A cover of 2 over 80 games.
  const SEEDS = [31, 18] as const;

  it('reaches both reveals in ordinary play', () => {
    // `OP01-072`, `OP01-083` and `OP01-067` are statics, so the union holds the
    // two cards that resolve scripts and the Events around them.
    expect(union(OP01_WARLORD_DECKS, SEEDS)).toEqual([
      'OP01-062-onOwnEvent',
      'OP01-063-main',
      'OP01-087-counter',
      'OP01-087-trigger',
      'OP01-088-trigger',
      'OP01-090-main',
      'OP01-105-onPlay',
    ]);
  });

  it('really reveals cards, which is the act no union entry proves', () => {
    const revealed = SEEDS.some((seed) =>
      runGame(OP01_WARLORD_DECKS, seed).state.log.some(
        (event) => event.type === 'cardsRevealed' && event.instanceIds.length > 0,
      ),
    );
    expect(revealed).toBe(true);
  });
});

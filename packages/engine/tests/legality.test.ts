import { describe, expect, it } from 'vitest';
import { canAttack, legalActions, REASONS } from '../src/index.js';
import type { Action, GameState, InstanceId, PlayerId } from '../src/index.js';
import { assertInvariants } from '../src/invariants.js';
import { ABIL_DECK } from '../src/testdata/abilityDecks.js';
import { buildScenario, characterAt } from '../src/testdata/scenarios.js';
import { assertSerializationRoundTrip } from '../src/testing/index.js';
import { applyFail, applyOk } from './helpers.js';

/**
 * Modifiable legality, engine side.
 *
 * The printed cards are two packages away and have their own file
 * (`packages/cards/tests/op01Batch8.test.ts`); this one holds what the printed
 * cards cannot reach and what is a property of the engine rather than of a card:
 * the third building (K.O. immunity), the direction of the attack question that
 * no printed card points at yet, the affordance contract, expiry, and what
 * happens when a forbidden block meets the vanished-participant rule.
 *
 * Everything here uses the ABIL decks, which is where the two synthetic cards
 * live — and both are written as a real printed card *minus a named gap*,
 * never as an invented shape. See their comments in `testdata/abilities.ts`.
 */

const decks = { p1: ABIL_DECK, p2: ABIL_DECK };

function blockOffers(state: GameState, player: PlayerId): InstanceId[] {
  return legalActions(state, player)
    .filter((action): action is Extract<Action, { type: 'DECLARE_BLOCK' }> =>
      action.type === 'DECLARE_BLOCK',
    )
    .map((action) => action.blocker);
}

function attackOffers(state: GameState, player: PlayerId): Array<[InstanceId, InstanceId]> {
  return legalActions(state, player)
    .filter((action): action is Extract<Action, { type: 'DECLARE_ATTACK' }> =>
      action.type === 'DECLARE_ATTACK',
    )
    .map((action) => [action.attacker, action.target]);
}

// ---------------------------------------------------------------------------
// The third building: K.O. immunity in battle
// ---------------------------------------------------------------------------

describe("ABIL-026 — a Character that cannot be K.O.'d in battle", () => {
  /**
   * p2 fields the immune 2000-power body, rested so it can be attacked; p1
   * fields a 4000 that wins the comparison outright.
   */
  function staged(): GameState {
    return buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-020' }], activeDon: 3 },
      p2: { characters: [{ cardId: 'ABIL-026', orientation: 'rested' }], activeDon: 3 },
    });
  }

  it('survives a battle it lost, and the battle still ends normally', () => {
    const state = staged();
    const attacker = characterAt(state, 'p1', 0);
    const target = characterAt(state, 'p2', 0);

    let next = applyOk(state, { type: 'DECLARE_ATTACK', player: 'p1', attacker, target }).state;
    next = applyOk(next, { type: 'PASS', player: 'p2' }).state;
    const damage = applyOk(next, { type: 'PASS', player: 'p2' });

    // CR 7-1-4-1-2 K.O.s the loser and then proceeds to the End of the Battle.
    // Only the first half is prevented, so everything else reads exactly as a
    // resolved battle does.
    expect(damage.state.players.p2.characters).toContain(target);
    expect(damage.state.players.p2.trash).not.toContain(target);
    expect(damage.state.battle).toBeNull();
    expect(damage.state.priority).toBe('p1');
    expect(damage.state.modifiers.filter((m) => m.duration === 'endOfBattle')).toEqual([]);
    expect(damage.state.legality.filter((r) => r.duration === 'endOfBattle')).toEqual([]);
    assertInvariants(damage.state);
  });

  it('reports the outcome as its own thing, not as an attack that missed', () => {
    const state = staged();
    const attacker = characterAt(state, 'p1', 0);
    const target = characterAt(state, 'p2', 0);
    let next = applyOk(state, { type: 'DECLARE_ATTACK', player: 'p1', attacker, target }).state;
    next = applyOk(next, { type: 'PASS', player: 'p2' }).state;
    const { events } = applyOk(next, { type: 'PASS', player: 'p2' });

    const resolved = events.find((event) => event.type === 'battleResolved');
    expect(resolved).toBeDefined();
    // `noEffect` would say the attacker lost the comparison. It won it.
    expect(resolved?.type === 'battleResolved' && resolved.outcome).toBe('koPrevented');
    expect(events.some((event) => event.type === 'koed')).toBe(false);
  });

  it('does not stop the same Character being K.O.d by an effect', () => {
    // CR 10-2-1-3: "cannot be K.O.'d" covers a K.O. "by an effect **or** due to
    // the result of a battle", and every printed card in scope narrows it to
    // the battle half. The clause is `koInBattle`, so the effect route is
    // untouched — a wider clause would be a different card, not a second site.
    const state = buildScenario({
      decks,
      // ABIL-001 is "[On Play] you may K.O. up to 1 opponent Character".
      p1: { hand: ['ABIL-001'], activeDon: 3, clearHand: true },
      p2: { characters: [{ cardId: 'ABIL-026' }], activeDon: 3 },
    });
    const victim = characterAt(state, 'p2', 0);
    const played = state.players.p1.hand[0];
    expect(played).toBeDefined();

    let next = applyOk(state, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: played as InstanceId,
    }).state;
    // Opt in, then choose the immune Character.
    next = applyOk(next, {
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId: next.pending?.id ?? '',
      answer: { kind: 'yesNo', value: true },
    }).state;
    next = applyOk(next, {
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId: next.pending?.id ?? '',
      answer: { kind: 'cards', selected: [victim] },
    }).state;

    expect(next.players.p2.characters).not.toContain(victim);
    expect(next.players.p2.trash).toContain(victim);
  });
});

// ---------------------------------------------------------------------------
// The forbid direction of the attack question
// ---------------------------------------------------------------------------

describe('ABIL-027 — a Character told it cannot attack', () => {
  /**
   * The pinned card is one of p1's own, and that is forced rather than chosen:
   * an `[Activate: Main]` runs on its controller's turn and an `endOfTurn` rule
   * dies at the end of it, so a rule aimed at an opponent's Character would
   * expire before that Character ever got to attack. Which is the whole reason
   * `OP01-085` prints "until the end of your **opponent's next turn**" and the
   * whole reason it is not in this batch.
   */
  function staged(): GameState {
    return buildScenario({
      decks,
      turn: 3,
      p1: {
        characters: [{ cardId: 'ABIL-027' }, { cardId: 'ABIL-020' }],
        activeDon: 5,
      },
      p2: { characters: [{ cardId: 'ABIL-005', orientation: 'rested' }], activeDon: 5 },
    });
  }

  function pin(state: GameState): { state: GameState; pinned: InstanceId } {
    const source = characterAt(state, 'p1', 0);
    const pinned = characterAt(state, 'p1', 1);
    let next = applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: source,
      abilityId: 'ABIL-027-main',
    }).state;
    next = applyOk(next, {
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId: next.pending?.id ?? '',
      answer: { kind: 'cards', selected: [pinned] },
    }).state;
    return { state: next, pinned };
  }

  it('is not offered any attack at all, and is refused if one is sent anyway', () => {
    const free = staged();
    const willBePinned = characterAt(free, 'p1', 1);
    expect(attackOffers(free, 'p1').map(([attacker]) => attacker)).toContain(willBePinned);

    const { state, pinned } = pin(free);
    const enemyLeader = state.players.p2.leader;
    expect(canAttack(state, pinned, enemyLeader)).toBe(false);
    expect(attackOffers(state, 'p1').map(([attacker]) => attacker)).not.toContain(pinned);
    // The pin is one card's, not the board's: the source can still attack.
    expect(attackOffers(state, 'p1').map(([attacker]) => attacker)).toContain(
      characterAt(state, 'p1', 0),
    );

    const reason = applyFail(state, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: pinned,
      target: enemyLeader,
    });
    // Not `targetNotRested`: the Leader is always a legal target, and what
    // refused this was a card rather than the base rule.
    expect(reason).toBe(REASONS.attackForbidden);
  });

  it('lets go when the turn it was written for ends', () => {
    const { state, pinned } = pin(staged());
    expect(state.legality).toHaveLength(1);

    const handed = applyOk(state, { type: 'END_TURN', player: 'p1' }).state;
    expect(handed.legality).toEqual([]);
    expect(canAttack(handed, pinned, handed.players.p2.leader)).toBe(true);
  });

  it('forgets the pinned card the moment it leaves the field (CR 3-1-6)', () => {
    // Aimed at the opponent this time, and K.O.'d in the battle that follows.
    // The rule outlives nothing: the card that comes back from the trash is a
    // new card, so `detachFromField` drops what was said about the old one —
    // the same line, one array over, that already dropped its modifiers.
    const state = staged();
    const source = characterAt(state, 'p1', 0);
    const enemy = characterAt(state, 'p2', 0);
    let next = applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: source,
      abilityId: 'ABIL-027-main',
    }).state;
    next = applyOk(next, {
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId: next.pending?.id ?? '',
      answer: { kind: 'cards', selected: [enemy] },
    }).state;
    expect(next.legality[0]?.subject).toEqual({ is: enemy });

    const attacker = characterAt(next, 'p1', 1);
    next = applyOk(next, { type: 'DECLARE_ATTACK', player: 'p1', attacker, target: enemy }).state;
    next = applyOk(next, { type: 'PASS', player: 'p2' }).state;
    next = applyOk(next, { type: 'PASS', player: 'p2' }).state;

    expect(next.players.p2.trash).toContain(enemy);
    expect(next.legality).toEqual([]);
    assertInvariants(next);
  });
});

// ---------------------------------------------------------------------------
// The affordance contract
// ---------------------------------------------------------------------------

describe('a forbidden move is invisible, not rejected', () => {
  /**
   * p2 holds a printed [Blocker] (`ABIL-022`), and p1 attacks with a body whose
   * own script bans it. There is no ABIL card that bans a block, so the rule is
   * written straight onto the state — which is the honest way to test the
   * *aggregator* rather than a card, and the printed-card route is pinned two
   * packages over.
   */
  function battleWithBan(ban: boolean): GameState {
    const staged = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-020' }], activeDon: 3 },
      p2: { characters: [{ cardId: 'ABIL-022' }], activeDon: 3 },
    });
    const attacker = characterAt(staged, 'p1', 0);
    const opened = applyOk(staged, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker,
      target: staged.players.p2.leader,
    }).state;
    if (!ban) {
      return opened;
    }
    const draft = JSON.parse(JSON.stringify(opened)) as GameState;
    draft.legality.push({
      id: 'leg-test',
      source: attacker,
      controller: 'p1',
      writtenOnTurn: draft.turn,
      duration: 'endOfBattle',
      effect: 'forbid',
      subject: { player: 'p2' },
      clause: { question: 'activateBlocker' },
    });
    return draft;
  }

  it('withholds the block offer rather than offering a move that fails', () => {
    const free = battleWithBan(false);
    const blocker = characterAt(free, 'p2', 0);
    expect(blockOffers(free, 'p2')).toEqual([blocker]);

    const banned = battleWithBan(true);
    expect(blockOffers(banned, 'p2')).toEqual([]);
    // And the rest of the Block Step is untouched: passing is still there, so a
    // client is never left with nothing to do.
    expect(legalActions(banned, 'p2').map((action) => action.type)).toContain('PASS');
    assertInvariants(banned);
  });

  it('still refuses the action if it arrives from somewhere else', () => {
    const banned = battleWithBan(true);
    const blocker = characterAt(banned, 'p2', 0);
    expect(applyFail(banned, { type: 'DECLARE_BLOCK', player: 'p2', blocker })).toBe(
      REASONS.blockForbidden,
    );
  });

  it('keeps every action legalActions offers acceptable', () => {
    // The exhaustiveness property this engine has always claimed, asserted
    // against a state with a live prohibition in it: a withheld offer must not
    // leave a *different* offer behind that the reducer would then reject.
    const banned = battleWithBan(true);
    for (const action of legalActions(banned, 'p2')) {
      if (action.type === 'CONCEDE') {
        continue;
      }
      const result = applyOk(banned, action);
      assertInvariants(result.state);
    }
  });
});

// ---------------------------------------------------------------------------
// The vanished-participant route (PR #24) crossing a forbidden block
// ---------------------------------------------------------------------------

describe('a banned Blocker and a battle that evaporates', () => {
  it('ends the battle cleanly when the attacker leaves and the only defence was forbidden', () => {
    // The two rules meet here: p2's single [Blocker] is banned for the battle,
    // so nothing can be interposed, and then the attacker leaves the field
    // before the Damage Step. CR 7-1-2-3 sends the game to the End of the
    // Battle, and the ban has to expire on that exit exactly as an endOfBattle
    // modifier does — `closeBattle` is shared precisely so the two cannot drift.
    const staged = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-020' }], activeDon: 3 },
      p2: { characters: [{ cardId: 'ABIL-022' }], activeDon: 3 },
    });
    const attacker = characterAt(staged, 'p1', 0);
    const opened = applyOk(staged, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker,
      target: staged.players.p2.leader,
    }).state;

    const draft = JSON.parse(JSON.stringify(opened)) as GameState;
    draft.legality.push({
      id: 'leg-test',
      source: attacker,
      controller: 'p1',
      writtenOnTurn: draft.turn,
      duration: 'endOfBattle',
      effect: 'forbid',
      subject: { player: 'p2' },
      clause: { question: 'activateBlocker' },
    });
    expect(blockOffers(draft, 'p2')).toEqual([]);

    // The attacker vanishes mid-battle, the way a defender's effect removes it.
    const vanished = JSON.parse(JSON.stringify(draft)) as GameState;
    vanished.players.p1.characters = vanished.players.p1.characters.filter((id) => id !== attacker);
    vanished.players.p1.trash.unshift(attacker);
    const card = vanished.cards[attacker];
    if (card !== undefined) {
      card.orientation = 'active';
      card.playedOnTurn = null;
    }

    // Any action re-enters `applyAction`, which is the single site that closes a
    // battle missing a participant.
    const settled = applyOk(vanished, { type: 'PASS', player: 'p2' });
    expect(settled.state.battle).toBeNull();
    expect(settled.state.legality).toEqual([]);
    expect(settled.state.priority).toBe('p1');
    expect(settled.events.some((event) => event.type === 'battleEndedEarly')).toBe(true);
    assertInvariants(settled.state);
  });
});

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

describe('a live prohibition survives a JSON round trip', () => {
  it('round-trips a state holding rules of both durations and both directions', () => {
    const staged = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-027' }, { cardId: 'ABIL-020' }], activeDon: 5 },
      p2: { characters: [{ cardId: 'ABIL-022' }], activeDon: 5 },
    });
    const source = characterAt(staged, 'p1', 0);
    const pinned = characterAt(staged, 'p2', 0);

    // A choice opens inside the rule-writing script, and the state that rests on
    // it already carries a suspended interpreter. That is the pairing worth
    // asserting: an unanswered question **and** the mechanism that will write a
    // rule once it is answered, both in one serialized state.
    const asking = applyOk(staged, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: source,
      abilityId: 'ABIL-027-main',
    }).state;
    expect(asking.pending).not.toBeNull();
    expect(asking.priority).toBe('p1');
    expect(asking.stack).toHaveLength(1);
    assertSerializationRoundTrip(asking);

    const answered = applyOk(asking, {
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId: asking.pending?.id ?? '',
      answer: { kind: 'cards', selected: [pinned] },
    }).state;

    const written = answered.legality[0];
    expect(written).toBeDefined();
    expect(written?.effect).toBe('forbid');
    expect(written?.duration).toBe('endOfTurn');
    assertSerializationRoundTrip(answered);

    // Read back through a real round trip, the rule still decides the same way.
    const revived = JSON.parse(JSON.stringify(answered)) as GameState;
    expect(canAttack(revived, pinned, revived.players.p1.leader)).toBe(false);
  });

  it('writes no rule at all when the choice names nothing', () => {
    // Rule 1 of the interpreter: an "up to 1" answered with nothing leaves a
    // prohibition with no card to hang on, and the state should not carry one
    // around until the turn ends.
    const staged = buildScenario({
      decks,
      p1: { characters: [{ cardId: 'ABIL-027' }], activeDon: 5 },
      p2: { characters: [{ cardId: 'ABIL-005' }], activeDon: 5 },
    });
    const source = characterAt(staged, 'p1', 0);
    const asking = applyOk(staged, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: source,
      abilityId: 'ABIL-027-main',
    }).state;
    const answered = applyOk(asking, {
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId: asking.pending?.id ?? '',
      answer: { kind: 'cards', selected: [] },
    }).state;

    expect(answered.legality).toEqual([]);
    assertInvariants(answered);
  });
});

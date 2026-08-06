import { describe, expect, it } from 'vitest';
import { getCardDef, getPower, legalActions } from '@optcg/engine';
import type { GameState, InstanceId } from '@optcg/engine';
import { characterAt, handCard } from '@optcg/engine/testdata/scenarios';
import { answer, applyOk, assertSettled, firedIds, optIn, run, starterScenario } from './support.js';

/**
 * One case per scripted ability: a position built directly, a fixed action
 * sequence, and the exact values the ability is responsible for. Fixed seed,
 * no mocks — the same shape as the engine's own ABIL table.
 *
 * Each case also asserts the interpreter came to a full stop, which is where a
 * half-resolved script shows up.
 */

// ---------------------------------------------------------------------------
// ST01-005 Jinbe — [DON!! x1] [When Attacking]
// ---------------------------------------------------------------------------

describe('ST01-005 Jinbe — [DON!! x1] [When Attacking] give another card +1000', () => {
  function setup(attachedDon: number): { state: GameState; jinbe: InstanceId; ally: InstanceId } {
    const state = starterScenario({
      p1: {
        activeDon: 4,
        characters: [{ cardId: 'ST01-005', attachedDon }, { cardId: 'ST01-010' }],
      },
    });
    return { state, jinbe: characterAt(state, 'p1', 0), ally: characterAt(state, 'p1', 1) };
  }

  function attack(state: GameState, jinbe: InstanceId): GameState {
    return applyOk(state, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: jinbe,
      target: state.players.p2.leader,
    }).state;
  }

  it('asks for a target when a DON!! is attached', () => {
    const { state, jinbe, ally } = setup(1);
    const attacking = attack(state, jinbe);

    expect(attacking.pending?.kind).toBe('selectCards');
    expect(attacking.pending?.player).toBe('p1');
    expect(attacking.pending?.min).toBe(0);
    expect(attacking.pending?.max).toBe(1);
    // "other than this card": Jinbe is not among its own candidates.
    expect(attacking.pending?.candidates).toEqual([state.players.p1.leader, ally]);
  });

  it('adds exactly +1000 to the chosen card, for the turn', () => {
    const { state, jinbe, ally } = setup(1);
    const before = getPower(state, ally);
    const done = answer(attack(state, jinbe), 'p1', { kind: 'cards', selected: [ally] });

    expect(getPower(done, ally)).toBe(before + 1000);
    expect(done.modifiers).toHaveLength(1);
    expect(done.modifiers[0]).toMatchObject({
      target: ally,
      kind: 'power',
      value: 1000,
      duration: 'endOfTurn',
      source: jinbe,
    });
    assertSettled(done);
  });

  it('does not fire at all with no DON!! attached', () => {
    const { state, jinbe, ally } = setup(0);
    const attacking = attack(state, jinbe);

    expect(attacking.pending).toBeNull();
    expect(attacking.modifiers).toEqual([]);
    expect(getPower(attacking, ally)).toBe(getPower(state, ally));
    expect(attacking.stack).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ST01-014 Guard Point — [Trigger]
// ---------------------------------------------------------------------------

describe('ST01-014 Guard Point — [Trigger] give +1000 for the turn', () => {
  /**
   * Guard Point is an ST-01 card, so it can only ever be in p1's life. p2
   * therefore has to be the attacker, which is what `firstPlayer` buys here.
   */
  function damageInto(): { state: GameState; attacker: InstanceId } {
    const staged = starterScenario({
      firstPlayer: 'p2',
      p1: { lifeCards: ['ST01-014', 'ST01-003', 'ST01-008', 'ST01-009', 'ST01-011'] },
      // Koby, 6000, beats a 5000 Leader without needing any DON!! attached.
      p2: { characters: [{ cardId: 'ST02-006' }] },
    });
    const attacker = characterAt(staged, 'p2', 0);
    const state = run(
      staged,
      { type: 'DECLARE_ATTACK', player: 'p2', attacker, target: staged.players.p1.leader },
      { type: 'PASS', player: 'p1' },
      { type: 'PASS', player: 'p1' },
    );
    return { state, attacker };
  }

  it('offers the [Trigger] to the damaged player as an opt-in', () => {
    const { state } = damageInto();
    expect(state.pending?.kind).toBe('yesNo');
    expect(state.pending?.player).toBe('p1');
    expect(state.stack[0]?.status).toBe('optIn');
  });

  it('gives +1000 for the turn — not for the battle — when accepted', () => {
    const { state } = damageInto();
    const targeting = optIn(state, 'p1', true);
    const done = answer(targeting, 'p1', {
      kind: 'cards',
      selected: [state.players.p1.leader],
    });

    expect(done.modifiers).toHaveLength(1);
    expect(done.modifiers[0]).toMatchObject({
      target: done.players.p1.leader,
      kind: 'power',
      value: 1000,
      duration: 'endOfTurn',
    });
    // The battle it came out of is already closed, so an endOfBattle duration
    // here would have expired on the spot. This is the copy-paste trap.
    expect(done.battle).toBeNull();
    expect(getPower(done, done.players.p1.leader)).toBe(6000);
    assertSettled(done);
  });

  it('does nothing when the [Trigger] is declined', () => {
    const { state } = damageInto();
    const done = optIn(state, 'p1', false);
    expect(done.modifiers).toEqual([]);
    assertSettled(done);
  });
});

// ---------------------------------------------------------------------------
// ST01-015 Gum-Gum Jet Pistol — [Main] and [Trigger]
// ---------------------------------------------------------------------------

describe('ST01-015 Gum-Gum Jet Pistol — K.O. a Character with 6000 power or less', () => {
  function setup(): { state: GameState; event: InstanceId; weak: InstanceId; strong: InstanceId } {
    const state = starterScenario({
      p1: { activeDon: 4, hand: ['ST01-015'] },
      // Vito is 5000 and in range; Kid is 7000 and is not.
      p2: { characters: [{ cardId: 'ST02-002' }, { cardId: 'ST02-013' }] },
    });
    return {
      state,
      event: handCard(state, 'p1', 'ST01-015'),
      weak: characterAt(state, 'p2', 0),
      strong: characterAt(state, 'p2', 1),
    };
  }

  it('offers only the Characters inside the power limit', () => {
    const { state, event, weak } = setup();
    const played = applyOk(state, { type: 'PLAY_CARD', player: 'p1', instanceId: event }).state;

    expect(played.pending?.kind).toBe('selectCards');
    expect(played.pending?.candidates).toEqual([weak]);
  });

  it('K.O.s the chosen Character and trashes the event', () => {
    const { state, event, weak, strong } = setup();
    const played = applyOk(state, { type: 'PLAY_CARD', player: 'p1', instanceId: event }).state;
    const done = answer(played, 'p1', { kind: 'cards', selected: [weak] });

    expect(done.players.p2.characters).toEqual([strong]);
    expect(done.players.p2.trash[0]).toBe(weak);
    expect(done.players.p1.trash).toContain(event);
    assertSettled(done);
  });

  it('runs the same instruction list from the [Trigger]', () => {
    const staged = starterScenario({
      firstPlayer: 'p2',
      p1: { lifeCards: ['ST01-015', 'ST01-003', 'ST01-008', 'ST01-009', 'ST01-011'] },
      // Vito, 5000: exactly the Leader's power, and the attacker wins ties.
      p2: { characters: [{ cardId: 'ST02-002' }] },
    });
    const attacker = characterAt(staged, 'p2', 0);
    const victim = attacker;
    const damaged = run(
      staged,
      { type: 'DECLARE_ATTACK', player: 'p2', attacker, target: staged.players.p1.leader },
      { type: 'PASS', player: 'p1' },
      { type: 'PASS', player: 'p1' },
    );

    expect(damaged.pending?.player).toBe('p1');
    const targeting = optIn(damaged, 'p1', true);
    // Same script as the [Main] half: an opponent Character within 6000.
    expect(targeting.pending?.candidates).toEqual([victim]);

    const done = answer(targeting, 'p1', { kind: 'cards', selected: [victim] });
    expect(done.players.p2.characters).toEqual([]);
    expect(done.players.p2.trash[0]).toBe(victim);
    assertSettled(done);
  });
});

// ---------------------------------------------------------------------------
// ST02-009 Trafalgar Law — [On Play]
// ---------------------------------------------------------------------------

describe('ST02-009 Trafalgar Law — [On Play] set a rested crewmate active', () => {
  function setup(): { state: GameState; law: InstanceId; bepo: InstanceId; koby: InstanceId } {
    const state = starterScenario({
      p2: {
        activeDon: 6,
        hand: ['ST02-009'],
        characters: [
          // Bepo: {Minks}{Heart Pirates}, cost 1, rested — a candidate.
          { cardId: 'ST02-012', orientation: 'rested' },
          // Koby: {Navy}, cost 4, rested — right cost, wrong type.
          { cardId: 'ST02-006', orientation: 'rested' },
        ],
      },
      firstPlayer: 'p2',
    });
    return {
      state,
      law: handCard(state, 'p2', 'ST02-009'),
      bepo: characterAt(state, 'p2', 0),
      koby: characterAt(state, 'p2', 1),
    };
  }

  it('offers only rested Characters of the right type and cost', () => {
    const { state, law, bepo } = setup();
    const played = applyOk(state, { type: 'PLAY_CARD', player: 'p2', instanceId: law }).state;
    // Koby is excluded by type; Law itself enters active, so orientation
    // excludes it without any need for excludeSelf.
    expect(played.pending?.candidates).toEqual([bepo]);
  });

  it('sets the chosen Character active', () => {
    const { state, law, bepo, koby } = setup();
    const played = applyOk(state, { type: 'PLAY_CARD', player: 'p2', instanceId: law }).state;
    const done = answer(played, 'p2', { kind: 'cards', selected: [bepo] });

    expect(done.cards[bepo]?.orientation).toBe('active');
    expect(done.cards[koby]?.orientation).toBe('rested');
    assertSettled(done);
  });
});

// ---------------------------------------------------------------------------
// ST02-013 Eustass"Captain"Kid — [DON!! x1] [End of Your Turn]
// ---------------------------------------------------------------------------

describe('ST02-013 Kid — [DON!! x1] [End of Your Turn] set this Character active', () => {
  /** Kid is an ST-02 card, so only p2 can ever have one on the field. */
  function setup(attachedDon: number, turnOf: 'p1' | 'p2'): { state: GameState; kid: InstanceId } {
    const state = starterScenario({
      firstPlayer: turnOf,
      p2: { activeDon: 4, characters: [{ cardId: 'ST02-013', orientation: 'rested', attachedDon }] },
    });
    return { state, kid: characterAt(state, 'p2', 0) };
  }

  it('wakes at the end of its controller turn', () => {
    const { state, kid } = setup(1, 'p2');
    const { state: done, events } = applyOk(state, { type: 'END_TURN', player: 'p2' });

    expect(done.cards[kid]?.orientation).toBe('active');
    // p2's own Refresh does not run at the end of p2's turn — p1's does — so
    // the ability is the only thing that could have woken it.
    expect(firedIds(events)).toEqual(['ST02-013-endOfTurn']);
    assertSettled(done);
  });

  it('stays asleep at the end of the opponent turn', () => {
    const { state, kid } = setup(1, 'p1');
    const { state: done, events } = applyOk(state, { type: 'END_TURN', player: 'p1' });

    // `endOfTurn` fires for both players' cards, so `isYourTurn` is the only
    // thing keeping this one quiet. The orientation cannot show it — p2's
    // Refresh runs right after and wakes everything — but the events can.
    expect(firedIds(events)).toEqual([]);
    expect(done.cards[kid]?.orientation).toBe('active');
    assertSettled(done);
  });

  it('stays rested with no DON!! attached', () => {
    const { state, kid } = setup(0, 'p2');
    const { state: done, events } = applyOk(state, { type: 'END_TURN', player: 'p2' });

    expect(done.cards[kid]?.orientation).toBe('rested');
    expect(firedIds(events)).toEqual([]);
    assertSettled(done);
  });
});

// ---------------------------------------------------------------------------
// ST01-006 / ST02-004 — printed [Blocker], no script
// ---------------------------------------------------------------------------

describe('ST01-006 Chopper and ST02-004 Bege — printed [Blocker], no ability', () => {
  const BLOCKERS: Array<['p1' | 'p2', string]> = [
    ['p1', 'ST01-006'],
    ['p2', 'ST02-004'],
  ];

  it.each(BLOCKERS)('%s %s carries the keyword and no Ability', (_player, cardId) => {
    const def = getCardDef(cardId);
    expect(def.keywords).toContain('Blocker');
    expect(def.abilities).toBeUndefined();
  });

  it.each(BLOCKERS)('%s %s can actually block an attack', (player, cardId) => {
    // p1 owns the ST-01 deck and p2 the ST-02 one, so each blocker is tested
    // against an attacker from the other side.
    const state =
      player === 'p1'
        ? starterScenario({
            firstPlayer: 'p2',
            p1: { characters: [{ cardId, orientation: 'active' }] },
            p2: { activeDon: 4, characters: [{ cardId: 'ST02-006' }] },
          })
        : starterScenario({
            firstPlayer: 'p1',
            p1: { activeDon: 4, characters: [{ cardId: 'ST01-010' }] },
            p2: { characters: [{ cardId, orientation: 'active' }] },
          });
    const attacker = player === 'p1' ? 'p2' : 'p1';
    const blocker = characterAt(state, player, 0);
    const attacking = applyOk(state, {
      type: 'DECLARE_ATTACK',
      player: attacker,
      attacker: characterAt(state, attacker, 0),
      target: state.players[player].leader,
    }).state;

    // The engine offers the block off the printed keyword alone.
    expect(legalActions(attacking, player)).toContainEqual({
      type: 'DECLARE_BLOCK',
      player,
      blocker,
    });

    const blocked = applyOk(attacking, { type: 'DECLARE_BLOCK', player, blocker }).state;
    expect(blocked.battle?.target).toBe(blocker);
    expect(blocked.battle?.wasBlocked).toBe(true);
    expect(blocked.cards[blocker]?.orientation).toBe('rested');
  });
});

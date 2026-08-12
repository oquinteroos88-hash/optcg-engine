import { describe, expect, it } from 'vitest';
import { applyAction, checkInvariants, legalActions, registerCardSet } from '../src/index.js';
import type { Action, CardDefinition, Decklist, GameState, InstanceId } from '../src/index.js';
import { buildScenario, characterAt } from '../src/testdata/scenarios.js';

/**
 * The battle whose attacker or target leaves the field mid-resolution.
 *
 * ## The rule
 *
 * The Comprehensive Rules v1.2.0 say it three times, once per step, in
 * identical words — **7-1-1-4** (end of the Attack Step), **7-1-2-3** (end of
 * the Block Step), and the same sentence at the end of the Counter Step, which
 * v1.2.0 misprints as "7-1-2-3" a second time and means 7-1-3-3:
 *
 * > "If, at the end of the … Step, the attacking card or the target card for
 * > the attack has moved areas due to some method, proceed not to the … Step,
 * > but to the End of the Battle (see 7-1-5.)."
 *
 * Each `it` below pins one consequence of that sentence, and the file is the
 * regression test for the crash that found it: before this, the Damage Step
 * called `leaveField` on a card already in the trash and `detachFromField`
 * threw `Engine bug: … is not on … field`.
 *
 * ## Why it registers its own cards
 *
 * The removal has to happen *during* a battle, and no card in the TEST or ABIL
 * sets does that. These are registered into the same public registry the other
 * sets use, and their deck is local to this file — the ABIL deck is untouched,
 * so no seeded sweep moves.
 */

const VANISH_CARDS: CardDefinition[] = [
  {
    cardId: 'VAN-L01',
    name: 'Vanishing Leader',
    category: 'leader',
    color: 'blue',
    cost: 0,
    power: 5000,
    counter: null,
    life: 4,
    keywords: [],
    types: ['Crew'],
  },
  // Removes the battle's *current* target. The mirror of OP01-017 Nico Robin,
  // and of the printed [When Attacking] K.O. family generally.
  {
    cardId: 'VAN-001',
    name: 'Reaper',
    category: 'character',
    color: 'blue',
    cost: 2,
    power: 5000,
    counter: 1000,
    life: 0,
    keywords: [],
    types: ['Crew'],
    abilities: [
      {
        id: 'VAN-001-whenAttacking',
        trigger: 'whenAttacking',
        script: [{ op: 'ko', target: { battle: 'target' } }],
      },
    ],
  },
  // Same, but the target moves to its owner's hand. CR 7-1-1-4 says "moved
  // areas", not "K.O.'d", and real cards do this: OP04-068 Yokozuna returns a
  // Character to hand on the opponent's attack, ST03-003 Crocodile puts one at
  // the bottom of the deck on block.
  {
    cardId: 'VAN-002',
    name: 'Repeller',
    category: 'character',
    color: 'blue',
    cost: 2,
    power: 5000,
    counter: 1000,
    life: 0,
    keywords: [],
    types: ['Crew'],
    abilities: [
      {
        id: 'VAN-002-whenAttacking',
        trigger: 'whenAttacking',
        script: [{ op: 'moveCard', target: { battle: 'target' }, to: { zone: 'hand' } }],
      },
    ],
  },
  // The defender's side of the same rule. Printed equivalents: EB01-037 Mr. 9
  // and OP04-072 Mr.5(Gem), both [On Your Opponent's Attack] K.O.s.
  {
    cardId: 'VAN-003',
    name: 'Retaliator',
    category: 'character',
    color: 'blue',
    cost: 2,
    power: 3000,
    counter: 1000,
    life: 0,
    keywords: [],
    types: ['Crew'],
    abilities: [
      {
        id: 'VAN-003-whenOpponentAttacks',
        trigger: 'whenOpponentAttacks',
        script: [{ op: 'ko', target: { battle: 'attacker' } }],
      },
    ],
  },
  // Blocks — becoming the new target — and then removes itself. The printed
  // shape is ST03-003 Crocodile, whose [On Block] can bottom-deck any Character
  // with a cost of 2 or less, itself included.
  {
    cardId: 'VAN-004',
    name: 'Kamikaze Wall',
    category: 'character',
    color: 'blue',
    cost: 2,
    power: 2000,
    counter: 1000,
    life: 0,
    keywords: ['Blocker'],
    types: ['Crew'],
    abilities: [
      {
        id: 'VAN-004-onBlock',
        trigger: 'onBlock',
        script: [{ op: 'ko', target: { self: true } }],
      },
    ],
  },
  // Grants itself an endOfBattle buff and *then* removes the target, so the
  // battle ends early with a live modifier parked on the attacker.
  {
    cardId: 'VAN-005',
    name: 'Rallier',
    category: 'character',
    color: 'blue',
    cost: 3,
    power: 4000,
    counter: 1000,
    life: 0,
    keywords: [],
    types: ['Crew'],
    abilities: [
      {
        id: 'VAN-005-whenAttacking',
        trigger: 'whenAttacking',
        script: [
          { op: 'addPower', target: { self: true }, value: 3000, duration: 'endOfBattle' },
          { op: 'ko', target: { battle: 'target' } },
        ],
      },
    ],
  },
  {
    cardId: 'VAN-006',
    name: 'Bystander',
    category: 'character',
    color: 'blue',
    cost: 1,
    power: 3000,
    counter: 1000,
    life: 0,
    keywords: [],
    types: ['Crew'],
  },
];

registerCardSet(VANISH_CARDS);

const VANISH_DECK: Decklist = {
  leader: 'VAN-L01',
  cards: [
    ...Array.from({ length: 8 }, () => 'VAN-001'),
    ...Array.from({ length: 8 }, () => 'VAN-002'),
    ...Array.from({ length: 8 }, () => 'VAN-003'),
    ...Array.from({ length: 8 }, () => 'VAN-004'),
    ...Array.from({ length: 8 }, () => 'VAN-005'),
    ...Array.from({ length: 10 }, () => 'VAN-006'),
  ],
};

function scenario(spec: Parameters<typeof buildScenario>[0]): GameState {
  return buildScenario({ ...spec, decks: { p1: VANISH_DECK, p2: VANISH_DECK } });
}

function apply(state: GameState, action: Action): GameState {
  const result = applyAction(state, action);
  if (!result.ok) {
    throw new Error(`action rejected (${result.reason}): ${JSON.stringify(action)}`);
  }
  return result.state;
}

function attack(state: GameState, attacker: InstanceId, target: InstanceId): GameState {
  return apply(state, { type: 'DECLARE_ATTACK', player: 'p1', attacker, target });
}

/** The last `battleEndedEarly` in the log, or undefined. */
function endedEarly(state: GameState) {
  return [...state.log].reverse().find((event) => event.type === 'battleEndedEarly');
}

// ---------------------------------------------------------------------------
// The four-action reproduction
// ---------------------------------------------------------------------------

describe('the repro that found it', () => {
  it('ends the battle instead of throwing when the target is K.O.d mid-battle', () => {
    const start = scenario({
      p1: { activeDon: 2, characters: [{ cardId: 'VAN-001' }] },
      p2: { characters: [{ cardId: 'VAN-006', orientation: 'rested' }] },
    });
    const reaper = characterAt(start, 'p1', 0);
    const victim = characterAt(start, 'p2', 0);
    // CR 7-1-1-2: a rested Character is a legal target, which is what makes
    // this reachable at all.
    expect(
      legalActions(start, 'p1').some((a) => a.type === 'DECLARE_ATTACK' && a.target === victim),
    ).toBe(true);

    const after = attack(start, reaper, victim);

    expect(after.battle).toBeNull();
    expect(after.players.p2.characters).not.toContain(victim);
    expect(after.players.p2.trash).toContain(victim);
    // CR 7-1-5-5: the game returns to the turn player's Main Phase.
    expect(after.priority).toBe('p1');
    expect(checkInvariants(after)).toEqual([]);

    const event = endedEarly(after);
    expect(event?.type).toBe('battleEndedEarly');
    if (event?.type === 'battleEndedEarly') {
      expect(event.gone).toBe('target');
      expect(event.attacker).toBe(reaper);
      expect(event.target).toBe(victim);
    }
    // And no damage was dealt: the Damage Step never ran.
    expect(after.log.some((e) => e.type === 'battleResolved')).toBe(false);
  });

  it('offers no battle action afterwards, because there is no battle', () => {
    const start = scenario({
      p1: { activeDon: 2, characters: [{ cardId: 'VAN-001' }] },
      p2: { characters: [{ cardId: 'VAN-006', orientation: 'rested' }] },
    });
    const after = attack(start, characterAt(start, 'p1', 0), characterAt(start, 'p2', 0));
    const kinds = new Set(legalActions(after, 'p1').map((a) => a.type));
    expect(kinds.has('PASS')).toBe(false);
    expect(kinds.has('DECLARE_BLOCK')).toBe(false);
    // The turn player carries on with their Main Phase.
    expect(kinds.has('END_TURN')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// One case per question the rules verification asked
// ---------------------------------------------------------------------------

describe('what the rules say happens', () => {
  it('leaves the attacker rested — CR 7-1-1-1 rests it, and 7-1-5 never gives it back', () => {
    const start = scenario({
      p1: { activeDon: 2, characters: [{ cardId: 'VAN-001' }] },
      p2: { characters: [{ cardId: 'VAN-006', orientation: 'rested' }] },
    });
    const reaper = characterAt(start, 'p1', 0);
    expect(start.cards[reaper]?.orientation).toBe('active');

    const after = attack(start, reaper, characterAt(start, 'p2', 0));
    // An attack that evaporated still cost the tap. Nothing in End of the
    // Battle sets a card active; a rested card wakes in its own Refresh Phase.
    expect(after.cards[reaper]?.orientation).toBe('rested');
    expect(
      legalActions(after, 'p1').some((a) => a.type === 'DECLARE_ATTACK' && a.attacker === reaper),
    ).toBe(false);
  });

  it('expires endOfBattle modifiers — CR 7-1-5-3 and 7-1-5-4 run on the early exit too', () => {
    const start = scenario({
      p1: { activeDon: 3, characters: [{ cardId: 'VAN-005' }] },
      p2: { characters: [{ cardId: 'VAN-006', orientation: 'rested' }] },
    });
    const rallier = characterAt(start, 'p1', 0);

    const after = attack(start, rallier, characterAt(start, 'p2', 0));
    // The +3000 was granted, the target then left, and the battle ended at
    // 7-1-5 rather than at nothing — so the buff expired with it instead of
    // leaking into the next battle.
    expect(after.log.some((e) => e.type === 'powerGranted')).toBe(true);
    expect(after.modifiers.filter((m) => m.duration === 'endOfBattle')).toEqual([]);
    expect(checkInvariants(after)).toEqual([]);
  });

  it('ends the battle when the ATTACKER leaves — CR 7-1-1-4 names it first', () => {
    // Reachable with printed cards, not only synthetic ones: EB01-037 Mr. 9 and
    // OP04-072 Mr.5(Gem) both K.O. on [On Your Opponent's Attack].
    const start = scenario({
      p1: { activeDon: 2, characters: [{ cardId: 'VAN-001' }] },
      p2: { characters: [{ cardId: 'VAN-003' }] },
    });
    const reaper = characterAt(start, 'p1', 0);
    const retaliator = characterAt(start, 'p2', 0);

    // Attacking the Leader, so the target survives and only the attacker goes.
    const after = attack(start, reaper, start.players.p2.leader);

    expect(after.battle).toBeNull();
    expect(after.players.p1.characters).not.toContain(reaper);
    expect(after.players.p2.characters).toContain(retaliator);
    expect(after.players.p2.life.length).toBe(start.players.p2.life.length);
    expect(checkInvariants(after)).toEqual([]);

    const event = endedEarly(after);
    if (event?.type === 'battleEndedEarly') {
      expect(event.gone).toBe('attacker');
    } else {
      throw new Error('expected a battleEndedEarly event');
    }
  });

  it('counts a bounce to hand, because the rule says "moved areas", not "K.O.d"', () => {
    const start = scenario({
      p1: { activeDon: 2, characters: [{ cardId: 'VAN-002' }] },
      p2: { characters: [{ cardId: 'VAN-006', orientation: 'rested' }] },
    });
    const victim = characterAt(start, 'p2', 0);

    const after = attack(start, characterAt(start, 'p1', 0), victim);

    expect(after.battle).toBeNull();
    // In hand, not in the trash — and the battle ended all the same.
    expect(after.players.p2.hand).toContain(victim);
    expect(after.players.p2.trash).not.toContain(victim);
    expect(endedEarly(after)?.type).toBe('battleEndedEarly');
    expect(checkInvariants(after)).toEqual([]);
  });

  it('watches the CURRENT target after a [Blocker] redirects the attack', () => {
    // The blocker makes itself the target (CR 7-1-2), then removes itself. The
    // original target is a spectator by then and is untouched.
    const start = scenario({
      p1: { activeDon: 2, characters: [{ cardId: 'VAN-006' }] },
      p2: { characters: [{ cardId: 'VAN-004' }] },
    });
    const attacker = characterAt(start, 'p1', 0);
    const wall = characterAt(start, 'p2', 0);
    const originalTarget = start.players.p2.leader;

    const declared = attack(start, attacker, originalTarget);
    expect(declared.battle?.target).toBe(originalTarget);

    const blocked = apply(declared, { type: 'DECLARE_BLOCK', player: 'p2', blocker: wall });

    expect(blocked.battle).toBeNull();
    expect(blocked.players.p2.characters).not.toContain(wall);
    // The Leader took no damage: the attack was redirected and then evaporated.
    expect(blocked.players.p2.life.length).toBe(start.players.p2.life.length);
    const event = endedEarly(blocked);
    if (event?.type === 'battleEndedEarly') {
      expect(event.gone).toBe('target');
      // Names the blocker, which is what `battle.target` held by then.
      expect(event.target).toBe(wall);
    } else {
      throw new Error('expected a battleEndedEarly event');
    }
    expect(checkInvariants(blocked)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// No regression: a battle that keeps both participants is untouched
// ---------------------------------------------------------------------------

describe('a battle that reaches the Damage Step is unchanged', () => {
  it('still resolves, still K.O.s the loser, and emits no early-end event', () => {
    const start = scenario({
      p1: { activeDon: 2, characters: [{ cardId: 'VAN-006' }] },
      p2: { characters: [{ cardId: 'VAN-006', orientation: 'rested' }] },
    });
    const attacker = characterAt(start, 'p1', 0);
    const target = characterAt(start, 'p2', 0);

    const declared = attack(start, attacker, target);
    expect(declared.battle).not.toBeNull();
    const blockStep = apply(declared, { type: 'PASS', player: 'p2' });
    const done = apply(blockStep, { type: 'PASS', player: 'p2' });

    // 3000 against 3000: the attacker wins ties (CR 7-1-4-1).
    expect(done.log.some((e) => e.type === 'battleResolved')).toBe(true);
    expect(done.log.some((e) => e.type === 'battleEndedEarly')).toBe(false);
    expect(done.players.p2.characters).not.toContain(target);
    expect(done.battle).toBeNull();
    expect(checkInvariants(done)).toEqual([]);
  });

  it('leaves a battle open while an effect is still resolving', () => {
    // The quiescence rule, from the other side: the guard must not close a
    // battle mid-step. `VAN-003` opens no choice, so this uses the plain block
    // step — a real resting state with a live battle and both participants on
    // the field.
    const start = scenario({
      p1: { activeDon: 2, characters: [{ cardId: 'VAN-006' }] },
      p2: { characters: [{ cardId: 'VAN-004' }] },
    });
    const declared = attack(start, characterAt(start, 'p1', 0), start.players.p2.leader);
    expect(declared.battle).not.toBeNull();
    expect(declared.battle?.step).toBe('block');
    expect(checkInvariants(declared)).toEqual([]);
  });
});

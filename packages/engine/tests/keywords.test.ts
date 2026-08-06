import { describe, expect, it } from 'vitest';
import { hasKeyword, legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { ABIL_DECK } from '../src/testdata/abilityDecks.js';
import { buildScenario, characterAt } from '../src/testdata/scenarios.js';
import { applyFail, applyOk, cloneWith } from './helpers.js';

/**
 * The four keywords in combat, plus `[Trigger]` on life cards.
 *
 * The Double Attack cases are the ones worth reading. The official Q&A answers
 * two questions that the Comprehensive Rules only imply, and they pull in
 * opposite directions from the naive model of "damage with 0 life is a loss":
 *
 * - Q36: with the opponent on 1 life, a Double Attack does **not** win.
 * - Q51: the first life card's `[Trigger]` resolves **before** the second
 *   damage, and the second damage only checks a life card if one is left.
 *
 * So the second instance of a Double Attack finds an empty life area and does
 * nothing, while a lone damage instance against an empty life area still wins.
 * `rules.doubleAttackCanWinFromOneLife` exists for anyone who reads the
 * mechanism differently; the default follows the Q&A.
 */

const abilityDecks = { p1: ABIL_DECK, p2: ABIL_DECK };

/**
 * p1 attacks p2's leader with the given card and the attack connects.
 *
 * Both leaders are 5000 and the attacker wins ties, so the attacker is topped
 * up with DON!! to exactly 5000 when its printed power is lower — otherwise the
 * battle resolves to noEffect and no damage rule is exercised at all.
 */
function attackLeaderWith(
  cardId: string,
  p2: { life?: number; lifeCards?: string[] },
  attachedDon = 3,
): {
  state: GameState;
  attacker: string;
} {
  const staged = buildScenario({
    decks: abilityDecks,
    turn: 3,
    p1: { activeDon: attachedDon, characters: [{ cardId, attachedDon }] },
    p2,
  });
  const attacker = characterAt(staged, 'p1', 0);
  const attacking = applyOk(staged, {
    type: 'DECLARE_ATTACK',
    player: 'p1',
    attacker,
    target: staged.players.p2.leader,
  }).state;
  // Block step, then counter step, then damage resolves.
  const blocked = applyOk(attacking, { type: 'PASS', player: 'p2' }).state;
  return { state: applyOk(blocked, { type: 'PASS', player: 'p2' }).state, attacker };
}

describe('Rush', () => {
  it('lets a character attack on the turn it was played', () => {
    const state = buildScenario({
      decks: abilityDecks,
      turn: 3,
      p1: { characters: [{ cardId: 'ABIL-005', playedOnTurn: 3 }] },
    });
    const rusher = characterAt(state, 'p1', 0);
    expect(hasKeyword(state, rusher, 'rush')).toBe(true);
    const attacks = legalActions(state, 'p1').filter(
      (a) => a.type === 'DECLARE_ATTACK' && a.attacker === rusher,
    );
    expect(attacks.length).toBeGreaterThan(0);
  });

  it('still blocks a character without it', () => {
    const state = buildScenario({
      decks: abilityDecks,
      turn: 3,
      p1: { characters: [{ cardId: 'ABIL-002', playedOnTurn: 3 }] },
    });
    const fresh = characterAt(state, 'p1', 0);
    expect(
      legalActions(state, 'p1').filter((a) => a.type === 'DECLARE_ATTACK' && a.attacker === fresh),
    ).toEqual([]);
    expect(
      applyFail(state, {
        type: 'DECLARE_ATTACK',
        player: 'p1',
        attacker: fresh,
        target: state.players.p2.leader,
      }),
    ).toBe('cannotAttackYet');
  });

  it('counts a Rush granted by an effect, not only a printed one', () => {
    // ABIL-023 grants itself Rush on play, so the character it just became can
    // attack immediately.
    const staged = buildScenario({
      decks: abilityDecks,
      turn: 3,
      p1: { activeDon: 5, hand: ['ABIL-023'] },
    });
    const inHand = staged.players.p1.hand.at(-1);
    expect(inHand).toBeDefined();
    const played = applyOk(staged, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: inHand as string,
    }).state;

    expect(hasKeyword(played, inHand as string, 'rush')).toBe(true);
    expect(played.cards[inHand as string]?.playedOnTurn).toBe(3);
    const attacks = legalActions(played, 'p1').filter(
      (a) => a.type === 'DECLARE_ATTACK' && a.attacker === inHand,
    );
    expect(attacks.length).toBeGreaterThan(0);
  });
});

describe('Banish', () => {
  it('sends the life card to the trash and never offers its [Trigger]', () => {
    const { state } = attackLeaderWith('ABIL-007', {
      lifeCards: ['ABIL-021', 'ABIL-002'], // ABIL-021 carries a [Trigger]
    });
    expect(state.pending).toBeNull();
    expect(state.players.p2.life).toHaveLength(1);
    // The banished card is in the trash, not the hand.
    const banished = state.players.p2.trash[0];
    expect(banished).toBeDefined();
    expect(state.cards[banished as string]?.cardId).toBe('ABIL-021');
    expect(state.players.p2.hand).not.toContain(banished);
    expect(state.log.some((e) => e.type === 'lifeBanished')).toBe(true);
  });
});

describe('Double Attack', () => {
  it('takes two life cards instead of one', () => {
    const { state } = attackLeaderWith('ABIL-006', {
      lifeCards: ['ABIL-002', 'ABIL-002', 'ABIL-005'],
    });
    expect(state.players.p2.life).toHaveLength(1);
    expect(state.players.p2.hand.slice(-2)).toHaveLength(2);
    expect(state.status).toBe('playing');
  });

  // Official Q&A Q36.
  it('does not win against a player holding exactly one life card', () => {
    const { state } = attackLeaderWith('ABIL-006', { lifeCards: ['ABIL-002'] });
    expect(state.players.p2.life).toHaveLength(0);
    expect(state.status).toBe('playing');
    expect(state.winner).toBeNull();
    expect(state.stack).toEqual([]);
    expect(state.resume).toEqual([]);
  });

  it('still wins when the life area was already empty', () => {
    const { state } = attackLeaderWith('ABIL-006', { life: 0 });
    expect(state.status).toBe('finished');
    expect(state.winner).toBe('p1');
    expect(state.endReason).toBe('lifeOut');
  });

  it('a following ordinary attack finishes the job', () => {
    const { state } = attackLeaderWith('ABIL-006', { lifeCards: ['ABIL-002'] });
    expect(state.players.p2.life).toHaveLength(0);

    const staged = cloneWith(state, (draft) => {
      // Give p1 a fresh attacker and hand the turn back to them.
      draft.turn = 5;
      draft.activePlayer = 'p1';
      draft.priority = 'p1';
      for (const id of draft.players.p1.characters) {
        const card = draft.cards[id];
        if (card !== undefined) {
          card.orientation = 'active';
          card.playedOnTurn = 0;
        }
      }
    });
    const attacker = characterAt(staged, 'p1', 0);
    const attacking = applyOk(staged, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker,
      target: staged.players.p2.leader,
    }).state;
    const passed = applyOk(attacking, { type: 'PASS', player: 'p2' }).state;
    const finished = applyOk(passed, { type: 'PASS', player: 'p2' }).state;

    expect(finished.status).toBe('finished');
    expect(finished.endReason).toBe('lifeOut');
    expect(finished.winner).toBe('p1');
  });

  it('honours the rules flag for anyone who reads the mechanism the other way', () => {
    const staged = buildScenario({
      decks: abilityDecks,
      turn: 3,
      p1: { characters: [{ cardId: 'ABIL-006' }] },
      p2: { lifeCards: ['ABIL-002'] },
    });
    const flagged = cloneWith(staged, (draft) => {
      draft.rules.doubleAttackCanWinFromOneLife = true;
    });
    const attacking = applyOk(flagged, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(flagged, 'p1', 0),
      target: flagged.players.p2.leader,
    }).state;
    const passed = applyOk(attacking, { type: 'PASS', player: 'p2' }).state;
    const finished = applyOk(passed, { type: 'PASS', player: 'p2' }).state;

    expect(finished.status).toBe('finished');
    expect(finished.winner).toBe('p1');
  });
});

describe('[Trigger] on life cards', () => {
  it('offers the damaged player a yes/no choice and holds priority for them', () => {
    const { state } = attackLeaderWith('ABIL-002', { lifeCards: ['ABIL-021', 'ABIL-002'] });
    expect(state.pending).not.toBeNull();
    expect(state.pending?.kind).toBe('yesNo');
    expect(state.pending?.player).toBe('p2');
    expect(state.priority).toBe('p2');
    expect(legalActions(state, 'p1')).toEqual([{ type: 'CONCEDE', player: 'p1' }]);
  });

  it('runs the trigger script on yes', () => {
    const { state } = attackLeaderWith('ABIL-002', { lifeCards: ['ABIL-021', 'ABIL-002'] });
    const handBefore = state.players.p2.hand.length;
    const after = applyOk(state, {
      type: 'ANSWER_CHOICE',
      player: 'p2',
      choiceId: state.pending?.id as string,
      answer: { kind: 'yesNo', value: true },
    }).state;
    // The life card itself joined the hand before the question; the trigger's
    // own draw is the extra card.
    expect(after.players.p2.hand).toHaveLength(handBefore + 1);
    expect(after.pending).toBeNull();
    expect(after.stack).toEqual([]);
  });

  it('skips it on no, and leaves nothing queued', () => {
    const { state } = attackLeaderWith('ABIL-002', { lifeCards: ['ABIL-021', 'ABIL-002'] });
    const handBefore = state.players.p2.hand.length;
    const after = applyOk(state, {
      type: 'ANSWER_CHOICE',
      player: 'p2',
      choiceId: state.pending?.id as string,
      answer: { kind: 'yesNo', value: false },
    }).state;
    expect(after.players.p2.hand).toHaveLength(handBefore);
    expect(after.pending).toBeNull();
    expect(after.stack).toEqual([]);
    expect(after.resume).toEqual([]);
    expect(after.log.some((e) => e.type === 'abilityDeclined')).toBe(true);
  });

  it('never asks about a life card with no [Trigger]', () => {
    const { state } = attackLeaderWith('ABIL-002', { lifeCards: ['ABIL-002', 'ABIL-002'] });
    expect(state.pending).toBeNull();
  });

  // Official Q&A Q51: with Double Attack the first card's trigger resolves
  // before the second damage is dealt.
  it('resolves the first life card trigger before the second damage lands', () => {
    const { state } = attackLeaderWith('ABIL-006', {
      lifeCards: ['ABIL-021', 'ABIL-021', 'ABIL-005'],
    });
    // Stopped on the first card's question, with the second damage still queued.
    expect(state.pending?.kind).toBe('yesNo');
    expect(state.players.p2.life).toHaveLength(2);
    expect(state.resume.some((step) => step.kind === 'damage')).toBe(true);

    const afterFirst = applyOk(state, {
      type: 'ANSWER_CHOICE',
      player: 'p2',
      choiceId: state.pending?.id as string,
      answer: { kind: 'yesNo', value: true },
    }).state;

    // Second damage has now landed and asks about the second card.
    expect(afterFirst.players.p2.life).toHaveLength(1);
    expect(afterFirst.pending?.kind).toBe('yesNo');

    const afterSecond = applyOk(afterFirst, {
      type: 'ANSWER_CHOICE',
      player: 'p2',
      choiceId: afterFirst.pending?.id as string,
      answer: { kind: 'yesNo', value: false },
    }).state;
    expect(afterSecond.pending).toBeNull();
    expect(afterSecond.stack).toEqual([]);
    expect(afterSecond.resume).toEqual([]);
  });
});

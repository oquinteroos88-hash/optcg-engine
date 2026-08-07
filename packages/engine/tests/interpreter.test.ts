import { deepStrictEqual } from 'node:assert';
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, registerCardSet } from '../src/index.js';
import type { Action, GameState } from '../src/index.js';
import { assertInvariants, checkTurnLeak } from '../src/invariants.js';
import { assertSerializationRoundTrip } from '../src/testing/index.js';
import { advanceToMain, applyFail, applyOk, buildGame, cloneWith, draftSetCostDon } from './helpers.js';

/**
 * The suspend/resume cycle, tested on its own before any of the rest of the DSL
 * exists.
 *
 * This is the load-bearing property of the whole design: an effect that stops to
 * ask a question is *state*, not a paused function. If a choice could not
 * survive `JSON.parse(JSON.stringify(...))` here, every effect built on top of
 * it would have to be rebuilt.
 *
 * Vitest isolates the module graph per file, so the cards registered here cannot
 * leak into another test file.
 */

const KO_CARD = 'TEST-A01';
const ATTACK_CARD = 'TEST-A02';

registerCardSet([
  {
    cardId: KO_CARD,
    name: 'Test Assassin',
    category: 'character',
    color: 'red',
    cost: 1,
    power: 1000,
    counter: null,
    keywords: [],
    life: 0,
    abilities: [
      {
        id: 'A01-onPlay',
        trigger: 'onPlay',
        script: [
          {
            op: 'select',
            as: 'victim',
            from: { zone: 'field', owner: 'opponent', category: ['character'] },
            min: 1,
            max: 1,
            prompt: 'KO one of your opponent characters',
          },
          { op: 'ko', target: { var: 'victim' } },
          { op: 'draw', player: 'you', count: 1 },
        ],
      },
    ],
  },
  {
    cardId: ATTACK_CARD,
    name: 'Test Duelist',
    category: 'character',
    color: 'red',
    cost: 1,
    power: 6000,
    counter: null,
    keywords: [],
    life: 0,
    abilities: [
      {
        id: 'A02-whenAttacking',
        trigger: 'whenAttacking',
        script: [
          {
            op: 'select',
            as: 'boosted',
            from: { zone: 'field', owner: 'you', category: ['character'] },
            min: 1,
            max: 1,
            prompt: 'Pick one of your characters',
          },
        ],
      },
    ],
  },
]);

/** Repoints an existing instance at another printed card: conservation holds. */
function retarget(draft: GameState, instanceId: string, cardId: string): void {
  const card = draft.cards[instanceId];
  if (card === undefined) {
    throw new Error(`missing instance ${instanceId}`);
  }
  card.cardId = cardId;
}

/** p1 holds the KO card; p2 has two characters on the board. */
function koSetup(): { state: GameState; koCard: string; victims: string[] } {
  const main = advanceToMain(buildGame());
  let koCard!: string;
  const victims: string[] = [];
  const state = cloneWith(main, (draft) => {
    draft.turn = 3;
    draftSetCostDon(draft, 'p1', 3);
    const inHand = draft.players.p1.hand[0];
    if (inHand === undefined) {
      throw new Error('p1 has no hand card to repurpose');
    }
    retarget(draft, inHand, KO_CARD);
    koCard = inHand;
    for (let i = 0; i < 2; i += 1) {
      const id = draft.players.p2.deck.shift();
      if (id === undefined) {
        throw new Error('p2 deck exhausted');
      }
      draft.players.p2.characters.push(id);
      const card = draft.cards[id];
      if (card !== undefined) {
        card.playedOnTurn = 0;
      }
      victims.push(id);
    }
  });
  return { state, koCard, victims };
}

/** Plays the KO card and stops on the choice it opens. */
function suspendedOnSelect(): { state: GameState; victims: string[] } {
  const { state, koCard, victims } = koSetup();
  const played = applyOk(state, { type: 'PLAY_CARD', player: 'p1', instanceId: koCard }).state;
  return { state: played, victims };
}

describe('interpreter: suspend and resume', () => {
  it('stops on a select with the stack loaded and the pending addressed to the controller', () => {
    const { state, victims } = suspendedOnSelect();
    expect(state.pending).not.toBeNull();
    expect(state.pending?.kind).toBe('selectCards');
    expect(state.pending?.player).toBe('p1');
    expect(state.pending?.min).toBe(1);
    expect(state.pending?.max).toBe(1);
    expect(new Set(state.pending?.candidates)).toEqual(new Set(victims));
    expect(state.stack).toHaveLength(1);
    expect(state.stack[0]?.abilityId).toBe('A01-onPlay');
    expect(state.stack[0]?.status).toBe('running');
    assertInvariants(state);
  });

  // Acceptance test 1. deepStrictEqual, not toEqual: it also catches a key whose
  // value is an explicit undefined, which a JSON round trip would silently drop.
  it('survives a JSON round trip with a choice open and the stack non-empty', () => {
    const { state } = suspendedOnSelect();
    expect(state.stack.length).toBeGreaterThan(0);
    expect(state.pending).not.toBeNull();
    assertSerializationRoundTrip(state);
    expect(JSON.stringify(state)).not.toContain('undefined');
    // No functions anywhere: a closure hiding in the cursor would not survive.
    for (const value of Object.values(state.stack[0] ?? {})) {
      expect(typeof value).not.toBe('function');
    }
  });

  // Acceptance test 2. The Phase 3 rehearsal: answering a rehydrated state has
  // to be indistinguishable from answering the live one.
  it('resumes identically after being serialized and rehydrated', () => {
    const { state, victims } = suspendedOnSelect();
    const choiceId = state.pending?.id;
    expect(choiceId).toBeDefined();
    const answer: Action = {
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId: choiceId as string,
      answer: { kind: 'cards', selected: [victims[0] as string] },
    };

    const rehydrated = JSON.parse(JSON.stringify(state)) as GameState;
    const live = applyOk(state, answer);
    const revived = applyOk(rehydrated, answer);

    deepStrictEqual(revived.state, live.state);
    deepStrictEqual(revived.events, live.events);
  });

  it('runs the rest of the script after the answer: the target is KOd and the draw happens', () => {
    const { state, victims } = suspendedOnSelect();
    const handBefore = state.players.p1.hand.length;
    const after = applyOk(state, {
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId: state.pending?.id as string,
      answer: { kind: 'cards', selected: [victims[0] as string] },
    }).state;

    expect(after.pending).toBeNull();
    expect(after.stack).toEqual([]);
    expect(after.resume).toEqual([]);
    expect(after.players.p2.characters).not.toContain(victims[0]);
    expect(after.players.p2.trash[0]).toBe(victims[0]);
    expect(after.players.p1.hand).toHaveLength(handBefore + 1);
    expect(after.priority).toBe('p1');
    assertInvariants(after);
  });

  // Acceptance test 5.
  it('gives the player who does not owe an answer exactly [CONCEDE]', () => {
    const { state } = suspendedOnSelect();
    expect(legalActions(state, 'p2')).toEqual([{ type: 'CONCEDE', player: 'p2' }]);
    expect(checkTurnLeak(state)).toEqual([]);
  });

  it('offers the answering player the marker and CONCEDE, and nothing else', () => {
    const { state } = suspendedOnSelect();
    expect(legalActions(state, 'p1')).toEqual([
      { type: 'ANSWER_CHOICE', player: 'p1', choiceId: state.pending?.id },
      { type: 'CONCEDE', player: 'p1' },
    ]);
  });

  it('blocks every other action while a choice is open', () => {
    const { state } = suspendedOnSelect();
    expect(applyFail(state, { type: 'END_TURN', player: 'p1' })).toBe('choicePending');
    expect(applyFail(state, { type: 'PASS', player: 'p1' })).toBe('choicePending');
    expect(applyFail(state, { type: 'END_TURN', player: 'p2' })).toBe('notYourPriority');
  });

  it('rejects ANSWER_CHOICE when nothing is pending', () => {
    const main = advanceToMain(buildGame());
    expect(
      applyFail(main, { type: 'ANSWER_CHOICE', player: 'p1', choiceId: 'choice-0' }),
    ).toBe('noPendingChoice');
  });

  it('hands priority to the effect owner mid-battle and gives it back on resume', () => {
    const main = advanceToMain(buildGame());
    let attacker!: string;
    const staged = cloneWith(main, (draft) => {
      draft.turn = 3;
      draftSetCostDon(draft, 'p1', 2);
      const id = draft.players.p1.deck.shift();
      if (id === undefined) {
        throw new Error('p1 deck exhausted');
      }
      retarget(draft, id, ATTACK_CARD);
      draft.players.p1.characters.push(id);
      const card = draft.cards[id];
      if (card !== undefined) {
        card.playedOnTurn = 0;
      }
      attacker = id;
    });

    const attacking = applyOk(staged, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker,
      target: staged.players.p2.leader,
    }).state;

    // The battle put priority on the defender; the attacker's own trigger takes
    // it back for exactly as long as the question is open.
    expect(attacking.battle).not.toBeNull();
    expect(attacking.pending?.player).toBe('p1');
    expect(attacking.priority).toBe('p1');
    expect(legalActions(attacking, 'p2')).toEqual([{ type: 'CONCEDE', player: 'p2' }]);
    assertInvariants(attacking);
    assertSerializationRoundTrip(attacking);

    const answered = applyOk(attacking, {
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId: attacking.pending?.id as string,
      answer: { kind: 'cards', selected: [attacker] },
    }).state;

    expect(answered.pending).toBeNull();
    expect(answered.battle?.step).toBe('block');
    expect(answered.priority).toBe('p2');
    assertInvariants(answered);
  });
});

describe('interpreter: answer validation', () => {
  function pendingState(): { state: GameState; choiceId: string; victims: string[] } {
    const { state, victims } = suspendedOnSelect();
    return { state, choiceId: state.pending?.id as string, victims };
  }

  it('accepts an answer that satisfies the pending exactly', () => {
    const { state, choiceId, victims } = pendingState();
    const result = applyAction(state, {
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId,
      answer: { kind: 'cards', selected: [victims[1] as string] },
    });
    expect(result.ok).toBe(true);
  });

  it('names the specific rule an answer breaks', () => {
    const { state, choiceId, victims } = pendingState();
    const answer = (selected: string[]): Action => ({
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId,
      answer: { kind: 'cards', selected },
    });

    expect(applyFail(state, answer([]))).toBe('choiceCardinality');
    expect(applyFail(state, answer([victims[0] as string, victims[1] as string]))).toBe(
      'choiceCardinality',
    );
    expect(applyFail(state, answer([state.players.p1.leader]))).toBe('choiceCandidateUnknown');
    expect(
      applyFail(state, {
        type: 'ANSWER_CHOICE',
        player: 'p1',
        choiceId: 'choice-does-not-exist',
        answer: { kind: 'cards', selected: [victims[0] as string] },
      }),
    ).toBe('wrongChoiceId');
    expect(
      applyFail(state, {
        type: 'ANSWER_CHOICE',
        player: 'p2',
        choiceId,
        answer: { kind: 'cards', selected: [victims[0] as string] },
      }),
    ).toBe('notYourPriority');
    expect(applyFail(state, { type: 'ANSWER_CHOICE', player: 'p1', choiceId })).toBe(
      'missingAnswer',
    );
    expect(
      applyFail(state, {
        type: 'ANSWER_CHOICE',
        player: 'p1',
        choiceId,
        answer: { kind: 'yesNo', value: true },
      }),
    ).toBe('choiceKindMismatch');
  });

  it('rejects a duplicate selection even when the cardinality fits', () => {
    const { state, victims } = suspendedOnSelect();
    // A min/max of 1 cannot express a duplicate, so widen the pending itself.
    const widened = cloneWith(state, (draft) => {
      if (draft.pending !== null) {
        draft.pending.min = 2;
        draft.pending.max = 2;
      }
    });
    expect(
      applyFail(widened, {
        type: 'ANSWER_CHOICE',
        player: 'p1',
        choiceId: widened.pending?.id as string,
        answer: { kind: 'cards', selected: [victims[0] as string, victims[0] as string] },
      }),
    ).toBe('choiceDuplicateSelection');
  });

  it('rejects a malformed answer payload before any rule check', () => {
    const { state, choiceId } = pendingState();
    expect(
      applyFail(state, {
        type: 'ANSWER_CHOICE',
        player: 'p1',
        choiceId,
        answer: { kind: 'cards', selected: 'not-an-array' },
      } as unknown as Action),
    ).toBe('malformedAction');
  });
});

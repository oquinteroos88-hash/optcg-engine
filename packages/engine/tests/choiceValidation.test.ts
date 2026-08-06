import { describe, expect, it } from 'vitest';
import { applyAction, createGame, legalActions } from '../src/index.js';
import type { Action, GameState, InstanceId, PendingChoice } from '../src/index.js';
import { botRngFor, chooseAction } from '../src/bots/randomBot.js';
import { checkInvariants, checkTurnLeak } from '../src/invariants.js';
import { ABIL_DECK } from '../src/testdata/abilityDecks.js';

/**
 * Acceptance test 4, on real pendings rather than hand-picked ones.
 *
 * `legalActions` deliberately does not enumerate answers, so the burden of
 * saying what a legal answer looks like falls entirely on `state.pending` and
 * on `applyAction`'s validation. This collects the choices a few hundred bot
 * games actually open and checks both directions on each: every answer the
 * pending permits is accepted, and every way of breaking it comes back with its
 * own reason code rather than a generic rejection.
 */

/** Plays bot games and keeps every state that rests on an open choice. */
function pendingCorpus(games: number, cap: number): GameState[] {
  const found: GameState[] = [];
  for (let seed = 1; seed <= games && found.length < cap; seed += 1) {
    let state = createGame({
      seed,
      decks: { p1: ABIL_DECK, p2: ABIL_DECK },
      firstPlayer: 'p1',
    });
    let rng = botRngFor(seed);
    let guard = 0;
    while (state.status !== 'finished' && guard < 4000) {
      guard += 1;
      if (state.pending !== null && found.length < cap) {
        found.push(state);
      }
      const picked = chooseAction(state, state.priority, rng);
      if (picked === null) {
        break;
      }
      rng = picked.rng;
      const result = applyAction(state, picked.action);
      if (!result.ok) {
        throw new Error(`bot produced an illegal action: ${result.reason}`);
      }
      state = result.state;
    }
    // Acceptance test 3, on every game the corpus walks.
    if (state.status === 'finished') {
      expect(state.stack).toEqual([]);
      expect(state.resume).toEqual([]);
      expect(state.pending).toBeNull();
    }
  }
  return found;
}

/** Up to `limit` distinct selections of a legal size, plus the extremes. */
function validSelections(pending: PendingChoice, limit: number): InstanceId[][] {
  const out: InstanceId[][] = [];
  for (let size = pending.min; size <= pending.max && out.length < limit; size += 1) {
    // Every contiguous window of this size is a distinct valid selection.
    for (let start = 0; start + size <= pending.candidates.length && out.length < limit; start += 1) {
      out.push(pending.candidates.slice(start, start + size));
    }
  }
  return out;
}

function accept(state: GameState, action: Action): void {
  const result = applyAction(state, action);
  if (!result.ok) {
    throw new Error(`valid answer rejected (${result.reason}): ${JSON.stringify(action)}`);
  }
  expect(checkInvariants(result.state)).toEqual([]);
}

function rejectWith(state: GameState, action: Action, reason: string): void {
  const result = applyAction(state, action);
  if (result.ok) {
    throw new Error(`invalid answer accepted: ${JSON.stringify(action)}`);
  }
  expect(result.reason).toBe(reason);
}

describe('answer validation over a corpus of real pendings', () => {
  const corpus = pendingCorpus(40, 120);

  it('collects enough pendings for the checks below to mean something', () => {
    expect(corpus.length).toBeGreaterThan(50);
    const kinds = new Set(corpus.map((state) => state.pending?.kind));
    expect(kinds.has('yesNo')).toBe(true);
    expect(kinds.has('selectCards')).toBe(true);
  });

  it('holds the priority invariant on every one of them', () => {
    for (const state of corpus) {
      expect(state.priority).toBe(state.pending?.player);
      expect(checkTurnLeak(state)).toEqual([]);
      expect(checkInvariants(state)).toEqual([]);
    }
  });

  it('accepts every answer the pending permits', () => {
    for (const state of corpus) {
      const pending = state.pending;
      if (pending === null) {
        continue;
      }
      const base = { type: 'ANSWER_CHOICE', player: pending.player, choiceId: pending.id } as const;
      if (pending.kind === 'yesNo') {
        accept(state, { ...base, answer: { kind: 'yesNo', value: true } });
        accept(state, { ...base, answer: { kind: 'yesNo', value: false } });
        continue;
      }
      if (pending.kind === 'selectOption') {
        for (let index = 0; index < pending.max; index += 1) {
          accept(state, { ...base, answer: { kind: 'option', index } });
        }
        continue;
      }
      for (const selected of validSelections(pending, 8)) {
        accept(state, { ...base, answer: { kind: 'cards', selected } });
      }
    }
  });

  it('rejects each way of breaking the pending with its own reason', () => {
    let cardinalityChecked = 0;
    let membershipChecked = 0;
    let duplicateChecked = 0;

    for (const state of corpus) {
      const pending = state.pending;
      if (pending === null) {
        continue;
      }
      const base = { type: 'ANSWER_CHOICE', player: pending.player, choiceId: pending.id } as const;

      // Wrong choice id, wrong player, and a missing payload apply to any kind.
      rejectWith(
        state,
        { ...base, choiceId: `${pending.id}-nope`, answer: { kind: 'yesNo', value: true } },
        'wrongChoiceId',
      );
      rejectWith(state, base, 'missingAnswer');
      const other = pending.player === 'p1' ? 'p2' : 'p1';
      // The priority gate catches the wrong player before the choice rules do,
      // which is the stricter of the two and the one the invariant relies on.
      rejectWith(
        state,
        { ...base, player: other, answer: { kind: 'yesNo', value: true } },
        'notYourPriority',
      );

      if (pending.kind === 'yesNo') {
        rejectWith(state, { ...base, answer: { kind: 'cards', selected: [] } }, 'choiceKindMismatch');
        continue;
      }
      if (pending.kind !== 'selectCards' && pending.kind !== 'orderCards') {
        continue;
      }

      rejectWith(state, { ...base, answer: { kind: 'yesNo', value: true } }, 'choiceKindMismatch');

      // Cardinality, both directions.
      if (pending.min > 0) {
        cardinalityChecked += 1;
        rejectWith(state, { ...base, answer: { kind: 'cards', selected: [] } }, 'choiceCardinality');
      }
      const tooMany = pending.candidates.slice(0, pending.max + 1);
      if (tooMany.length > pending.max) {
        cardinalityChecked += 1;
        rejectWith(
          state,
          { ...base, answer: { kind: 'cards', selected: tooMany } },
          'choiceCardinality',
        );
      }

      // Membership: an id that exists in the game but is not on offer.
      const stranger = Object.keys(state.cards).find((id) => !pending.candidates.includes(id));
      if (stranger !== undefined && pending.max >= 1) {
        membershipChecked += 1;
        const selected = [stranger, ...pending.candidates.slice(0, pending.min - 1)];
        rejectWith(
          state,
          { ...base, answer: { kind: 'cards', selected } },
          'choiceCandidateUnknown',
        );
      }

      // Duplicates, which only differ from a short selection when max >= 2.
      const first = pending.candidates[0];
      if (first !== undefined && pending.max >= 2 && pending.min <= 2) {
        duplicateChecked += 1;
        rejectWith(
          state,
          { ...base, answer: { kind: 'cards', selected: [first, first] } },
          'choiceDuplicateSelection',
        );
      }
    }

    expect(cardinalityChecked).toBeGreaterThan(0);
    expect(membershipChecked).toBeGreaterThan(0);
    // Not asserted as non-zero: the ABIL set has no "choose up to 2" card yet,
    // so this may legitimately be 0 here. interpreter.test.ts pins the rule
    // directly on a widened pending.
    expect(duplicateChecked).toBeGreaterThanOrEqual(0);
  });

  it('offers the answering player only the marker and CONCEDE', () => {
    for (const state of corpus) {
      const pending = state.pending;
      if (pending === null) {
        continue;
      }
      expect(legalActions(state, pending.player)).toEqual([
        { type: 'ANSWER_CHOICE', player: pending.player, choiceId: pending.id },
        { type: 'CONCEDE', player: pending.player },
      ]);
    }
  });
});

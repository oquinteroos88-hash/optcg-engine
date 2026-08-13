import { describe, expect, it } from 'vitest';
import { legalActions } from '../src/index.js';
import type { GameState, PlayerId } from '../src/index.js';
import { assertInvariants } from '../src/invariants.js';
import { assertSerializationRoundTrip } from '../src/testing/index.js';
import { buildScenario, characterAt } from '../src/testdata/scenarios.js';
import { REASONS } from '../src/reducer/errors.js';
import { applyFail, applyOk, cloneWith } from './helpers.js';

/**
 * `endOfOpponentNextTurn` — the first duration that outlives the turn it was
 * written in.
 *
 * The other two are measured against something the engine is already inside: a
 * battle, or a turn. This one is measured against **whose** turn ends, and that
 * difference is the whole of the design — it is why `Modifier` and
 * `LegalityRule` now carry a `controller` and a `writtenOnTurn`, and why the End
 * Phase had to be told which player's turn it is closing.
 *
 * Three rules were read off the Comprehensive Rules v1.2.0 before the code:
 *
 * - **Where it expires.** CR 6-6-1-2, and the clause structure is the answer:
 *   "After all processing that is to be carried out at this time has been
 *   completed, any remaining effects are processed in the following order:
 *   (1) Process any continuous effects of the **turn player** that have been
 *   activated and resolved, but are only due to be processed at the end of this
 *   turn or at the end of your turn … (2) Process any continuous effects of the
 *   **non-turn player** …". So expiry is in the End Phase of the opponent's
 *   turn, not at the start of yours, and the two are not the same instant: CR
 *   6-6-1-1 runs `[End of Your Turn]` effects *before* it, and CR 6-6-1-4 hands
 *   the turn over to a Refresh Phase (CR 6-2) that comes *after*.
 * - **How "next" is counted.** The rules do not say. The phrase is printed on 43
 *   cards and appears in no CR clause, so it is `rules.
 *   nextTurnExcludesTurnInProgress` with a default argued from the English —
 *   and both readings are exercised below.
 * - **What happens when there is no next turn.** Nothing: the game ends, the
 *   record sits in a finished state, and no End Phase runs to expire it. The
 *   invariant that bounds its lifetime is scoped to a playing game for exactly
 *   this reason.
 */

/** A prohibition of `player`'s making, aimed at the other side's Character. */
function withSpanningRule(
  state: GameState,
  player: PlayerId,
  subject: string,
  duration: 'endOfTurn' | 'endOfOpponentNextTurn',
): GameState {
  return cloneWith(state, (draft) => {
    draft.legality.push({
      id: `leg-test-${duration}`,
      source: draft.players[player].leader,
      controller: player,
      writtenOnTurn: draft.turn,
      duration,
      effect: 'forbid',
      subject: { is: subject },
      clause: { question: 'attack' },
    });
  });
}

function hasTestRule(state: GameState): boolean {
  return state.legality.some((rule) => rule.id.startsWith('leg-test-'));
}

/** Ends the turn in progress, settling anything it queues. */
function endTurn(state: GameState): GameState {
  const next = applyOk(state, { type: 'END_TURN', player: state.activePlayer }).state;
  assertInvariants(next);
  assertSerializationRoundTrip(next);
  return next;
}

describe('a rule that spans a change of turn player', () => {
  it('survives its own End Phase and dies in the opponent\'s (CR 6-6-1-2)', () => {
    // The full cycle, one End Phase at a time. The `endOfTurn` twin is written
    // in the same instant and against the same card, so the two lifetimes are
    // compared rather than merely asserted: the old duration is what `OP01-085`
    // would have had, and it is gone one End Phase before the new one.
    const staged = buildScenario({
      turn: 3,
      p1: { characters: [{ cardId: 'TEST-002' }] },
      p2: { characters: [{ cardId: 'TEST-102' }] },
    });
    expect(staged.activePlayer).toBe('p1');
    const victim = characterAt(staged, 'p2', 0);

    const short = withSpanningRule(staged, 'p1', victim, 'endOfTurn');
    const long = withSpanningRule(staged, 'p1', victim, 'endOfOpponentNextTurn');

    // p1's own End Phase. The short rule dies here — CR 6-6-1-2 clause (1),
    // the turn player's — and the long one is untouched, because its controller
    // *is* the turn player and clause (2) is not about them.
    const afterOwn = { short: endTurn(short), long: endTurn(long) };
    expect(hasTestRule(afterOwn.short)).toBe(false);
    expect(hasTestRule(afterOwn.long)).toBe(true);
    expect(afterOwn.long.activePlayer).toBe('p2');

    // And it is still there through the whole of p2's turn, which is the point
    // of the duration existing: the Character it names gets a turn to be
    // prohibited *in*.
    expect(hasTestRule(afterOwn.long)).toBe(true);

    // p2's End Phase. Now p1 is the non-turn player, so clause (2) reaches it.
    const afterOpponent = endTurn(afterOwn.long);
    expect(hasTestRule(afterOpponent)).toBe(false);
    expect(afterOpponent.activePlayer).toBe('p1');
  });

  it('stops the named Character attacking during that Character\'s own turn', () => {
    // What the old duration could not buy, stated as the board fact rather than
    // as a filter over `state.legality`: on p2's turn, with the rule still in
    // force, the prohibited Character cannot declare. Its neighbour can, so the
    // refusal is the rule's and not the position's.
    const staged = buildScenario({
      turn: 3,
      p1: { characters: [{ cardId: 'TEST-002' }] },
      p2: { characters: [{ cardId: 'TEST-102' }, { cardId: 'TEST-103' }] },
    });
    const pinned = characterAt(staged, 'p2', 0);
    const free = characterAt(staged, 'p2', 1);

    const ruled = withSpanningRule(staged, 'p1', pinned, 'endOfOpponentNextTurn');
    const opponentTurn = endTurn(ruled);
    expect(opponentTurn.activePlayer).toBe('p2');
    expect(hasTestRule(opponentTurn)).toBe(true);

    const target = opponentTurn.players.p1.leader;
    const attack = (attacker: string) =>
      ({ type: 'DECLARE_ATTACK', player: 'p2', attacker, target }) as const;

    expect(applyFail(opponentTurn, attack(pinned))).toBe(REASONS.attackForbidden);
    applyOk(opponentTurn, attack(free));

    // The offer is withheld as well as refused. A prohibition a client can still
    // see is a prohibition the affordance layer has to know about separately,
    // which is the contract `legalActions` has held since PR #31.
    const offered = legalActions(opponentTurn, 'p2')
      .filter((action) => action.type === 'DECLARE_ATTACK')
      .map((action) => (action.type === 'DECLARE_ATTACK' ? action.attacker : ''));
    expect(offered).not.toContain(pinned);
    expect(offered).toContain(free);
  });

  it('counts a turn already in progress as not being the next one', () => {
    // The reading `rules.nextTurnExcludesTurnInProgress` names, and the only
    // one the Comprehensive Rules leave open. Written by p1 *during p2's turn* —
    // which a `[Trigger]` out of the Life area really can do (`OP08-112`) — the
    // rule must not die at the end of the turn it was born in.
    const staged = buildScenario({ turn: 3, p2: { characters: [{ cardId: 'TEST-102' }] } });
    const onOpponentTurn = endTurn(staged);
    expect(onOpponentTurn.activePlayer).toBe('p2');

    const victim = characterAt(onOpponentTurn, 'p2', 0);
    const written = withSpanningRule(onOpponentTurn, 'p1', victim, 'endOfOpponentNextTurn');
    expect(written.turn).toBe(4);

    // p2's End Phase, the one in progress when it was written: survives.
    const afterThisOne = endTurn(written);
    expect(hasTestRule(afterThisOne)).toBe(true);
    // p1's own turn: survives, because clause (2) is not about the turn player.
    const afterOwn = endTurn(afterThisOne);
    expect(hasTestRule(afterOwn)).toBe(true);
    // p2's *next* turn: dies.
    const afterNext = endTurn(afterOwn);
    expect(hasTestRule(afterNext)).toBe(false);
  });

  it('with the flag off, the turn in progress does count', () => {
    // The other reading, kept exercisable rather than merely spelled: a flag
    // whose false branch nothing runs is a flag nobody can trust.
    const staged = buildScenario({ turn: 3, p2: { characters: [{ cardId: 'TEST-102' }] } });
    const onOpponentTurn = endTurn(staged);
    const victim = characterAt(onOpponentTurn, 'p2', 0);
    const written = cloneWith(
      withSpanningRule(onOpponentTurn, 'p1', victim, 'endOfOpponentNextTurn'),
      (draft) => {
        draft.rules.nextTurnExcludesTurnInProgress = false;
      },
    );

    expect(hasTestRule(endTurn(written))).toBe(false);
  });

  it('survives a JSON round trip while it is crossing turns', () => {
    // The record now carries two fields nothing else needed — `controller` and
    // `writtenOnTurn` — and both are required rather than optional precisely so
    // that this comparison is exact. An optional field would round-trip as an
    // absent one and the state would come back a different state.
    const staged = buildScenario({ turn: 3, p2: { characters: [{ cardId: 'TEST-102' }] } });
    const victim = characterAt(staged, 'p2', 0);
    const ruled = withSpanningRule(staged, 'p1', victim, 'endOfOpponentNextTurn');

    const midway = endTurn(ruled);
    expect(hasTestRule(midway)).toBe(true);
    assertSerializationRoundTrip(midway);
    expect(JSON.parse(JSON.stringify(midway))).toEqual(midway);

    const rule = midway.legality.find((entry) => entry.id.startsWith('leg-test-'));
    expect(rule?.controller).toBe('p1');
    expect(rule?.writtenOnTurn).toBe(3);
  });

  it('does not hang when the game ends before the next turn arrives', () => {
    // "Until the end of your opponent's next turn" with no next turn is not a
    // special case in the rules and is not one here: nothing expires it, nothing
    // looks for it, and the invariant that bounds its lifetime is scoped to a
    // playing game. This asserts the absence of a hang rather than a behaviour.
    const staged = buildScenario({ turn: 3, p2: { characters: [{ cardId: 'TEST-102' }] } });
    const victim = characterAt(staged, 'p2', 0);
    const ruled = withSpanningRule(staged, 'p1', victim, 'endOfOpponentNextTurn');

    const finished = cloneWith(ruled, (draft) => {
      draft.status = 'finished';
      draft.winner = 'p1';
      draft.endReason = 'concede';
    });
    expect(hasTestRule(finished)).toBe(true);
    assertInvariants(finished);
    assertSerializationRoundTrip(finished);
  });
});

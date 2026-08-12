import { answerFor, chooseFrom, decide } from '../testing/policy.js';
import { legalActions } from '../legalActions.js';
import type { Action, ChoiceAnswer, GameState, PendingChoice, PlayerId } from '../types.js';

/**
 * The sweep's bot, now a thin adapter over the shared policy.
 *
 * It used to carry its own uniform-over-index implementation and thread an
 * `RngState` derived from the game seed. Both are gone:
 *
 * - **Index choice violated local perturbation.** A new legal action displaced
 *   every action after it in `legalActions`, so adding one ability shifted every
 *   later decision of every game. `testing/policy.ts` documents what that cost.
 * - **The threaded RNG is what made it hard to share.** A stream of draws is
 *   order-dependent by construction: two drivers that consume a different number
 *   of draws diverge even from the same seed. A hash of
 *   `(seed, decision, action key)` needs no stream, so the same policy can be
 *   called from four suites and give the same answer in each.
 *
 * `decision` replaces the RNG cursor and is simply the driver's step counter.
 */

/** One decision: the action to submit, answer included. `undefined` when none. */
export function chooseAction(
  state: GameState,
  player: PlayerId,
  seed: number,
  decision: number,
): Action | undefined {
  return decide(state, player, seed, decision);
}

/** A legal answer to an open choice, for a driver that already has the pending. */
export function answerChoice(
  pending: PendingChoice,
  seed: number,
  decision: number,
): ChoiceAnswer {
  return answerFor(pending, seed, decision);
}

/** The action the policy takes out of an already-enumerated list. */
export function chooseFromActions(
  actions: readonly Action[],
  seed: number,
  decision: number,
): Action | undefined {
  return chooseFrom(actions, seed, decision);
}

/** `legalActions` for `player`, as the bot sees it before the policy runs. */
export function botOptions(state: GameState, player: PlayerId): Action[] {
  return legalActions(state, player);
}

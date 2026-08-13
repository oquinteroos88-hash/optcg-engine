import { legalActions } from '../legalActions.js';
import type {
  Action,
  ChoiceAnswer,
  GameState,
  InstanceId,
  PendingChoice,
  PlayerId,
} from '../types.js';

/**
 * The one random policy every test driver in this repo consumes.
 *
 * ## The property this exists for
 *
 * **Local perturbation.** If a state gains a new legal action and the driver
 * does not pick it, the decision must be *identical* to the one it would have
 * made without it. Adding abilities may only change the decisions the new
 * ability wins — never the others.
 *
 * Every driver here used to choose by **index** into `legalActions`, which
 * violates that by construction: a new action displaces every action after it
 * in the list, so every later decision in every game shifts. The repo paid for
 * that three times — seed 107 died when `ST01-017` gained an activatable
 * ability, the first 2C driver lost the seed that spent both Counter Events,
 * and every "ability X fires in a real game" test hung on seeds any future PR
 * could kill. With ~35 OP-01 abilities queued in batches, each batch would have
 * been a seed hunt.
 *
 * ## How it holds
 *
 * A decision is a pure function of the *set* of options, never of their order:
 *
 * 1. Each option gets a **stable key** derived from its content — the action's
 *    type plus the ids it carries — and never from its position.
 * 2. Each key gets a score from `hash(seed, decision, key)`.
 * 3. The winner is the best score; **ties break on the key**, not on the index,
 *    so two options that collide still resolve without consulting the order.
 *
 * Adding an option adds one score to the comparison. If it does not win, the
 * winner is unchanged — which is the property, and `stableKeys.test.ts` asserts
 * it by injecting a synthetic legal action into real games.
 *
 * ## What it deliberately does not fix
 *
 * A choice's *shape* is the engine's, not the driver's. `PendingChoice.max` is
 * `min(instruction.max, candidates.length)`, so a script that gains a candidate
 * can widen the cardinality range and move the draw. That is the engine
 * reporting a different question, not the driver reordering an answer to the
 * same one.
 */

/* ------------------------------------------------------------------ hashing */

/** FNV-1a, 32-bit. Cheap, stable across engines, and no dependency. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Avalanche (Murmur3 finaliser). FNV-1a alone leaves neighbouring keys in
 * neighbouring buckets, and the keys here differ by one character constantly
 * (`p1-c14` against `p1-c15`). Without this the scores of two sibling cards
 * correlate and the driver stops looking random.
 */
function avalanche(hash: number): number {
  let h = hash >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * The score of one option at one decision point.
 *
 * `decision` is the driver's step counter. It is what makes the same option
 * score differently on turn 3 and turn 30 — without it a driver would pick the
 * same action forever whenever the same set of options came round again.
 */
export function scoreFor(seed: number, decision: number, key: string): number {
  return avalanche(fnv1a(`${seed}\u0000${decision}\u0000${key}`));
}

/* --------------------------------------------------------------------- keys */

/**
 * A canonical key for an action: its type, then the ids it carries, in a fixed
 * field order.
 *
 * Not `JSON.stringify`. Two call sites building the same action with the
 * properties in a different order would serialise differently, and `undefined`
 * fields vanish rather than being marked — both of which would make one action
 * carry two keys and silently break the tie-break.
 *
 * The switch is exhaustive on purpose: a new `Action` variant fails to compile
 * here rather than falling into a default that keys it by type alone, which is
 * exactly how two distinct actions would come to share a key.
 */
export function actionKey(action: Action): string {
  switch (action.type) {
    case 'MULLIGAN':
      return `MULLIGAN|${action.player}|${action.accept ? 'y' : 'n'}`;
    case 'PLAY_CARD':
      // `trashCharacter` distinguishes two real, simultaneously legal moves:
      // playing the same card over a full field is a different action per
      // character trashed to make room.
      return `PLAY_CARD|${action.player}|${action.instanceId}|${action.trashCharacter ?? '-'}`;
    case 'ATTACH_DON':
      // `count` is part of the identity: attaching 1 and attaching 2 to the same
      // card are different actions and must not collide.
      return `ATTACH_DON|${action.player}|${action.to}|${action.count}`;
    case 'DECLARE_ATTACK':
      return `DECLARE_ATTACK|${action.player}|${action.attacker}|${action.target}`;
    case 'DECLARE_BLOCK':
      return `DECLARE_BLOCK|${action.player}|${action.blocker}`;
    case 'PLAY_COUNTER':
      return `PLAY_COUNTER|${action.player}|${action.instanceId}|${action.target}`;
    case 'PLAY_COUNTER_EVENT':
      return `PLAY_COUNTER_EVENT|${action.player}|${action.instanceId}`;
    case 'PASS':
      return `PASS|${action.player}`;
    case 'END_TURN':
      return `END_TURN|${action.player}`;
    case 'CONCEDE':
      return `CONCEDE|${action.player}`;
    case 'ACTIVATE_ABILITY':
      return `ACTIVATE_ABILITY|${action.player}|${action.instanceId}|${action.abilityId}`;
    case 'ANSWER_CHOICE':
      // `legalActions` emits a marker with no answer; the answer is built from
      // `pending` by `answerFor` below, so it is not part of the key.
      return `ANSWER_CHOICE|${action.player}|${action.choiceId}`;
  }
}

/* ---------------------------------------------------------------- selection */

/**
 * Policy layers, applied before the score.
 *
 * A layer is a **tier over the option's content**, never a filter over its
 * position, so it cannot reintroduce the ordering dependence the score removes.
 * Lower tiers win outright; the score only separates options inside one tier.
 *
 * - `CONCEDE` is excluded entirely. In a uniform pool virtually every game ends
 *   by random concession within a few turns, which makes the `endReason`
 *   distribution meaningless and leaves the rules untested.
 * - `END_TURN` is the last tier, so turns actually spend resources and games
 *   progress toward a real ending.
 */
export function actionTier(action: Action): number {
  return action.type === 'END_TURN' ? 1 : 0;
}

export function isExcluded(action: Action): boolean {
  return action.type === 'CONCEDE';
}

/**
 * The best of `items` under (tier asc, score desc, key asc).
 *
 * The key is the final tie-break rather than the index. Two options whose
 * scores collide — one pair in ~4 billion, but a suite that runs tens of
 * thousands of decisions will meet it — still resolve without anyone consulting
 * the order they arrived in. Without this the property would hold "almost
 * always", which for a determinism guarantee is the same as not holding.
 */
export function pickByKey<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  tierOf: (item: T) => number,
  seed: number,
  decision: number,
): T | undefined {
  let best: T | undefined;
  let bestKey = '';
  let bestTier = Number.POSITIVE_INFINITY;
  let bestScore = -1;
  for (const item of items) {
    const tier = tierOf(item);
    const key = keyOf(item);
    const score = scoreFor(seed, decision, key);
    if (
      best === undefined ||
      tier < bestTier ||
      (tier === bestTier && (score > bestScore || (score === bestScore && key < bestKey)))
    ) {
      best = item;
      bestKey = key;
      bestTier = tier;
      bestScore = score;
    }
  }
  return best;
}

/**
 * How often the driver declines to attach DON!!: 1 decision in
 * `HOLD_DON_EVERY`.
 *
 * ## The style this fixes
 *
 * `ATTACH_DON` is legal while a single active DON!! remains, because the Leader
 * is always a legal recipient, and `END_TURN` is the last tier. Between them
 * those two facts meant the bot **emptied its cost area every single turn**, and
 * DON!! return to active only in their controller's own Refresh Phase (CR 6-2).
 * So a defender arrived at every Counter Step with nothing to spend, and
 * `PLAY_COUNTER_EVENT` — which needs active cost-area DON!! covering the Event's
 * printed cost (CR 7-1-3-2-2) — was never once offered in 7,921 Counter Steps.
 *
 * Holding DON!! back to defend is a central pattern of the real game. The bot
 * played a style no human plays, and that style made a whole family of printed
 * cards unreachable.
 *
 * ## Why a per-decision coin is enough
 *
 * It looks like it should not be: declining once and attaching afterwards ends
 * the turn just as empty. What makes it work is the **tier interaction**. Once
 * a turn has nothing left but attaches and `END_TURN`, a declining decision
 * removes every attach from the pool and `END_TURN` is what remains — so the
 * turn ends holding DON!!. The coin does not have to fire on every decision of
 * a turn, only on one of the last few.
 *
 * That keeps the policy a pure function of `(seed, decision, keys)`. A per-turn
 * flag would need state the policy deliberately does not have.
 *
 * ## The rate, measured
 *
 * Swept the same way PR #22 swept the answer-exploration rate — against the
 * numbers that matter, not against a notion of realism. 200 games per corpus,
 * `cEvent` being `PLAY_COUNTER_EVENT` offered / taken, and `abilities` the union
 * of distinct ability ids reached:
 *
 * | rate | rg offered/taken | rg abilities | bp offered/taken | bp abilities | starters offered/taken | avg active DON!! |
 * | --- | --- | --- | --- | --- | --- | --- |
 * | never | 0 / 0 | 20 | 0 / 0 | 12 | 16 / 10 | 0.00 |
 * | 1 in 16 | 3 / 2 | 22 | 0 / 0 | 12 | 23 / 9 | 0.02 |
 * | 1 in 8 | 0 / 0 | 19 | 2 / 1 | 13 | 23 / 11 | 0.04 |
 * | 1 in 4 | 7 / 3 | 22 | 3 / 3 | 14 | 26 / 12 | 0.11 |
 * | **1 in 3** | **21 / 11** | **25** | **13 / 8** | **14** | **33 / 15** | **0.18** |
 * | 1 in 2 | 31 / 13 | 25 | 24 / 11 | 46 / 25 | 14 | 0.39 |
 *
 * **1 in 3 is the inflection**, and it is chosen for three reasons visible in
 * that table rather than for taste:
 *
 * 1. The `cEvent` column turns sharply there — 7 to 21 on red/green, 3 to 13 on
 *    blue/purple. Below it the effect is inside the noise.
 * 2. Ability coverage **peaks** at 25 / 14 / 15. Every rate below reaches fewer,
 *    and 1 in 2 reaches no more.
 * 3. 1 in 2 starts costing what PR #22 warned about. Counter Steps per 200 games
 *    drop from 10,468 to 9,553 — a bot holding half its DON!! plays fewer
 *    battles, and fewer battles is a poorer board for everything else.
 *
 * What it bought, concretely: **every `[Counter]` half in the repo now fires in
 * ordinary play.** All five of OP-01's, both of the blue ones, and
 * `ST01-014-counter` — Guard Point's, written when `PLAY_COUNTER_EVENT` shipped
 * in PR #10 and never once reached by a real game in the two years since.
 */
const HOLD_DON_EVERY = 3;

/**
 * True on the decisions where the driver keeps its DON!! rather than attaching.
 *
 * Depends on `(seed, decision)` only — never on which actions are on offer — so
 * injecting an action into the pool cannot change whether this fires. That is
 * what keeps local perturbation intact, and `stableKeys.test.ts` proves it with
 * a synthetic `ATTACH_DON` injected into real games.
 */
export function holdsDon(seed: number, decision: number, every = HOLD_DON_EVERY): boolean {
  return scoreFor(seed, decision, '#hold-don') % every === 0;
}

/**
 * Picks one action out of what `legalActions` offered.
 *
 * Returns `undefined` when nothing is playable, which is how a driver notices a
 * finished game rather than spinning.
 */
export function chooseFrom(
  actions: readonly Action[],
  seed: number,
  decision: number,
  holdDonEvery = HOLD_DON_EVERY,
): Action | undefined {
  const usable = actions.filter((action) => !isExcluded(action));
  if (holdsDon(seed, decision, holdDonEvery)) {
    const holding = usable.filter((action) => action.type !== 'ATTACH_DON');
    // Only when something else is on offer. A decision whose *every* option is
    // an attach is not a decision to hold DON!! — it is the end of the game's
    // patience, and returning `undefined` there would strand the driver.
    if (holding.length > 0) {
      return pickByKey(holding, actionKey, actionTier, seed, decision);
    }
  }
  return pickByKey(usable, actionKey, actionTier, seed, decision);
}

/* ------------------------------------------------------------------ answers */

/**
 * How often an answer explores instead of taking the effect at full strength:
 * 1 in `EXPLORE_EVERY`.
 *
 * **Measured, not chosen.** A uniform draw over `[min, max]` was the obvious
 * design and it is wrong. Over 500 ST-01/ST-02 games, answering every selection
 * uniformly took `ST02-016` Repel from 5 reachable seeds to **0** and `ST02-015`
 * Scalpel from 14 to 4 — the two hardest abilities in the starter decks to reach
 * unprompted, and the reason seed 224 was ever searched for. Half-strength
 * answers do not merely make effects smaller; they stop the board reaching the
 * positions where a [Counter] Event is holdable and payable at all.
 *
 * The knob was swept against the number that matters — how many seeds reach each
 * scripted ability — rather than against a notion of randomness:
 *
 * | policy                | Repel | Scalpel | "no" answers | empty selections |
 * | --------------------- | ----- | ------- | ------------ | ---------------- |
 * | always max, always yes|   5   |   14    |      0       |        0         |
 * | **1 in 8 explores**   | **4** | **12**  |    **50**    |     **595**      |
 * | uniform               |   0   |    4    |     314      |      4644        |
 *
 * 1 in 8 costs ~15% of the reach and buys both extremes — the empty selection
 * and the declined opt-in — inside a *single* pass. That is what retired the
 * client's two-pass min/max corpus: the second pass existed only because a fixed
 * `max` never exercised the empty answer.
 *
 * Note the shape of the finding. The old driver took `max` always *and* answered
 * every `yesNo` yes, and both mattered: an ability that is never declined and
 * never resolves to nothing is an ability whose two most interesting branches no
 * game ever walks.
 */
const EXPLORE_EVERY = 8;

/** True on the 1-in-8 decisions that explore rather than take the strong line. */
function explores(seed: number, decision: number, tag: string): boolean {
  return scoreFor(seed, decision, tag) % EXPLORE_EVERY === 0;
}

/**
 * How much of an offered selection to take: `max`, except on an exploring
 * decision, where it is a uniform draw over `[min, max]` — the empty answer
 * included whenever `min` is 0.
 *
 * "Up to N" is the most common quantifier on these cards, so `min: 0` is not an
 * edge case: it is the normal shape, and a driver that never produces it leaves
 * the whole degrade-to-nothing path unwalked.
 */
export function cardinalityFor(
  // Structural rather than `PendingChoice`, so the client's UI-level clicker can
  // share it: that driver never sees a `PendingChoice`, only the `ChoiceView`
  // the affordances publish. Both carry the three fields this reads, and taking
  // the narrow shape is what stops the UI driver growing a second cardinality
  // policy — which is how the repo ended up with four of everything.
  pending: { id: string; min: number; max: number },
  seed: number,
  decision: number,
): number {
  const span = pending.max - pending.min + 1;
  if (span <= 1) {
    return pending.min;
  }
  const tag = `#size|${pending.id}`;
  if (!explores(seed, decision, tag)) {
    return pending.max;
  }
  // A second, independent slice of the same hash: the bits that decided whether
  // to explore must not also decide the size, or the two correlate.
  return pending.min + ((scoreFor(seed, decision, tag) >>> 8) % span);
}

/**
 * Ranks candidates by their own scores and takes the first `size`.
 *
 * The same property as `pickByKey`, one level down: a candidate that appears in
 * a longer list does not push the others along, because each candidate's place
 * comes from its own key. Adding a candidate either beats the last one taken —
 * displacing exactly that one — or changes nothing.
 *
 * The result is an *ordered* list, which `orderCards` needs and `selectCards`
 * ignores.
 */
export function rankCandidates(
  candidates: readonly InstanceId[],
  seed: number,
  decision: number,
): InstanceId[] {
  return [...candidates].sort((left, right) => {
    const leftScore = scoreFor(seed, decision, `#cand|${left}`);
    const rightScore = scoreFor(seed, decision, `#cand|${right}`);
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

/**
 * A legal answer to whatever is being asked, read out of `pending`.
 *
 * `legalActions` deliberately does not enumerate answers — for "select 2 of 7"
 * the subsets alone are 21 entries — so a driver reads the shape from
 * `state.pending`, which is exactly what any real client has to do.
 */
export function answerFor(
  pending: PendingChoice,
  seed: number,
  decision: number,
): ChoiceAnswer {
  switch (pending.kind) {
    case 'yesNo': {
      // Yes, except on an exploring decision. Same reasoning as the cardinality:
      // an optional ability that is always accepted never exercises the decline,
      // and one that is declined half the time stops the board reaching the
      // positions the rarer abilities need.
      const tag = `#yes|${pending.id}`;
      if (!explores(seed, decision, tag)) {
        return { kind: 'yesNo', value: true };
      }
      return { kind: 'yesNo', value: (scoreFor(seed, decision, tag) >>> 8) % 2 === 1 };
    }
    case 'selectOption':
      return {
        kind: 'option',
        index: scoreFor(seed, decision, `#opt|${pending.id}`) % Math.max(1, pending.max),
      };
    case 'selectCards': {
      const size = cardinalityFor(pending, seed, decision);
      return {
        kind: 'cards',
        selected: rankCandidates(pending.candidates, seed, decision).slice(0, size),
      };
    }
    /**
     * The whole candidate list, in ranked order — no cardinality, because a
     * permutation has none.
     *
     * `rankCandidates` is what keeps the perturbation property intact here: each
     * card's place comes from its own key, so a candidate added to the list
     * lands wherever its own score puts it and every other card keeps its
     * position relative to the rest. Deriving the order from indices — "reverse
     * them", "shuffle by cursor" — would make every position depend on the
     * length, which is the failure mode that burned two seed sets before the
     * shared policy existed.
     */
    case 'orderCards':
      return { kind: 'order', order: rankCandidates(pending.candidates, seed, decision) };
  }
}

/* ------------------------------------------------------------------ the loop */

/**
 * One whole decision: the action to submit next, answer included.
 *
 * This is what every driver in the repo calls, and the reason the policy is one
 * module rather than four. The four copies that preceded it were two policies
 * written twice each, and they had already drifted — the engine's bot drew a
 * random cardinality while the card and client drivers always took `max`, so
 * "the driver" meant something different depending on which suite failed.
 */
export function decide(
  state: GameState,
  player: PlayerId,
  seed: number,
  decision: number,
  holdDonEvery?: number,
): Action | undefined {
  // An open choice leaves exactly one real move, and its payload is data rather
  // than an enumerated option.
  const pending = state.pending;
  if (pending !== null && pending.player === player) {
    return {
      type: 'ANSWER_CHOICE',
      player,
      choiceId: pending.id,
      answer: answerFor(pending, seed, decision),
    };
  }
  return chooseFrom(legalActions(state, player), seed, decision, holdDonEvery);
}

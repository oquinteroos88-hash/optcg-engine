import { describe, expect, it } from 'vitest';
import { applyAction, createGame, legalActions } from '../src/index.js';
import type { Action, GameState, InstanceId, PlayerId } from '../src/index.js';
import {
  actionKey,
  cardinalityFor,
  chooseFrom,
  holdsDon,
  decide,
  rankCandidates,
} from '../src/testing/policy.js';
import { ABIL_DECK } from '../src/testdata/abilityDecks.js';

/**
 * The property the shared policy exists for, asserted rather than described.
 *
 * > **Local perturbation.** If a state gains a new legal action and the driver
 * > does not pick it, the decision must be *identical* to the one it would have
 * > made without it.
 *
 * This is the test that stops someone "simplifying" the policy back to an index
 * without finding out what it costs — which is the whole reason the repo burned
 * seed 107, then seed 224, then the first 2C driver's trajectories.
 *
 * The method is a synthetic action injected into the list the driver sees. It is
 * never applied, so it need not be a move the engine would accept; what matters
 * is only that it is a well-formed `Action` with a key of its own.
 */

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MAX_STEPS = 220;

function abilGame(seed: number): GameState {
  return createGame({ seed, decks: { p1: ABIL_DECK, p2: ABIL_DECK }, firstPlayer: 'p1' });
}

/**
 * A well-formed action that no game will ever contain.
 *
 * `ATTACH_DON` because its key carries a `count`, which lets the injections
 * differ from each other by more than one character and so land in unrelated
 * hash buckets — an injection that always scored low would make the test look
 * like it passed when it had simply never competed.
 */
function synthetic(player: PlayerId, n: number): Action {
  return { type: 'ATTACH_DON', player, to: `synthetic-${n}` as InstanceId, count: 90 + n };
}

interface Perturbation {
  decisions: number;
  /** Decisions where the injected action won. Those are allowed to differ. */
  won: number;
  /** Decisions where it lost and the choice changed anyway — must stay 0. */
  disturbed: number;
}

/**
 * Walks real games, and at every decision compares the choice made over
 * `legalActions` with the choice made over `legalActions` plus one injection.
 */
function measure(
  pick: (actions: readonly Action[], seed: number, step: number) => Action | undefined,
): Perturbation {
  const out: Perturbation = { decisions: 0, won: 0, disturbed: 0 };
  for (const seed of SEEDS) {
    let state = abilGame(seed);
    for (let step = 0; step < MAX_STEPS; step += 1) {
      if (state.status === 'finished') {
        break;
      }
      const player = state.priority;
      const pending = state.pending;
      // Only positions where the driver really chooses between actions. While a
      // choice is open `legalActions` offers the marker and CONCEDE only, and
      // the answer is built from `pending` rather than picked from a list.
      if (pending === null || pending.player !== player) {
        const options = legalActions(state, player);
        const base = pick(options, seed, step);
        // Several injections per decision, so one unlucky low-scoring key does
        // not let a whole game through without the property being tested.
        for (let n = 0; n < 6; n += 1) {
          const extra = synthetic(player, n);
          const perturbed = pick([...options, extra], seed, step);
          out.decisions += 1;
          if (perturbed !== undefined && actionKey(perturbed) === actionKey(extra)) {
            out.won += 1;
            continue;
          }
          const same =
            base === undefined
              ? perturbed === undefined
              : perturbed !== undefined && actionKey(base) === actionKey(perturbed);
          if (!same) {
            out.disturbed += 1;
          }
        }
      }
      const action = decide(state, player, seed, step);
      if (action === undefined) {
        break;
      }
      const result = applyAction(state, action);
      if (!result.ok) {
        throw new Error(`driver bug: ${result.reason}`);
      }
      state = result.state;
    }
  }
  return out;
}

/** The policy as it was before this PR: uniform over the index into the pool. */
function indexPick(
  actions: readonly Action[],
  _seed: number,
  step: number,
): Action | undefined {
  const usable = actions.filter((action) => action.type !== 'CONCEDE');
  if (usable.length === 0) {
    return undefined;
  }
  const rest = usable.filter((action) => action.type !== 'END_TURN');
  const pool = rest.length > 0 ? rest : usable;
  return pool[((step * 1103515245 + 12345) >>> 8) % pool.length];
}

describe('a new legal action disturbs nothing it does not win', () => {
  const stable = measure(chooseFrom);

  it('tests the property on enough real decisions to mean something', () => {
    expect(stable.decisions).toBeGreaterThan(5_000);
  });

  it('lets the injected action win sometimes, or it would prove nothing', () => {
    // A driver that never picks the injection would pass the assertion below
    // trivially. This is the guard that the injections actually competed.
    expect(stable.won).toBeGreaterThan(100);
  });

  it('leaves every decision it did not win byte for byte identical', () => {
    expect(stable.disturbed).toBe(0);
  });

  it('goes red for the index-based policy it replaced', () => {
    // The reason this file exists, stated as a passing assertion rather than as
    // a comment. Choosing by index means the injection displaces every action
    // after it in the list, so the great majority of decisions move even though
    // the injection lost.
    const indexed = measure(indexPick);
    expect(indexed.decisions).toBe(stable.decisions);
    expect(indexed.disturbed).toBeGreaterThan(1_000);
  });
});

/**
 * A wider sweep than `SEEDS`, because card selections are rare: 12 games open
 * only eight of them between them, which is too few to claim anything.
 */
const SELECTION_SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);

describe('an added candidate disturbs no selection it does not enter', () => {
  it('holds over the choices real games open', { timeout: 120_000 }, () => {
    let selections = 0;
    let entered = 0;
    let disturbed = 0;
    for (const seed of SELECTION_SEEDS) {
      let state = abilGame(seed);
      for (let step = 0; step < MAX_STEPS; step += 1) {
        if (state.status === 'finished') {
          break;
        }
        const pending = state.pending;
        if (
          pending !== null &&
          pending.player === state.priority &&
          (pending.kind === 'selectCards' || pending.kind === 'orderCards') &&
          pending.candidates.length > 0
        ) {
          const size = cardinalityFor(pending, seed, step);
          const base = rankCandidates(pending.candidates, seed, step).slice(0, size);
          for (let n = 0; n < 6; n += 1) {
            const extra = `synthetic-${n}` as InstanceId;
            const widened = rankCandidates([...pending.candidates, extra], seed, step).slice(0, size);
            selections += 1;
            if (widened.includes(extra)) {
              entered += 1;
              // It may only displace the last one taken, never reorder the rest.
              expect(widened.filter((id) => id !== extra)).toEqual(base.slice(0, size - 1));
              continue;
            }
            if (JSON.stringify(widened) !== JSON.stringify(base)) {
              disturbed += 1;
            }
          }
        }
        const action = decide(state, state.priority, seed, step);
        if (action === undefined) {
          break;
        }
        const result = applyAction(state, action);
        if (!result.ok) {
          throw new Error(`driver bug: ${result.reason}`);
        }
        state = result.state;
      }
    }
    expect(selections).toBeGreaterThan(200);
    expect(entered).toBeGreaterThan(10);
    expect(disturbed).toBe(0);
  });
});

describe('the policy is deterministic', () => {
  function trace(seed: number): string[] {
    const keys: string[] = [];
    let state = abilGame(seed);
    for (let step = 0; step < MAX_STEPS; step += 1) {
      if (state.status === 'finished') {
        break;
      }
      const action = decide(state, state.priority, seed, step);
      if (action === undefined) {
        break;
      }
      // The answer payload too, not just the key: `actionKey` deliberately
      // leaves it out, so comparing keys alone would miss a wandering answer.
      const answer = action.type === 'ANSWER_CHOICE' ? action.answer : undefined;
      keys.push(`${actionKey(action)}#${JSON.stringify(answer ?? null)}`);
      const result = applyAction(state, action);
      if (!result.ok) {
        throw new Error(`driver bug: ${result.reason}`);
      }
      state = result.state;
    }
    return keys;
  }

  it('replays the same seed to the same decisions, byte for byte', () => {
    for (const seed of SEEDS) {
      expect(trace(seed)).toEqual(trace(seed));
    }
  });

  it('does not replay two seeds to the same decisions', () => {
    // Otherwise the previous assertion would hold for a policy that ignores the
    // seed entirely.
    expect(trace(1)).not.toEqual(trace(2));
  });
});

describe('the DON!!-holding bias', () => {
  it('is a coin on (seed, decision) and nothing else', () => {
    // This is what keeps local perturbation intact. If the decision to hold
    // DON!! depended on which actions were on offer, injecting one could flip
    // it, and every option in the pool would move with it.
    for (let decision = 0; decision < 200; decision += 1) {
      expect(holdsDon(1, decision)).toBe(holdsDon(1, decision));
      // Different seeds and different decisions must disagree somewhere, or the
      // coin is a constant and the bias does nothing.
      void holdsDon(2, decision);
    }
    const onSeedOne = Array.from({ length: 300 }, (_, i) => holdsDon(1, i));
    const onSeedTwo = Array.from({ length: 300 }, (_, i) => holdsDon(2, i));
    expect(onSeedOne).not.toEqual(onSeedTwo);
    const held = onSeedOne.filter(Boolean).length;
    // Roughly one in three, with room for the hash not being a perfect die.
    expect(held).toBeGreaterThan(60);
    expect(held).toBeLessThan(160);
  });

  it('leaves attaching alone when the pool has nothing else', () => {
    // A decision whose every option is an attach is not a decision to hold
    // DON!!; returning `undefined` there would strand the driver mid-game.
    const onlyAttaches: Action[] = [
      { type: 'ATTACH_DON', player: 'p1', to: 'p1-c1', count: 1 },
      { type: 'ATTACH_DON', player: 'p1', to: 'p1-c2', count: 1 },
    ];
    for (let decision = 0; decision < 100; decision += 1) {
      expect(chooseFrom(onlyAttaches, 1, decision)).toBeDefined();
    }
  });

  it('really does skip attaches on a holding decision', () => {
    const mixed: Action[] = [
      { type: 'ATTACH_DON', player: 'p1', to: 'p1-c1', count: 1 },
      { type: 'PASS', player: 'p1' },
    ];
    let skipped = 0;
    let attached = 0;
    for (let decision = 0; decision < 300; decision += 1) {
      const picked = chooseFrom(mixed, 1, decision);
      if (picked?.type === 'ATTACH_DON') attached += 1;
      else skipped += 1;
      // And the two agree: a holding decision never lands on an attach.
      if (holdsDon(1, decision)) {
        expect(picked?.type).not.toBe('ATTACH_DON');
      }
    }
    expect(skipped).toBeGreaterThan(0);
    expect(attached).toBeGreaterThan(0);
  });
});

describe('action keys are canonical', () => {
  it('gives one action one key regardless of how its fields were ordered', () => {
    const a: Action = { type: 'PLAY_CARD', player: 'p1', instanceId: 'p1-d3' };
    const b: Action = { instanceId: 'p1-d3', player: 'p1', type: 'PLAY_CARD' } as Action;
    expect(actionKey(a)).toBe(actionKey(b));
  });

  it('separates actions that differ only in a field an index would hide', () => {
    const keys = new Set(
      [
        { type: 'ATTACH_DON', player: 'p1', to: 'p1-c1', count: 1 },
        { type: 'ATTACH_DON', player: 'p1', to: 'p1-c1', count: 2 },
        { type: 'ATTACH_DON', player: 'p2', to: 'p1-c1', count: 1 },
        { type: 'PLAY_CARD', player: 'p1', instanceId: 'p1-d3' },
        { type: 'PLAY_CARD', player: 'p1', instanceId: 'p1-d3', trashCharacter: 'p1-c1' },
        { type: 'PLAY_CARD', player: 'p1', instanceId: 'p1-d3', trashCharacter: 'p1-c2' },
        { type: 'ACTIVATE_ABILITY', player: 'p1', instanceId: 'p1-c1', abilityId: 'X-main' },
        { type: 'ACTIVATE_ABILITY', player: 'p1', instanceId: 'p1-c1', abilityId: 'X-other' },
        { type: 'DECLARE_ATTACK', player: 'p1', attacker: 'p1-c1', target: 'p2-l' },
        { type: 'DECLARE_ATTACK', player: 'p1', attacker: 'p2-l', target: 'p1-c1' },
      ].map((action) => actionKey(action as Action)),
    );
    expect(keys.size).toBe(10);
  });

  it('never collides across the actions a real game offers', () => {
    for (const seed of SEEDS) {
      let state = abilGame(seed);
      for (let step = 0; step < MAX_STEPS; step += 1) {
        if (state.status === 'finished') {
          break;
        }
        const options = legalActions(state, state.priority);
        expect(new Set(options.map(actionKey)).size).toBe(options.length);
        const action = decide(state, state.priority, seed, step);
        if (action === undefined) {
          break;
        }
        const result = applyAction(state, action);
        if (!result.ok) {
          throw new Error(`driver bug: ${result.reason}`);
        }
        state = result.state;
      }
    }
  });
});

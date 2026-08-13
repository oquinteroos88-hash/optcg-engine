import { describe, expect, it } from 'vitest';
import { registerCardSet } from '../src/index.js';
import type { GameState, InstanceId, StackItem } from '../src/index.js';
import { assertInvariants } from '../src/invariants.js';
import { ABIL_DECK } from '../src/testdata/abilityDecks.js';
import { buildScenario, characterAt } from '../src/testdata/scenarios.js';
import { applyOk, cloneWith } from './helpers.js';

/**
 * Interpreter rule 1 and the cost re-check, both of which the random sweep
 * cannot reach.
 *
 * Rule 1 — a target that moved on is *ignored*, and never aborts the script —
 * only shows up when something changes between choosing a target and acting on
 * it, which needs a chain the bots essentially never build. It is also the rule
 * most likely to be quietly implemented as "abort the whole effect", so it gets
 * a position built directly instead.
 *
 * Vitest isolates the module graph per file, so the card registered here cannot
 * leak elsewhere.
 */

const STALE_CARD = 'TEST-S01';

registerCardSet([
  {
    cardId: STALE_CARD,
    name: 'Slow Assassin',
    category: 'character',
    color: 'blue',
    cost: 1,
    power: 1000,
    counter: null,
    keywords: [],
    life: 0,
    abilities: [
      {
        id: 'S01-onPlay',
        trigger: 'onPlay',
        script: [
          {
            op: 'select',
            as: 'victim',
            from: { zone: 'field', owner: 'opponent', category: ['character'] },
            min: 1,
            max: 1,
            prompt: 'Mark a target',
          },
          { op: 'ko', target: { var: 'victim' } },
          // Runs whether or not the KO above found anything: an ignored target
          // must not stop the rest of the script.
          { op: 'draw', player: 'you', count: 1 },
        ],
      },
    ],
  },
]);

function suspendedWithTarget(): { state: GameState; victim: InstanceId } {
  const staged = buildScenario({
    decks: { p1: ABIL_DECK, p2: ABIL_DECK },
    p1: { activeDon: 3, hand: ['ABIL-002'] },
    p2: { characters: [{ cardId: 'ABIL-002' }, { cardId: 'ABIL-005' }] },
  });
  // Repoint the hand card at the stale-target card; conservation is untouched.
  const retargeted = cloneWith(staged, (draft) => {
    const inHand = draft.players.p1.hand.at(-1);
    const card = inHand === undefined ? undefined : draft.cards[inHand];
    if (card === undefined) {
      throw new Error('p1 has no hand card to repurpose');
    }
    card.cardId = STALE_CARD;
  });
  const inHand = retargeted.players.p1.hand.at(-1);
  const played = applyOk(retargeted, {
    type: 'PLAY_CARD',
    player: 'p1',
    instanceId: inHand as string,
  }).state;
  return { state: played, victim: characterAt(retargeted, 'p2', 0) };
}

describe('stale targets are ignored, not fatal', () => {
  it('skips a ko whose target left the field and still runs the rest', () => {
    const { state, victim } = suspendedWithTarget();
    expect(state.pending?.candidates).toContain(victim);

    // The chosen character leaves between the answer and the instruction that
    // would have hit it — the position a chained effect creates.
    const moved = cloneWith(state, (draft) => {
      const ps = draft.players.p2;
      ps.characters = ps.characters.filter((id) => id !== victim);
      ps.trash.unshift(victim);
      const card = draft.cards[victim];
      if (card !== undefined) {
        card.orientation = 'active';
        card.attachedDon = [];
        card.playedOnTurn = null;
        card.usedThisTurn = [];
      }
    });
    assertInvariants(moved);

    const handBefore = moved.players.p1.hand.length;
    const trashBefore = moved.players.p2.trash.length;
    const done = applyOk(moved, {
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId: moved.pending?.id as string,
      answer: { kind: 'cards', selected: [victim] },
    }).state;

    // The ko found nothing and did nothing; the draw after it still happened.
    expect(done.players.p2.trash).toHaveLength(trashBefore);
    expect(done.players.p1.hand).toHaveLength(handBefore + 1);
    expect(done.pending).toBeNull();
    expect(done.stack).toEqual([]);
    assertInvariants(done);
  });

  it('completes normally when the target is still there', () => {
    const { state, victim } = suspendedWithTarget();
    const handBefore = state.players.p1.hand.length;
    const done = applyOk(state, {
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId: state.pending?.id as string,
      answer: { kind: 'cards', selected: [victim] },
    }).state;

    expect(done.players.p2.characters).not.toContain(victim);
    expect(done.players.p2.trash[0]).toBe(victim);
    expect(done.players.p1.hand).toHaveLength(handBefore + 1);
    assertInvariants(done);
  });
});

describe('a cost that stops being payable before the ability resolves', () => {
  it('drops the ability instead of paying it halfway', () => {
    // ABIL-009 needs to rest a DON!!. Queue it by hand with an empty cost area,
    // which is the state a chain of earlier effects can leave behind.
    const staged = buildScenario({
      decks: { p1: ABIL_DECK, p2: ABIL_DECK },
      p1: { activeDon: 0, characters: [{ cardId: 'ABIL-009' }] },
    });
    const source = characterAt(staged, 'p1', 0);
    const before = staged.players.p1.hand.length;

    const queued = cloneWith(staged, (draft) => {
      const item: StackItem = {
        abilityId: 'ABIL-009-main',
        source,
        controller: 'p1',
        status: 'ready',
        // Nothing paid yet, which is the whole point: the re-check that drops
        // this ability runs on the first cost entry and only there.
        costsPaid: 0,
        cursor: [{ path: [], index: 0, loop: null }],
        vars: {},
      };
      draft.stack.push(item);
      // A queued effect needs somebody waiting on it for the state to be sound,
      // so the choice below stands in for whatever opened it.
      draft.pending = {
        id: 'choice-stub',
        player: 'p1',
        kind: 'yesNo',
        prompt: 'continue',
        candidates: [],
        min: 0,
        max: 0,
        sink: { kind: 'var', name: 'ignored' },
      };
      draft.priority = 'p1';
    });
    assertInvariants(queued);

    const done = applyOk(queued, {
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId: 'choice-stub',
      answer: { kind: 'yesNo', value: true },
    }).state;

    // Nothing was rested, nothing was granted, and the item is gone.
    expect(done.stack).toEqual([]);
    expect(done.modifiers).toEqual([]);
    expect(done.players.p1.hand).toHaveLength(before);
    expect(
      done.players.p1.don.filter(
        (d) => d.location.kind === 'cost' && d.location.orientation === 'rested',
      ),
    ).toEqual([]);
    assertInvariants(done);
  });
});

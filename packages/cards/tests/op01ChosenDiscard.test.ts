import { describe, expect, it } from 'vitest';
import { applyAction, assertInvariants, createGame, legalActions } from '@optcg/engine';
import { decide } from '@optcg/engine/testing';
import type { Decklist, GameState, InstanceId, PlayerId } from '@optcg/engine';
import {
  answer,
  applyOk,
  assertSettled,
  characterAt,
  firedIds,
  handCard,
  op01JackScenario,
  op01KanjuroScenario,
  OP01_JACK_DECKS,
  OP01_KANJURO_DECKS,
} from './support.js';

/**
 * The player-chosen discard, on printed cards — four of them, and between them
 * every shape the sentence has.
 *
 * The engine's own file (`packages/engine/tests/chosenDiscard.test.ts`) owns the
 * mechanism: two independent `PlayerRef`s, the sink that carries the owner, the
 * empty hand, the priority that crosses the table. This file is the corpus, and
 * it asks the one thing synthetic cards cannot: that the printed sentences really
 * do fall into three shapes and that the odd one out is spelled the way its text
 * reads.
 *
 * | Card | Printed | `chooser` | `owner` |
 * | --- | --- | --- | --- |
 * | `OP01-088` | "[Trigger] Draw 2 cards and trash 1 card from your hand" | you | you |
 * | `OP01-102` | "Your opponent trashes 1 card from their hand" | opponent | opponent |
 * | `OP01-114` | the same sentence, different trigger | opponent | opponent |
 * | `OP01-038` | "Your opponent **chooses** 1 card from **your** hand" | opponent | **you** |
 */

function candidates(state: GameState): InstanceId[] {
  const pending = state.pending;
  if (pending === null) {
    throw new Error('expected an open choice');
  }
  return [...pending.candidates];
}

function attack(
  state: GameState,
  player: PlayerId,
  attacker: InstanceId,
  target: InstanceId,
): GameState {
  return applyOk(state, { type: 'DECLARE_ATTACK', player, attacker, target }).state;
}

// ===========================================================================
// chooser === owner === you
// ===========================================================================

describe('OP01-088 Desert Spada [Trigger] — draw 2, then trash 1 of your own', () => {
  /** The Event in the life area, so damage turns it over as a real `[Trigger]`. */
  function damaged(): { asking: GameState; handBefore: number } {
    const state = op01JackScenario({
      firstPlayer: 'p1',
      p1: { characters: [{ cardId: 'OP01-103' }], activeDon: 5 },
      p2: { lifeCards: ['OP01-088'], activeDon: 5, clearHand: true, hand: ['OP01-076'] },
    });
    const attacking = attack(state, 'p1', characterAt(state, 'p1', 0), state.players.p2.leader);
    const blocked = applyOk(attacking, { type: 'PASS', player: 'p2' }).state;
    const damagedState = applyOk(blocked, { type: 'PASS', player: 'p2' }).state;
    // The `[Trigger]` is offered as an opt-in first.
    return {
      asking: answer(damagedState, 'p2', { kind: 'yesNo', value: true }),
      handBefore: damagedState.players.p2.hand.length,
    };
  }

  it('draws two before it asks, so the drawn cards are candidates', () => {
    // The printed order, and it decides the answer space. CR 2-8-3 resolves text
    // "in order starting from the text closest to the top", so the draw lands
    // first and a player who drew into something worse may trash it.
    const { asking, handBefore } = damaged();
    expect(asking.pending?.player).toBe('p2');
    expect(asking.players.p2.hand).toHaveLength(handBefore + 2);
    // Everything in hand, the two just drawn included — the whole point of the
    // order being draw-then-trash.
    expect(candidates(asking)).toEqual(asking.players.p2.hand);
  });

  it('trashes the one the controller picked, out of their own hand', () => {
    const { asking, handBefore } = damaged();
    const chosen = candidates(asking).at(-1);
    if (chosen === undefined) {
      throw new Error('expected a candidate');
    }
    const done = answer(asking, 'p2', { kind: 'cards', selected: [chosen] });

    expect(done.players.p2.trash).toContain(chosen);
    // +2 drawn, −1 trashed.
    expect(done.players.p2.hand).toHaveLength(handBefore + 1);
    assertSettled(done);
  });

  it('is a decision: two answers, two different hands', () => {
    const { asking } = damaged();
    const [first, second] = candidates(asking);
    if (first === undefined || second === undefined) {
      throw new Error('expected at least two candidates');
    }
    expect(answer(asking, 'p2', { kind: 'cards', selected: [first] }).players.p2.hand).not.toContain(
      first,
    );
    expect(
      answer(asking, 'p2', { kind: 'cards', selected: [second] }).players.p2.hand,
    ).toContain(first);
  });
});

// ===========================================================================
// chooser === owner === opponent
// ===========================================================================

describe('OP01-102 Jack — DON!! −1: your opponent trashes 1 card from their hand', () => {
  function staged(): GameState {
    return op01JackScenario({
      p1: { characters: [{ cardId: 'OP01-102' }], activeDon: 5 },
      p2: { activeDon: 5 },
    });
  }

  it('opens the choice to the opponent, over the opponent’s hand', () => {
    const state = staged();
    const attacking = attack(state, 'p1', characterAt(state, 'p1', 0), state.players.p2.leader);
    // "You may" — the printed opt-in on the DON!! −1 cost.
    const asking = answer(attacking, 'p1', { kind: 'yesNo', value: true });

    expect(asking.pending?.player).toBe('p2');
    expect(candidates(asking)).toEqual(asking.players.p2.hand);
  });

  it('takes the card out of the opponent’s hand and leaves the controller’s alone', () => {
    const state = staged();
    const attacking = attack(state, 'p1', characterAt(state, 'p1', 0), state.players.p2.leader);
    const asking = answer(attacking, 'p1', { kind: 'yesNo', value: true });
    const p1HandBefore = [...asking.players.p1.hand];
    const chosen = candidates(asking)[0];
    if (chosen === undefined) {
      throw new Error('expected a candidate');
    }
    const done = answer(asking, 'p2', { kind: 'cards', selected: [chosen] });

    expect(done.players.p2.trash).toContain(chosen);
    expect(done.players.p1.hand).toEqual(p1HandBefore);
    expect(firedIds(done.log)).toContain('OP01-102-whenAttacking');
  });

  it('costs nothing and asks nothing when the DON!! is declined', () => {
    // CR 8-3-1-4 puts the decline before payment: no DON!! returns and no
    // question is opened.
    const state = staged();
    const attacking = attack(state, 'p1', characterAt(state, 'p1', 0), state.players.p2.leader);
    const declined = answer(attacking, 'p1', { kind: 'yesNo', value: false });

    expect(declined.pending).toBeNull();
    expect(firedIds(declined.log)).not.toContain('OP01-102-whenAttacking');
  });
});

describe('OP01-114 X.Drake — the same sentence on [On Play]', () => {
  it('asks the opponent about their own hand', () => {
    const state = op01JackScenario({
      p1: { hand: ['OP01-114'], clearHand: true, activeDon: 8 },
      p2: { activeDon: 5 },
    });
    const played = applyOk(state, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: handCard(state, 'p1', 'OP01-114'),
    }).state;
    const asking = answer(played, 'p1', { kind: 'yesNo', value: true });

    expect(asking.pending?.player).toBe('p2');
    expect(candidates(asking)).toEqual(asking.players.p2.hand);

    const chosen = candidates(asking)[0];
    if (chosen === undefined) {
      throw new Error('expected a candidate');
    }
    const done = answer(asking, 'p2', { kind: 'cards', selected: [chosen] });
    expect(done.players.p2.trash).toContain(chosen);
    assertSettled(done);
  });
});

// ===========================================================================
// chooser !== owner — the card the two fields exist for
// ===========================================================================

describe('OP01-038 Kanjuro [On K.O.] — your opponent chooses from YOUR hand', () => {
  /**
   * p2 owns Kanjuro; p1 kills it. The ability's controller is p2, so "your
   * hand" is p2's and "your opponent" is p1.
   */
  function killKanjuro(p2Hand?: string[]): GameState {
    const state = op01KanjuroScenario({
      p1: { characters: [{ cardId: 'OP01-045' }], activeDon: 5 },
      p2: {
        characters: [{ cardId: 'OP01-038', orientation: 'rested' }],
        activeDon: 5,
        ...(p2Hand === undefined ? {} : { hand: p2Hand, clearHand: true }),
      },
    });
    const attacking = attack(state, 'p1', characterAt(state, 'p1', 0), characterAt(state, 'p2', 0));
    const blocked = applyOk(attacking, { type: 'PASS', player: 'p2' }).state;
    return applyOk(blocked, { type: 'PASS', player: 'p2' }).state;
  }

  it('asks the player who did not control the effect', () => {
    const asking = killKanjuro();
    expect(firedIds(asking.log)).toContain('OP01-038-onKO');
    expect(asking.pending?.player).toBe('p1');
  });

  it('offers the controller’s hand, not the chooser’s', () => {
    // The composition the whole instruction exists for: candidates out of one
    // player's hand, question addressed to the other.
    const asking = killKanjuro();
    expect(candidates(asking)).toEqual(asking.players.p2.hand);
    expect(candidates(asking)).not.toEqual(asking.players.p1.hand);
  });

  it('trashes out of the controller’s hand, and the chooser loses nothing', () => {
    const asking = killKanjuro();
    const p1HandBefore = [...asking.players.p1.hand];
    const chosen = candidates(asking)[0];
    if (chosen === undefined) {
      throw new Error('expected a candidate');
    }
    const done = answer(asking, 'p1', { kind: 'cards', selected: [chosen] });

    expect(done.players.p2.trash).toContain(chosen);
    expect(done.players.p2.hand).not.toContain(chosen);
    expect(done.players.p1.hand).toEqual(p1HandBefore);
    expect(done.players.p1.trash).not.toContain(chosen);
    assertSettled(done);
  });

  it('is a real decision: two cards in hand, two different results', () => {
    // The test that says the choice exists. Two named cards, staged, and each
    // answer leaves a different one behind — which a deterministic discard could
    // not produce, by construction.
    const asking = killKanjuro(['OP01-036', 'OP01-045']);
    const [otsuru, jeanBart] = candidates(asking);
    if (otsuru === undefined || jeanBart === undefined) {
      throw new Error('expected exactly the two staged cards');
    }
    expect(candidates(asking)).toHaveLength(2);

    const tookOtsuru = answer(asking, 'p1', { kind: 'cards', selected: [otsuru] });
    const tookJeanBart = answer(asking, 'p1', { kind: 'cards', selected: [jeanBart] });

    expect(tookOtsuru.players.p2.hand).toEqual([jeanBart]);
    expect(tookJeanBart.players.p2.hand).toEqual([otsuru]);
    expect(tookOtsuru).not.toEqual(tookJeanBart);
  });

  it('leaves the controller holding exactly [CONCEDE] while it is open', () => {
    // p2 played nothing and did nothing wrong — their own Character died and its
    // own printed text handed the decision to the other player. This is the
    // first route in the engine to that position.
    const asking = killKanjuro();
    expect(legalActions(asking, 'p2')).toEqual([{ type: 'CONCEDE', player: 'p2' }]);
    expect(legalActions(asking, 'p1').map((action) => action.type)).toEqual([
      'ANSWER_CHOICE',
      'CONCEDE',
    ]);
  });

  it('survives a JSON round trip mid-choice and answers identically', () => {
    const asking = killKanjuro(['OP01-036', 'OP01-045']);
    const rehydrated = JSON.parse(JSON.stringify(asking)) as GameState;
    expect(rehydrated).toEqual(asking);
    expect(rehydrated.pending?.player).toBe('p1');
    expect(rehydrated.pending?.sink).toEqual({ kind: 'discard', owner: 'p2' });

    const chosen = candidates(asking)[0];
    if (chosen === undefined) {
      throw new Error('expected a candidate');
    }
    expect(answer(rehydrated, 'p1', { kind: 'cards', selected: [chosen] })).toEqual(
      answer(asking, 'p1', { kind: 'cards', selected: [chosen] }),
    );
  });

  it('asks nothing when the controller’s hand is empty', () => {
    const state = op01KanjuroScenario({
      p1: { characters: [{ cardId: 'OP01-045' }], activeDon: 5 },
      p2: {
        characters: [{ cardId: 'OP01-038', orientation: 'rested' }],
        activeDon: 5,
        hand: [],
        clearHand: true,
      },
    });
    expect(state.players.p2.hand).toEqual([]);
    const attacking = attack(state, 'p1', characterAt(state, 'p1', 0), characterAt(state, 'p2', 0));
    const blocked = applyOk(attacking, { type: 'PASS', player: 'p2' }).state;
    const done = applyOk(blocked, { type: 'PASS', player: 'p2' }).state;

    // CR 1-3-2: as many of the actions as possible, which here is none.
    expect(firedIds(done.log)).toContain('OP01-038-onKO');
    expect(done.pending).toBeNull();
    expect(done.players.p2.trash.filter((id) => id !== characterAt(state, 'p2', 0))).toEqual([]);
    assertSettled(done);
  });

  it('names the owner in the discard event, never the chooser', () => {
    // No observer in the engine reads this yet — there is no discard trigger.
    // Four cards in the full set will (`OP12-040`, `OP14-045`, `OP14-049`,
    // `OP14-056`) and every one reads "when a card is trashed from **your**
    // hand", which is a fact about the owner. Pinning it now is what stops the
    // day they arrive from being an archaeology exercise.
    const asking = killKanjuro();
    const chosen = candidates(asking)[0];
    if (chosen === undefined) {
      throw new Error('expected a candidate');
    }
    const result = applyAction(asking, {
      type: 'ANSWER_CHOICE',
      player: 'p1',
      choiceId: asking.pending?.id ?? '',
      answer: { kind: 'cards', selected: [chosen] },
    });
    if (!result.ok) {
      throw new Error(result.reason);
    }
    expect(result.events.filter((event) => event.type === 'cardDiscarded')).toEqual([
      { type: 'cardDiscarded', player: 'p2', instanceId: chosen },
    ]);
  });
});

describe('OP01-038 Kanjuro [When Attacking] — the half that never needed this', () => {
  it('K.O.s a rested 2-drop, and asked for no discard to do it', () => {
    // The row named the whole card after the wall on one of its halves. This one
    // is `OP01-054`'s selector with a smaller cap and has been expressible for
    // batches.
    const state = op01KanjuroScenario({
      p1: { characters: [{ cardId: 'OP01-038', attachedDon: 1 }], activeDon: 5 },
      p2: { characters: [{ cardId: 'OP01-053', orientation: 'rested' }], activeDon: 5 },
    });
    const victim = characterAt(state, 'p2', 0);
    const asking = attack(state, 'p1', characterAt(state, 'p1', 0), state.players.p2.leader);

    expect(asking.pending?.player).toBe('p1');
    expect(candidates(asking)).toEqual([victim]);
    const done = answer(asking, 'p1', { kind: 'cards', selected: [victim] });
    expect(done.players.p2.trash).toContain(victim);
  });
});

// ===========================================================================
// Manifestation
// ===========================================================================

type Decks = Record<PlayerId, Decklist>;

function runGame(decks: Decks, seed: number): { state: GameState; fired: Set<string> } {
  let state = createGame({ seed, decks, firstPlayer: 'p1' });
  const fired = new Set<string>();
  for (let step = 0; step < 400; step += 1) {
    if (state.status === 'finished') break;
    const action = decide(state, state.priority, seed, step);
    if (action === undefined) break;
    const result = applyAction(state, action);
    if (!result.ok) {
      throw new Error(`action ${step} (${action.type}) rejected: ${result.reason}`);
    }
    state = result.state;
    for (const event of result.events) {
      if (event.type === 'abilityTriggered') fired.add(event.abilityId);
    }
    assertInvariants(state);
  }
  return { state, fired };
}

function union(decks: Decks, seeds: readonly number[]): string[] {
  const all = new Set<string>();
  for (const seed of seeds) {
    const game = runGame(decks, seed);
    expect(game.state.pending, `seed ${seed}`).toBeNull();
    expect(game.state.stack, `seed ${seed}`).toEqual([]);
    expect(game.state.resume, `seed ${seed}`).toEqual([]);
    for (const id of game.fired) all.add(id);
  }
  return [...all].sort();
}

describe('a real game of the Kaido deck', () => {
  // A cover of 2 over 60 games. `OP01-088`'s `[Counter]` is in it, which is the
  // hardest move in this repo for a random game to reach.
  const SEEDS = [24, 12] as const;

  it('reaches both halves of the opponent-trashes shape', () => {
    expect(union(OP01_JACK_DECKS, SEEDS)).toEqual([
      // The Leader's own ability, which this deck runs and batch 10 wrote.
      'OP01-061-onEnemyKO',
      'OP01-088-counter',
      'OP01-088-trigger',
      'OP01-102-whenAttacking',
      'OP01-104-trigger',
      'OP01-114-onPlay',
    ]);
  });

  it('really answers choices about the other player’s hand, unprompted', () => {
    // The bot has answered choices since Phase 2A, but never one whose
    // candidates were somebody else's cards. It reads `state.pending` and builds
    // an answer from it, so the hand it comes out of was never its business —
    // this says so with a measurement rather than with an argument.
    let crossed = 0;
    for (const seed of SEEDS) {
      let state = createGame({ seed, decks: OP01_JACK_DECKS, firstPlayer: 'p1' });
      for (let step = 0; step < 400; step += 1) {
        if (state.status === 'finished') break;
        const pending = state.pending;
        if (pending !== null && pending.sink.kind === 'discard' && pending.sink.owner !== pending.player) {
          crossed += 1;
        }
        const action = decide(state, state.priority, seed, step);
        if (action === undefined) break;
        const result = applyAction(state, action);
        if (!result.ok) {
          throw new Error(`action ${step} rejected: ${result.reason}`);
        }
        state = result.state;
      }
    }
    // The Kaido deck's two discard cards both have chooser === owner, so the
    // *cross* case cannot appear here — it is the Kanjuro deck's, below. What
    // this pins is the shape of the count: zero, and for a stated reason rather
    // than by accident.
    expect(crossed).toBe(0);
  });
});

describe('a real game of the Oden deck', () => {
  // A cover of 2 (seeds 19 and 29), plus 32 — the seed that reaches the
  // cross-side choice twice. The union is the same either way; 32 is here for
  // the measurement below, which the cover alone does not make.
  const SEEDS = [19, 29, 32] as const;

  it('reaches Kanjuro’s two halves in ordinary play', () => {
    expect(union(OP01_KANJURO_DECKS, SEEDS)).toEqual([
      'OP01-031-main',
      'OP01-033-onPlay',
      'OP01-034-whenAttacking',
      'OP01-035-whenAttacking',
      'OP01-037-trigger',
      'OP01-038-onKO',
      'OP01-038-whenAttacking',
      'OP01-048-onPlay',
      'OP01-052-whenAttacking',
      'OP01-057-counter',
      'OP01-057-trigger',
    ]);
  });

  it('answers a choice about the opponent’s hand at least once', () => {
    // The measurement the deck above could not make: Kanjuro's `[On K.O.]` puts
    // the chooser and the owner on opposite sides, and a random game reaches it.
    let crossed = 0;
    for (const seed of SEEDS) {
      let state = createGame({ seed, decks: OP01_KANJURO_DECKS, firstPlayer: 'p1' });
      for (let step = 0; step < 400; step += 1) {
        if (state.status === 'finished') break;
        const pending = state.pending;
        if (pending !== null && pending.sink.kind === 'discard' && pending.sink.owner !== pending.player) {
          crossed += 1;
        }
        const action = decide(state, state.priority, seed, step);
        if (action === undefined) break;
        const result = applyAction(state, action);
        if (!result.ok) {
          throw new Error(`action ${step} rejected: ${result.reason}`);
        }
        state = result.state;
      }
    }
    expect(crossed).toBeGreaterThan(0);
  });
});

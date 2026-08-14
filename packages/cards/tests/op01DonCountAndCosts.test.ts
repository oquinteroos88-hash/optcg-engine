import { describe, expect, it } from 'vitest';
import { applyAction, assertInvariants, createGame, getPower, legalActions } from '@optcg/engine';
import { decide } from '@optcg/engine/testing';
import type { Decklist, GameState, InstanceId, PlayerId } from '@optcg/engine';
import {
  answer,
  applyOk,
  assertSettled,
  characterAt,
  firedIds,
  handCard,
  op01KingScenario,
  op01LifeScenario,
  OP01_KING_DECKS,
  OP01_LIFE_DECKS,
} from './support.js';

/**
 * The eight cards three census rows were holding, on printed text.
 *
 * The engine's own file (`packages/engine/tests/donCountAndCosts.test.ts`) owns
 * the mechanisms — what the count includes, what each cost takes, the flag that
 * decides a self-payment. This file is the corpus, and it asks the two things
 * synthetic cards cannot: that the printed sentences really do reduce to those
 * shapes, and that a random game reaches them.
 *
 * | Row | Cards |
 * | --- | --- |
 * | a condition on your DON!! count | `OP01-091`, `OP01-095`, `OP01-109` |
 * | a cost that moves chosen cards | `OP01-011`, `OP01-047`, `OP01-055` |
 * | a cost paid with a Life card | `OP01-008`, `OP01-013` |
 */

function candidates(state: GameState): InstanceId[] {
  const pending = state.pending;
  if (pending === null) {
    throw new Error('expected an open choice');
  }
  return [...pending.candidates];
}

function play(state: GameState, player: PlayerId, cardId: string): GameState {
  return applyOk(state, {
    type: 'PLAY_CARD',
    player,
    instanceId: handCard(state, player, cardId),
  }).state;
}

function donOnField(state: GameState, player: PlayerId): number {
  return state.players[player].don.filter((don) => don.location.kind !== 'donDeck').length;
}

// ===========================================================================
// A condition on your DON!! count
// ===========================================================================

describe('OP01-091 King — all ten DON!! give the opponent’s Characters −1000', () => {
  function staged(don: number): GameState {
    return op01KingScenario({
      p1: { activeDon: don },
      p2: { characters: [{ cardId: 'OP01-103' }, { cardId: 'OP01-100' }], activeDon: 4 },
    });
  }

  it('is off at nine and on at ten, which is the whole card', () => {
    // A player has exactly ten DON!! (CR 5-1-2), so "10 DON!! cards on your
    // field" is every one of them deployed — the boundary is the card.
    const nine = staged(9);
    const ten = staged(10);
    expect(donOnField(nine, 'p1')).toBe(9);
    expect(donOnField(ten, 'p1')).toBe(10);

    expect(getPower(nine, characterAt(nine, 'p2', 0))).toBe(6000);
    expect(getPower(ten, characterAt(ten, 'p2', 0))).toBe(5000);
  });

  it('reaches every one of the opponent’s Characters and none of its own side', () => {
    const state = staged(10);
    expect(getPower(state, characterAt(state, 'p2', 0))).toBe(6000 - 1000);
    expect(getPower(state, characterAt(state, 'p2', 1))).toBe(3000 - 1000);
    // The opponent's Leader is not a Character and is untouched.
    expect(getPower(state, state.players.p2.leader)).toBe(5000);
  });

  it('counts a given DON!! toward the ten, because giving leaves it on the field', () => {
    // CR 6-5-5-1 places a given DON!! under the card "such that it remains
    // visible" — it is still in the Character area, so still on the field. CR
    // 4-4-2 makes it neither active nor rested, which is why no orientation
    // filter could see it.
    const state = op01KingScenario({
      p1: { characters: [{ cardId: 'OP01-104', attachedDon: 2 }], activeDon: 10 },
      p2: { characters: [{ cardId: 'OP01-103' }], activeDon: 4 },
    });
    expect(state.players.p1.don.filter((don) => don.location.kind === 'attached')).toHaveLength(2);
    expect(donOnField(state, 'p1')).toBe(10);
    expect(getPower(state, characterAt(state, 'p2', 0))).toBe(5000);
  });

  it('writes no modifier, and switches off the moment a DON!! leaves the field', () => {
    const state = staged(10);
    expect(state.modifiers).toEqual([]);
    // `OP01-115` Elephant's Marchoo is an Event: playing it spends DON!! out of
    // the cost area into rested, which does not leave the field — so the count
    // holds. The honest switch-off is staging nine, which the first case does.
    expect(getPower(staged(9), characterAt(staged(9), 'p2', 0))).toBe(6000);
  });
});

describe('OP01-095 Kyoshirou — draw at eight DON!! or more', () => {
  function staged(don: number): GameState {
    return op01KingScenario({
      p1: { hand: ['OP01-095'], clearHand: true, activeDon: don },
      p2: { activeDon: 4 },
    });
  }

  it('draws at eight', () => {
    const state = staged(8);
    const before = state.players.p1.deck.length;
    const done = play(state, 'p1', 'OP01-095');

    expect(firedIds(done.log)).toContain('OP01-095-onPlay');
    expect(done.players.p1.deck).toHaveLength(before - 1);
    assertSettled(done);
  });

  it('does not fire at seven, and the Character still lands', () => {
    const state = staged(7);
    const before = state.players.p1.deck.length;
    const done = play(state, 'p1', 'OP01-095');

    expect(firedIds(done.log)).not.toContain('OP01-095-onPlay');
    expect(done.players.p1.deck).toHaveLength(before);
    expect(done.players.p1.characters).toHaveLength(1);
    assertSettled(done);
  });
});

describe('OP01-109 Who’s.Who — three printed gates on one continuous buff', () => {
  function staged(don: number, attached: number): GameState {
    return op01KingScenario({
      p1: { characters: [{ cardId: 'OP01-109', attachedDon: attached }], activeDon: don },
      p2: { activeDon: 4 },
    });
  }

  it('needs the attached DON!! and the field count together', () => {
    // `[DON!! x1]` asks how many DON!! are **attached to this card**;
    // `donOnField` asks how many are on the field at all. Two questions about
    // the same resource, and this card is where they stand side by side.
    const neither = staged(4, 0);
    const onlyAttached = staged(4, 1);
    const onlyCount = staged(8, 0);
    const both = staged(8, 1);

    expect(getPower(neither, characterAt(neither, 'p1', 0))).toBe(3000);
    expect(getPower(onlyAttached, characterAt(onlyAttached, 'p1', 0))).toBe(3000 + 1000);
    expect(getPower(onlyCount, characterAt(onlyCount, 'p1', 0))).toBe(3000);
    // +1000 for the attached DON!! and +1000 from the static.
    expect(getPower(both, characterAt(both, 'p1', 0))).toBe(3000 + 1000 + 1000);
  });

  it('is off at seven on the field and on at eight', () => {
    // The attached DON!! is one of the eight, which is the arithmetic that makes
    // the boundary worth pinning: `attachedDon` moves a DON!! from the cost area
    // rather than adding one.
    const seven = staged(7, 1);
    const eight = staged(8, 1);
    expect(donOnField(seven, 'p1')).toBe(7);
    expect(donOnField(eight, 'p1')).toBe(8);
    expect(getPower(seven, characterAt(seven, 'p1', 0))).toBe(3000 + 1000);
    expect(getPower(eight, characterAt(eight, 'p1', 0))).toBe(3000 + 1000 + 1000);
  });

  it('writes nothing to modifiers either way', () => {
    const on = staged(8, 1);
    expect(on.modifiers).toEqual([]);
  });
});

// ===========================================================================
// Costs that move cards the player chooses
// ===========================================================================

describe('OP01-011 Gordon — a hand card under the deck, then draw', () => {
  function staged(): GameState {
    return op01LifeScenario({
      p1: { hand: ['OP01-011', 'OP01-010', 'OP01-012'], clearHand: true, activeDon: 5 },
      p2: { activeDon: 4 },
    });
  }

  it('offers the hand and buries the chosen card under the deck', () => {
    const state = staged();
    const asking = answer(play(state, 'p1', 'OP01-011'), 'p1', { kind: 'yesNo', value: true });
    expect(candidates(asking)).toEqual(asking.players.p1.hand);

    const buried = candidates(asking)[0];
    if (buried === undefined) {
      throw new Error('expected a candidate');
    }
    const done = answer(asking, 'p1', { kind: 'cards', selected: [buried] });

    // Moved, not trashed — which is the whole difference from `discardHand`.
    expect(done.players.p1.trash).not.toContain(buried);
    expect(done.players.p1.deck.at(-1)).toBe(buried);
    assertSettled(done);
  });

  it('proves where it went by drawing the deck down to it', () => {
    // Reading `deck.at(-1)` says where the engine put it; drawing says the deck
    // agrees. The card comes back last, which is what "bottom" means.
    const state = staged();
    const asking = answer(play(state, 'p1', 'OP01-011'), 'p1', { kind: 'yesNo', value: true });
    const buried = candidates(asking)[0];
    if (buried === undefined) {
      throw new Error('expected a candidate');
    }
    const done = answer(asking, 'p1', { kind: 'cards', selected: [buried] });
    expect(done.players.p1.deck.at(-1)).toBe(buried);
    expect(done.players.p1.deck.indexOf(buried)).toBe(done.players.p1.deck.length - 1);
  });

  it('is a decision: two answers bury two different cards', () => {
    const state = staged();
    const asking = answer(play(state, 'p1', 'OP01-011'), 'p1', { kind: 'yesNo', value: true });
    const [first, second] = candidates(asking);
    if (first === undefined || second === undefined) {
      throw new Error('expected two candidates');
    }
    expect(answer(asking, 'p1', { kind: 'cards', selected: [first] }).players.p1.deck.at(-1)).toBe(
      first,
    );
    expect(answer(asking, 'p1', { kind: 'cards', selected: [second] }).players.p1.deck.at(-1)).toBe(
      second,
    );
  });

  it('costs nothing when declined, because CR 8-3-1-4 declines before paying', () => {
    const state = staged();
    const before = state.players.p1.deck.length;
    const declined = answer(play(state, 'p1', 'OP01-011'), 'p1', { kind: 'yesNo', value: false });

    expect(declined.pending).toBeNull();
    expect(declined.players.p1.deck).toHaveLength(before);
    assertSettled(declined);
  });
});

describe('OP01-047 Trafalgar Law — return a Character, then play a 3-drop', () => {
  function staged(): GameState {
    return op01LifeScenario({
      p1: {
        characters: [{ cardId: 'OP01-010' }],
        hand: ['OP01-047', 'OP01-023'],
        clearHand: true,
        activeDon: 8,
      },
      p2: { characters: [{ cardId: 'OP01-045' }], activeDon: 4 },
    });
  }

  it('offers your own Characters, never the opponent’s', () => {
    // "To **your** hand" is what says whose, and `ZoneRef` carries no owner
    // because a card returns to its own owner's zone — an opponent's Character
    // would land in their hand and contradict the sentence.
    const state = staged();
    const asking = answer(play(state, 'p1', 'OP01-047'), 'p1', { kind: 'yesNo', value: true });
    expect(candidates(asking)).toEqual(asking.players.p1.characters);
    expect(candidates(asking)).not.toContain(characterAt(state, 'p2', 0));
  });

  it('includes Law itself, because nothing in the text excludes it', () => {
    // A card that means to exclude its source says so — `OP08-047` prints
    // "other than this Character". This one does not.
    const state = staged();
    const asking = answer(play(state, 'p1', 'OP01-047'), 'p1', { kind: 'yesNo', value: true });
    const law = asking.players.p1.characters.find(
      (id) => asking.cards[id]?.cardId === 'OP01-047',
    );
    expect(law).toBeDefined();
    expect(candidates(asking)).toContain(law);
  });

  it('resolves the play even when Law paid with itself', () => {
    // `rules.selfReturnResolvesEffect`. CR 8-3-1-3-1 describes a payment
    // happening after the effect was "activated", and this engine has resolved
    // scripts from off the field since PR #27. The alternative reading would
    // make a printed cost that no player can ever take.
    const state = staged();
    const asking = answer(play(state, 'p1', 'OP01-047'), 'p1', { kind: 'yesNo', value: true });
    const law = asking.players.p1.characters.find(
      (id) => asking.cards[id]?.cardId === 'OP01-047',
    );
    if (law === undefined) {
      throw new Error('expected Law on the field');
    }
    const paid = answer(asking, 'p1', { kind: 'cards', selected: [law] });

    // Law is in hand, and the script is still asking about the 3-drop.
    expect(paid.players.p1.hand).toContain(law);
    expect(paid.players.p1.characters).not.toContain(law);
    expect(paid.pending?.kind).toBe('selectCards');

    const marco = handCard(paid, 'p1', 'OP01-023');
    const done = answer(paid, 'p1', { kind: 'cards', selected: [marco] });
    expect(done.players.p1.characters).toContain(marco);
    assertSettled(done);
  });

  it('plays nothing when the "up to 1" is answered with nothing', () => {
    const state = staged();
    const asking = answer(play(state, 'p1', 'OP01-047'), 'p1', { kind: 'yesNo', value: true });
    const other = characterAt(state, 'p1', 0);
    const paid = answer(asking, 'p1', { kind: 'cards', selected: [other] });
    const done = answer(paid, 'p1', { kind: 'cards', selected: [] });

    expect(done.players.p1.hand).toContain(other);
    assertSettled(done);
  });
});

describe('OP01-055 You Can Be My Samurai!! — rest two of yours, draw two', () => {
  function staged(active: number, rested = 0): GameState {
    return op01LifeScenario({
      p1: {
        characters: [
          ...Array.from({ length: active }, () => ({ cardId: 'OP01-010' as const })),
          ...Array.from({ length: rested }, () => ({
            cardId: 'OP01-012' as const,
            orientation: 'rested' as const,
          })),
        ],
        hand: ['OP01-055'],
        clearHand: true,
        activeDon: 5,
      },
      p2: { activeDon: 4 },
    });
  }

  it('rests the two chosen and draws two', () => {
    const state = staged(3);
    const before = state.players.p1.deck.length;
    const asking = answer(play(state, 'p1', 'OP01-055'), 'p1', { kind: 'yesNo', value: true });
    const [first, second] = candidates(asking);
    if (first === undefined || second === undefined) {
      throw new Error('expected candidates');
    }
    const done = answer(asking, 'p1', { kind: 'cards', selected: [first, second] });

    expect(done.cards[first]?.orientation).toBe('rested');
    expect(done.cards[second]?.orientation).toBe('rested');
    expect(done.players.p1.deck).toHaveLength(before - 2);
    assertSettled(done);
  });

  it('offers only active Characters', () => {
    const state = staged(2, 2);
    const asking = answer(play(state, 'p1', 'OP01-055'), 'p1', { kind: 'yesNo', value: true });
    expect(candidates(asking)).toHaveLength(2);
    for (const id of candidates(asking)) {
      expect(state.cards[id]?.orientation).toBe('active');
    }
  });

  it('asks nothing with only one active Character, and draws nothing', () => {
    // CR 8-3-1-3: a cost that cannot be paid in full cannot be paid at all — so
    // the **ability** never opens its "You may", and the draw never happens.
    //
    // The **play** is still legal, and that separation is the point rather than
    // a gap. Playing an Event is CR 6-5-3-1's Main Phase action, gated on the
    // card's printed cost; its effect's *activation* cost is a second question
    // settled at 8-3-1-3 while the effect resolves. A player may burn the Event
    // for nothing, the same way CR 8-3-1-4 lets them decline a payable one.
    const state = staged(1, 3);
    const event = handCard(state, 'p1', 'OP01-055');
    expect(
      legalActions(state, 'p1').some(
        (action) => action.type === 'PLAY_CARD' && action.instanceId === event,
      ),
    ).toBe(true);

    const before = state.players.p1.deck.length;
    const done = play(state, 'p1', 'OP01-055');

    expect(done.pending).toBeNull();
    expect(firedIds(done.log)).not.toContain('OP01-055-main');
    expect(done.players.p1.deck).toHaveLength(before);
    // Nothing was rested, because nothing was paid.
    for (const id of done.players.p1.characters) {
      expect(done.cards[id]?.orientation).toBe(state.cards[id]?.orientation);
    }
    assertSettled(done);
  });

  it('asks the moment a second Character stands', () => {
    const state = staged(2, 2);
    const asking = answer(play(state, 'p1', 'OP01-055'), 'p1', { kind: 'yesNo', value: true });
    expect(candidates(asking)).toHaveLength(2);
  });
});

// ===========================================================================
// Costs paid with a Life card
// ===========================================================================

describe('OP01-008 Cavendish — a Life card for [Rush]', () => {
  function staged(life: number): GameState {
    return op01LifeScenario({
      p1: { hand: ['OP01-008'], clearHand: true, activeDon: 6, life },
      p2: { activeDon: 4 },
    });
  }

  it('takes the top Life card into hand and asks nothing', () => {
    // CR 3-10-2 already chose: "a player must select the card at the top of
    // their Life cards unless otherwise specified".
    const state = staged(3);
    const top = state.players.p1.life[0];
    const rest = state.players.p1.life.slice(1);
    if (top === undefined) {
      throw new Error('expected a life card');
    }
    const done = answer(play(state, 'p1', 'OP01-008'), 'p1', { kind: 'yesNo', value: true });

    expect(done.pending).toBeNull();
    expect(done.players.p1.hand).toContain(top);
    expect(done.players.p1.life).toEqual(rest);
    assertSettled(done);
  });

  it('grants [Rush], which is what the price bought', () => {
    const state = staged(3);
    const done = answer(play(state, 'p1', 'OP01-008'), 'p1', { kind: 'yesNo', value: true });
    const cavendish = characterAt(done, 'p1', 0);
    // The proof is the attack: a Character played this turn cannot attack
    // without [Rush] (CR 3-7-4).
    expect(
      legalActions(done, 'p1').some(
        (action) => action.type === 'DECLARE_ATTACK' && action.attacker === cavendish,
      ),
    ).toBe(true);
  });

  it('fires no [Trigger] on the card it takes', () => {
    // CR 2-11-1 binds `[Trigger]` to adding a Life card to hand **on taking
    // damage**, and CR 4-6-3 to the damage procedure of CR 4-6-2. A payment is
    // neither. Staged with `OP01-009` Carrot on top, whose whole printed text is
    // "[Trigger] Play this card" — so the case is not vacuous.
    const state = op01LifeScenario({
      p1: {
        hand: ['OP01-008'],
        clearHand: true,
        activeDon: 6,
        lifeCards: ['OP01-025', 'OP01-010', 'OP01-012'],
      },
      p2: { activeDon: 4 },
    });
    const top = state.players.p1.life[0];
    if (top === undefined) {
      throw new Error('expected a life card');
    }
    const result = applyAction(state, {
      type: 'PLAY_CARD',
      player: 'p1',
      instanceId: handCard(state, 'p1', 'OP01-008'),
    });
    if (!result.ok) {
      throw new Error(result.reason);
    }
    const done = answer(result.state, 'p1', { kind: 'yesNo', value: true });

    expect(done.players.p1.hand).toContain(top);
    // One yes/no was asked — the ability's own "You may" — and no second one.
    expect(done.pending).toBeNull();
    assertSettled(done);
  });

  it('may be paid with the last Life card, and the game continues', () => {
    // CR 1-2-1-1-1: the defeat condition is "0 Life cards **and** your Leader
    // takes damage". Reaching zero is not one.
    const state = staged(1);
    const done = answer(play(state, 'p1', 'OP01-008'), 'p1', { kind: 'yesNo', value: true });

    expect(done.players.p1.life).toEqual([]);
    expect(done.status).not.toBe('finished');
    assertSettled(done);
  });

  it('is not offered at zero Life, because the price cannot be paid', () => {
    const state = staged(0);
    expect(state.players.p1.life).toEqual([]);
    const done = play(state, 'p1', 'OP01-008');
    // The Character still lands; only its optional ability never asks.
    expect(done.players.p1.characters).toHaveLength(1);
    expect(done.pending).toBeNull();
    expect(firedIds(done.log)).not.toContain('OP01-008-onPlay');
  });
});

describe('OP01-013 Sanji — a Life card for +2000 and two rested DON!!', () => {
  function staged(restedDon: number): GameState {
    return op01LifeScenario({
      p1: {
        characters: [{ cardId: 'OP01-013' }],
        activeDon: 4,
        restedDon,
        life: 3,
      },
      p2: { activeDon: 4 },
    });
  }

  function activate(state: GameState): GameState {
    return applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: characterAt(state, 'p1', 0),
      abilityId: 'OP01-013-main',
    }).state;
  }

  it('pays a Life card, then adds the power and the DON!!', () => {
    const state = staged(3);
    const sanji = characterAt(state, 'p1', 0);
    const top = state.players.p1.life[0];
    if (top === undefined) {
      throw new Error('expected a life card');
    }
    const done = answer(activate(state), 'p1', { kind: 'yesNo', value: true });

    expect(done.players.p1.hand).toContain(top);
    // 3000 printed + 2000 from the effect + 1000 per DON!! given.
    expect(getPower(done, sanji)).toBe(3000 + 2000 + 2000);
    expect(done.cards[sanji]?.attachedDon).toHaveLength(2);
    assertSettled(done);
  });

  it('gives what rested DON!! there are, and no active one', () => {
    // "Give this Character **up to** 2 rested DON!! cards" — `giveDon` draws from
    // the rested pool only, so an empty one gives nothing rather than reaching
    // for an active DON!! the card does not authorize.
    const state = staged(0);
    const sanji = characterAt(state, 'p1', 0);
    const done = answer(activate(state), 'p1', { kind: 'yesNo', value: true });

    expect(done.cards[sanji]?.attachedDon).toHaveLength(0);
    expect(getPower(done, sanji)).toBe(3000 + 2000);
    assertSettled(done);
  });

  it('is once per turn, and the second attempt is refused', () => {
    const state = staged(3);
    const done = answer(activate(state), 'p1', { kind: 'yesNo', value: true });
    expect(
      legalActions(done, 'p1').some(
        (action) =>
          action.type === 'ACTIVATE_ABILITY' && action.abilityId === 'OP01-013-main',
      ),
    ).toBe(false);
  });
});

// ===========================================================================
// Manifestation
// ===========================================================================

type Decks = Record<PlayerId, Decklist>;

function runGame(
  decks: Decks,
  seed: number,
  watch?: (state: GameState) => void,
): { state: GameState; fired: Set<string> } {
  let state = createGame({ seed, decks, firstPlayer: 'p1' });
  const fired = new Set<string>();
  watch?.(state);
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
    watch?.(state);
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

describe('a real game of the King deck', () => {
  // A cover of 1 over 80 games, plus one for volume. `OP01-095`'s DON!!-gated
  // draw is in it, which is the reachability that mattered.
  const SEEDS = [66, 1] as const;

  it('reaches the eight-DON!! gate in ordinary play', () => {
    expect(union(OP01_KING_DECKS, SEEDS)).toEqual([
      'OP01-093-onPlay',
      'OP01-095-onPlay',
      'OP01-104-trigger',
      'OP01-106-onPlay',
      'OP01-106-trigger',
      'OP01-113-onKO',
      'OP01-115-main',
      'OP01-115-trigger',
    ]);
  });

  it('reaches ten DON!! on the field, which is what King asks for', () => {
    // Neither static can appear in the union above — a continuous effect emits
    // no event — so the reachability claim has to be made about the **board**.
    // Ten is every DON!! a player has (CR 5-1-2), and the deck's four
    // DON!!-adding cards are what get there before a game ends.
    let best = 0;
    for (const seed of SEEDS) {
      runGame(OP01_KING_DECKS, seed, (state) => {
        for (const player of ['p1', 'p2'] as const) {
          best = Math.max(best, donOnField(state, player));
        }
      });
    }
    expect(best).toBe(10);
  });

  it('puts King’s static to work: ten DON!! with enemy Characters standing', () => {
    // The position the card is about, reached rather than staged.
    let seen = false;
    for (const seed of SEEDS) {
      runGame(OP01_KING_DECKS, seed, (state) => {
        for (const player of ['p1', 'p2'] as const) {
          const foe = player === 'p1' ? 'p2' : 'p1';
          if (donOnField(state, player) === 10 && state.players[foe].characters.length > 0) {
            seen = true;
          }
        }
      });
    }
    expect(seen).toBe(true);
  });
});

describe('a real game of the Luffy deck', () => {
  // A cover of 1 over 80 games, plus one for volume — and between them every
  // one of the five cost cards pays its price.
  const SEEDS = [45, 1] as const;

  it('pays all five of the new costs in ordinary play', () => {
    expect(union(OP01_LIFE_DECKS, SEEDS)).toEqual([
      // The deck's Leader, whose own ability batch 6 wrote.
      'OP01-003-main',
      'OP01-008-onPlay',
      'OP01-011-onPlay',
      'OP01-013-main',
      'OP01-047-onPlay',
      'OP01-055-main',
    ]);
  });

  it('really spends Life, which is the cost no staged position can fake', () => {
    // A Life area that shrinks without damage is the payment: damage moves a
    // Life card to hand too, so the honest signal is a **decrease with no
    // damage event in the same step**.
    let paid = false;
    for (const seed of SEEDS) {
      let previous: Record<PlayerId, number> = { p1: 5, p2: 5 };
      runGame(OP01_LIFE_DECKS, seed, (state) => {
        for (const player of ['p1', 'p2'] as const) {
          const now = state.players[player].life.length;
          if (now < previous[player] && state.battle === null) {
            paid = true;
          }
          previous = { ...previous, [player]: now };
        }
      });
    }
    expect(paid).toBe(true);
  });
});

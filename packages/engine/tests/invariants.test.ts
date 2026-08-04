import { describe, expect, it } from 'vitest';
import { assertSerializationRoundTrip, checkInvariants } from '../src/index.js';
import type { GameState } from '../src/index.js';
import {
  advanceToMain,
  buildGame,
  cloneWith,
  draftPutCharacter,
  run,
} from './helpers.js';

function violationsOf(state: GameState, mutate: (draft: GameState) => void): string[] {
  return checkInvariants(cloneWith(state, mutate));
}

describe('invariants: green on real states', () => {
  it('holds on created, mid-game, mid-battle, and finished states', () => {
    const game = buildGame();
    expect(checkInvariants(game)).toEqual([]);
    const main = advanceToMain(game);
    expect(checkInvariants(main)).toEqual([]);
    const finished = run(main, { type: 'CONCEDE', player: 'p2' });
    expect(checkInvariants(finished)).toEqual([]);
  });
});

describe('invariants: each checker fires on targeted corruption', () => {
  it('cardConservation: duplicated and missing instances', () => {
    const main = advanceToMain(buildGame());
    const duplicated = violationsOf(main, (draft) => {
      draft.players.p1.hand.push(draft.players.p1.deck[0]!);
    });
    expect(duplicated.some((v) => v.startsWith('cardConservation'))).toBe(true);

    const missing = violationsOf(main, (draft) => {
      draft.players.p1.deck.pop();
    });
    expect(missing.some((v) => v.includes('51'))).toBe(true);
  });

  it('donConservation: wrong count and foreign attachment', () => {
    const main = advanceToMain(buildGame());
    const short = violationsOf(main, (draft) => {
      draft.players.p1.don.pop();
    });
    expect(short.some((v) => v.startsWith('donConservation'))).toBe(true);

    const foreign = violationsOf(main, (draft) => {
      draft.players.p1.don[0]!.location = { kind: 'attached', to: draft.players.p2.leader };
      draft.cards[draft.players.p2.leader]!.attachedDon.push('p1-d0');
    });
    expect(foreign.some((v) => v.startsWith('donConservation'))).toBe(true);
  });

  it('donBidirectional: one-way links in both directions', () => {
    const main = advanceToMain(buildGame());
    const danglingDon = violationsOf(main, (draft) => {
      draft.players.p1.don[0]!.location = { kind: 'attached', to: draft.players.p1.leader };
      // leader.attachedDon not updated
    });
    expect(danglingDon.some((v) => v.startsWith('donBidirectional'))).toBe(true);

    const ghostRef = violationsOf(main, (draft) => {
      draft.cards[draft.players.p1.leader]!.attachedDon.push('p1-d0');
      // don location still cost/donDeck
    });
    expect(ghostRef.some((v) => v.startsWith('donBidirectional'))).toBe(true);
  });

  it('fieldLimits: more than 5 characters', () => {
    const main = advanceToMain(buildGame());
    const crowded = violationsOf(main, (draft) => {
      for (const cardId of ['TEST-001', 'TEST-002', 'TEST-003', 'TEST-004', 'TEST-005', 'TEST-006']) {
        draftPutCharacter(draft, 'p1', cardId);
      }
    });
    expect(crowded.some((v) => v.startsWith('fieldLimits'))).toBe(true);
  });

  it('offFieldNormalized: rested or stateful cards outside the field', () => {
    const main = advanceToMain(buildGame());
    const restedInHand = violationsOf(main, (draft) => {
      draft.cards[draft.players.p1.hand[0]!]!.orientation = 'rested';
    });
    expect(restedInHand.some((v) => v.startsWith('offFieldNormalized'))).toBe(true);

    const turnStamped = violationsOf(main, (draft) => {
      draft.cards[draft.players.p1.deck[0]!]!.playedOnTurn = 5;
    });
    expect(turnStamped.some((v) => v.startsWith('offFieldNormalized'))).toBe(true);
  });

  it('modifierShape: off-field targets and orphaned endOfBattle modifiers', () => {
    const main = advanceToMain(buildGame());
    const offField = violationsOf(main, (draft) => {
      draft.modifiers.push({
        id: 'bad-1',
        target: draft.players.p1.hand[0]!,
        kind: 'power',
        value: 1000,
        duration: 'endOfTurn',
        source: draft.players.p1.leader,
      });
    });
    expect(offField.some((v) => v.startsWith('modifierShape'))).toBe(true);

    const orphaned = violationsOf(main, (draft) => {
      draft.modifiers.push({
        id: 'bad-2',
        target: draft.players.p1.leader,
        kind: 'power',
        value: 1000,
        duration: 'endOfBattle',
        source: draft.players.p1.leader,
      });
    });
    expect(orphaned.some((v) => v.includes('endOfBattle'))).toBe(true);
  });

  it('battleShape: transient steps and controller mismatches', () => {
    const main = advanceToMain(buildGame());
    const transientStep = violationsOf(main, (draft) => {
      draft.battle = {
        step: 'damage',
        attacker: draft.players.p1.leader,
        target: draft.players.p2.leader,
        originalTarget: draft.players.p2.leader,
        wasBlocked: false,
      };
      draft.priority = 'p2';
    });
    expect(transientStep.some((v) => v.startsWith('battleShape'))).toBe(true);

    const wrongController = violationsOf(main, (draft) => {
      draft.battle = {
        step: 'block',
        attacker: draft.players.p2.leader, // defender's card as attacker
        target: draft.players.p2.leader,
        originalTarget: draft.players.p2.leader,
        wasBlocked: false,
      };
      draft.priority = 'p2';
    });
    expect(wrongController.some((v) => v.startsWith('battleShape'))).toBe(true);
  });

  it('stateShape: finished without winner, wrong phase, leaked priority, mulligan turn', () => {
    const main = advanceToMain(buildGame());
    expect(
      violationsOf(main, (draft) => {
        draft.status = 'finished';
      }).some((v) => v.startsWith('stateShape')),
    ).toBe(true);
    expect(
      violationsOf(main, (draft) => {
        draft.phase = 'draw';
      }).some((v) => v.startsWith('stateShape')),
    ).toBe(true);
    expect(
      violationsOf(main, (draft) => {
        draft.priority = 'p2';
      }).some((v) => v.startsWith('stateShape')),
    ).toBe(true);
    expect(
      violationsOf(buildGame(), (draft) => {
        draft.turn = 3;
      }).some((v) => v.startsWith('stateShape')),
    ).toBe(true);
  });
});

describe('invariants: serialization round trip assertion', () => {
  it('throws when the state smuggles an explicit undefined', () => {
    const main = advanceToMain(buildGame());
    const smuggled = cloneWith(main, (draft) => {
      (draft.players.p1 as unknown as Record<string, unknown>)['stage'] = undefined;
    });
    expect(() => assertSerializationRoundTrip(smuggled)).toThrow();
    expect(() => assertSerializationRoundTrip(main)).not.toThrow();
  });
});

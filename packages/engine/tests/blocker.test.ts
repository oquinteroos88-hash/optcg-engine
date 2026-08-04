import { describe, expect, it } from 'vitest';
import { legalActions, registerCardSet } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { advanceToMain, applyOk, buildGame, cloneWith, draftPutCharacter, run } from './helpers.js';

// No Phase 0 card carries Blocker, so the redirect branch of the battle FSM is
// unreachable from the shipped card set: neither the unit tests nor the bot
// simulation can enter it. These tests register a Blocker card of their own and
// drive the branch directly, so a Phase 1 regression in the redirect logic gets
// caught here instead of silently passing the whole suite.
//
// Vitest isolates the module graph per test file, so registering an extra card
// here cannot leak into any other test file.
const BLOCKER_CARD = 'TEST-B01';

registerCardSet([
  {
    cardId: BLOCKER_CARD,
    name: 'Green Sentry',
    category: 'character',
    color: 'green',
    cost: 2,
    power: 3000,
    counter: 1000,
    keywords: ['Blocker'],
    life: 0,
  },
]);

// p1 attacks with a 9000 character on turn 3; p2 holds a 3000 Blocker and a
// rested 5000 character. Retargeting an existing instance keeps conservation
// intact: the instance stays in its zone, only its printed card changes.
function blockerSetup(): {
  state: GameState;
  attacker: string;
  blocker: string;
  originalTarget: string;
} {
  const main = advanceToMain(buildGame());
  let attacker!: string;
  let blocker!: string;
  let originalTarget!: string;
  const state = cloneWith(main, (draft) => {
    draft.turn = 3;
    attacker = draftPutCharacter(draft, 'p1', 'TEST-009'); // 9000
    originalTarget = draftPutCharacter(draft, 'p2', 'TEST-106', { orientation: 'rested' }); // 5000
    blocker = draftPutCharacter(draft, 'p2', 'TEST-103'); // active, becomes the Blocker
    const card = draft.cards[blocker];
    if (card === undefined) {
      throw new Error('missing blocker instance');
    }
    card.cardId = BLOCKER_CARD;
  });
  return { state, attacker, blocker, originalTarget };
}

describe('blocker redirect (Phase 1 forward-compatibility)', () => {
  it('legalActions offers DECLARE_BLOCK only to an active Blocker at the block step', () => {
    const { state, attacker, originalTarget, blocker } = blockerSetup();
    const inBattle = run(state, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker,
      target: originalTarget,
    });
    expect(legalActions(inBattle, 'p2')).toEqual([
      { type: 'PASS', player: 'p2' },
      { type: 'DECLARE_BLOCK', player: 'p2', blocker },
      { type: 'CONCEDE', player: 'p2' },
    ]);

    // A rested Blocker cannot block.
    const rested = cloneWith(inBattle, (draft) => {
      const card = draft.cards[blocker];
      if (card === undefined) {
        throw new Error('missing blocker instance');
      }
      card.orientation = 'rested';
    });
    expect(legalActions(rested, 'p2')).toEqual([
      { type: 'PASS', player: 'p2' },
      { type: 'CONCEDE', player: 'p2' },
    ]);
  });

  it('redirects the battle to the blocker, rests it, and keeps originalTarget', () => {
    const { state, attacker, blocker, originalTarget } = blockerSetup();
    const declared = run(state, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker,
      target: originalTarget,
    });
    const blocked = applyOk(declared, { type: 'DECLARE_BLOCK', player: 'p2', blocker });

    expect(blocked.state.battle).toEqual({
      step: 'counter',
      attacker,
      target: blocker,
      originalTarget,
      wasBlocked: true,
    });
    expect(blocked.state.cards[blocker]?.orientation).toBe('rested');
    expect(blocked.state.priority).toBe('p2');
    expect(blocked.events).toEqual([{ type: 'blockDeclared', player: 'p2', blocker }]);
  });

  it('resolves damage against the blocker, leaving the original target untouched', () => {
    const { state, attacker, blocker, originalTarget } = blockerSetup();
    const resolved = run(
      state,
      { type: 'DECLARE_ATTACK', player: 'p1', attacker, target: originalTarget },
      { type: 'DECLARE_BLOCK', player: 'p2', blocker },
      { type: 'PASS', player: 'p2' },
    );

    // 9000 vs the blocker's 3000: the blocker is KO'd.
    expect(resolved.players.p2.characters).not.toContain(blocker);
    expect(resolved.players.p2.trash[0]).toBe(blocker);
    // The originally declared target survives untouched, still rested.
    expect(resolved.players.p2.characters).toContain(originalTarget);
    expect(resolved.cards[originalTarget]?.orientation).toBe('rested');
    expect(resolved.battle).toBeNull();
    expect(resolved.priority).toBe('p1');
  });

  it('a blocker strong enough to win saves the original target and survives', () => {
    const { state, attacker, blocker, originalTarget } = blockerSetup();
    // Give the blocker 8 attached DON: 3000 + 8000 = 11000 beats the 9000 attacker.
    const staged = cloneWith(state, (draft) => {
      const card = draft.cards[blocker];
      if (card === undefined) {
        throw new Error('missing blocker instance');
      }
      draft.players.p2.don.slice(0, 8).forEach((don) => {
        don.location = { kind: 'attached', to: blocker };
        card.attachedDon.push(don.instanceId);
      });
    });
    const resolved = run(
      staged,
      { type: 'DECLARE_ATTACK', player: 'p1', attacker, target: originalTarget },
      { type: 'DECLARE_BLOCK', player: 'p2', blocker },
      { type: 'PASS', player: 'p2' },
    );

    expect(resolved.players.p2.characters).toContain(blocker);
    expect(resolved.players.p2.characters).toContain(originalTarget);
    expect(resolved.players.p2.trash).toEqual([]);
    // Damage is never bidirectional: the attacker survives losing the battle.
    expect(resolved.players.p1.characters).toContain(attacker);
  });

  it('a counter can be given to the blocker after it redirects the attack', () => {
    const { state, attacker, blocker, originalTarget } = blockerSetup();
    // TEST-104 has counter 2000: 3000 + 2000 = 5000, still short of 9000.
    let counterCard!: string;
    const staged = cloneWith(state, (draft) => {
      const deck = draft.players.p2.deck;
      const index = deck.findIndex((id) => draft.cards[id]?.cardId === 'TEST-104');
      const [id] = deck.splice(index, 1);
      counterCard = id as string;
      draft.players.p2.hand.push(counterCard);
    });
    const countered = run(
      staged,
      { type: 'DECLARE_ATTACK', player: 'p1', attacker, target: originalTarget },
      { type: 'DECLARE_BLOCK', player: 'p2', blocker },
      { type: 'PLAY_COUNTER', player: 'p2', instanceId: counterCard, target: blocker },
    );
    expect(countered.modifiers).toHaveLength(1);
    expect(countered.modifiers[0]?.target).toBe(blocker);

    const resolved = run(countered, { type: 'PASS', player: 'p2' });
    // 5000 < 9000, so the blocker still dies, and the counter modifier expires.
    expect(resolved.players.p2.characters).not.toContain(blocker);
    expect(resolved.modifiers).toEqual([]);
  });
});

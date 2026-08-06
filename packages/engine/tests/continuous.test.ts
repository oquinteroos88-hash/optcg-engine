import { describe, expect, it } from 'vitest';
import { getBasePower, getPower, hasKeyword, legalActions } from '../src/index.js';
import { ABIL_DECK } from '../src/testdata/abilityDecks.js';
import { buildScenario, characterAt } from '../src/testdata/scenarios.js';
import { applyOk } from './helpers.js';

/**
 * Acceptance test 7: continuous effects are read, not written.
 *
 * The point of these is negative as much as positive. A buff that showed up in
 * `state.modifiers` would be a script that ran once, and would then have to be
 * removed when its source left, recalculated on every board change, and kept in
 * sync forever. These tests assert the buff is visible *and* that nothing was
 * written anywhere to make it visible.
 */

const abilityDecks = { p1: ABIL_DECK, p2: ABIL_DECK };

describe('continuous power', () => {
  it('adds the static buff to other characters while the source is on the field', () => {
    const state = buildScenario({
      decks: abilityDecks,
      p1: { characters: [{ cardId: 'ABIL-003' }, { cardId: 'ABIL-002' }] },
    });
    const bearer = characterAt(state, 'p1', 0); // ABIL-003, +1000 to the others
    const ally = characterAt(state, 'p1', 1); // ABIL-002, printed 2000

    expect(getPower(state, ally)).toBe(3000);
    // excludeSelf: the bearer does not buff itself.
    expect(getPower(state, bearer)).toBe(3000);
    // And nothing was written to make that true.
    expect(state.modifiers).toEqual([]);
    expect(state.stack).toEqual([]);
  });

  it('drops back to base the moment the source leaves, with no cleanup step', () => {
    const withSource = buildScenario({
      decks: abilityDecks,
      p1: { characters: [{ cardId: 'ABIL-003' }, { cardId: 'ABIL-002' }] },
    });
    const ally = characterAt(withSource, 'p1', 1);
    expect(getPower(withSource, ally)).toBe(3000);

    const withoutSource = buildScenario({
      decks: abilityDecks,
      p1: { characters: [{ cardId: 'ABIL-002' }] },
    });
    const lonely = characterAt(withoutSource, 'p1', 0);
    expect(getPower(withoutSource, lonely)).toBe(2000);
    expect(getBasePower(withoutSource, lonely)).toBe(2000);
    expect(withoutSource.modifiers).toEqual([]);
  });

  it('stacks statics from several sources, including a stage', () => {
    const state = buildScenario({
      decks: abilityDecks,
      p1: {
        characters: [{ cardId: 'ABIL-003' }, { cardId: 'ABIL-002' }],
        stage: 'ABIL-024',
      },
    });
    const ally = characterAt(state, 'p1', 1);
    // 2000 printed + 1000 from ABIL-003 + 1000 from the ABIL-024 stage.
    expect(getPower(state, ally)).toBe(4000);
    expect(state.modifiers).toEqual([]);
  });

  it('does not leak across players', () => {
    const state = buildScenario({
      decks: abilityDecks,
      p1: { characters: [{ cardId: 'ABIL-003' }] },
      p2: { characters: [{ cardId: 'ABIL-002' }] },
    });
    expect(getPower(state, characterAt(state, 'p2', 0))).toBe(2000);
  });

  it('counts attached DON and static buffs together', () => {
    const state = buildScenario({
      decks: abilityDecks,
      p1: {
        activeDon: 4,
        characters: [{ cardId: 'ABIL-003' }, { cardId: 'ABIL-002', attachedDon: 2 }],
      },
    });
    const ally = characterAt(state, 'p1', 1);
    expect(getBasePower(state, ally)).toBe(4000); // 2000 + 2 DON
    expect(getPower(state, ally)).toBe(5000); // + the static
  });
});

describe('continuous keywords', () => {
  it('grants Blocker to the characters its selector covers, and only those', () => {
    const state = buildScenario({
      decks: abilityDecks,
      p1: {
        characters: [
          { cardId: 'ABIL-004' }, // grants blocker to your cost<=2 characters
          { cardId: 'ABIL-002' }, // cost 2 - covered
          { cardId: 'ABIL-005' }, // cost 3 - not covered
        ],
      },
    });
    expect(hasKeyword(state, characterAt(state, 'p1', 1), 'blocker')).toBe(true);
    expect(hasKeyword(state, characterAt(state, 'p1', 2), 'blocker')).toBe(false);
    // excludeSelf again: the source does not grant to itself.
    expect(hasKeyword(state, characterAt(state, 'p1', 0), 'blocker')).toBe(false);
    expect(state.modifiers).toEqual([]);
  });

  it('lets a granted Blocker actually block', () => {
    const staged = buildScenario({
      decks: abilityDecks,
      turn: 3,
      p1: { characters: [{ cardId: 'ABIL-005' }] },
      // ABIL-004 grants Blocker to p2's cost<=2 characters; ABIL-002 is one and
      // has no printed Blocker of its own.
      p2: { characters: [{ cardId: 'ABIL-004' }, { cardId: 'ABIL-002' }] },
    });
    const attacking = applyOk(staged, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: characterAt(staged, 'p1', 0),
      target: staged.players.p2.leader,
    }).state;

    const blocks = legalActions(attacking, 'p2')
      .filter((a) => a.type === 'DECLARE_BLOCK')
      .map((a) => (a.type === 'DECLARE_BLOCK' ? a.blocker : ''));
    expect(blocks).toEqual([characterAt(attacking, 'p2', 1)]);
  });

  it('reads printed keywords through the same function', () => {
    const state = buildScenario({
      decks: abilityDecks,
      p1: { characters: [{ cardId: 'ABIL-008' }, { cardId: 'ABIL-006' }, { cardId: 'ABIL-007' }] },
    });
    expect(hasKeyword(state, characterAt(state, 'p1', 0), 'blocker')).toBe(true);
    expect(hasKeyword(state, characterAt(state, 'p1', 1), 'doubleAttack')).toBe(true);
    expect(hasKeyword(state, characterAt(state, 'p1', 2), 'banish')).toBe(true);
    expect(hasKeyword(state, characterAt(state, 'p1', 0), 'rush')).toBe(false);
  });
});

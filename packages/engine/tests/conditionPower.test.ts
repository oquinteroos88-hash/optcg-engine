import { describe, expect, it } from 'vitest';
import { getPower, getPowerWithoutStatics, legalActions } from '../src/index.js';
import type { GameState, InstanceId } from '../src/index.js';
import { assertInvariants } from '../src/invariants.js';
import { ABIL_DECK } from '../src/testdata/abilityDecks.js';
import { buildScenario, characterAt, handCard } from '../src/testdata/scenarios.js';
import { applyFail, applyOk, cloneWith } from './helpers.js';

/**
 * A power Condition and a power Selector see the same number in the same
 * state.
 *
 * The rules know a single power value per card, made higher or lower than
 * printed by effects (CR 2-6-3), and an activation condition holds or not
 * against the state as it is (8-4-1-1). Before the fix these tests pin, the
 * three condition-check sites read the without-statics value while `if` and
 * `select` read `getPower` — so a character buffed over a threshold by someone
 * else's continuous effect satisfied the script's selector and failed the
 * ability's condition. Same board, same magnitude, two answers.
 *
 * The deliberate exception — a static whose own condition asks about power,
 * where the recursion guard is real — is declared in
 * docs/trigger-reachability.md (backlog A, OP06-002) and not tested here.
 */

const decks = { p1: ABIL_DECK, p2: ABIL_DECK };

/** Nothing is left half-resolved and the state is still sound. */
function assertSettled(state: GameState): void {
  expect(state.pending).toBeNull();
  expect(state.stack).toEqual([]);
  expect(state.resume).toEqual([]);
  assertInvariants(state);
}

function answer(
  state: GameState,
  player: 'p1' | 'p2',
  payload: { kind: 'cards'; selected: InstanceId[] },
): GameState {
  const pending = state.pending;
  if (pending === null) {
    throw new Error('expected an open choice');
  }
  return applyOk(state, {
    type: 'ANSWER_CHOICE',
    player,
    choiceId: pending.id,
    answer: payload,
  }).state;
}

/**
 * ABIL-025 next to ABIL-009 (printed 3000, pushed to 4000 by ABIL-003's
 * static) — the only card on the field that clears the 4000 gate, and only
 * with the static counted.
 */
function buffedBoard(): GameState {
  return buildScenario({
    decks,
    p1: {
      characters: [{ cardId: 'ABIL-025' }, { cardId: 'ABIL-009' }, { cardId: 'ABIL-003' }],
    },
  });
}

describe('ABIL-025 — a power condition and a power selector agree', () => {
  it('sees the same buffed number from the condition and the script selector', () => {
    const state = buffedBoard();
    const source = characterAt(state, 'p1', 0);
    const ally = characterAt(state, 'p1', 1);

    // The 4000 threshold sits between the two readings: real only with the
    // static counted.
    expect(getPower(state, ally)).toBe(4000);
    expect(getPowerWithoutStatics(state, ally)).toBe(3000);

    // The condition opens the gate...
    expect(
      legalActions(state, 'p1').some(
        (a) => a.type === 'ACTIVATE_ABILITY' && a.instanceId === source,
      ),
    ).toBe(true);

    // ...and the script's select — the same selector in the same state —
    // offers exactly the card the condition counted.
    const activated = applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: source,
      abilityId: 'ABIL-025-main',
    }).state;
    expect(activated.pending?.kind).toBe('selectCards');
    expect(activated.pending?.candidates).toEqual([ally]);
  });

  it('resolves onto the chosen character until end of turn', () => {
    const state = buffedBoard();
    const source = characterAt(state, 'p1', 0);
    const ally = characterAt(state, 'p1', 1);
    const activated = applyOk(state, {
      type: 'ACTIVATE_ABILITY',
      player: 'p1',
      instanceId: source,
      abilityId: 'ABIL-025-main',
    }).state;

    const done = answer(activated, 'p1', { kind: 'cards', selected: [ally] });
    expect(getPower(done, ally)).toBe(5000);
    expect(done.modifiers).toHaveLength(1);
    expect(done.cards[source]?.usedThisTurn).toEqual(['ABIL-025-main']);
    assertSettled(done);
  });

  it('stops being offered the moment the continuous source leaves the field', () => {
    const state = buffedBoard();
    const source = characterAt(state, 'p1', 0);
    const bearer = characterAt(state, 'p1', 2);
    const gone = cloneWith(state, (draft) => {
      draft.players.p1.characters = draft.players.p1.characters.filter((id) => id !== bearer);
      draft.players.p1.trash.push(bearer);
      const card = draft.cards[bearer];
      if (card !== undefined) {
        card.playedOnTurn = null; // off-field cards are normalized
      }
    });
    assertInvariants(gone);

    const ally = characterAt(gone, 'p1', 1);
    expect(getPower(gone, ally)).toBe(3000);
    expect(legalActions(gone, 'p1').filter((a) => a.type === 'ACTIVATE_ABILITY')).toEqual([]);
    expect(
      applyFail(gone, {
        type: 'ACTIVATE_ABILITY',
        player: 'p1',
        instanceId: source,
        abilityId: 'ABIL-025-main',
      }),
    ).toBe('abilityConditionUnmet');
  });

  it('gates an onPlay trigger the same way while the buff holds', () => {
    const staged = buildScenario({
      decks,
      p1: {
        activeDon: 2,
        hand: ['ABIL-025'],
        characters: [{ cardId: 'ABIL-009' }, { cardId: 'ABIL-003' }],
      },
    });
    const card = handCard(staged, 'p1', 'ABIL-025');
    const handBefore = staged.players.p1.hand.length;
    const deckBefore = staged.players.p1.deck.length;
    const drawnCard = staged.players.p1.deck[0];

    const done = applyOk(staged, { type: 'PLAY_CARD', player: 'p1', instanceId: card }).state;

    // -1 played, +1 drawn by the gated onPlay.
    expect(done.players.p1.hand).toHaveLength(handBefore);
    expect(done.players.p1.hand).toContain(drawnCard);
    expect(done.players.p1.deck).toHaveLength(deckBefore - 1);
    assertSettled(done);
  });

  it('does not fire the trigger once the buff is gone', () => {
    const staged = buildScenario({
      decks,
      p1: { activeDon: 2, hand: ['ABIL-025'], characters: [{ cardId: 'ABIL-009' }] },
    });
    const card = handCard(staged, 'p1', 'ABIL-025');
    const handBefore = staged.players.p1.hand.length;
    const deckBefore = staged.players.p1.deck.length;

    const done = applyOk(staged, { type: 'PLAY_CARD', player: 'p1', instanceId: card }).state;

    // The condition fails silently: no draw, nothing suspended.
    expect(done.players.p1.hand).toHaveLength(handBefore - 1);
    expect(done.players.p1.deck).toHaveLength(deckBefore);
    assertSettled(done);
  });
});

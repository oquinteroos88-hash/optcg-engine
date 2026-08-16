import { describe, expect, it } from 'vitest';
import { applyAction } from '@optcg/engine';
import type { GameState, InstanceId } from '@optcg/engine';
import { ABIL_DECK } from '@optcg/engine/testdata/abilityDecks';
import { buildScenario, characterAt } from '@optcg/engine/testdata/scenarios';
import { cardAffordance, computeAffordances, getAffordances } from '../src/game/affordances';
import { ensureModeValid } from '../src/game/uiMode';

/**
 * A choice whose candidates live in the **other player's** hand.
 *
 * The chosen-discard instruction is the first thing in the engine that opens a
 * choice to the player who does not control the effect, and `OP01-038` Kanjuro
 * goes one step further: the chooser picks out of a hand that is not theirs.
 *
 * **This file's original claim was that the client needed no change for it, and
 * PR #45 found that claim was hiding a leak.** The mode did cover the case, but
 * the affordances read `state.pending` straight off the state, so the hot-seat
 * chooser was shown Kanjuro's opponent's actual hand — face up, in an overlay.
 * CR 8-4-4-2 does not care whether the table is shared or networked: choosing
 * "unrevealed cards in a secret area" means choosing without seeing them.
 * Routing the hot-seat affordances through `playerView` — the same redaction a
 * networked seat gets — is what closed it, and what the cases below now pin:
 * the chooser gets a **count of handles**, never identities.
 *
 * It is checked rather than asserted in a comment, which is the same trade
 * `choiceShapes.test.ts` makes: the mode reads plausible either way, and a
 * plausible-looking mode that silently offers the wrong player a decision is
 * exactly the bug the engine's `notYourPriority` gate would then hide.
 *
 * The starter corpus cannot reach this — ST-01 and ST-02 print no such card — so
 * the position is staged from the engine's own ABIL set, the way the affordance
 * tests reach any ability the starter decks do not have.
 */

const decks = { p1: ABIL_DECK, p2: ABIL_DECK };

/**
 * p2's Scavenger dies to p1's attack. `ABIL-002`'s `[On K.O.]` is Kanjuro's
 * shape: controller p2, so `owner` is p2's hand and `chooser` is p1.
 */
function crossSideChoice(): GameState {
  const staged = buildScenario({
    decks,
    p1: { characters: [{ cardId: 'ABIL-012' }], activeDon: 4 },
    p2: { characters: [{ cardId: 'ABIL-002', orientation: 'rested' }], activeDon: 4 },
  });
  let state = staged;
  for (const action of [
    {
      type: 'DECLARE_ATTACK' as const,
      player: 'p1' as const,
      attacker: characterAt(staged, 'p1', 0),
      target: characterAt(staged, 'p2', 0),
    },
    { type: 'PASS' as const, player: 'p2' as const },
    { type: 'PASS' as const, player: 'p2' as const },
  ]) {
    const result = applyAction(state, action);
    if (!result.ok) {
      throw new Error(`staging failed (${result.reason})`);
    }
    state = result.state;
  }
  return state;
}

describe('a choice over the opponent’s hand needs no new UI mode', () => {
  const state = crossSideChoice();

  it('is really the cross-side shape, or the rest of this file proves nothing', () => {
    expect(state.pending?.sink).toEqual({ kind: 'discard', owner: 'p2' });
    expect(state.pending?.player).toBe('p1');
    expect(state.priority).toBe('p1');
    expect(state.pending?.candidates).toEqual(state.players.p2.hand);
  });

  it('gives the chooser the choice and the owner nothing', () => {
    const chooser = computeAffordances(state, 'p1');
    const owner = computeAffordances(state, 'p2');

    expect(chooser.global.mustAnswerChoice).toBe(true);
    // Blind: a count of backs, and not one id of the hand being chosen from.
    expect(chooser.pendingChoice?.blindHandles).toBe(state.players.p2.hand.length);
    expect(chooser.pendingChoice?.candidates).toEqual([]);
    // The owner of the cards is not the one being asked, so the client publishes
    // nothing to them — the same guard that keeps a life `[Trigger]` private to
    // the damaged player.
    expect(owner.global.mustAnswerChoice).toBe(false);
    expect(owner.pendingChoice).toBeNull();
    expect(owner.global.canConcede).toBe(true);
  });

  it('imposes answeringChoice on the chooser, from any mode', () => {
    const fromIdle = ensureModeValid({ kind: 'idle' }, getAffordances(state));
    expect(fromIdle).toMatchObject({ kind: 'answeringChoice', owner: 'p1' });

    // And it cannot be escaped by a mode that was open when the choice landed.
    const fromAttacking = ensureModeValid(
      { kind: 'attacking', owner: 'p1', attacker: characterAt(state, 'p1', 0) },
      getAffordances(state),
    );
    expect(fromAttacking).toMatchObject({ kind: 'answeringChoice', owner: 'p1' });
  });

  it('names not one card of the hand it is choosing from', () => {
    // The sharp version of the claim above, checked the way the engine's own
    // leak test checks a view: search the serialized affordances for every id
    // in the hand. A back with a name printed on it is not a back.
    const aff = computeAffordances(state, 'p1');
    const json = JSON.stringify(aff);
    const hand: readonly InstanceId[] = state.players.p2.hand;
    expect(hand.length).toBeGreaterThan(0);
    for (const id of hand) {
      expect(json).not.toContain(`"${id}"`);
    }
    // And what it does publish is enough to answer with: N positions.
    expect(aff.pendingChoice?.blindHandles).toBe(hand.length);
  });

  it('offers the chooser no other affordance while it holds', () => {
    // `legalActions` returns the marker plus CONCEDE, so nothing else can be
    // indexed. Stated here because it is what makes the imposed mode safe.
    const aff = computeAffordances(state, 'p1');
    expect(aff.global.canEndTurn).toBe(false);
    expect(aff.global.canPass).toBe(false);
    for (const id of Object.keys(state.cards)) {
      const card = cardAffordance(aff, id);
      expect(card.canPlay).toBe(false);
      expect(card.canAttack).toBe(false);
    }
  });

  it('renders the prompt from the chooser’s side of the table', () => {
    // Derived rather than printed on the instruction, so it reads correctly to
    // whoever is asked: the chooser is not the owner here, and the text says so.
    expect(computeAffordances(state, 'p1').pendingChoice?.prompt).toBe(
      "Choose 1 card from your opponent's hand to trash",
    );
  });
});

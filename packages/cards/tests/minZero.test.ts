import { describe, expect, it } from 'vitest';
import { getPower } from '@optcg/engine';
import type { GameState, InstanceId } from '@optcg/engine';
import { characterAt, handCard } from '@optcg/engine/testdata/scenarios';
import { answer, applyOk, assertSettled, optIn, run, starterScenario } from './support.js';

/**
 * `select` with `min: 0` — the "up to" quantifier.
 *
 * Fifteen of the twenty-six cards with text in these two decks say "up to", and
 * four of the five scripted here do. Until this file existed the path was
 * verified by reading only: no ability in the engine's own ABIL set uses
 * `min: 0`, so nothing ever answered a card choice with nothing.
 *
 * There are two distinct ways for an "up to" to come out empty, and they run
 * through different code:
 *
 * - **Candidates exist and the player takes none.** The interpreter suspends,
 *   the answer arrives as an empty list, and the variable holds `[]`.
 * - **No candidate exists at all.** `suspend()` never opens a choice: it writes
 *   `[]` and returns false, and the cursor steps past on the spot.
 *
 * Both have to degrade to a clean no-op, and both are asserted here.
 */

// ---------------------------------------------------------------------------
// Candidates exist, the player declines to use them
// ---------------------------------------------------------------------------

describe('an empty selection resolves as a no-op', () => {
  it('ST01-005 Jinbe — nobody is boosted, the attack carries on', () => {
    const staged = starterScenario({
      p1: {
        activeDon: 4,
        characters: [{ cardId: 'ST01-005', attachedDon: 1 }, { cardId: 'ST01-010' }],
      },
    });
    const jinbe = characterAt(staged, 'p1', 0);
    const ally = characterAt(staged, 'p1', 1);
    const attacking = applyOk(staged, {
      type: 'DECLARE_ATTACK',
      player: 'p1',
      attacker: jinbe,
      target: staged.players.p2.leader,
    }).state;
    expect(attacking.pending?.min).toBe(0);

    const done = answer(attacking, 'p1', { kind: 'cards', selected: [] });

    expect(done.modifiers).toEqual([]);
    expect(getPower(done, ally)).toBe(getPower(staged, ally));
    // The script is over, but the battle it interrupted is still there.
    expect(done.battle?.step).toBe('block');
    assertSettled(done);
  });

  it('ST01-014 Guard Point — the [Trigger] is accepted and then spends itself on nothing', () => {
    const staged = starterScenario({
      firstPlayer: 'p2',
      p1: { lifeCards: ['ST01-014', 'ST01-003', 'ST01-008', 'ST01-009', 'ST01-011'] },
      p2: { characters: [{ cardId: 'ST02-006' }] },
    });
    const damaged = run(
      staged,
      {
        type: 'DECLARE_ATTACK',
        player: 'p2',
        attacker: characterAt(staged, 'p2', 0),
        target: staged.players.p1.leader,
      },
      { type: 'PASS', player: 'p1' },
      { type: 'PASS', player: 'p1' },
    );
    const targeting = optIn(damaged, 'p1', true);
    const done = answer(targeting, 'p1', { kind: 'cards', selected: [] });

    expect(done.modifiers).toEqual([]);
    expect(getPower(done, done.players.p1.leader)).toBe(5000);
    assertSettled(done);
  });

  it('ST01-015 Gum-Gum Jet Pistol — nothing is K.O.d, the event is still spent', () => {
    const staged = starterScenario({
      p1: { activeDon: 4, hand: ['ST01-015'] },
      p2: { characters: [{ cardId: 'ST02-002' }] },
    });
    const event = handCard(staged, 'p1', 'ST01-015');
    const victim = characterAt(staged, 'p2', 0);
    const played = applyOk(staged, { type: 'PLAY_CARD', player: 'p1', instanceId: event }).state;
    const done = answer(played, 'p1', { kind: 'cards', selected: [] });

    expect(done.players.p2.characters).toEqual([victim]);
    expect(done.players.p2.trash).toEqual([]);
    // Declining the target does not give the card back.
    expect(done.players.p1.trash).toContain(event);
    assertSettled(done);
  });

  it('ST02-009 Trafalgar Law — the rested crewmate stays rested', () => {
    const staged = starterScenario({
      firstPlayer: 'p2',
      p2: {
        activeDon: 6,
        hand: ['ST02-009'],
        characters: [{ cardId: 'ST02-012', orientation: 'rested' }],
      },
    });
    const law = handCard(staged, 'p2', 'ST02-009');
    const bepo = characterAt(staged, 'p2', 0);
    const played = applyOk(staged, { type: 'PLAY_CARD', player: 'p2', instanceId: law }).state;
    const done = answer(played, 'p2', { kind: 'cards', selected: [] });

    expect(done.cards[bepo]?.orientation).toBe('rested');
    // Law is on the field either way: the effect resolving to nothing is not
    // the play failing.
    expect(done.players.p2.characters).toContain(law);
    assertSettled(done);
  });
});

// ---------------------------------------------------------------------------
// No candidate exists — the interpreter never asks
// ---------------------------------------------------------------------------

describe('no candidates at all never opens a choice', () => {
  function playJetPistol(p2Characters: Array<{ cardId: string; attachedDon?: number }>): {
    state: GameState;
    event: InstanceId;
  } {
    const staged = starterScenario({
      p1: { activeDon: 4, hand: ['ST01-015'] },
      p2: { activeDon: 4, characters: p2Characters },
    });
    const event = handCard(staged, 'p1', 'ST01-015');
    return {
      state: applyOk(staged, { type: 'PLAY_CARD', player: 'p1', instanceId: event }).state,
      event,
    };
  }

  it('ST01-015 — an out-of-range Character is not a candidate, so nothing suspends', () => {
    // Vito is 5000 printed, but two DON!! put it at 7000 and out of reach of a
    // powerMax of 6000. This is the filter, not an empty board.
    const { state, event } = playJetPistol([{ cardId: 'ST02-002', attachedDon: 2 }]);

    expect(state.pending).toBeNull();
    expect(state.stack).toEqual([]);
    expect(state.players.p2.characters).toHaveLength(1);
    expect(state.players.p2.trash).toEqual([]);
    expect(state.players.p1.trash).toContain(event);
    assertSettled(state);
  });

  it('ST01-015 — an empty board is the same no-op', () => {
    const { state, event } = playJetPistol([]);

    expect(state.pending).toBeNull();
    expect(state.players.p1.trash).toContain(event);
    assertSettled(state);
  });

  it('ST02-009 — no rested crewmate, so the [On Play] passes straight through', () => {
    const staged = starterScenario({
      firstPlayer: 'p2',
      p2: {
        activeDon: 6,
        hand: ['ST02-009'],
        // Right type, wrong orientation: Bepo is already active.
        characters: [{ cardId: 'ST02-012' }],
      },
    });
    const law = handCard(staged, 'p2', 'ST02-009');
    const bepo = characterAt(staged, 'p2', 0);
    const done = applyOk(staged, { type: 'PLAY_CARD', player: 'p2', instanceId: law }).state;

    expect(done.pending).toBeNull();
    expect(done.cards[bepo]?.orientation).toBe('active');
    expect(done.players.p2.characters).toContain(law);
    assertSettled(done);
  });
});

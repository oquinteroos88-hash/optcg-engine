import { describe, expect, it } from 'vitest';
import { applyAction, getPower, legalActions, REASONS } from '@optcg/engine';
import type { Action, GameState, InstanceId, PlayerId } from '@optcg/engine';
import { answer, applyOk, assertSettled, characterAt, starterScenario } from './support.js';

/**
 * `ST01-017` Thousand Sunny — the first real card that pays with itself.
 *
 * "[Activate: Main] You may rest this Stage: Up to 1 {Straw Hat Crew} type
 * Leader or Character card on your field gains +1000 power during this turn."
 *
 * Everything here follows from two Comprehensive Rules v1.2.0 readings:
 *
 * - **A rested Stage cannot pay.** Resting is a state change, and a card
 *   already rested has none left to make — the same reason CR 7-1-1-1 has an
 *   attack rest an *active* card. Official Q&A puts "[Activate: Main] You may
 *   rest this Character:" in the same list as attacking and [Blocker] when it
 *   explains what "cannot be rested" stops. An unpayable part makes the whole
 *   activation cost unpayable (CR 8-3-1-3), so the ability is not activatable
 *   at all — which has to be visible in `legalActions`, not merely refused by
 *   `applyAction`.
 * - **The cost is paid before the effect resolves.** CR 8-4-1 pays all
 *   activation costs (8-4-1-3), then activates (8-4-1-4), then resolves
 *   (8-4-1-5).
 *
 * The card prints no `[Once Per Turn]`, and does not need one: the Stage is set
 * active again only in its controller's Refresh Phase (CR 6-2-4, which names
 * the Stage area), so the cost is the limiter.
 */

const ABILITY_ID = 'ST01-017-main';

/**
 * p1 with Thousand Sunny in the stage slot, Franky (a {Straw Hat Crew}
 * Character) and Karoo (an {Animal} {Alabasta} one) on the board. Karoo is
 * there so the type filter has something real to exclude.
 */
function sunnyBoard(): GameState {
  return starterScenario({
    p1: {
      activeDon: 4,
      stage: 'ST01-017',
      characters: [{ cardId: 'ST01-010' }, { cardId: 'ST01-003' }],
    },
    p2: { activeDon: 4 },
  });
}

function sunny(state: GameState): InstanceId {
  const id = state.players.p1.stage;
  if (id === null) {
    throw new Error('p1 has no stage');
  }
  return id;
}

function orientationOf(state: GameState, id: InstanceId): string {
  const card = state.cards[id];
  if (card === undefined) {
    throw new Error(`missing instance ${id}`);
  }
  return card.orientation;
}

function activateAction(state: GameState, player: PlayerId = 'p1'): Action {
  return { type: 'ACTIVATE_ABILITY', player, instanceId: sunny(state), abilityId: ABILITY_ID };
}

function activate(state: GameState): GameState {
  return applyOk(state, activateAction(state)).state;
}

function offersAbility(state: GameState, player: PlayerId): boolean {
  return legalActions(state, player).some(
    (action) => action.type === 'ACTIVATE_ABILITY' && action.abilityId === ABILITY_ID,
  );
}

/** The board after Sunny has paid once — the position the gate is about. */
function afterOneUse(): GameState {
  const asking = activate(sunnyBoard());
  return answer(asking, 'p1', { kind: 'cards', selected: [] });
}

describe('ST01-017 Thousand Sunny — the rest gate reaches legalActions', () => {
  it('offers the ability while the Stage is active', () => {
    expect(offersAbility(sunnyBoard(), 'p1')).toBe(true);
  });

  it('does not offer it once the Stage is rested', () => {
    const used = afterOneUse();
    expect(orientationOf(used, sunny(used))).toBe('rested');
    expect(offersAbility(used, 'p1')).toBe(false);
  });

  it('rejects the action with abilityCostUnpayable if a caller sends it anyway', () => {
    // The contract between the two: everything `legalActions` withholds,
    // `applyAction` refuses, and it names which rule was broken.
    const used = afterOneUse();
    const result = applyAction(used, activateAction(used));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(REASONS.abilityCostUnpayable);
    }
  });
});

describe('ST01-017 Thousand Sunny — paying and resolving', () => {
  it('rests the Stage, and the Stage is already rested when the choice opens', () => {
    // The payment order made observable with the printed card: the effect has
    // begun — it is asking its question — and the cost is already spent.
    const staged = sunnyBoard();
    const stage = sunny(staged);
    expect(orientationOf(staged, stage)).toBe('active');

    const asking = activate(staged);

    expect(asking.pending?.kind).toBe('selectCards');
    expect(asking.pending?.player).toBe('p1');
    expect(orientationOf(asking, stage)).toBe('rested');
  });

  it('gives +1000 to a chosen {Straw Hat Crew} Character until the end of the turn', () => {
    const staged = sunnyBoard();
    const franky = characterAt(staged, 'p1', 0);
    const before = getPower(staged, franky);

    const asking = activate(staged);
    const done = answer(asking, 'p1', { kind: 'cards', selected: [franky] });

    expect(getPower(done, franky)).toBe(before + 1000);
    assertSettled(done);

    // "During this turn" — gone once the turn ends, and the Stage is active
    // again by the time p1 could use it next.
    const p2Turn = applyOk(done, { type: 'END_TURN', player: 'p1' }).state;
    expect(getPower(p2Turn, franky)).toBe(before);
    expect(p2Turn.modifiers).toEqual([]);
  });

  it('also takes the Leader, which the printed text names', () => {
    // "Leader or Character card", not "Character" — and the ST-01 Leader is a
    // {Straw Hat Crew}.
    const staged = sunnyBoard();
    const leader = staged.players.p1.leader;
    const before = getPower(staged, leader);

    const done = answer(activate(staged), 'p1', { kind: 'cards', selected: [leader] });

    expect(getPower(done, leader)).toBe(before + 1000);
    assertSettled(done);
  });

  it('offers only {Straw Hat Crew} cards as candidates', () => {
    const staged = sunnyBoard();
    const karoo = characterAt(staged, 'p1', 1);
    const asking = activate(staged);

    expect(asking.pending?.candidates).toEqual([
      staged.players.p1.leader,
      characterAt(staged, 'p1', 0),
    ]);
    expect(asking.pending?.candidates).not.toContain(karoo);
    // The Stage itself is a {Straw Hat Crew} card on the field, and the text
    // says "Leader or Character card" — so it is not a target for its own buff.
    expect(asking.pending?.candidates).not.toContain(sunny(staged));
  });

  it('resolves to nothing on an empty selection, with the cost still spent', () => {
    // "Up to 1" includes 0 (CR 4-8-1, 8-4-4-1). Choosing nothing is a complete
    // resolution — no stack, no pending, no modifier — and it is not a refund:
    // the Stage stays rested.
    const staged = sunnyBoard();
    const asking = activate(staged);

    const done = answer(asking, 'p1', { kind: 'cards', selected: [] });

    expect(done.modifiers).toEqual([]);
    expect(orientationOf(done, sunny(done))).toBe('rested');
    expect(done.pending).toBeNull();
    expect(done.stack).toEqual([]);
    expect(done.resume).toEqual([]);
    assertSettled(done);
  });
});

describe('ST01-017 Thousand Sunny — the cost is the once-per-turn', () => {
  it('stays rested through the opponent turn and returns at p1 Refresh', () => {
    const used = afterOneUse();
    const stage = sunny(used);

    const p2Turn = applyOk(used, { type: 'END_TURN', player: 'p1' }).state;
    expect(p2Turn.activePlayer).toBe('p2');
    expect(orientationOf(p2Turn, stage)).toBe('rested');
    // p2 could never activate it — it is not their card — but the orientation
    // is the reason it is not on anyone's list.
    expect(offersAbility(p2Turn, 'p2')).toBe(false);

    const p1Again = applyOk(p2Turn, { type: 'END_TURN', player: 'p2' }).state;
    expect(p1Again.activePlayer).toBe('p1');
    expect(orientationOf(p1Again, stage)).toBe('active');
    expect(offersAbility(p1Again, 'p1')).toBe(true);

    // Usable again, not merely offered.
    const franky = characterAt(p1Again, 'p1', 0);
    const before = getPower(p1Again, franky);
    const done = answer(activate(p1Again), 'p1', { kind: 'cards', selected: [franky] });
    expect(getPower(done, franky)).toBe(before + 1000);
    assertSettled(done);
  });
});

describe('a continuous ability on a rested card still applies', () => {
  it('keeps ST01-013 Roronoa Zoro at +1000 while he is rested', () => {
    // The rules question this change had to settle before the gate could be
    // written, because the engine treating rested as a shutdown would be a
    // latent bug this PR would have exposed rather than caused.
    //
    // CR 4-4-1 defines active and rested as nothing more than which way the card
    // faces; 4-4-2 carves out only given DON!!. A permanent effect is valid
    // while its own stated conditions hold (CR 8-1-3-3-2), and the conditions
    // the rules enumerate are [DON!! xX], [Your Turn] and [Opponent's Turn]
    // (CR 8-3-2). Orientation is not among them. Resting is a state, not a
    // deactivation.
    const staged = starterScenario({
      p1: {
        activeDon: 4,
        characters: [
          { cardId: 'ST01-013', orientation: 'rested', attachedDon: 1 },
          { cardId: 'ST01-013', attachedDon: 1 },
        ],
      },
    });
    const rested = characterAt(staged, 'p1', 0);
    const active = characterAt(staged, 'p1', 1);

    // `[DON!! x1] This Character gains +1000 power`, printed 5000: both are at
    // 5000 + 1000 for the attached DON!! + 1000 from their own static.
    expect(getPower(staged, rested)).toBe(7000);
    expect(getPower(staged, active)).toBe(getPower(staged, rested));
  });
});

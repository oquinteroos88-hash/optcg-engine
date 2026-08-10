import { describe, expect, it } from 'vitest';
import { getPower, getPowerWithoutStatics, legalActions, REASONS } from '../src/index.js';
import type { Action, GameState, InstanceId } from '../src/index.js';
import { assertInvariants } from '../src/invariants.js';
import { ABIL_DECK } from '../src/testdata/abilityDecks.js';
import { buildScenario, characterAt } from '../src/testdata/scenarios.js';
import { applyFail, applyOk } from './helpers.js';

/**
 * The `restSelf` cost: "rest this card" as the price of its own ability.
 *
 * ABIL-024 is the Stage that carries it, which is the shape the real card has
 * (`ST01-017` Thousand Sunny). Two rules decide everything below, both read off
 * the Comprehensive Rules v1.2.0:
 *
 * - **A rested source cannot pay.** Resting is a state change and a rested card
 *   has none to make, exactly as CR 7-1-1-1 has an attack rest an *active*
 *   card. An unpayable part makes the whole activation cost unpayable
 *   (CR 8-3-1-3), so the ability is not activatable — and because
 *   `legalActions` asks `canPayCosts`, that shows up in the enumeration and not
 *   only in `applyAction`.
 * - **The cost is paid before the script runs.** CR 8-4-1 orders it: pay all
 *   activation costs (8-4-1-3), activate (8-4-1-4), resolve (8-4-1-5).
 *
 * The Stage also carries a continuous ability, which is the third question the
 * cost raises and the one most likely to be a latent bug: resting is a state,
 * not a deactivation, so the static must keep applying to a rested source.
 */

const decks = { p1: ABIL_DECK, p2: ABIL_DECK };

const ABILITY_ID = 'ABIL-024-main';

function assertSettled(state: GameState): void {
  expect(state.pending).toBeNull();
  expect(state.stack).toEqual([]);
  expect(state.resume).toEqual([]);
  assertInvariants(state);
}

/** The Stage on p1's field, with a Crew character beside it for the static. */
function stagedGame(stageOrientation: 'active' | 'rested' = 'active'): GameState {
  const state = buildScenario({
    decks,
    p1: { activeDon: 4, characters: [{ cardId: 'ABIL-002' }], stage: 'ABIL-024' },
  });
  if (stageOrientation === 'active') {
    return state;
  }
  // Reached by paying the cost once rather than by writing the orientation
  // directly: the rested position this suite cares about is the one the cost
  // itself produces.
  return activate(state);
}

function stageOf(state: GameState): InstanceId {
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

function activateAction(state: GameState): Action {
  return {
    type: 'ACTIVATE_ABILITY',
    player: 'p1',
    instanceId: stageOf(state),
    abilityId: ABILITY_ID,
  };
}

function activate(state: GameState): GameState {
  return applyOk(state, activateAction(state)).state;
}

function offersAbility(state: GameState, player: 'p1' | 'p2'): boolean {
  return legalActions(state, player).some(
    (action) => action.type === 'ACTIVATE_ABILITY' && action.abilityId === ABILITY_ID,
  );
}

describe('restSelf — the gate is in legalActions, not only in applyAction', () => {
  it('offers the ability while the source is active', () => {
    expect(offersAbility(stagedGame(), 'p1')).toBe(true);
  });

  it('stops offering it once the source is rested', () => {
    // The whole point of putting the check in `canPayCosts`: a UI reading
    // `legalActions` must never be handed a move the engine would refuse.
    expect(offersAbility(stagedGame('rested'), 'p1')).toBe(false);
  });

  it('rejects the action with abilityCostUnpayable when it is sent anyway', () => {
    const rested = stagedGame('rested');
    expect(applyFail(rested, activateAction(rested))).toBe(REASONS.abilityCostUnpayable);
  });
});

describe('restSelf — paying it', () => {
  it('rests the source', () => {
    const state = stagedGame();
    const stage = stageOf(state);
    expect(orientationOf(state, stage)).toBe('active');

    const done = activate(state);

    expect(orientationOf(done, stage)).toBe('rested');
    expect(
      done.log.some(
        (event) => event.type === 'orientationChanged' && event.instanceId === stage,
      ),
    ).toBe(true);
    assertSettled(done);
  });

  it('has the source already rested by the time the script runs', () => {
    // ABIL-024's script draws only if this Stage is *already* rested when the
    // condition is evaluated (CR 8-4-1-3 before 8-4-1-4/8-4-1-5). A payment that
    // leaked past the start of the script would leave the hand unchanged.
    const state = stagedGame();
    const handBefore = state.players.p1.hand.length;

    const done = activate(state);

    expect(done.players.p1.hand).toHaveLength(handBefore + 1);
    assertSettled(done);
  });

  it('pays before the ability announces itself', () => {
    // The same ordering seen from the event log, which is what a client renders:
    // the orientation change is already in the log when `abilityTriggered`
    // arrives.
    const state = stagedGame();
    const { events } = applyOk(state, activateAction(state));
    const rested = events.findIndex((event) => event.type === 'orientationChanged');
    const fired = events.findIndex(
      (event) => event.type === 'abilityTriggered' && event.abilityId === ABILITY_ID,
    );
    expect(rested).toBeGreaterThanOrEqual(0);
    expect(fired).toBeGreaterThan(rested);
  });
});

describe('restSelf — the cost is the limiter', () => {
  it('cannot be used twice in the same turn', () => {
    const once = stagedGame('rested');
    expect(offersAbility(once, 'p1')).toBe(false);
    expect(applyFail(once, activateAction(once))).toBe(REASONS.abilityCostUnpayable);
  });

  it('stays rested through the opponent turn and comes back at your Refresh', () => {
    // CR 6-2-4 names the Stage area among the areas a player sets active in
    // their own Refresh Phase — so the opponent's turn starting does nothing for
    // it, and the controller's next turn does.
    const used = stagedGame('rested');
    const stage = stageOf(used);

    const opponentTurn = applyOk(used, { type: 'END_TURN', player: 'p1' }).state;
    expect(opponentTurn.activePlayer).toBe('p2');
    expect(orientationOf(opponentTurn, stage)).toBe('rested');
    expect(offersAbility(opponentTurn, 'p2')).toBe(false);

    const backToP1 = applyOk(opponentTurn, { type: 'END_TURN', player: 'p2' }).state;
    expect(backToP1.activePlayer).toBe('p1');
    expect(orientationOf(backToP1, stage)).toBe('active');
    expect(offersAbility(backToP1, 'p1')).toBe(true);

    // And it really is usable again, not merely offered.
    const again = activate(backToP1);
    expect(orientationOf(again, stage)).toBe('rested');
    assertSettled(again);
  });
});

describe('restSelf — a continuous ability on a rested source still applies', () => {
  it('keeps granting power after the Stage rests itself to pay', () => {
    // CR 4-4-1 defines active and rested as nothing but the card's position;
    // 4-4-2 carves out only given DON!!. A permanent effect is valid while its
    // stated conditions hold (CR 8-1-3-3-2), and the conditions the rules
    // enumerate are [DON!! xX], [Your Turn] and [Opponent's Turn] (CR 8-3-2) —
    // orientation is not among them. So resting is a state, not a shutdown.
    const state = stagedGame();
    const crew = characterAt(state, 'p1', 0);
    const buffed = getPower(state, crew);
    expect(buffed).toBe(getPowerWithoutStatics(state, crew) + 1000);

    const done = activate(state);

    expect(orientationOf(done, stageOf(done))).toBe('rested');
    expect(getPower(done, crew)).toBe(buffed);
    assertSettled(done);
  });
});

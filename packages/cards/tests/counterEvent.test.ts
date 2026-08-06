import { describe, expect, it } from 'vitest';
import { legalActions } from '@optcg/engine';
import { characterAt, handCard } from '@optcg/engine/testdata/scenarios';
import { applyOk, starterScenario } from './support.js';
import { englishCards } from '../src/index.js';

/**
 * Why ST01-014's `[Counter]` half is not written.
 *
 * `docs/starter-card-inventory.md` put Guard Point in pile A on the strength of
 * the DSL alone, and for the script that is right: "up to 1 of your Leader or
 * Character cards gains +3000 power during this battle" is a `select` and an
 * `addPower`, nothing more. What the inventory did not check is whether a real
 * card can ever *reach* the `counterEvent` trigger.
 *
 * It cannot. `legalActions` offers PLAY_COUNTER only for a card with a printed
 * Counter value, and `applyPlayCounter` throws on a card without one — the
 * printed value is the amount the counter adds, so a card without it has
 * nothing to add. Every `[Counter]` ability in the game is on an Event, and no
 * Event is printed with a Counter value: playing one is a different move, with
 * its own cost, that the engine does not have.
 *
 * These tests pin that as it stands today. They are the alarm: the day the
 * engine learns to play a Counter Event, they fail, and the `[Counter]` half of
 * Guard Point — plus Scalpel and Repel, both pile B — becomes writable.
 */

describe('the counterEvent trigger is unreachable for every real card', () => {
  it('no card in the set has both a [Counter] ability and a printed Counter value', () => {
    const counterCards = englishCards.filter((card) =>
      [card.effectText, card.triggerText].some((text) => text?.includes('[Counter]') === true),
    );

    expect(counterCards.length).toBeGreaterThan(0);
    expect(counterCards.every((card) => card.category === 'event')).toBe(true);
    // The gate `legalActions` uses. Not one of them passes it.
    expect(counterCards.filter((card) => card.counter !== null)).toEqual([]);
  });

  it('ST01-014 Guard Point is not offered during the Counter Step', () => {
    const staged = starterScenario({
      firstPlayer: 'p2',
      p1: {
        activeDon: 4,
        // Both a Counter Event and a Character with a printed Counter value,
        // so the difference between the two is visible in one hand.
        hand: ['ST01-014', 'ST01-003'],
      },
      p2: { characters: [{ cardId: 'ST02-006' }] },
    });
    const guardPoint = handCard(staged, 'p1', 'ST01-014');
    const karoo = handCard(staged, 'p1', 'ST01-003');

    const counterStep = applyOk(
      applyOk(staged, {
        type: 'DECLARE_ATTACK',
        player: 'p2',
        attacker: characterAt(staged, 'p2', 0),
        target: staged.players.p1.leader,
      }).state,
      { type: 'PASS', player: 'p1' },
    ).state;
    expect(counterStep.battle?.step).toBe('counter');

    const counters = legalActions(counterStep, 'p1').filter(
      (action) => action.type === 'PLAY_COUNTER',
    );
    const offered = counters.map((action) =>
      action.type === 'PLAY_COUNTER' ? action.instanceId : '',
    );

    // Karoo has a printed Counter of 1000 and is offered. Guard Point, whose
    // whole text is a [Counter] ability, is not.
    expect(offered).toContain(karoo);
    expect(offered).not.toContain(guardPoint);
  });
});

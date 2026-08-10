import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState, InstanceId, PlayerId } from '@optcg/engine';
import { getAffordances } from '../src/game/affordances';
import { menuOptions } from '../src/game/uiMode';
import { useStore } from '../src/store/store';

/**
 * A whole game of ST-01 against ST-02, played only through the store.
 *
 * This is the acceptance criterion of phase 2C written down. The bot below may
 * call nothing the UI cannot: `uiEvent` with the events real components fire,
 * and the four store actions the buttons are wired to. It never builds an
 * `Action`, never touches `applyAction`, and never reads `state.pending` except
 * through the affordance that publishes it — so anything it reaches, a player
 * can reach by clicking, and anything it cannot reach is unreachable in the UI.
 *
 * The sharp assertion is the console spy. `store.dispatch` logs
 * "UI bug: illegal action" and changes nothing when the engine rejects an
 * action, which makes an unsound affordance silent on the board and loud here.
 */

const SETUP = { seed: 12, deckIdP1: 'ST-01', deckIdP2: 'ST-02', firstPlayer: 'p1' as PlayerId };
const MAX_TURNS_OF_CLICKING = 4000;

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
  useStore.getState().toSetup();
});

function mustState(): GameState {
  const state = useStore.getState().gameState;
  if (state === null) {
    throw new Error('no game state');
  }
  return state;
}

/** What AnimationDriver does, without the timers. */
function drainQueue(): void {
  for (let guard = 0; guard < 500; guard += 1) {
    const head = useStore.getState().animQueue[0];
    if (head === undefined) {
      return;
    }
    useStore.getState().animTick(head.id);
  }
  throw new Error('the animation queue never drained — a pending choice would stay buried');
}

/**
 * A deterministic LCG so a failure is reproducible. Seeded per run, not per
 * step, so two runs of the same seed click the same buttons.
 */
function makeRng(seed: number): () => number {
  let state = (seed ^ 0x9e3779b9) | 0;
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) | 0;
    return (state >>> 8) % 0x7fffff;
  };
}

interface Trace {
  finished: boolean;
  /** Ability ids that resolved, from the engine's log. */
  fired: Set<string>;
  /** UiEvent kinds and store actions the bot actually used. */
  used: Set<string>;
  steps: number;
}

/**
 * One click. Returns false when there is nothing left to do, which is how the
 * loop notices a dead end rather than spinning.
 */
function step(rng: () => number, used: Set<string>): boolean {
  const store = useStore.getState();
  const state = mustState();
  if (state.status === 'finished') {
    return false;
  }
  const aff = getAffordances(state);

  if (aff.global.mustAnswerChoice) {
    const choice = aff.pendingChoice;
    if (choice === null) {
      throw new Error('mustAnswerChoice with no published choice');
    }
    if (choice.kind === 'yesNo') {
      used.add('answerYesNo');
      store.uiEvent({ kind: 'answerYesNo', value: rng() % 3 !== 0 });
      return true;
    }
    // Take a random legal count, min included: "up to N" answered with nothing
    // is a real move and has to survive the whole loop.
    const want = choice.min + (rng() % (choice.max - choice.min + 1));
    for (const id of choice.candidates.slice(0, want)) {
      used.add('toggleChoiceCandidate');
      store.uiEvent({ kind: 'toggleChoiceCandidate', instanceId: id });
    }
    used.add('confirmChoice');
    useStore.getState().uiEvent({ kind: 'confirmChoice' });
    return true;
  }

  if (aff.global.mustAnswerMulligan) {
    used.add('answerMulligan');
    store.answerMulligan(rng() % 2 === 0);
    return true;
  }

  // Everything a card offers, as the board offers it: one entry per card that
  // has at least one option, plus the DON area and the global buttons.
  const cards = Object.keys(aff.byCard).filter((id) => menuOptions(aff, id).length > 0);
  const choices: (() => void)[] = [];
  for (const id of cards) {
    choices.push(() => clickCard(id, rng, used));
  }
  if (Object.values(aff.byCard).some((card) => card.canReceiveDon)) {
    choices.push(() => {
      used.add('clickDonArea');
      useStore.getState().uiEvent({ kind: 'clickDonArea' });
      const target = Object.entries(getAffordances(mustState()).byCard).find(
        ([, card]) => card.canReceiveDon,
      );
      if (target !== undefined) {
        useStore.getState().uiEvent({ kind: 'clickFieldCard', instanceId: target[0], mine: true });
      }
    });
  }
  if (aff.global.canPass) {
    choices.push(() => {
      used.add('pass');
      useStore.getState().pass();
    });
  }
  // End turn only as a last resort, so a game is played rather than skipped.
  if (choices.length === 0) {
    if (!aff.global.canEndTurn) {
      return false;
    }
    used.add('endTurn');
    store.endTurn();
    return true;
  }
  const pick = choices[rng() % choices.length];
  if (pick === undefined) {
    return false;
  }
  pick();
  return true;
}

/** Clicks a card, then answers whatever the click opened. */
function clickCard(id: InstanceId, rng: () => number, used: Set<string>): void {
  const before = mustState();
  const inHand =
    before.players.p1.hand.includes(id) || before.players.p2.hand.includes(id) ? 'hand' : 'field';
  used.add(inHand === 'hand' ? 'clickHandCard' : 'clickFieldCard');
  useStore
    .getState()
    .uiEvent(
      inHand === 'hand'
        ? { kind: 'clickHandCard', instanceId: id }
        : { kind: 'clickFieldCard', instanceId: id, mine: true },
    );

  const mode = useStore.getState().ui.mode;
  if (mode.kind === 'cardMenu') {
    used.add('chooseMenuOption');
    const options = menuOptions(getAffordances(mustState()), mode.card);
    useStore.getState().uiEvent({ kind: 'chooseMenuOption', index: rng() % options.length });
  }

  // Targeting modes: pick one of the targets the affordance published.
  const after = useStore.getState().ui.mode;
  const aff = getAffordances(mustState());
  if (after.kind === 'attacking') {
    const targets = aff.byCard[after.attacker]?.attackTargets ?? [];
    const target = targets[rng() % Math.max(targets.length, 1)];
    if (target !== undefined) {
      useStore.getState().uiEvent({ kind: 'clickFieldCard', instanceId: target, mine: false });
    }
  } else if (after.kind === 'countering') {
    const targets = aff.byCard[after.counterCard]?.counterTargets ?? [];
    const target = targets[rng() % Math.max(targets.length, 1)];
    if (target !== undefined) {
      useStore.getState().uiEvent({ kind: 'clickFieldCard', instanceId: target, mine: true });
    }
  } else if (after.kind === 'choosingTrash') {
    const targets = aff.byCard[after.cardToPlay]?.trashCandidates ?? [];
    const target = targets[rng() % Math.max(targets.length, 1)];
    if (target !== undefined) {
      useStore.getState().uiEvent({ kind: 'clickFieldCard', instanceId: target, mine: true });
    }
  }
}

function playThrough(seed: number): Trace {
  useStore.getState().newGame({ ...SETUP, seed });
  const rng = makeRng(seed);
  const used = new Set<string>();
  let steps = 0;

  for (; steps < MAX_TURNS_OF_CLICKING; steps += 1) {
    // The board finishes showing what happened before anything else is clicked
    // — the same order the real driver enforces, and the reason the choice
    // overlay only appears on an empty queue.
    drainQueue();
    if (!step(rng, used)) {
      break;
    }
  }
  drainQueue();

  const state = mustState();
  const fired = new Set<string>();
  for (const event of state.log) {
    if (event.type === 'abilityTriggered') {
      fired.add(event.abilityId);
    }
  }
  return { finished: state.status === 'finished', fired, used, steps };
}

describe('a whole game of ST-01 against ST-02, clicked from end to end', () => {
  it('reaches game over without the UI ever submitting an illegal action', () => {
    const trace = playThrough(12);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(trace.finished).toBe(true);
    expect(mustState().winner).not.toBeNull();
    // A game, not a concession loop: the bot never concedes and never ends the
    // turn while it has something else to click.
    expect(trace.steps).toBeGreaterThan(60);
  });

  it('leaves nothing suspended when it ends', () => {
    playThrough(12);
    const state = mustState();
    expect(state.pending).toBeNull();
    expect(state.stack).toEqual([]);
    expect(state.resume).toEqual([]);
    expect(useStore.getState().ui.mode).toEqual({ kind: 'idle' });
  });

  it('uses every interaction the UI offers', () => {
    // If one of these is missing the corresponding control is decoration: the
    // board renders it and no game ever needs it.
    const used = new Set<string>();
    for (const seed of [12, 5, 224]) {
      for (const entry of playThrough(seed).used) {
        used.add(entry);
      }
    }
    for (const interaction of [
      'answerMulligan',
      'clickHandCard',
      'clickFieldCard',
      'clickDonArea',
      'chooseMenuOption',
      'toggleChoiceCandidate',
      'confirmChoice',
      'answerYesNo',
      'pass',
      'endTurn',
    ]) {
      expect(used, interaction).toContain(interaction);
    }
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('fires scripted abilities of every trigger kind while clicking', () => {
    // A lower bound, and deliberately not the full set of 14. What a uniform
    // clicker reaches is a matter of draws: [When Attacking] needs a specific
    // Character alive and attacking, [End of Turn] needs one surviving to the
    // end of a turn. Asserting all 14 here would be asserting a property of the
    // random policy, and it would go red the day that policy shifts by one call.
    //
    // The claim that matters - every scripted ability is reachable through the
    // UI, per ability, in a game that really fires it - is
    // `abilityReach.test.ts`. This one says the clicking bot drives the
    // machinery in a real game rather than only in a replay.
    const fired = new Set<string>();
    const reasons = new Set<string | null>();
    for (const seed of [12, 5, 99, 2, 9, 224, 20260806]) {
      for (const id of playThrough(seed).fired) {
        fired.add(id);
      }
      reasons.add(mustState().endReason);
    }
    for (const id of [
      // Activated Main abilities, reached through the contextual menu.
      'ST01-001-main',
      'ST01-007-main',
      'ST01-017-main',
      // [On Play], reached by playing the card.
      'ST01-011-onPlay',
      'ST02-009-onPlay',
      // An Event's main half, and a life-card [Trigger] half - the latter
      // answered through the choice overlay by the player taking the damage.
      'ST01-015-main',
      'ST01-015-trigger',
    ]) {
      expect(fired, id).toContain(id);
    }
    // And the games really end. A uniform clicker attaches DON!! and activates
    // abilities as readily as it attacks, so these seven run the decks out
    // rather than the Life; `lifeOut` is what the engine's own suite pins.
    expect([...reasons].sort()).toEqual(['deckOut']);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

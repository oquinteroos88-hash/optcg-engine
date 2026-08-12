import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState, InstanceId, PlayerId } from '@optcg/engine';
import { getAffordances } from '../src/game/affordances';
import { menuOptions } from '../src/game/uiMode';
import { useStore } from '../src/store/store';
import { cardinalityFor, pickByKey, rankCandidates, scoreFor } from '@optcg/engine/testing';

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

const SETUP = { seed: 82, deckIdP1: 'ST-01', deckIdP2: 'ST-02', firstPlayer: 'p1' as PlayerId };
/**
 * The same seeds the engine-level corpus uses (`tests/corpus.ts`), re-searched
 * once when the drivers stopped choosing by index. Seed 82 is the one that
 * turns a Gum-Gum Jet Pistol over as damage while clicking, which is the only
 * way this suite reaches `ST01-015-trigger`.
 */
const CLICK_SEEDS = [82, 465, 160, 9, 8, 46, 105] as const;
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
 * The clicker chooses by **stable key**, like every other driver in the repo.
 *
 * It used to run a local LCG and index into whatever array was in front of it —
 * the list of clickable cards, `menuOptions`, the published target list. All
 * three renumber when a card gains an ability, so this suite's seven pinned
 * seeds were as fragile as the engine-level ones even though it never touches
 * `legalActions`. It is the driver the "there are three" count missed.
 *
 * The keys are UI-shaped rather than `Action`-shaped, because that is this
 * bot's action space: it may call nothing a player cannot. The *scoring* is the
 * shared one, which is the part worth having in one place.
 */
function uiPick<T>(items: readonly T[], keyOf: (item: T) => string, seed: number, at: number): T | undefined {
  return pickByKey(items, keyOf, () => 0, seed, at);
}

/** A coin from the same hash, for the places the UI needs one. */
function roll(seed: number, at: number, tag: string): number {
  return scoreFor(seed, at, `ui|${tag}`);
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
function step(seed: number, at: number, used: Set<string>): boolean {
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
      store.uiEvent({ kind: 'answerYesNo', value: roll(seed, at, `yes|${choice.id}`) % 3 !== 0 });
      return true;
    }
    // The shared cardinality: `max`, exploring the rest of the range on 1
    // decision in 8. "Up to N" answered with nothing is a real move and has to
    // survive the whole loop, and this is where the loop meets it.
    const want = cardinalityFor(choice, seed, at);
    for (const id of rankCandidates(choice.candidates, seed, at).slice(0, want)) {
      used.add('toggleChoiceCandidate');
      store.uiEvent({ kind: 'toggleChoiceCandidate', instanceId: id });
    }
    used.add('confirmChoice');
    useStore.getState().uiEvent({ kind: 'confirmChoice' });
    return true;
  }

  if (aff.global.mustAnswerMulligan) {
    used.add('answerMulligan');
    store.answerMulligan(roll(seed, at, 'mulligan') % 2 === 0);
    return true;
  }

  // Everything a card offers, as the board offers it: one entry per card that
  // has at least one option, plus the DON area and the global buttons. Keyed by
  // what the control *is*, so a card gaining an ability does not renumber the
  // others.
  const controls: { key: string; run: () => void }[] = [];
  for (const id of Object.keys(aff.byCard).filter((id) => menuOptions(aff, id).length > 0)) {
    controls.push({ key: `card|${id}`, run: () => clickCard(id, seed, at, used) });
  }
  if (Object.values(aff.byCard).some((card) => card.canReceiveDon)) {
    controls.push({
      key: 'donArea',
      run: () => {
        used.add('clickDonArea');
        useStore.getState().uiEvent({ kind: 'clickDonArea' });
        const target = Object.entries(getAffordances(mustState()).byCard).find(
          ([, card]) => card.canReceiveDon,
        );
        if (target !== undefined) {
          useStore.getState().uiEvent({ kind: 'clickFieldCard', instanceId: target[0], mine: true });
        }
      },
    });
  }
  if (aff.global.canPass) {
    controls.push({
      key: 'pass',
      run: () => {
        used.add('pass');
        useStore.getState().pass();
      },
    });
  }
  // End turn only as a last resort, so a game is played rather than skipped.
  if (controls.length === 0) {
    if (!aff.global.canEndTurn) {
      return false;
    }
    used.add('endTurn');
    store.endTurn();
    return true;
  }
  const picked = uiPick(controls, (control) => control.key, seed, at);
  if (picked === undefined) {
    return false;
  }
  picked.run();
  return true;
}

/** One published target, chosen by its own id rather than by its position. */
function pickTarget(targets: readonly InstanceId[], seed: number, at: number): InstanceId | undefined {
  return uiPick(targets, (id) => `target|${id}`, seed, at);
}

/** Clicks a card, then answers whatever the click opened. */
function clickCard(id: InstanceId, seed: number, at: number, used: Set<string>): void {
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
    // Keyed by what the entry *does*. `menuOptions` already appends activated
    // abilities so existing entries keep their index, but the modulo did not
    // care: one more option moved every pick on that card anyway.
    const chosen = uiPick(
      options,
      (option) => `menu|${mode.card}|${option.kind}|${option.kind === 'activate' ? option.abilityId : ''}`,
      seed,
      at,
    );
    const index = chosen === undefined ? 0 : options.indexOf(chosen);
    useStore.getState().uiEvent({ kind: 'chooseMenuOption', index });
  }

  // Targeting modes: pick one of the targets the affordance published.
  const after = useStore.getState().ui.mode;
  const aff = getAffordances(mustState());
  if (after.kind === 'attacking') {
    const target = pickTarget(aff.byCard[after.attacker]?.attackTargets ?? [], seed, at);
    if (target !== undefined) {
      useStore.getState().uiEvent({ kind: 'clickFieldCard', instanceId: target, mine: false });
    }
  } else if (after.kind === 'countering') {
    const target = pickTarget(aff.byCard[after.counterCard]?.counterTargets ?? [], seed, at);
    if (target !== undefined) {
      useStore.getState().uiEvent({ kind: 'clickFieldCard', instanceId: target, mine: true });
    }
  } else if (after.kind === 'choosingTrash') {
    const target = pickTarget(aff.byCard[after.cardToPlay]?.trashCandidates ?? [], seed, at);
    if (target !== undefined) {
      useStore.getState().uiEvent({ kind: 'clickFieldCard', instanceId: target, mine: true });
    }
  }
}

function playThrough(seed: number): Trace {
  useStore.getState().newGame({ ...SETUP, seed });
  const used = new Set<string>();
  let steps = 0;

  for (; steps < MAX_TURNS_OF_CLICKING; steps += 1) {
    // The board finishes showing what happened before anything else is clicked
    // — the same order the real driver enforces, and the reason the choice
    // overlay only appears on an empty queue.
    drainQueue();
    if (!step(seed, steps, used)) {
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
    const trace = playThrough(SETUP.seed);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(trace.finished).toBe(true);
    expect(mustState().winner).not.toBeNull();
    // A game, not a concession loop: the bot never concedes and never ends the
    // turn while it has something else to click.
    expect(trace.steps).toBeGreaterThan(60);
  });

  it('leaves nothing suspended when it ends', () => {
    playThrough(SETUP.seed);
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
    for (const seed of CLICK_SEEDS.slice(0, 3)) {
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
    for (const seed of CLICK_SEEDS) {
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

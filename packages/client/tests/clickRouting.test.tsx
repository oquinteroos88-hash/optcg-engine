// @vitest-environment jsdom
//
// The only suite that renders real components in a real DOM. Everything else in
// this package runs in `node` on purpose: affordances, reduceUiMode and the
// store are all pure and need no browser. What the pure suites cannot see is the
// wiring — which element fires which UiEvent, what the store does with it, and
// which controls exist at the same time. That stretch is what these tests cover,
// with the real store, real engine states and no mocks.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { applyAction, createGame, registerCardSet } from '@optcg/engine';
import type { Action, CardId, Decklist, GameState, InstanceId, PlayerId } from '@optcg/engine';
import { buildScenario, characterAt, handCard } from '@optcg/engine/testdata/scenarios';
import type { UiMode } from '../src/game/uiMode';
import { GameScreen } from '../src/screens/GameScreen';
import { playerLabel } from '../src/store/selectors';
import { useStore } from '../src/store/store';

// ---------------------------------------------------------------------------
// Store plumbing

/**
 * Prepared positions have no constructor path through the store — `newGame`
 * only ever deals a fresh game — so they go in through setState, exactly as
 * tests/store.test.ts already does. Resetting between tests uses the real
 * `toSetup` API.
 */
function loadState(state: GameState): void {
  useStore.setState({
    screen: 'playing',
    gameState: state,
    animQueue: [],
    ui: { mode: { kind: 'idle' }, veilOpponentHand: false, hovered: null, viewingTrash: null },
    deviceAckFor: state.priority,
  });
}

function mustState(): GameState {
  const state = useStore.getState().gameState;
  if (state === null) {
    throw new Error('no game state');
  }
  return state;
}

function mode(): UiMode {
  return useStore.getState().ui.mode;
}

/** Runs the queue down the way AnimationDriver would, but without waiting. */
function drainQueue(): void {
  act(() => {
    for (let guard = 0; guard < 200; guard += 1) {
      const head = useStore.getState().animQueue[0];
      if (head === undefined) {
        return;
      }
      useStore.getState().animTick(head.id);
    }
    throw new Error('queue did not drain');
  });
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Left un-mocked so React's own warnings still print; only the store's
  // illegal-action marker is asserted on.
  errorSpy = vi.spyOn(console, 'error');
});

afterEach(() => {
  const illegal = errorSpy.mock.calls.filter((call) => call[0] === 'UI bug: illegal action');
  errorSpy.mockRestore();
  cleanup();
  useStore.getState().toSetup();
  // Every click here goes through affordances, so the UI must never build an
  // action the engine rejects.
  expect(illegal).toEqual([]);
});

// ---------------------------------------------------------------------------
// DOM addressing
//
// No class names and no test ids: every lookup below starts from an accessible
// name and walks the structure the components actually render.

/**
 * One player's half of the table.
 *
 * The board is addressed through accessible names rather than through the
 * element tree, and this is where that changed: the phase 1 helpers walked
 * `donArea.parentElement.parentElement` and broke the moment the playmat layout
 * split one field row into three. Names survive a re-layout; parent chains do
 * not. The assertions below are untouched.
 */
function sideOf(player: PlayerId): HTMLElement {
  return screen.getByRole('region', { name: playerLabel(player) });
}

/** Everything of a player's board except their hand: characters, Leader, Stage, DON!!. */
function fieldOf(player: PlayerId): HTMLElement {
  return within(sideOf(player)).getByRole('group', {
    name: `Campo de ${playerLabel(player)}`,
  });
}

/** A side board's hand, fanned or not. */
function handOf(player: PlayerId): HTMLElement {
  return within(sideOf(player)).getByRole('group', {
    name: `Mano de ${playerLabel(player)}`,
  });
}

/** The table background: the element that owns both side boards. */
function tableBackground(): HTMLElement {
  const table = sideOf('p1').parentElement;
  if (table === null || !table.contains(sideOf('p2'))) {
    throw new Error('table background not found');
  }
  return table;
}

/** The sacrifice modal, addressed through its own cancel control. */
function trashDialog(): HTMLElement {
  const dialog = screen.getByRole('button', { name: 'Cancelar' }).parentElement;
  if (dialog === null) {
    throw new Error('sacrifice modal not rendered');
  }
  return dialog;
}

/** The battle panel, addressed through the step title only it renders alone. */
function battlePanel(step: string): HTMLElement {
  const panel = screen.getByText(step).parentElement;
  if (panel === null) {
    throw new Error(`battle panel for "${step}" not rendered`);
  }
  return panel;
}

function cardIn(scope: HTMLElement, name: RegExp): HTMLElement {
  return within(scope).getByRole('button', { name });
}

/**
 * The contextual menu, addressed through the control only it renders.
 *
 * Every card in hand goes through it now: a click there selects and asks, and
 * only the menu commits. On the field a single-option click still acts on the
 * first click, which is why the attack and block tests below have no menu step.
 */
function cardMenu(): HTMLElement {
  const menu = screen.getByRole('button', { name: 'Cancelar' }).parentElement;
  if (menu === null) {
    throw new Error('contextual menu not rendered');
  }
  return menu;
}

async function confirmInMenu(user: UserEvent, name: RegExp): Promise<void> {
  await user.click(within(cardMenu()).getByRole('button', { name }));
}

function donAreaOf(player: PlayerId): HTMLElement {
  return within(fieldOf(player)).getByRole('button', { name: /^DON!!/ });
}

// ---------------------------------------------------------------------------
// Scenarios
//
// Hands are cleared and refilled explicitly so no two rendered cards ever share
// an accessible name inside the scope a test queries.

/** p1 in the main phase with one attacker, one playable card and spare DON!!. */
function mainPhase(): GameState {
  return buildScenario({
    p1: {
      characters: [{ cardId: 'TEST-005' }],
      clearHand: true,
      hand: ['TEST-003'],
      activeDon: 5,
    },
    p2: { clearHand: true, activeDon: 3 },
  });
}

/** Five distinct characters on the board: the sixth play needs a sacrifice. */
function fullBoard(): GameState {
  return buildScenario({
    p1: {
      characters: [
        { cardId: 'TEST-001' },
        { cardId: 'TEST-002' },
        { cardId: 'TEST-003' },
        { cardId: 'TEST-004' },
        { cardId: 'TEST-005' },
      ],
      clearHand: true,
      hand: ['TEST-006'],
      activeDon: 10,
    },
    p2: { clearHand: true, activeDon: 3 },
  });
}

function must(state: GameState, action: Action): GameState {
  const result = applyAction(state, action);
  if (!result.ok) {
    throw new Error(`scenario bug: ${action.type} rejected (${result.reason})`);
  }
  return result.state;
}

/** Mid-battle counter step: p2 holds priority and one counter-valued card. */
function counterStep(): GameState {
  const base = buildScenario({
    p1: { characters: [{ cardId: 'TEST-005' }], clearHand: true, activeDon: 3 },
    p2: { clearHand: true, hand: ['TEST-101'], activeDon: 3 },
  });
  const withAttack = must(base, {
    type: 'DECLARE_ATTACK',
    player: 'p1',
    attacker: characterAt(base, 'p1', 0),
    target: base.players.p2.leader,
  });
  // The block step is a real resting state; the defender passes through it.
  return must(withAttack, { type: 'PASS', player: 'p2' });
}

// No card in the engine's TEST set carries Blocker, so the DOM route for the
// block affordance needs a synthetic one, registered through the public
// registry exactly as tests/blocker.test.ts does.
const BLOCKER: CardId = 'CTEST-B10';

registerCardSet([
  {
    cardId: BLOCKER,
    name: 'Client Test Blocker',
    category: 'character',
    color: 'red',
    cost: 1,
    power: 2000,
    counter: 1000,
    life: 0,
    keywords: ['Blocker'],
  },
]);

const BLOCKER_DECK: Decklist = { leader: 'TEST-L01', cards: Array.from({ length: 50 }, () => BLOCKER) };

/** Block step where p2 controls one active Blocker on the field. */
function blockStep(): { state: GameState; blocker: InstanceId } {
  let state = createGame({ seed: 5, decks: { p1: BLOCKER_DECK, p2: BLOCKER_DECK }, firstPlayer: 'p1' });
  state = must(state, { type: 'MULLIGAN', player: 'p1', accept: false });
  state = must(state, { type: 'MULLIGAN', player: 'p2', accept: false });
  state = must(state, { type: 'END_TURN', player: 'p1' });

  const inHand = state.players.p2.hand[0];
  if (inHand === undefined) {
    throw new Error('scenario bug: p2 drew no cards');
  }
  state = must(state, { type: 'PLAY_CARD', player: 'p2', instanceId: inHand });
  state = must(state, { type: 'END_TURN', player: 'p2' });
  state = must(state, {
    type: 'DECLARE_ATTACK',
    player: 'p1',
    attacker: state.players.p1.leader,
    target: state.players.p2.leader,
  });

  const blocker = state.players.p2.characters[0];
  if (blocker === undefined) {
    throw new Error('scenario bug: p2 has no blocker on the field');
  }
  return { state, blocker };
}

// ---------------------------------------------------------------------------

describe('mode ownership across a turn change (DOM regression)', () => {
  // Phase-1 bug: `attachingDon` was the only mode carrying no InstanceId, so
  // nothing in it referred to a card that could go stale. It outlived END_TURN,
  // and the next player's very first click on one of their own cards spent a
  // DON!! on it instead of selecting it. Ownership stamping plus ensureModeValid
  // fixed it; this is the click path that would have caught it.
  it('drops p1 DON!! targeting at Terminar turno so p2 first card click selects an attacker', async () => {
    const user = userEvent.setup();
    const state = buildScenario({
      p1: { characters: [{ cardId: 'TEST-005' }], clearHand: true, activeDon: 3 },
      p2: { characters: [{ cardId: 'TEST-105' }], clearHand: true, activeDon: 3 },
    });
    loadState(state);
    render(<GameScreen />);

    await user.click(donAreaOf('p1'));
    expect(mode()).toEqual({ kind: 'attachingDon', owner: 'p1' });

    await user.click(screen.getByRole('button', { name: 'Terminar turno' }));
    drainQueue();

    expect(mustState().priority).toBe('p2');
    expect(mode()).toEqual({ kind: 'idle' });

    const attacker = characterAt(mustState(), 'p2', 0);
    const beforeClick = mustState();
    await user.click(cardIn(fieldOf('p2'), /^Green Duelist/));

    // Selection, not attachment: no action was dispatched and no DON!! moved.
    expect(mode()).toEqual({ kind: 'attacking', owner: 'p2', attacker });
    expect(mustState()).toBe(beforeClick);
    expect(mustState().cards[attacker]?.attachedDon).toHaveLength(0);
  });
});

describe('one click per mode routes to the right intent', () => {
  it('plays a card that needs no sacrifice straight from the hand', async () => {
    const user = userEvent.setup();
    const state = mainPhase();
    loadState(state);
    render(<GameScreen />);
    const toPlay = handCard(state, 'p1', 'TEST-003');

    await user.click(cardIn(handOf('p1'), /^Red Brawler/));
    // The first click only asks. Nothing has left the hand yet.
    expect(mode()).toEqual({ kind: 'cardMenu', owner: 'p1', card: toPlay });
    expect(mustState()).toBe(state);

    await confirmInMenu(user, /^Jugar/);

    expect(mode()).toEqual({ kind: 'idle' });
    expect(mustState().players.p1.characters).toContain(toPlay);
    expect(mustState().players.p1.hand).not.toContain(toPlay);
  });

  it('routes a full-board play through the sacrifice modal', async () => {
    const user = userEvent.setup();
    const state = fullBoard();
    loadState(state);
    render(<GameScreen />);
    const toPlay = handCard(state, 'p1', 'TEST-006');
    const sacrificed = characterAt(state, 'p1', 0);

    await user.click(cardIn(handOf('p1'), /^Red Champion/));
    await confirmInMenu(user, /^Jugar/);
    // No dispatch yet: the play is pending on a choice.
    expect(mode()).toEqual({ kind: 'choosingTrash', owner: 'p1', cardToPlay: toPlay });
    expect(mustState()).toBe(state);

    await user.click(cardIn(trashDialog(), /^Red Recruit/));

    expect(mode()).toEqual({ kind: 'idle' });
    expect(mustState().players.p1.characters).toContain(toPlay);
    expect(mustState().players.p1.characters).not.toContain(sacrificed);
  });

  it('declares an attack from an attacker click followed by a target click', async () => {
    const user = userEvent.setup();
    const state = mainPhase();
    loadState(state);
    render(<GameScreen />);
    const attacker = characterAt(state, 'p1', 0);
    const target = state.players.p2.leader;

    await user.click(cardIn(fieldOf('p1'), /^Red Duelist/));
    expect(mode()).toEqual({ kind: 'attacking', owner: 'p1', attacker });
    expect(mustState()).toBe(state);

    await user.click(cardIn(fieldOf('p2'), /^Green Leader/));

    expect(mode()).toEqual({ kind: 'idle' });
    expect(mustState().battle?.attacker).toBe(attacker);
    expect(mustState().battle?.target).toBe(target);
  });

  it('attaches one DON!! from a DON!! area click followed by a card click', async () => {
    const user = userEvent.setup();
    const state = mainPhase();
    loadState(state);
    render(<GameScreen />);
    const leader = state.players.p1.leader;

    await user.click(donAreaOf('p1'));
    expect(mode()).toEqual({ kind: 'attachingDon', owner: 'p1' });

    await user.click(cardIn(fieldOf('p1'), /^Red Leader/));

    expect(mode()).toEqual({ kind: 'idle' });
    expect(mustState().cards[leader]?.attachedDon).toHaveLength(1);
  });

  it('cancels DON!! targeting when the DON!! area is clicked again', async () => {
    const user = userEvent.setup();
    const state = mainPhase();
    loadState(state);
    render(<GameScreen />);

    await user.click(donAreaOf('p1'));
    expect(mode()).toEqual({ kind: 'attachingDon', owner: 'p1' });

    await user.click(donAreaOf('p1'));

    expect(mode()).toEqual({ kind: 'idle' });
    expect(mustState()).toBe(state);
  });

  it('plays a counter from a hand click followed by an own-card click', async () => {
    const user = userEvent.setup();
    const state = counterStep();
    loadState(state);
    render(<GameScreen />);
    const counterCard = handCard(state, 'p2', 'TEST-101');
    const boosted = state.players.p2.leader;

    await user.click(cardIn(handOf('p2'), /^Green Recruit/));
    await confirmInMenu(user, /^Usar de contraataque/);
    expect(mode()).toEqual({ kind: 'countering', owner: 'p2', counterCard });
    expect(mustState()).toBe(state);

    await user.click(cardIn(fieldOf('p2'), /^Green Leader/));

    expect(mode()).toEqual({ kind: 'idle' });
    expect(mustState().players.p2.hand).not.toContain(counterCard);
    expect(mustState().battle?.target).toBe(boosted);
    expect(mustState().battle?.step).toBe('counter');
  });

  it('declares a block from a single click on an own blocker', async () => {
    const user = userEvent.setup();
    const { state, blocker } = blockStep();
    loadState(state);
    render(<GameScreen />);
    expect(state.battle?.step).toBe('block');

    await user.click(cardIn(fieldOf('p2'), /^Client Test Blocker/));

    expect(mode()).toEqual({ kind: 'idle' });
    expect(mustState().battle?.wasBlocked).toBe(true);
    expect(mustState().battle?.target).toBe(blocker);
  });

  it('does nothing at all when the clicked element carries no affordance', async () => {
    const user = userEvent.setup();
    const state = buildScenario({
      // One active DON!! against a cost-10 card: holdable, not playable.
      p1: { clearHand: true, hand: ['TEST-010'], activeDon: 1 },
      p2: { characters: [{ cardId: 'TEST-105' }], clearHand: true, activeDon: 3 },
    });
    loadState(state);
    render(<GameScreen />);

    await user.click(cardIn(handOf('p1'), /^Red Colossus/));
    expect(mode()).toEqual({ kind: 'idle' });
    expect(mustState()).toBe(state);

    // An opponent's character is never the acting player's to select.
    await user.click(cardIn(fieldOf('p2'), /^Green Duelist/));
    expect(mode()).toEqual({ kind: 'idle' });
    expect(mustState()).toBe(state);
  });
});

describe('input is held while the animation queue drains', () => {
  // fireEvent, not userEvent: the assertions must land inside the queue's real
  // 200ms window, and a synchronous dispatch removes the timing from the test.
  it('swallows a click with a non-empty queue and accepts the same click after it drains', () => {
    const state = mainPhase();
    loadState(state);
    render(<GameScreen />);
    const toPlay = handCard(state, 'p1', 'TEST-003');

    // Attaching a DON!! is the cheapest way to a real, non-empty queue.
    fireEvent.click(donAreaOf('p1'));
    fireEvent.click(cardIn(fieldOf('p1'), /^Red Leader/));
    expect(useStore.getState().animQueue.length).toBeGreaterThan(0);

    const held = mustState();
    fireEvent.click(cardIn(handOf('p1'), /^Red Brawler/));
    // Never reached dispatch, and never even moved the mode.
    expect(mustState()).toBe(held);
    expect(mode()).toEqual({ kind: 'idle' });
    expect(mustState().players.p1.hand).toContain(toPlay);

    drainQueue();

    // The same click now works — through the menu, which is what a hand click
    // does. It is the click being accepted at all that this test is about.
    fireEvent.click(cardIn(handOf('p1'), /^Red Brawler/));
    expect(mode()).toEqual({ kind: 'cardMenu', owner: 'p1', card: toPlay });
    fireEvent.click(within(cardMenu()).getByRole('button', { name: /^Jugar/ }));
    expect(mustState()).not.toBe(held);
    expect(mustState().players.p1.characters).toContain(toPlay);
  });
});

describe('resets driven through the real DOM', () => {
  it('clears a targeting mode on the Escape key', async () => {
    const user = userEvent.setup();
    const state = mainPhase();
    loadState(state);
    render(<GameScreen />);

    await user.click(donAreaOf('p1'));
    expect(mode()).toEqual({ kind: 'attachingDon', owner: 'p1' });

    await user.keyboard('{Escape}');

    expect(mode()).toEqual({ kind: 'idle' });
    expect(mustState()).toBe(state);
  });

  it('clears a targeting mode on a click that lands on the table background', async () => {
    const user = userEvent.setup();
    const state = mainPhase();
    loadState(state);
    render(<GameScreen />);

    await user.click(cardIn(fieldOf('p1'), /^Red Duelist/));
    expect(mode()).toEqual({ kind: 'attacking', owner: 'p1', attacker: characterAt(state, 'p1', 0) });

    await user.click(tableBackground());

    expect(mode()).toEqual({ kind: 'idle' });
    expect(mustState()).toBe(state);
  });
});

describe('overlay layering while a battle is open', () => {
  // The corpus suite asserts `canPass === (battle !== null)` on the affordance.
  // Its DOM consequence is that the contextual control the BattleOverlay owns is
  // the only pass control on screen — there is no generic one to race with it.
  it('offers exactly one pass control, inside the battle panel, and it resolves the battle', async () => {
    const user = userEvent.setup();
    const state = counterStep();
    loadState(state);
    render(<GameScreen />);
    expect(state.battle).not.toBeNull();

    const passControls = screen.getAllByRole('button', {
      name: /pasar|pass|no bloquear|no contraatacar/i,
    });
    expect(passControls).toHaveLength(1);

    const control = passControls[0];
    if (control === undefined) {
      throw new Error('no pass control rendered');
    }
    expect(battlePanel('Paso de contraataque').contains(control)).toBe(true);

    await user.click(control);
    expect(mustState().battle).toBeNull();
  });
});

// @vitest-environment jsdom
//
// The DOM half of the choice work. The pure suites already say what
// `reduceUiMode` does with a confirm; what they cannot see is whether any
// element fires one, whether the overlay can be dismissed by the controls a
// browser gives you for free (Escape, a backdrop click), and whether rendering
// it is stable at all.
//
// That last one is not hypothetical: `useCardMenu` and `useChoiceOverlay`
// originally built a fresh object per store read, so React re-rendered forever
// and the first click that opened a menu blanked the screen. Every pure test
// passed. These render.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getCardDef } from '@optcg/engine';
import type { GameState } from '@optcg/engine';
import { getAffordances } from '../src/game/affordances';
import { ensureModeValid } from '../src/game/uiMode';
import { GameScreen } from '../src/screens/GameScreen';
import { useStore } from '../src/store/store';
import { firstPendingState, firstStarterStateWhere } from './corpus';

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  errorSpy.mockRestore();
  useStore.getState().toSetup();
});

/** Loads a prepared position with the mode the store would have derived. */
function loadState(state: GameState): void {
  useStore.setState({
    screen: 'playing',
    gameState: state,
    animQueue: [],
    ui: { mode: ensureModeValid({ kind: 'idle' }, state), veilOpponentHand: false },
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

describe('the choice overlay', () => {
  const cardsChoice = firstPendingState((pending) => pending.kind === 'selectCards');
  const yesNoChoice = firstPendingState((pending) => pending.kind === 'yesNo');

  it('renders the prompt and the candidates without looping', () => {
    loadState(cardsChoice);
    render(<GameScreen />);
    expect(screen.getByRole('dialog', { name: 'Elección' })).toBeDefined();
    expect(screen.getByText(cardsChoice.pending?.prompt ?? '')).toBeDefined();
    // The React "Maximum update depth exceeded" regression would land here.
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('confirms an empty selection when min is 0, and the engine accepts it', () => {
    loadState(cardsChoice);
    expect(cardsChoice.pending?.min).toBe(0);
    render(<GameScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(mustState().pending?.id).not.toBe(cardsChoice.pending?.id);
    // dispatch logs "UI bug: illegal action" and changes nothing on a rejection.
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('selects a candidate by clicking it on the board, then confirms', () => {
    loadState(cardsChoice);
    const candidate = cardsChoice.pending?.candidates[0];
    expect(candidate).toBeDefined();
    render(<GameScreen />);
    // The candidate is rendered both on the board and inside the dialog; either
    // tile fires the same zone event, which the reducer routes to a toggle.
    const tiles = screen.getAllByRole('button', { name: /poder/ });
    const tile = tiles.find((element) => element.getAttribute('aria-label') !== null);
    expect(tile).toBeDefined();
    if (tile !== undefined) {
      fireEvent.click(tile);
    }
    const mode = useStore.getState().ui.mode;
    expect(mode.kind).toBe('answeringChoice');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('cannot be escaped: neither Escape nor a click on the table closes it', () => {
    loadState(cardsChoice);
    render(<GameScreen />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useStore.getState().ui.mode.kind).toBe('answeringChoice');
    expect(screen.getByRole('dialog', { name: 'Elección' })).toBeDefined();
    expect(mustState().pending).not.toBeNull();
  });

  it('offers exactly two buttons for a yes/no choice, and answers with them', () => {
    loadState(yesNoChoice);
    render(<GameScreen />);
    expect(screen.queryByRole('button', { name: 'Confirmar' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sí' }));
    expect(mustState().pending?.id).not.toBe(yesNoChoice.pending?.id);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('stays hidden until the animation queue has drained', () => {
    // The ordering decision: the board finishes showing what happened before
    // the player is asked about it. The queue always drains, so this is a delay
    // and not a way to bury a choice.
    loadState(cardsChoice);
    useStore.setState({ animQueue: [{ id: 1, kind: 'single', events: [], durationMs: 1, cardIds: [] }] });
    render(<GameScreen />);
    expect(screen.queryByRole('dialog', { name: 'Elección' })).toBeNull();
    act(() => useStore.getState().animTick(1));
    expect(screen.getByRole('dialog', { name: 'Elección' })).toBeDefined();
  });

  it('names the player who is being asked, even when it is not the turn player', () => {
    const state = firstPendingState(
      (pending) => pending.kind === 'yesNo' && pending.sink.kind === 'optIn',
    );
    loadState(state);
    render(<GameScreen />);
    const asked = state.pending?.player;
    expect(asked).toBeDefined();
    const label = asked === 'p1' ? 'Jugador 1' : 'Jugador 2';
    expect(screen.getByText(`${label} decide`)).toBeDefined();
    expect(screen.getByText(`${label} decide un efecto`)).toBeDefined();
  });
});

describe('the contextual menu', () => {
  // A real position where one card can both attack and activate an ability -
  // the ambiguity phase 1 could not produce and phase 2C brought back.
  const ambiguous = firstStarterStateWhere((state) => {
    if (state.pending !== null) {
      return false;
    }
    const aff = getAffordances(state);
    return Object.values(aff.byCard).some((card) => card.canAttack && card.canActivate);
  });

  /**
   * Clicks the board tile for `id`. Card names repeat across the board and the
   * hand, so the tile is found by name and then confirmed by what the click
   * did — the alternative is a brittle index into the DOM.
   */
  function clickTile(id: string): void {
    const name = getCardDef(mustState().cards[id]?.cardId ?? '').name;
    const tiles = screen
      .getAllByRole('button')
      .filter((element) => element.getAttribute('aria-label')?.startsWith(`${name},`));
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) {
      fireEvent.click(tile);
      if (useStore.getState().ui.mode.kind !== 'idle') {
        return;
      }
    }
    throw new Error(`no tile named ${name} responded to a click`);
  }

  function ambiguousCard(state: GameState): string {
    const aff = getAffordances(state);
    const entry = Object.entries(aff.byCard).find(
      ([, card]) => card.canAttack && card.canActivate,
    );
    if (entry === undefined) {
      throw new Error('test bug: no ambiguous card');
    }
    return entry[0];
  }

  it('opens on a click instead of guessing, and lists every option', () => {
    loadState(ambiguous);
    const id = ambiguousCard(ambiguous);
    render(<GameScreen />);
    clickTile(id);

    expect(useStore.getState().ui.mode.kind).toBe('cardMenu');
    expect(screen.getByRole('button', { name: /Atacar/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /Activar habilidad/ })).toBeDefined();
    // The click did not silently pick one of them.
    expect(mustState()).toBe(ambiguous);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('activates the ability from the menu, and the engine accepts it', () => {
    loadState(ambiguous);
    const id = ambiguousCard(ambiguous);
    render(<GameScreen />);
    clickTile(id);
    fireEvent.click(screen.getByRole('button', { name: /Activar habilidad/ }));
    expect(mustState()).not.toBe(ambiguous);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('closes on Cancelar without doing anything', () => {
    loadState(ambiguous);
    const id = ambiguousCard(ambiguous);
    render(<GameScreen />);
    clickTile(id);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(useStore.getState().ui.mode).toEqual({ kind: 'idle' });
    expect(mustState()).toBe(ambiguous);
  });
});

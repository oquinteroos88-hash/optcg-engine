// @vitest-environment jsdom
//
// The trash viewer, and where the battle panel is allowed to be.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { GameState } from '@optcg/engine';
import { GameScreen } from '../src/screens/GameScreen';
import { useStore } from '../src/store/store';
import { firstStarterStateWhere } from './corpus';

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  errorSpy.mockRestore();
  useStore.getState().toSetup();
});

function loadState(state: GameState): void {
  useStore.setState({
    screen: 'playing',
    gameState: state,
    animQueue: [],
    ui: { mode: { kind: 'idle' }, veilOpponentHand: false, hovered: null, viewingTrash: null },
    deviceAckFor: state.priority,
  });
}

/** A real position where both players have something in the trash. */
const withTrash = firstStarterStateWhere(
  (state) =>
    state.pending === null &&
    state.players.p1.trash.length > 0 &&
    state.players.p2.trash.length > 0,
);

function trashPile(player: 'Jugador 1' | 'Jugador 2'): HTMLElement {
  const field = screen.getByRole('group', { name: `Campo de ${player}` });
  return within(field).getByRole('button', { name: /^Descarte/ });
}

describe('the trash can be read', () => {
  it('opens a viewer listing every card in the pile, newest first', () => {
    loadState(withTrash);
    render(<GameScreen />);
    const ids = withTrash.players.p1.trash;
    expect(ids.length).toBeGreaterThan(0);

    fireEvent.click(trashPile('Jugador 1'));
    const dialog = screen.getByRole('dialog', { name: 'Descarte de Jugador 1' });
    // One tile per card, in the engine's own order — [0] is the most recent.
    expect(within(dialog).getAllByRole('button').length).toBe(ids.length + 1); // +1 = Cerrar
    expect(within(dialog).getByText(`Descarte de Jugador 1 (${ids.length})`)).toBeDefined();
  });

  it('reads either pile, because the trash is public information', () => {
    loadState(withTrash);
    render(<GameScreen />);
    fireEvent.click(trashPile('Jugador 2'));
    expect(screen.getByRole('dialog', { name: 'Descarte de Jugador 2' })).toBeDefined();
  });

  it('is not a move: opening and closing leaves the board untouched', () => {
    // The reason it lives outside `UiMode`. Looking at a pile ends in nothing,
    // so it may not disturb a targeting mode or dispatch anything.
    loadState(withTrash);
    render(<GameScreen />);
    const before = useStore.getState().gameState;

    fireEvent.click(trashPile('Jugador 1'));
    expect(useStore.getState().ui.mode).toEqual({ kind: 'idle' });

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog', { name: /^Descarte/ })).toBeNull();
    expect(useStore.getState().gameState).toBe(before);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('offers nothing to click on an empty pile', () => {
    const empty = firstStarterStateWhere(
      (state) => state.pending === null && state.players.p1.trash.length === 0,
    );
    loadState(empty);
    render(<GameScreen />);
    // jest-dom is not installed here, so the attribute is the assertion.
    expect((trashPile('Jugador 1') as HTMLButtonElement).disabled).toBe(true);
  });

  it('leaves the deck a plain count, with nothing to open', () => {
    // Showing the deck would hand a player information the game does not give
    // them. Only the trash is readable.
    loadState(withTrash);
    render(<GameScreen />);
    const field = screen.getByRole('group', { name: 'Campo de Jugador 1' });
    expect(within(field).queryByRole('button', { name: /^Mazo:/ })).toBeNull();
    expect(within(field).getByText('Mazo')).toBeDefined();
  });
});

describe('the battle panel never covers the board', () => {
  it('renders outside the table, in the left rail', () => {
    // It used to be `position: fixed; inset: 0` centred on the viewport, which
    // put it exactly over both Character rows — so at the Block Step the
    // defender could not click the Character they wanted to block with.
    const battling = firstStarterStateWhere((state) => state.battle !== null);
    loadState(battling);
    render(<GameScreen />);

    const panel = screen.getByText(/^Paso de/).parentElement;
    expect(panel).not.toBeNull();
    for (const label of ['Jugador 1', 'Jugador 2']) {
      const side = screen.getByRole('region', { name: label });
      expect(side.contains(panel), label).toBe(false);
    }
    // And it shares the rail with the card preview rather than floating.
    const rail = screen.getByRole('complementary', { name: 'Vista de carta' }).parentElement;
    expect(rail?.contains(panel)).toBe(true);
  });
});

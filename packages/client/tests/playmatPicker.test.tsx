// @vitest-environment jsdom
//
// The playmat control: per seat, remembered, and — the claim that matters —
// never a move. A mat is paint. It does not reach the engine, it does not reach
// the socket, and the other seat never learns which one you picked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { GameState } from '@optcg/engine';
import { resetAssetManifest } from '../src/game/assets';
import type { AssetManifest } from '../src/game/assets';
import { NEUTRAL_PLAYMAT, loadPlaymat } from '../src/game/playmat';
import { messagesFor } from '../src/i18n';
import { GameScreen } from '../src/screens/GameScreen';
import { hotSeatSnapshot, useStore } from '../src/store/store';
import { openingBoard } from './openingBoard';

/** The suites run in Spanish — see `tests/setup.ts`. */
const m = messagesFor('es');

const board: GameState = openingBoard();

const TWO_MATS: AssetManifest = {
  cardBack: null,
  donBack: null,
  playmats: [
    { id: 'east_blue', file: 'playmats/east_blue.png', name: 'East Blue' },
    { id: 'op01-launch', file: 'playmats/op01-launch.png', name: 'Op01 Launch' },
  ],
};

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  globalThis.localStorage?.removeItem('optcg.playmat.p1');
  globalThis.localStorage?.removeItem('optcg.playmat.p2');
  useStore.setState({ playmats: { p1: NEUTRAL_PLAYMAT, p2: NEUTRAL_PLAYMAT } });
  resetAssetManifest(TWO_MATS);
});

afterEach(() => {
  cleanup();
  errorSpy.mockRestore();
  resetAssetManifest();
  globalThis.localStorage?.removeItem('optcg.playmat.p1');
  globalThis.localStorage?.removeItem('optcg.playmat.p2');
  useStore.getState().toSetup();
});

function loadState(state: GameState): void {
  useStore.setState({
    screen: 'playing',
    ...hotSeatSnapshot(state),
    animQueue: [],
    ui: { mode: { kind: 'idle' }, veilOpponentHand: false, hovered: null, viewingTrash: null },
    deviceAckFor: state.priority,
  });
}

function pickerFor(player: 'Jugador 1' | 'Jugador 2'): HTMLSelectElement {
  return screen.getByRole('combobox', {
    name: m.playmat.forPlayer(player),
  }) as HTMLSelectElement;
}

function matOf(player: 'Jugador 1' | 'Jugador 2'): string {
  return screen.getByRole('group', { name: `Campo de ${player}` }).getAttribute('style') ?? '';
}

// ---------------------------------------------------------------------------

describe('choosing a mat', () => {
  it('offers the neutral one plus whatever the local archive has, per seat', () => {
    loadState(board);
    render(<GameScreen />);
    for (const player of ['Jugador 1', 'Jugador 2'] as const) {
      const options = [...pickerFor(player).options].map((option) => option.textContent);
      expect(options, player).toEqual([m.playmat.neutral, 'East Blue', 'Op01 Launch']);
    }
  });

  it('paints the chosen mat on that seat only', () => {
    loadState(board);
    render(<GameScreen />);
    fireEvent.change(pickerFor('Jugador 1'), { target: { value: 'east_blue' } });

    expect(matOf('Jugador 1')).toContain('url("/cards/playmats/east_blue.png")');
    // The other half keeps the neutral one. Two seats, two mats, one table.
    expect(matOf('Jugador 2')).toContain('--playmat: none');
  });

  it('is never a move: nothing is dispatched and the game does not change', () => {
    // The same claim `languagePicker.test.tsx` makes about the language, for
    // the same reason. If a mat could reach the engine it would be state, and
    // state is the one thing presentation may never become.
    loadState(board);
    render(<GameScreen />);
    const before = useStore.getState().gameState;

    fireEvent.change(pickerFor('Jugador 1'), { target: { value: 'op01-launch' } });
    fireEvent.change(pickerFor('Jugador 2'), { target: { value: 'east_blue' } });

    expect(useStore.getState().gameState).toBe(before);
    expect(useStore.getState().ui.mode).toEqual({ kind: 'idle' });
    expect(useStore.getState().net).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('remembers the choice per seat, and reads it back on a fresh start', () => {
    loadState(board);
    render(<GameScreen />);
    fireEvent.change(pickerFor('Jugador 2'), { target: { value: 'east_blue' } });

    expect(globalThis.localStorage?.getItem('optcg.playmat.p2')).toBe('east_blue');
    expect(loadPlaymat('p2')).toBe('east_blue');
    // And the seat that was not touched is untouched, in storage too.
    expect(globalThis.localStorage?.getItem('optcg.playmat.p1')).toBeNull();
    expect(loadPlaymat('p1')).toBe(NEUTRAL_PLAYMAT);
  });

  it('falls back to neutral when the chosen mat is no longer in the archive', () => {
    // A mat deleted from the local directory since the choice was stored. Not
    // an error: an optional local file that is gone is the normal state of
    // every optional local file.
    useStore.setState({ playmats: { p1: 'a-mat-that-left', p2: NEUTRAL_PLAYMAT } });
    loadState(board);
    render(<GameScreen />);
    expect(matOf('Jugador 1')).toContain('--playmat: none');
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('a machine with no local mats', () => {
  it('offers no control at all, because one option is not a choice', async () => {
    resetAssetManifest();
    loadState(board);
    render(<GameScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('combobox', { name: /^Tapete/ })).toBeNull();
    // The board still draws: the neutral mat is ours and needs no file.
    expect(matOf('Jugador 1')).toContain('--playmat: none');
    expect(screen.getByRole('group', { name: 'Campo de Jugador 1' })).toBeDefined();
  });
});

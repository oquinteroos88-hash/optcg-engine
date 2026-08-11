// @vitest-environment jsdom
//
// The preview panel. Two claims, and the second is the reason it is a panel at
// all rather than a card that grows where it sits.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { GameState } from '@optcg/engine';
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

function loadState(state: GameState): void {
  useStore.setState({
    screen: 'playing',
    gameState: state,
    animQueue: [],
    ui: { mode: ensureModeValid({ kind: 'idle' }, state), veilOpponentHand: false, hovered: null },
    deviceAckFor: state.priority,
  });
}

const populated = firstStarterStateWhere(
  (state) =>
    state.pending === null &&
    state.players.p1.characters.length > 0 &&
    state.players.p2.characters.length > 0,
);

function panel(): HTMLElement {
  return screen.getByRole('complementary', { name: 'Vista de carta' });
}

/** Every card box on the board, by position, so a shift is measurable. */
function boardCards(): string[] {
  return [...document.querySelectorAll('section[aria-label] button')].map(
    (el) => el.getAttribute('aria-label') ?? '',
  );
}

describe('the preview panel', () => {
  it('is rendered even with nothing to show, so the board never moves', () => {
    // The whole reason it is a fixed rail. An element that appears and
    // disappears would reflow the row it is in — which is the board.
    loadState(populated);
    render(<GameScreen />);
    expect(panel()).toBeDefined();
    expect(within(panel()).getByText(/Pasá el mouse/)).toBeDefined();
  });

  it('does not add or remove a single card when it fills in', () => {
    loadState(populated);
    render(<GameScreen />);
    const before = boardCards();

    const tile = screen
      .getAllByRole('button')
      .find((el) => (el.getAttribute('aria-label') ?? '').includes('poder'));
    expect(tile).toBeDefined();
    if (tile === undefined) {
      return;
    }
    fireEvent.mouseEnter(tile);

    // The panel filled...
    expect(within(panel()).queryByText(/Pasá el mouse/)).toBeNull();
    // ...and the board is the same board, in the same order.
    expect(boardCards()).toEqual(before);
  });

  it('shows the card under the pointer, with its derived power', () => {
    loadState(populated);
    render(<GameScreen />);
    const tile = screen
      .getAllByRole('button')
      .find((el) => (el.getAttribute('aria-label') ?? '').includes('poder'));
    if (tile === undefined) {
      throw new Error('test bug: no card rendered');
    }
    const name = (tile.getAttribute('aria-label') ?? '').split(',')[0] ?? '';
    fireEvent.mouseEnter(tile);

    expect(within(panel()).getByRole('heading', { name })).toBeDefined();
    expect(within(panel()).getByText('Poder')).toBeDefined();
    // Leaving clears it again.
    fireEvent.mouseLeave(tile);
    expect(within(panel()).getByText(/Pasá el mouse/)).toBeDefined();
  });

  it('renders the enlarged text card when there is no art', () => {
    // A fresh clone has no `public/cards/`, so this is the normal case rather
    // than a failure. jsdom never loads an image, so firing `error` is the only
    // honest way to reach the state a browser reaches by itself.
    loadState(populated);
    render(<GameScreen />);
    const tile = screen
      .getAllByRole('button')
      .find((el) => (el.getAttribute('aria-label') ?? '').includes('poder'));
    if (tile === undefined) {
      throw new Error('test bug: no card rendered');
    }
    const name = (tile.getAttribute('aria-label') ?? '').split(',')[0] ?? '';
    fireEvent.mouseEnter(tile);

    const image = within(panel()).getByRole('presentation', { hidden: true });
    fireEvent.error(image);

    // No image left, and the card is still fully readable: name, stats, and the
    // printed text that a tile this size could never show.
    expect(panel().querySelector('img')).toBeNull();
    expect(within(panel()).getByRole('heading', { name })).toBeDefined();
    expect(within(panel()).getAllByText(name).length).toBeGreaterThan(0);
    expect(within(panel()).getByText('Poder')).toBeDefined();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('shows the card whose ability is asking, while a choice is open', () => {
    // Nothing is hovered here: an open choice puts its source on show by
    // itself, so the question reads as being about a card rather than about a
    // prompt string with an ability id in it.
    const asking = firstPendingState(() => true);
    loadState(asking);
    render(<GameScreen />);
    expect(within(panel()).queryByText(/Pasá el mouse/)).toBeNull();
    expect(within(panel()).getByText('Efecto en resolución')).toBeDefined();

    const source = asking.stack[asking.stack.length - 1];
    expect(source).toBeDefined();
    if (source !== undefined) {
      const name = screen.getByRole('dialog', { name: 'Elección' }).textContent ?? '';
      const heading = within(panel()).getByRole('heading');
      expect(name).toContain(heading.textContent ?? '');
    }
  });
});

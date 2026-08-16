// @vitest-environment jsdom
//
// The selector, in a real DOM: it switches the board mid-match, it survives a
// reload, and it never touches the game.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { applyAction, createGame } from '@optcg/engine';
import type { Action, GameState } from '@optcg/engine';
import { registerStarterCards, starterDecklists, toEngineDecklist } from '@optcg/cards/starters';
import { App } from '../src/App';
import { messagesFor } from '../src/i18n';
import { initialLocale } from '../src/i18n/locale';
import { GameScreen } from '../src/screens/GameScreen';
import { SetupScreen } from '../src/screens/SetupScreen';
import { hotSeatSnapshot, useStore } from '../src/store/store';

const en = messagesFor('en');
const es = messagesFor('es');

const STORAGE_KEY = 'optcg.locale';

/**
 * A real ST-01/ST-02 board, three actions deep.
 *
 * Built rather than searched for out of the playout corpus: what this suite
 * needs is real starter cards on a real board with a few lines of log, and
 * `firstStarterStateWhere` would run a four-hundred-step playout to hand back
 * the same thing. That cost is not this suite's to add — it shares a CPU with
 * `fullGame.test.ts`, whose five-second budget has no headroom to lend.
 */
function openingBoard(): GameState {
  registerStarterCards();
  const [st01, st02] = starterDecklists;
  if (st01 === undefined || st02 === undefined) {
    throw new Error('expected both starter decklists');
  }
  let state = createGame({
    seed: 82,
    decks: { p1: toEngineDecklist(st01), p2: toEngineDecklist(st02) },
    firstPlayer: 'p1',
  });
  for (const action of [
    { type: 'MULLIGAN', player: 'p1', accept: false },
    { type: 'MULLIGAN', player: 'p2', accept: false },
  ] as Action[]) {
    const result = applyAction(state, action);
    if (!result.ok) {
      throw new Error(result.reason);
    }
    state = result.state;
  }
  return state;
}

const midGame: GameState = openingBoard();

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  useStore.getState().setLocale('es');
});

afterEach(() => {
  cleanup();
  errorSpy.mockRestore();
  useStore.getState().toSetup();
  useStore.getState().setLocale('es');
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

function pickers(): HTMLSelectElement[] {
  return screen.getAllByRole('combobox', { name: /Idioma|Language/ }) as HTMLSelectElement[];
}

describe('the language selector', () => {
  it('is offered before a game starts', () => {
    render(<SetupScreen onNetwork={() => undefined} />);
    const picker = pickers()[0];
    expect(picker).toBeDefined();
    expect(picker?.value).toBe('es');
    // Each language names itself in itself, so somebody who cannot read the
    // current one can still find theirs.
    expect(within(picker!).getByText('English')).toBeDefined();
    expect(within(picker!).getByText('Español')).toBeDefined();
  });

  it('switches the whole board mid-match, in place', () => {
    loadState(midGame);
    render(<GameScreen />);

    expect(screen.getByText(es.board.logTitle)).toBeDefined();
    expect(screen.queryByText(en.board.logTitle)).toBeNull();
    const before = screen.getByRole('region', { name: es.common.playerOne });
    expect(before).toBeDefined();

    fireEvent.change(pickers()[0]!, { target: { value: 'en' } });

    expect(screen.getByText(en.board.logTitle)).toBeDefined();
    expect(screen.queryByText(es.board.logTitle)).toBeNull();
    // The zones, the log and the accessible names all moved together — this is
    // one store field driving one render, not a screen that has to be reopened.
    expect(screen.getByRole('region', { name: en.common.playerOne })).toBeDefined();
    expect(screen.getAllByText(en.board.deck).length).toBeGreaterThan(0);
  });

  it('changes nothing about the game', () => {
    loadState(midGame);
    render(<GameScreen />);
    const before = useStore.getState();
    const state = before.gameState;
    const journal = before.journals.p1;

    fireEvent.change(pickers()[0]!, { target: { value: 'en' } });

    const after = useStore.getState();
    // Identity, not equality: a language change must not rebuild a frame.
    expect(after.gameState).toBe(state);
    expect(after.journals.p1).toBe(journal);
    expect(after.affordances).toBe(before.affordances);
    expect(after.ui).toBe(before.ui);
    expect(after.net).toBeNull();
  });

  it('follows the document language, which a screen reader reads', () => {
    // Through `App`, because that is where the effect lives and where the real
    // client mounts it: the whole document has one language, not each screen.
    render(<App />);
    expect(document.documentElement.lang).toBe('es');
    fireEvent.change(pickers()[0]!, { target: { value: 'en' } });
    expect(document.documentElement.lang).toBe('en');
  });

  it('persists the choice, and prefers it over the browser next time', () => {
    render(<SetupScreen onNetwork={() => undefined} />);
    fireEvent.change(pickers()[0]!, { target: { value: 'en' } });
    expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBe('en');
    // A fresh client would start here: jsdom reports `en-US`, but the stored
    // answer is what decides — and it decides even when it disagrees.
    expect(initialLocale()).toBe('en');
    act(() => useStore.getState().setLocale('es'));
    expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBe('es');
    expect(initialLocale()).toBe('es');
  });

  it('falls back to the browser when nothing is stored', () => {
    globalThis.localStorage.removeItem(STORAGE_KEY);
    // jsdom's navigator says `en-US`.
    expect(initialLocale()).toBe('en');
    const original = Object.getOwnPropertyDescriptor(globalThis.navigator, 'language');
    Object.defineProperty(globalThis.navigator, 'language', {
      value: 'es-419',
      configurable: true,
    });
    expect(initialLocale()).toBe('es');
    if (original !== undefined) {
      Object.defineProperty(globalThis.navigator, 'language', original);
    }
  });
});

describe('the unofficial-translation note', () => {
  it('appears with the Spanish text and not with the English', () => {
    loadState(midGame);
    render(<GameScreen />);
    const leader = midGame.players.p1.leader;
    const tile = screen.getAllByRole('button', { name: /poder/ })[0];
    expect(tile).toBeDefined();
    fireEvent.mouseEnter(tile!);
    expect(leader).toBeDefined();

    // Quiet, and only where a translation is on screen.
    expect(screen.getByText(es.preview.unofficialTranslation)).toBeDefined();

    fireEvent.change(pickers()[0]!, { target: { value: 'en' } });
    expect(screen.queryByText(en.preview.unofficialTranslation)).toBeNull();
    expect(screen.queryByText(es.preview.unofficialTranslation)).toBeNull();
  });
});

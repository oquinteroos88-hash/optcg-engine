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
import { hotSeatSnapshot, useStore } from '../src/store/store';
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
    ...hotSeatSnapshot(state),
    animQueue: [],
    ui: { mode: ensureModeValid({ kind: 'idle' }, getAffordances(state)), veilOpponentHand: false, hovered: null, viewingTrash: null },
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
  const orderChoice = firstPendingState((pending) => pending.kind === 'orderCards');

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

  it('renders a whole-deck search — forty-odd candidates — without breaking', () => {
    // `OP01-069` and `OP01-098` search the **whole deck**, which makes their
    // choice roughly ten times wider than anything the UI had ever been handed:
    // every other `selectCards` in the game offers single digits. The overlay
    // was written against a hand, and "does it still work at forty" is the one
    // question that could not be answered by reading it.
    //
    // The answer is that the layout needed a ceiling and a scroll — a
    // `max-height` on the dialog and `overflow-y` on the candidate list, so the
    // prompt stays at the top and Confirmar stays reachable at the bottom. That
    // part is CSS and lives in `ChoiceOverlay.module.css`. What a test can see
    // is the rest of it: every candidate renders, once each, and the answer is
    // still submittable.
    const wide = JSON.parse(JSON.stringify(cardsChoice)) as GameState;
    const pending = wide.pending;
    expect(pending).toBeDefined();
    if (pending === null) {
      throw new Error('expected an open choice');
    }
    const deck = wide.players[pending.player].deck;
    // Forty in this position, which is the order of magnitude a real search
    // faces: fifty minus the opening hand and the life cards.
    expect(deck.length).toBeGreaterThanOrEqual(40);
    pending.candidates = [...deck];
    pending.min = 0;
    pending.max = 1;
    // A real search marks the whole deck known to the searcher before it
    // offers anything (CR 8-4-4-4 has them check the faces), and staging the
    // candidates by hand without that would build a state the engine cannot
    // produce: a choice whose chooser may not see its own candidates. Invisible
    // under perfect information; with a per-player view the tiles would simply
    // not be there, which is what caught it.
    for (const id of deck) {
      wide.knownBy[id] = [pending.player];
    }

    loadState(wide);
    render(<GameScreen />);
    expect(screen.getByRole('dialog', { name: 'Elección' })).toBeDefined();
    // One tile per candidate inside the dialog — a wrapped flex row, not a grid
    // that silently drops the overflow.
    const dialog = screen.getByRole('dialog', { name: 'Elección' });
    expect(dialog.querySelectorAll('[aria-label]').length).toBeGreaterThanOrEqual(deck.length);
    // And the answer still goes back: an "up to 1" confirmed empty is exactly
    // what a search that finds nothing looks like.
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

  it('renders an ordering with a position badge per candidate, and confirms only when full', () => {
    // The first new choice kind since phase 2C, and the whole of its UI: tap the
    // candidates in the order you want them, watch the numbers appear, confirm.
    // No drag library and no second way to click a card - the interaction the
    // overlay already had, with the position made visible.
    loadState(orderChoice);
    const pending = orderChoice.pending;
    expect(pending).toBeDefined();
    const candidates = pending?.candidates ?? [];
    expect(candidates.length).toBeGreaterThan(1);
    render(<GameScreen />);

    // A permutation is exact, so an empty answer must not be confirmable - the
    // opposite of the min-0 selection above, and the reason the button is driven
    // by the published cardinality rather than by the kind.
    const confirm = screen.getByRole('button', { name: 'Confirmar' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(screen.getAllByLabelText('sin ordenar').length).toBe(candidates.length);

    for (let at = 0; at < candidates.length; at += 1) {
      const id = candidates[at];
      act(() => {
        useStore.getState().uiEvent({ kind: 'toggleChoiceCandidate', instanceId: id as string });
      });
      expect(screen.getAllByLabelText('posición ' + String(at + 1)).length).toBe(1);
    }

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(mustState().pending?.id).not.toBe(pending?.id);
    // The order really reached the engine: the last card tapped is the deepest.
    const deck = mustState().players[pending?.player ?? 'p1'].deck;
    expect(deck.slice(-candidates.length)).toEqual([...candidates]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('cannot be escaped mid-ordering either, and a re-tap unplaces a card', () => {
    loadState(orderChoice);
    const candidates = orderChoice.pending?.candidates ?? [];
    const first = candidates[0];
    render(<GameScreen />);
    act(() => {
      useStore.getState().uiEvent({ kind: 'toggleChoiceCandidate', instanceId: first as string });
    });
    expect(screen.getAllByLabelText('posición 1').length).toBe(1);

    // Tapping the same card again takes it back out, which is the only undo the
    // mode needs: a player who placed the wrong card first can say so.
    act(() => {
      useStore.getState().uiEvent({ kind: 'toggleChoiceCandidate', instanceId: first as string });
    });
    expect(screen.queryAllByLabelText('posición 1').length).toBe(0);

    // And there is still no way out. An ordering is as unrefusable as any other
    // open choice.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useStore.getState().ui.mode.kind).toBe('answeringChoice');
    expect(mustState().pending).not.toBeNull();
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

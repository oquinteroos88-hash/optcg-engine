// @vitest-environment jsdom
//
// The card back, and what happens on the machine that has no card art.
//
// That machine is not an edge case: it is every clone of this repository. No
// official artwork is committed — `.gitignore` refuses every raster format and
// `packages/cards/tests/noTrackedArt.test.ts` fails if one reaches the index —
// so the state this suite spends most of its time in is the normal one, and
// the manifest is the only thing that ever says otherwise.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import type { GameState } from '@optcg/engine';
import { NO_ASSETS, backgroundImage, resetAssetManifest } from '../src/game/assets';
import { messagesFor } from '../src/i18n';
import { GameScreen } from '../src/screens/GameScreen';
import { hotSeatSnapshot, useStore } from '../src/store/store';
import { openingBoard } from './openingBoard';

/** The suites run in Spanish — see `tests/setup.ts`. */
const m = messagesFor('es');

const board: GameState = openingBoard();

let errorSpy: ReturnType<typeof vi.spyOn>;
const realFetch = globalThis.fetch;

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  resetAssetManifest();
});

afterEach(() => {
  cleanup();
  errorSpy.mockRestore();
  resetAssetManifest();
  globalThis.fetch = realFetch;
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

/** Renders, then lets any manifest promise settle before asserting. */
async function renderBoard(): Promise<void> {
  loadState(board);
  render(<GameScreen />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** The custom property the optional official back is declared through. */
function declaredCardBack(): string {
  const screenEl = screen.getByRole('region', { name: 'Jugador 1' }).closest('[style]');
  return screenEl?.getAttribute('style') ?? '';
}

// ---------------------------------------------------------------------------

describe('a machine with no local card art', () => {
  it('asks once for the manifest, and treats a 404 as "there is nothing here"', async () => {
    const asked: string[] = [];
    globalThis.fetch = vi.fn((input: unknown) => {
      asked.push(String(input));
      return Promise.resolve(new Response('', { status: 404 }));
    }) as unknown as typeof fetch;

    await renderBoard();

    // Once for the whole page, not once per back: the manifest is a fact about
    // the machine, and the machine does not change while the tab is open.
    expect(asked).toEqual(['/cards/manifest.json']);
    expect(declaredCardBack()).toContain('--card-back: none');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('survives a fetch that rejects, without an unhandled rejection', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    await renderBoard();
    expect(declaredCardBack()).toContain('--card-back: none');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('survives a body that parses but is not a manifest', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response('"a string"', { status: 200 })),
    ) as unknown as typeof fetch;
    await renderBoard();
    expect(declaredCardBack()).toContain('--card-back: none');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('runs at all where there is no fetch to call', async () => {
    // Not hypothetical: `loadAssetManifest` is called from a render, and a
    // render must not depend on a global that an environment may not have.
    // @ts-expect-error — deleting a global is the point of the test.
    delete globalThis.fetch;
    await renderBoard();
    expect(declaredCardBack()).toContain('--card-back: none');
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('the back this repository ships', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response('', { status: 404 })),
    ) as unknown as typeof fetch;
  });

  it('is drawn in every zone the game asks a back for', async () => {
    await renderBoard();
    // Deck and DON!! deck, per player, plus the Life column of both, plus the
    // opponent hand — the five places the real game shows a face-down card.
    for (const label of ['Jugador 1', 'Jugador 2']) {
      const field = screen.getByRole('group', { name: `Campo de ${label}` });
      expect(within(field).getByText('Mazo')).toBeDefined();
      expect(within(field).getByText(m.board.donDeck)).toBeDefined();
      expect(within(field).getByText('Vida')).toBeDefined();
      // One SVG back per pile that has cards in it, and one per Life card.
      expect(field.querySelectorAll('svg').length).toBeGreaterThan(0);
    }
  });

  it('is vector, so nothing this repository commits is an image file', async () => {
    // The committed fallback has to be an SVG element rather than an asset:
    // every raster extension is gitignored repository-wide, and the client's
    // vitest config loads no Vite plugins to resolve an imported one with.
    await renderBoard();
    const field = screen.getByRole('group', { name: 'Campo de Jugador 1' });
    const svg = field.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 63 88');
    // And it is decoration, not content: it carries no accessible name.
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(field.querySelector('img[src$=".png"]')).toBeNull();
  });
});

describe('a machine that does have the local archive', () => {
  it('paints the official back over the shipped one', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            version: 1,
            cardBack: 'CardBackRegular.png',
            donBack: 'DonBack.png',
            playmats: [],
          }),
          { status: 200 },
        ),
      ),
    ) as unknown as typeof fetch;

    await renderBoard();

    expect(declaredCardBack()).toContain('url("/cards/CardBackRegular.png")');
    expect(declaredCardBack()).toContain('url("/cards/DonBack.png")');
    // The shipped back is still underneath. It is not conditional — an
    // official file that goes missing must degrade to a drawn card, not to a
    // hole where a card was.
    const field = screen.getByRole('group', { name: 'Campo de Jugador 1' });
    expect(field.querySelector('svg')).not.toBeNull();
  });
});

describe('the url helper', () => {
  it('turns nothing into the declaration that does not paint', () => {
    expect(backgroundImage(null)).toBe('none');
    expect(backgroundImage(undefined)).toBe('none');
    expect(backgroundImage('')).toBe('none');
    expect(backgroundImage('playmats/x.png')).toBe('url("/cards/playmats/x.png")');
    expect(NO_ASSETS.playmats).toEqual([]);
  });
});

// @vitest-environment jsdom
//
// The art layer, and the only thing about it that really matters: what the
// board looks like when there is no art.
//
// A fresh clone has none — `public/cards/` is gitignored and filled by a script
// nobody is obliged to run — so "no images" is the normal case and not an error
// state. jsdom never loads an image at all, which makes it the right place to
// assert the fallback: nothing here has to simulate a failure that would not
// otherwise happen.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { GameState, InstanceId } from '@optcg/engine';
import { CardTile } from '../src/components/CardTile';
import { cardImageSrc, hasCardImage } from '../src/game/cardImage';
import { powerBreakdown } from '../src/store/selectors';
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
    ui: { mode: { kind: 'idle' }, veilOpponentHand: false, hovered: null },
    deviceAckFor: state.priority,
  });
}

/** A real board with a Character carrying attached DON!! and a rested card. */
const boardWithDon = firstStarterStateWhere((state) =>
  state.players.p1.characters.some((id) => (state.cards[id]?.attachedDon.length ?? 0) > 0),
);

function characterWithDon(state: GameState): InstanceId {
  const id = state.players.p1.characters.find(
    (candidate) => (state.cards[candidate]?.attachedDon.length ?? 0) > 0,
  );
  if (id === undefined) {
    throw new Error('test bug: no character carries DON!!');
  }
  return id;
}

describe('the art layer sits under the tile, never in place of it', () => {
  it('asks for art by card id, from the client-owned base', () => {
    // Not the upstream URL: the client reads its own local cache. Changing
    // where that is, is a change of `config.cardImageBase` and nothing else.
    expect(cardImageSrc('ST01-001')).toBe('/cards/ST01-001.png');
    expect(cardImageSrc('ST01-001')).not.toContain('onepiece-cardgame.com');
  });

  it('only asks for cards the dataset actually has art for', () => {
    expect(hasCardImage('ST01-001')).toBe(true);
    expect(hasCardImage('ST02-017')).toBe(true);
    // The TEST set is synthetic; there is no printed card behind it, so the
    // board must not fire twenty guaranteed 404s at a deck built from it.
    expect(hasCardImage('TEST-001')).toBe(false);
  });

  it('renders an <img> under a real card, and none under a TEST card', () => {
    loadState(boardWithDon);
    const id = characterWithDon(boardWithDon);
    const { container } = render(<CardTile id={id} zone="field" mine />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe(cardImageSrc(boardWithDon.cards[id]?.cardId ?? ''));
    // Decorative: the tile's own aria-label already says everything the art
    // cannot, and a screen reader gaining "image" here would be noise.
    expect(img?.getAttribute('alt')).toBe('');
    expect(img?.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps every engine indicator readable with the art present', () => {
    // The whole design constraint in one assertion. None of this is printed on
    // the card: the power is effective, the DON!! count and the rested flag are
    // board state. If the art layer ever replaced the tile instead of sitting
    // under it, these disappear.
    loadState(boardWithDon);
    const id = characterWithDon(boardWithDon);
    const card = boardWithDon.cards[id];
    expect(card).toBeDefined();
    render(<CardTile id={id} zone="field" mine />);

    const tile = screen.getByRole('button');
    const label = tile.getAttribute('aria-label') ?? '';
    expect(label).toContain('poder');
    expect(label).toContain(`+${(card?.attachedDon.length ?? 0) * 1000} por DON!! adjuntados`);
    // The visible badge, not only the label.
    expect(screen.getByText(`DON ×${card?.attachedDon.length ?? 0}`)).toBeDefined();
    // And the tooltip that carries the printed text is still there.
    expect(tile.getAttribute('title') ?? '').not.toBe('');
  });

  it('falls back to the plain tile when the image fails, indicators intact', () => {
    loadState(boardWithDon);
    const id = characterWithDon(boardWithDon);
    const card = boardWithDon.cards[id];
    const { container } = render(<CardTile id={id} zone="field" mine />);

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    if (img !== null) {
      fireEvent.error(img);
    }

    // The <img> is gone and is not retried.
    expect(container.querySelector('img')).toBeNull();
    // Everything the tile drew before there was ever an art layer is still here.
    const tile = screen.getByRole('button');
    expect(tile.getAttribute('aria-label') ?? '').toContain('poder');
    expect(screen.getByText(`DON ×${card?.attachedDon.length ?? 0}`)).toBeDefined();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('still routes a click after the image failed', () => {
    // The art is `pointer-events: none` and the tile is the button, so a failed
    // image must not have taken the click area with it on its way out.
    loadState(boardWithDon);
    const id = characterWithDon(boardWithDon);
    const { container } = render(<CardTile id={id} zone="field" mine />);
    const img = container.querySelector('img');
    if (img !== null) {
      fireEvent.error(img);
    }
    fireEvent.click(screen.getByRole('button'));
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('shows the rested rotation, which the art rotates with rather than hides', () => {
    // Rotation lives on the tile, so the image inside it turns too — the class
    // is what the assertion can see, and it is on the button, not on the img.
    const attacked = (() => {
      const state = firstStarterStateWhere((candidate) =>
        candidate.players.p1.characters.some((id) => candidate.cards[id]?.orientation === 'rested'),
      );
      return state;
    })();
    loadState(attacked);
    const rested = attacked.players.p1.characters.find(
      (id) => attacked.cards[id]?.orientation === 'rested',
    );
    expect(rested).toBeDefined();
    if (rested === undefined) {
      return;
    }
    render(<CardTile id={rested} zone="field" mine />);
    const tile = screen.getByRole('button');
    expect(tile.getAttribute('aria-label') ?? '').toContain('agotada');
    expect(tile.className).toContain('rested');
  });

  it('shows the continuous badge on top of the art', () => {
    // The badge is the only trace of a continuous effect anywhere in the UI —
    // statics emit no events — so covering it with a picture would delete the
    // information rather than move it.
    const lifted = firstStarterStateWhere((state) => {
      const ids = [state.players.p1.leader, ...state.players.p1.characters];
      return ids.some((id) => powerBreakdown(state, id).fromStatics !== 0);
    });
    const id = [lifted.players.p1.leader, ...lifted.players.p1.characters].find(
      (candidate) => powerBreakdown(lifted, candidate).fromStatics !== 0,
    );
    expect(id).toBeDefined();
    if (id === undefined) {
      return;
    }
    loadState(lifted);
    const parts = powerBreakdown(lifted, id);
    render(<CardTile id={id} zone="field" mine />);

    const sign = parts.fromStatics > 0 ? '+' : '';
    expect(screen.getByText(`${sign}${parts.fromStatics}`)).toBeDefined();
    expect(screen.getByRole('button').getAttribute('title') ?? '').toContain('continuo');
  });
});

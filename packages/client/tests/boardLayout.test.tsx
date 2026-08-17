// @vitest-environment jsdom
//
// The layout claims that can be checked without a browser.
//
// jsdom has no layout engine — every box is 0x0 and `getComputedStyle` does not
// resolve a stylesheet — so nothing here measures pixels. What it can check is
// structure and declared style, which is where the two bugs this PR fixes
// actually lived: a `rotate(180deg)` on a container full of text, and a preview
// that grew into the board instead of into a reserved rail.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { getCardDef } from '@optcg/engine';
import type { GameState } from '@optcg/engine';
import { fanGeometry } from '../src/components/HandRow';
import { messagesFor } from '../src/i18n';
import { GameScreen } from '../src/screens/GameScreen';
import { TURN_PHASES } from '../src/store/selectors';
import { hotSeatSnapshot, useStore } from '../src/store/store';
import { firstStarterStateWhere } from './corpus';
import { openingBoard } from './openingBoard';

/** The suites run in Spanish — see `tests/setup.ts`. */
const m = messagesFor('es');

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
    ...hotSeatSnapshot(state),
    animQueue: [],
    ui: { mode: { kind: 'idle' }, veilOpponentHand: false, hovered: null, viewingTrash: null },
    deviceAckFor: state.priority,
  });
}

/**
 * A position with both halves populated: characters on the board, and a hand
 * wide enough to actually be fanned.
 *
 * The hand-size clause is new and is not a relaxation — it is the opposite. The
 * fan tests below have always needed more than three cards in the hand of the
 * player on priority ("still routes a click on a card inside the arc" asserts
 * exactly that), and until the driver changed they got one by luck: the first
 * state matching the old predicate happened to have a wide hand. A corpus query
 * that depends on an unstated precondition is a test that fails for a reason
 * unrelated to what it claims, which is what happened here.
 */
const populated = firstStarterStateWhere(
  (state) =>
    state.pending === null &&
    state.players.p1.characters.length > 0 &&
    state.players.p2.characters.length > 0 &&
    state.players[state.priority].hand.length > 3,
);

/**
 * Reads a stylesheet as text.
 *
 * Deliberately a filesystem read rather than an import: Vite turns a
 * `new URL(...css)` into an asset request and refuses it for CSS modules, and
 * more importantly jsdom would not resolve the rules anyway. The claim being
 * checked is about what the stylesheet *says*, which is exactly what a
 * `rotate(180deg)` regression would put back into it.
 */
const COMPONENTS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'components');

function styleSheet(name: string): string {
  // Comments stripped: the stylesheets explain the rotation they replaced, and
  // a test that cannot tell a rule from a note about a rule is measuring prose.
  return readFileSync(join(COMPONENTS, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Every `selector { … }` rule of a stylesheet, body keyed by selector. */
function rules(sheet: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, selector = '', body = ''] of sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.set(selector.trim(), body);
  }
  return out;
}

/**
 * A `grid-template-areas` as data: one array of area names per row, in the
 * order they are painted, top to bottom.
 */
function templateAreas(sheet: string, selector: string): readonly (readonly string[])[] {
  const body = rules(sheet).get(selector);
  expect(body, `no rule for ${selector}`).toBeDefined();
  const declaration = /grid-template-areas:([^;]*);/.exec(body ?? '');
  expect(declaration, `no grid-template-areas in ${selector}`).not.toBeNull();
  return [...(declaration?.[1] ?? '').matchAll(/'([^']*)'/g)].map(([, row = '']) =>
    row.trim().split(/\s+/),
  );
}

/** A card's printed name — identical in both locales, so no locale is needed. */
function cardNameOf(state: GameState, instanceId: string): string {
  const card = state.cards[instanceId];
  if (card === undefined) {
    throw new Error(`no such instance: ${instanceId}`);
  }
  return getCardDef(card.cardId).name;
}

/** The nine zones the official playsheet prints, as the grid names them. */
const MAT_AREAS = [
  'life',
  'character',
  'leader',
  'stage',
  'deck',
  'don',
  'cost',
  'trash',
  'phases',
] as const;

// ---------------------------------------------------------------------------

describe('nothing that carries text is turned upside down', () => {
  // Phase 1 mirrored the opponent's half with `transform: rotate(180deg)`,
  // which put the Character rows against the centre line and made every label
  // on that half unreadable. The mirror is now `flex-direction: column-reverse`
  // — an order, not a rotation.
  const sideBoard = styleSheet('SideBoard.module.css');

  it('mirrors the opponent half by placing its zones, not by rotating it', () => {
    // This used to assert `column-reverse`, which was a proxy: what the mirror
    // is FOR is putting both Character Areas against the centre line, and a
    // flex direction only implied that. The grid says it outright, so the test
    // now asserts the thing itself.
    const mine = templateAreas(sideBoard, '.field');
    const theirs = templateAreas(sideBoard, '.mirrored .field');

    // Your half is the bottom one, so the line is above it; theirs is the top
    // one, so the line is below. Both Character Areas end up against it.
    expect(mine[0]).toContain('character');
    expect(theirs.at(-1)).toContain('character');
    // And the Cost Area — the near edge of each mat — ends up at the outside.
    expect(mine.at(-1)).toContain('cost');
    expect(theirs[0]).toContain('cost');

    expect(sideBoard).not.toMatch(/rotate\(\s*180deg\s*\)/);
  });

  it('gives both halves the same nine zones of the printed sheet', () => {
    for (const [selector, template] of [
      ['.field', templateAreas(sideBoard, '.field')],
      ['.mirrored .field', templateAreas(sideBoard, '.mirrored .field')],
    ] as const) {
      const named = [...new Set(template.flat())].sort();
      expect(named, selector).toEqual([...MAT_AREAS].sort());
      // Every row of a template must be the same width or the whole
      // declaration is invalid and the browser silently drops it.
      const widths = [...new Set(template.map((row) => row.length))];
      expect(widths, selector).toHaveLength(1);
    }
  });

  it('keeps Life against the outer edge of each mat, so the two do not collide', () => {
    // On the real table your Life is at your left hand and theirs is at their
    // left — which, seen from your chair, is your right.
    const mine = templateAreas(sideBoard, '.field');
    const theirs = templateAreas(sideBoard, '.mirrored .field');
    for (const row of mine) {
      expect(row[0]).toBe('life');
    }
    for (const row of theirs) {
      expect(row.at(-1)).toBe('life');
    }
  });

  it('has no 180deg rotation in any component stylesheet', () => {
    // The tiles do rotate — 90deg, for rested — and that is the only rotation
    // of a card allowed to exist. A half-turn is what flips text.
    for (const file of [
      'SideBoard.module.css',
      'Table.module.css',
      'HandRow.module.css',
      'CardTile.module.css',
      'CardPreview.module.css',
      'DeckPile.module.css',
    ]) {
      expect(styleSheet(file), file).not.toMatch(/rotate\(\s*-?180deg\s*\)/);
    }
  });

  it('renders both halves with the same upright structure', () => {
    loadState(populated);
    render(<GameScreen />);
    for (const label of ['Jugador 1', 'Jugador 2']) {
      const side = screen.getByRole('region', { name: label });
      expect(within(side).getByRole('group', { name: `Campo de ${label}` })).toBeDefined();
      expect(within(side).getByRole('group', { name: `Mano de ${label}` })).toBeDefined();
      // The declared style of a mirrored half is a reversed column, never a
      // transform — an inline transform is what a rotation would need to be.
      expect(side.getAttribute('style')).toBeNull();
    }
  });
});

describe('the official zones are all on the board', () => {
  it('renders Life, Leader, Stage, Deck, DON!! deck, cost area and trash per player', () => {
    loadState(populated);
    render(<GameScreen />);
    for (const label of ['Jugador 1', 'Jugador 2']) {
      const field = screen.getByRole('group', { name: `Campo de ${label}` });
      expect(within(field).getByText('Vida')).toBeDefined();
      expect(within(field).getByText('Líder')).toBeDefined();
      expect(within(field).getByText('Escenario')).toBeDefined();
      expect(within(field).getByText('Mazo')).toBeDefined();
      expect(within(field).getByText(m.board.donDeck)).toBeDefined();
      expect(within(field).getByText('Descarte')).toBeDefined();
      // The cost area is the only clickable zone of the three DON!! ones.
      expect(within(field).getByRole('button', { name: /^DON!!/ })).toBeDefined();
    }
  });

  it('prints the two zone names the sheet has and the dictionary was missing', () => {
    // The Character Area had no label at all, and the Cost Area's only name was
    // buried inside a sentence — the visible word was the hard-coded `DON!!`,
    // which is the name of the CARDS, not of the zone they sit in.
    loadState(populated);
    render(<GameScreen />);
    for (const label of ['Jugador 1', 'Jugador 2']) {
      const field = screen.getByRole('group', { name: `Campo de ${label}` });
      expect(within(field).getByText('Área de Personajes')).toBeDefined();
      expect(within(field).getByText('Área de Coste')).toBeDefined();
      // And DON!! is still there, still untranslated, still a name — twice,
      // and both are right: the cards in the Cost Area, and the phase in
      // which you gain them. The mat prints both words too.
      expect(within(field).getAllByText('DON!!')).toHaveLength(2);
    }
  });
});

describe('the details the table has and a diagram does not', () => {
  it('shows the top of the trash face-up, because the trash is public', () => {
    // CR 3-5-2. The deck stays a count in the same row, which is the contrast
    // that makes this meaningful rather than decorative.
    const withTrash = firstStarterStateWhere(
      (state) => state.pending === null && state.players.p1.trash.length > 0,
    );
    loadState(withTrash);
    render(<GameScreen />);
    const field = screen.getByRole('group', { name: 'Campo de Jugador 1' });
    const top = withTrash.players.p1.trash[0];
    expect(top).toBeDefined();
    const name = cardNameOf(withTrash, top ?? '');
    expect(within(field).getByText(name)).toBeDefined();
    // Still one button, still addressed by the same name every suite uses.
    expect(within(field).getByRole('button', { name: /^Descarte/ })).toBeDefined();
  });

  it('leaves an empty trash with nothing to look at and nothing to click', () => {
    const empty = firstStarterStateWhere(
      (state) => state.pending === null && state.players.p1.trash.length === 0,
    );
    loadState(empty);
    render(<GameScreen />);
    const field = screen.getByRole('group', { name: 'Campo de Jugador 1' });
    const pile = within(field).getByRole('button', { name: /^Descarte/ }) as HTMLButtonElement;
    expect(pile.disabled).toBe(true);
  });

  it('draws attached DON!! under the card carrying them, as many as four', () => {
    const withDon = firstStarterStateWhere((state) =>
      state.players.p1.don.some((don) => don.location.kind === 'attached'),
    );
    loadState(withDon);
    render(<GameScreen />);
    const field = screen.getByRole('group', { name: 'Campo de Jugador 1' });
    // They are pictures of a fact the tile's badge already states, so they are
    // decoration and marked as such — never a second announcement of it.
    const fans = field.querySelectorAll('[aria-hidden="true"] > div');
    expect(fans.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The phase track the mat prints in its free space.
//
// It lives in this file rather than in one of its own for the reason recorded
// in `boardAssets.test.tsx`: every `.tsx` suite pays a jsdom environment, they
// run in parallel, and they share their CPUs with `fullGame.test.ts`, whose
// five-second budget has about half a second of headroom. This suite is
// already about what the mat says; the track is the newest thing it says.

function phaseTrack(): HTMLElement {
  return screen.getByRole('group', { name: m.board.phaseTrack });
}

/** The board straight out of the mulligan: cheap, and always in `main`. */
const playing = openingBoard();

describe('the printed phase track', () => {
  it('prints all five phases, in turn order', () => {
    loadState(playing);
    render(<GameScreen />);
    const boxes = [...phaseTrack().children].map((box) => box.textContent ?? '');
    expect(boxes).toHaveLength(5);
    for (const [i, phase] of TURN_PHASES.entries()) {
      expect(boxes[i], phase).toContain(m.board.turnPhase[phase]);
    }
  });

  it('keeps DON!! spelled DON!!, because it is a name', () => {
    expect(m.board.turnPhase.don).toBe('DON!!');
    expect(messagesFor('en').board.turnPhase.don).toBe('DON!!');
  });

  it('says Principal on the mat and Fase principal in the banner, on purpose', () => {
    // Two registers for one phase: a box on a sheet, and a sentence at the top
    // of the screen. If these ever converge it should be a decision rather
    // than a copy-paste, so the difference is pinned here and in the glossary.
    expect(m.board.turnPhase.main).toBe('Principal');
    expect(m.board.phase.main).toBe('Fase principal');
  });

  it('lights exactly one box, and it is the phase the wire carries', () => {
    // Which is always Main while anyone is looking: Refresh, Draw and DON!! run
    // inside one reducer step, and the engine asserts that a resting playing
    // state is in `main`. The five boxes are signage; this is the honest light.
    loadState(playing);
    render(<GameScreen />);
    expect(playing.phase).toBe('main');
    expect(within(phaseTrack()).getAllByText(m.board.turnPhase.main)).toHaveLength(1);
    expect(phaseTrack().querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });

  it('is drawn on both mats and named on only one', () => {
    // Both sheets really do have it printed. The phase is one global fact, so
    // a screen reader is told it once.
    loadState(playing);
    render(<GameScreen />);
    expect(screen.getAllByRole('group', { name: m.board.phaseTrack })).toHaveLength(1);
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });
});

describe('the moment, which is the part that moves', () => {
  it('lights nothing during the mulligan', () => {
    // Before the turn structure starts there is no phase to be in. `view.phase`
    // still holds a value; lighting it would claim a turn that is not running.
    loadState({ ...playing, status: 'mulligan' });
    render(<GameScreen />);
    expect(phaseTrack().querySelectorAll('[aria-current="step"]')).toHaveLength(0);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('lights nothing once the game is over', () => {
    loadState({ ...playing, status: 'finished', winner: 'p1' });
    render(<GameScreen />);
    expect(phaseTrack().querySelectorAll('[aria-current="step"]')).toHaveLength(0);
  });

  it('marks the Block Step on the lit box, which the wire phase cannot', () => {
    // `view.phase` is `main` throughout a battle. Without this the track would
    // say nothing about the one moment a defender has to act in.
    loadState({
      ...playing,
      battle: {
        step: 'block',
        attacker: playing.players.p1.leader,
        target: playing.players.p2.leader,
        originalTarget: playing.players.p2.leader,
        wasBlocked: false,
      },
    });
    render(<GameScreen />);
    expect(within(phaseTrack()).getByText(m.board.moment.blockStep)).toBeDefined();
    // The short form, deliberately. The Banner and the battle panel own the
    // long one, and two suites address that panel by exactly those words — a
    // mat that repeated them would make the panel ambiguous.
    expect(m.board.moment.blockStep).toBe('Bloqueo');
    expect(m.board.phase.blockStep).toBe('Paso de Bloqueo');
    // And it is a mark ON the lit box, not a sixth box.
    expect([...phaseTrack().children]).toHaveLength(5);
  });
});

describe('the fan', () => {
  it('does not overlap at all until a hand outgrows the row', () => {
    for (let n = 1; n <= 7; n += 1) {
      for (let i = 0; i < n; i += 1) {
        expect(fanGeometry(i, n).overlap, `n=${n}`).toBe(0);
      }
    }
  });

  it('compresses instead of overflowing, to a bounded footprint', () => {
    // The property that matters: a hand of any size occupies about the same
    // width. A game of nothing but End Turn really does reach 39 cards.
    const width = (n: number): number => 1 + (n - 1) * (1 - fanGeometry(0, n).overlap);
    expect(width(8)).toBeLessThanOrEqual(7.6);
    expect(width(12)).toBeLessThanOrEqual(7.6);
    expect(width(28)).toBeLessThanOrEqual(7.6);
    // Past the overlap cap it grows again, slowly and on purpose: below that
    // sliver a card stops being clickable at all.
    expect(width(40)).toBeLessThan(9);
  });

  it('keeps a visible sliver of every card, which is where the cost badge is', () => {
    for (const n of [8, 12, 28, 40, 100]) {
      expect(fanGeometry(0, n).overlap, `n=${n}`).toBeLessThanOrEqual(0.8);
    }
  });

  it('tilts symmetrically around the middle and never past the cap', () => {
    const n = 9;
    const angles = Array.from({ length: n }, (_, i) => fanGeometry(i, n).rotation);
    expect(angles[4]).toBe(0);
    expect(angles[0]).toBeCloseTo(-(angles[8] ?? 0), 6);
    for (const angle of angles) {
      expect(Math.abs(angle)).toBeLessThanOrEqual(5.5 * ((n - 1) / 2) + 0.001);
    }
    // A single card is not fanned at all.
    expect(fanGeometry(0, 1)).toEqual({ rotation: 0, lift: 0, overlap: 0 });
  });

  it('carries its geometry as custom properties, never as an inline transform', () => {
    // An inline `transform` cannot be overridden by `:hover`, and straightening
    // the hovered card is what makes an overlapped fan usable.
    loadState(populated);
    const { container } = render(<GameScreen />);
    const slots = container.querySelectorAll('[style*="--fan-rot"]');
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(slot.getAttribute('style')).not.toContain('transform');
    }
    expect(styleSheet('HandRow.module.css')).toContain('var(--fan-rot');
  });

  it('still routes a click on a card inside the arc', () => {
    // The fan wraps each tile in a rotated div; the tile is still the button.
    loadState(populated);
    render(<GameScreen />);
    const hand = screen.getByRole('group', {
      name: `Mano de ${populated.priority === 'p1' ? 'Jugador 1' : 'Jugador 2'}`,
    });
    const tiles = within(hand).getAllByRole('button');
    expect(tiles.length).toBeGreaterThan(3);
    // Every card in the fan, not only the first: an overlapped card that cannot
    // be clicked is the failure this arc could plausibly introduce.
    for (const tile of tiles) {
      fireEvent.click(tile);
      fireEvent.keyDown(window, { key: 'Escape' });
    }
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

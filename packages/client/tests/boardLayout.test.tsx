// @vitest-environment jsdom
//
// The board: its sheet, its zones, its phases, its assets and its fan.
//
// jsdom has no layout engine — every box is 0x0 and `getComputedStyle` does not
// resolve a stylesheet — so nothing here measures pixels. What it can check is
// structure and declared style, which is where the two bugs the mirror rewrite
// fixed actually lived: a `rotate(180deg)` on a container full of text, and a
// preview that grew into the board instead of into a reserved rail.
//
// ONE FILE, AND DELIBERATELY SO. Every `.tsx` suite spins up its own jsdom
// worker, and those workers share CPUs with `fullGame.test.ts`, whose budget is
// Vitest's default five seconds and whose heaviest test spends about that on
// its own — so it goes red from contention rather than from anything on its
// own path.
//
// Splitting the board's claims across three files made it fail about half the
// runs; putting them back into one fixed it, back to back, while the count of
// TESTS went up either way. Test count is cheap here and file count is not.
//
// Do not read an exact threshold into that. The same commit that measured
// clean later failed on the same machine with nothing changed — a laptop an
// hour into a test marathon is not a stable instrument, and CI is a different
// one again. The direction is what to act on: add board tests HERE rather than
// in a new `.tsx` file. The budget is never the thing to move.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { applyAction, getCardDef } from '@optcg/engine';
import type { GameState } from '@optcg/engine';
import { fanGeometry } from '../src/components/HandRow';
import { LONG_PRESS_MS } from '../src/game/longPress';
import {
  NO_ASSETS,
  assetManifest,
  backgroundImage,
  loadAssetManifest,
  resetAssetManifest,
} from '../src/game/assets';
import type { AssetManifest } from '../src/game/assets';
import {
  BUILTIN_PLAYMATS,
  NEUTRAL_PLAYMAT,
  builtinPlaymat,
  loadPlaymat,
  matTint,
} from '../src/game/playmat';
import { messagesFor } from '../src/i18n';
import { GameScreen } from '../src/screens/GameScreen';
import { TURN_PHASES } from '../src/store/selectors';
import { hotSeatSnapshot, useStore } from '../src/store/store';
import { firstStarterStateWhere } from './corpus';
import { resetViewport, setViewport } from './matchMedia';
import { openingBoard } from './openingBoard';

/** The suites run in Spanish — see `tests/setup.ts`. */
const m = messagesFor('es');

let errorSpy: ReturnType<typeof vi.spyOn>;
const realFetch = globalThis.fetch;

function forgetPlaymats(): void {
  globalThis.localStorage?.removeItem('optcg.playmat.p1');
  globalThis.localStorage?.removeItem('optcg.playmat.p2');
  useStore.setState({ playmats: { p1: NEUTRAL_PLAYMAT, p2: NEUTRAL_PLAYMAT } });
}

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  resetAssetManifest();
  forgetPlaymats();
});

afterEach(() => {
  cleanup();
  errorSpy.mockRestore();
  resetAssetManifest();
  forgetPlaymats();
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

/** Every `selector { … }` rule of a stylesheet, bodies grouped by selector. */
function rules(sheet: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [, selector = '', body = ''] of sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const key = selector.trim();
    out.set(key, [...(out.get(key) ?? []), body]);
  }
  return out;
}

/**
 * A `grid-template-areas` as data: one array of area names per row, in the
 * order they are painted, top to bottom.
 *
 * Bodies are grouped rather than overwritten, and exactly one of them may
 * declare the template. Keying a selector to its last rule is what this used to
 * do, and it silently read an empty template off a second `.condensed.mirrored
 * .field { column-gap }` block that had been added below the real one — a test
 * that reads the wrong rule and passes is worse than no test.
 */
function templateAreas(sheet: string, selector: string): readonly (readonly string[])[] {
  const bodies = rules(sheet).get(selector);
  expect(bodies, `no rule for ${selector}`).toBeDefined();
  const declaring = (bodies ?? []).flatMap((body) => {
    const found = /grid-template-areas:([^;]*);/.exec(body);
    return found === null ? [] : [found[1] ?? ''];
  });
  expect(declaring, `${selector} must declare grid-template-areas exactly once`).toHaveLength(1);
  return [...(declaring[0] ?? '').matchAll(/'([^']*)'/g)].map(([, row = '']) =>
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

/** The half's stylesheet, read once: every template claim below is about it. */
const sheet = styleSheet('SideBoard.module.css');

// ---------------------------------------------------------------------------

describe('nothing that carries text is turned upside down', () => {
  // Phase 1 mirrored the opponent's half with `transform: rotate(180deg)`,
  // which put the Character rows against the centre line and made every label
  // on that half unreadable. The mirror is now a second `grid-template-areas`
  // — a placement, not a rotation.
  const sideBoard = sheet;

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
    // The pile is moved by hand rather than played into. What is under test is
    // a rendering of `SideView.trashTop`, not how a card gets there, and the
    // corpus query that would reach such a position is a ten-seed playout this
    // file cannot afford — see the note on `populated`.
    const top = playing.players.p1.hand[0];
    expect(top).toBeDefined();
    const withTrash: GameState = {
      ...playing,
      players: {
        ...playing.players,
        p1: {
          ...playing.players.p1,
          hand: playing.players.p1.hand.slice(1),
          trash: [top ?? '', ...playing.players.p1.trash],
        },
      },
    };
    loadState(withTrash);
    render(<GameScreen />);
    const field = screen.getByRole('group', { name: 'Campo de Jugador 1' });
    const name = cardNameOf(withTrash, top ?? '');
    expect(within(field).getByText(name)).toBeDefined();
    // Still one button, still addressed by the same name every suite uses.
    expect(within(field).getByRole('button', { name: /^Descarte/ })).toBeDefined();
  });

  it('leaves an empty trash with nothing to look at and nothing to click', () => {
    // Straight out of the mulligan: nobody has discarded anything yet, so this
    // costs three engine calls rather than a corpus scan.
    loadState(playing);
    render(<GameScreen />);
    const field = screen.getByRole('group', { name: 'Campo de Jugador 1' });
    const pile = within(field).getByRole('button', { name: /^Descarte/ }) as HTMLButtonElement;
    expect(pile.disabled).toBe(true);
  });

  it('draws attached DON!! under the card carrying them, as many as four', () => {
    // One action past the opening board — p1 has exactly one DON!! on turn 1
    // and gives it to its Leader. Also cheaper than a corpus scan, and this
    // file already shares a CPU with `fullGame.test.ts`.
    const attached = applyAction(playing, {
      type: 'ATTACH_DON',
      player: 'p1',
      to: playing.players.p1.leader,
      count: 1,
    });
    if (!attached.ok) {
      throw new Error(attached.reason);
    }
    loadState(attached.state);
    render(<GameScreen />);
    const field = screen.getByRole('group', { name: 'Campo de Jugador 1' });
    // They are pictures of a fact the tile's badge already states, so they are
    // decoration and marked as such — never a second announcement of it.
    expect(field.querySelectorAll('[aria-hidden="true"] > div').length).toBeGreaterThan(0);
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

/** The same board, under the name the asset suites below already used. */
const board = playing;

describe('the printed phase track', () => {
  it('prints all five phases in turn order, lights the one the wire carries', () => {
    // Which is always Main while anyone is looking: Refresh, Draw and DON!! run
    // inside one reducer step, and the engine asserts that a resting playing
    // state is in `main`. The five boxes are signage; this is the honest light.
    loadState(playing);
    render(<GameScreen />);
    const boxes = [...phaseTrack().children].map((box) => box.textContent ?? '');
    expect(boxes).toHaveLength(5);
    for (const [i, phase] of TURN_PHASES.entries()) {
      expect(boxes[i], phase).toContain(m.board.turnPhase[phase]);
    }
    expect(playing.phase).toBe('main');
    expect(phaseTrack().querySelectorAll('[aria-current="step"]')).toHaveLength(1);

    // Both sheets really do have the track printed, and both draw it. The
    // phase is one global fact, so a screen reader is told it once.
    expect(screen.getAllByRole('group', { name: m.board.phaseTrack })).toHaveLength(1);
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
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

// ---------------------------------------------------------------------------
// Portrait.

describe('the condensed portrait sheet', () => {
  afterEach(() => {
    resetViewport();
  });

  it('leaves both halves full on a landscape screen', () => {
    setViewport('landscape');
    loadState(populated);
    render(<GameScreen />);
    for (const label of ['Jugador 1', 'Jugador 2']) {
      const side = screen.getByRole('region', { name: label });
      expect(side.className, label).not.toContain('condensed');
    }
  });

  it('condenses the far half, keeps yours whole, and drops nothing from either', () => {
    setViewport('portrait');
    loadState(populated);
    render(<GameScreen />);
    const viewer = populated.priority === 'p1' ? 'Jugador 1' : 'Jugador 2';
    const other = viewer === 'Jugador 1' ? 'Jugador 2' : 'Jugador 1';
    // Both halves carry the class; only the far one carries `mirrored` too,
    // and that pair is what selects the condensed opponent template.
    expect(screen.getByRole('region', { name: other }).className).toContain('condensed');
    expect(screen.getByRole('region', { name: other }).className).toContain('mirrored');
    expect(screen.getByRole('region', { name: viewer }).className).toContain('condensed');
    expect(screen.getByRole('region', { name: viewer }).className).not.toContain('mirrored');

    for (const label of ['Jugador 1', 'Jugador 2']) {
      const field = screen.getByRole('group', { name: `Campo de ${label}` });
      // Nothing is dropped. The far half gets smaller, not emptier — what it
      // loses is pictures of numbers, and it keeps the numbers.
      expect(within(field).getByText('Líder'), label).toBeDefined();
      expect(within(field).getByText('Área de Personajes'), label).toBeDefined();
      expect(within(field).getByText('Vida'), label).toBeDefined();
      expect(within(field).getByText('Mazo'), label).toBeDefined();
      expect(within(field).getByRole('button', { name: /^DON!!/ }), label).toBeDefined();
    }
  });

  it('follows the screen when it turns, rather than only reading it once', () => {
    // The half of `useCondensedLayout` a stub returning a constant never
    // touches: rotating a phone mid-match has to redraw the table.
    setViewport('landscape');
    loadState(populated);
    render(<GameScreen />);
    const opponent = populated.priority === 'p1' ? 'Jugador 2' : 'Jugador 1';
    expect(screen.getByRole('region', { name: opponent }).className).not.toContain('condensed');

    act(() => {
      setViewport('portrait');
    });
    expect(screen.getByRole('region', { name: opponent }).className).toContain('condensed');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('has a portrait template for each half, over the same nine zones', () => {
    const condensedFar = templateAreas(sheet, '.condensed.mirrored .field');
    const condensedNear = templateAreas(sheet, '.condensed:not(.mirrored) .field');
    for (const [name, template] of [
      ['far', condensedFar],
      ['near', condensedNear],
    ] as const) {
      const named = [...new Set(template.flat())].sort();
      // `phases` is absent from the far template on purpose: one track is
      // enough on a phone, and the one to drop is the one no screen reader
      // was being told about anyway.
      const expected = name === 'far' ? MAT_AREAS.filter((area) => area !== 'phases') : MAT_AREAS;
      expect(named, name).toEqual([...expected].sort());
      expect([...new Set(template.map((row) => row.length))], name).toHaveLength(1);
    }
    // And the near half still has its Character Area against the centre line.
    expect(condensedNear[0]).toContain('character');
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

// ===========================================================================
// The assets this machine has, and what the player may pick from them.
//
// The board straight out of the mulligan is enough for all of it: what these
// check is which pictures are declared over it, not what is on it.

const TWO_MATS: AssetManifest = {
  cardBack: null,
  donBack: null,
  playmats: [
    { id: 'east_blue', file: 'playmats/east_blue.png', name: 'East Blue' },
    { id: 'op01-launch', file: 'playmats/op01-launch.png', name: 'Op01 Launch' },
  ],
};


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
  /** Drives the loader without a screen: none of these claims needs one. */
  async function load(): Promise<void> {
    loadAssetManifest();
    await Promise.resolve();
    await Promise.resolve();
  }

  it('asks once for the manifest, and treats a 404 as "there is nothing here"', async () => {
    const asked: string[] = [];
    globalThis.fetch = vi.fn((input: unknown) => {
      asked.push(String(input));
      return Promise.resolve(new Response('', { status: 404 }));
    }) as unknown as typeof fetch;

    await load();
    // Twice would be twice: the manifest is a fact about the machine, and the
    // machine does not change while the tab is open.
    loadAssetManifest();
    expect(asked).toEqual(['/cards/manifest.json']);
    expect(assetManifest()).toBe(NO_ASSETS);
  });

  it('survives a fetch that rejects, without an unhandled rejection', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    await load();
    expect(assetManifest()).toBe(NO_ASSETS);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('survives a body that parses but is not a manifest', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response('"a string"', { status: 200 })),
    ) as unknown as typeof fetch;
    await load();
    expect(assetManifest()).toBe(NO_ASSETS);
  });

  it('runs at all where there is no fetch to call', async () => {
    // Not hypothetical: `loadAssetManifest` is called from a render, and a
    // render must not depend on a global an environment may not have.
    // @ts-expect-error — deleting a global is the point of the test.
    delete globalThis.fetch;
    await load();
    expect(assetManifest()).toBe(NO_ASSETS);
  });

  it('draws the board anyway, with nothing declared over the shipped back', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response('', { status: 404 })),
    ) as unknown as typeof fetch;
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

// ---------------------------------------------------------------------------
// The mat, and who gets to choose it.

function pickerFor(player: 'Jugador 1' | 'Jugador 2'): HTMLSelectElement {
  return screen.getByRole('combobox', {
    name: m.playmat.forPlayer(player),
  }) as HTMLSelectElement;
}

function matOf(player: 'Jugador 1' | 'Jugador 2'): string {
  return screen.getByRole('group', { name: `Campo de ${player}` }).getAttribute('style') ?? '';
}

describe('choosing a mat', () => {
  beforeEach(() => {
    resetAssetManifest(TWO_MATS);
  });

  it('offers the ones we draw plus whatever the local archive has, per seat', () => {
    loadState(board);
    render(<GameScreen />);
    for (const player of ['Jugador 1', 'Jugador 2'] as const) {
      const options = [...pickerFor(player).options].map((option) => option.textContent);
      expect(options, player).toEqual([
        m.playmat.builtin.neutral,
        m.playmat.builtin.red,
        m.playmat.builtin.green,
        m.playmat.builtin.blue,
        m.playmat.builtin.purple,
        'East Blue',
        'Op01 Launch',
      ]);
    }
  });

  it('names every mat it draws, and starts the two seats on different ones', () => {
    // The ids are a union, so a mat added without a name does not compile.
    // This is the other half: that the compiler was told about all of them.
    const en = messagesFor('en');
    for (const mat of BUILTIN_PLAYMATS) {
      expect(m.playmat.builtin[mat.id], mat.id).toBeTruthy();
      expect(en.playmat.builtin[mat.id], mat.id).toBeTruthy();
    }
    expect(BUILTIN_PLAYMATS).toHaveLength(5);

    // Nobody has chosen anything — storage is cleared in `beforeEach` — and
    // the two seats still differ. Two identical mats are one mat with a line
    // through it, which is the whole reason there is a set of colours.
    expect(loadPlaymat('p1')).not.toBe(loadPlaymat('p2'));
    const tints = [loadPlaymat('p1'), loadPlaymat('p2')].map(
      (id) => matTint(builtinPlaymat(id)?.hue ?? null)['--mat-base'],
    );
    expect(tints[0]).toBeDefined();
    expect(tints[0]).not.toBe(tints[1]);
    // And no tint at all for the untinted one: the stylesheet's own fallback
    // is the slate, so "no colour" needs no rule.
    expect(matTint(builtinPlaymat(NEUTRAL_PLAYMAT)?.hue ?? null)).toEqual({});
  });

  it('paints the chosen mat on that seat only', () => {
    loadState(board);
    render(<GameScreen />);
    fireEvent.change(pickerFor('Jugador 1'), { target: { value: 'east_blue' } });

    expect(matOf('Jugador 1')).toContain('url("/cards/playmats/east_blue.png")');
    // The other half keeps what it had. Two seats, two mats, one table.
    expect(matOf('Jugador 2')).toContain('--playmat: none');

    // And one of ours is a hue on the drawn mat, declared the same way.
    fireEvent.change(pickerFor('Jugador 2'), { target: { value: 'green' } });
    expect(matOf('Jugador 2')).toContain('--mat-base: hsl(145');
    expect(matOf('Jugador 1')).not.toContain('--mat-base');
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
    // And the seat that was not touched is untouched, in storage too: nothing
    // written, and the read falls back to that seat's own default.
    expect(globalThis.localStorage?.getItem('optcg.playmat.p1')).toBeNull();
    expect(loadPlaymat('p1')).toBe('red');
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

  it('is still a real choice on a machine with no local archive', () => {
    // It used to hide itself here, because the only mat we drew was one grey
    // sheet and a select with a single option is not a choice. Drawing a set
    // of colours is what turned that into a choice — and no clone has the
    // official mats, so this is the case that has to be worth offering.
    resetAssetManifest();
    loadState(board);
    render(<GameScreen />);
    for (const player of ['Jugador 1', 'Jugador 2'] as const) {
      expect([...pickerFor(player).options], player).toHaveLength(BUILTIN_PLAYMATS.length);
    }
    // No official file is declared, and the drawn mat is what shows.
    expect(matOf('Jugador 1')).toContain('--playmat: none');
    expect(screen.getByRole('group', { name: 'Campo de Jugador 1' })).toBeDefined();
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

// ===========================================================================
// The gestures a finger has and a mouse does not.
//
// Here rather than in a touch suite of its own, for the reason at the top of
// this file: one more .tsx file is one more jsdom worker against the canary,
// and adding one put it over on the very run that measured it.

/**
 * Two turns past the opening, so the acting seat can actually afford a card.
 *
 * On turn 1 with one DON!! nothing in a starter hand is playable, and a tap on
 * an unplayable card correctly does nothing at all — which makes it useless for
 * telling "the tap arrived" from "the tap was swallowed". Four engine calls buy
 * a board where the difference is visible.
 */
function playableBoard(): GameState {
  let state = openingBoard();
  for (let i = 0; i < 4; i += 1) {
    const result = applyAction(state, { type: 'END_TURN', player: state.activePlayer });
    if (!result.ok) {
      throw new Error(result.reason);
    }
    state = result.state;
  }
  return state;
}

const heldBoard: GameState = playableBoard();

/**
 * A card of the acting seat's hand that the affordances say may be played.
 *
 * By position: the hand renders in the view's own order, so the index of the
 * first playable id is the index of its tile. The affordances decide, never
 * this test — the same rule the UI itself follows.
 */
function playableHandCard(): HTMLElement {
  const seat = heldBoard.priority;
  const hand = heldBoard.players[seat].hand;
  const affordances = useStore.getState().affordances;
  const index = hand.findIndex((id) => affordances?.byCard[id]?.canPlay === true);
  expect(index, 'expected a playable card in hand').toBeGreaterThanOrEqual(0);

  const label = seat === 'p1' ? 'Jugador 1' : 'Jugador 2';
  const group = screen.getByRole('group', { name: `Mano de ${label}` });
  const tile = within(group).getAllByRole('button')[index];
  if (tile === undefined) {
    throw new Error('hand tile and hand id are out of step');
  }
  return tile;
}
/** The first card of the acting seat's hand — something real to hold. */
function handCard(): HTMLElement {
  const seat = heldBoard.priority === 'p1' ? 'Jugador 1' : 'Jugador 2';
  const hand = screen.getByRole('group', { name: `Mano de ${seat}` });
  const tiles = within(hand).getAllByRole('button');
  const first = tiles[0];
  if (first === undefined) {
    throw new Error('expected a card in hand');
  }
  return first;
}

/**
 * jsdom fires no pointer events of its own and `PointerEvent` is not
 * implemented, so the coordinates ride on a plain event. Testing Library's
 * `fireEvent.pointerDown` builds one from whatever it is handed, which is
 * exactly what the component reads: `pointerType` and two numbers.
 */
function press(el: HTMLElement, init: Record<string, unknown> = {}): void {
  fireEvent.pointerDown(el, { pointerType: 'touch', clientX: 100, clientY: 100, ...init });
}

// ---------------------------------------------------------------------------

describe('holding a card', () => {
  // Scoped to this block, not the file: the rest of the suite renders real
  // components with real timers, and a global fake clock would change what
  // every one of them is testing.
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens the enlarged view, and lets go of it on release', () => {
    loadState(heldBoard);
    render(<GameScreen />);
    const card = handCard();

    press(card);
    expect(useStore.getState().pressing).toBeNull();
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(useStore.getState().pressing).not.toBeNull();

    fireEvent.pointerUp(card, { pointerType: 'touch' });
    expect(useStore.getState().pressing).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('is a look and not a move: the press dispatches nothing', () => {
    // The claim that matters. A player reading a card must not play it.
    loadState(heldBoard);
    render(<GameScreen />);
    const before = useStore.getState().gameState;
    const card = handCard();

    press(card);
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });

    expect(useStore.getState().gameState).toBe(before);
    expect(useStore.getState().ui.mode).toEqual({ kind: 'idle' });
  });

  it('swallows the click the browser fires after it, and only that one', () => {
    loadState(heldBoard);
    render(<GameScreen />);
    const card = playableHandCard();

    press(card);
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    fireEvent.pointerUp(card, { pointerType: "touch" });
    fireEvent.click(card);
    // The look did not become a move.
    expect(useStore.getState().ui.mode).toEqual({ kind: 'idle' });

    // And the very next tap does what a tap has always done.
    fireEvent.click(card);
    expect(useStore.getState().ui.mode).not.toEqual({ kind: 'idle' });
  });

  it('does not fire when the finger moves — that is a scroll, not a hold', () => {
    loadState(heldBoard);
    render(<GameScreen />);
    const card = handCard();

    press(card);
    fireEvent.pointerMove(card, { pointerType: 'touch', clientX: 100, clientY: 160 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    });
    expect(useStore.getState().pressing).toBeNull();
  });

  it('ignores a mouse, which already has a hover', () => {
    loadState(heldBoard);
    render(<GameScreen />);
    const card = playableHandCard();

    fireEvent.pointerDown(card, { pointerType: 'mouse', clientX: 100, clientY: 100 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    });
    expect(useStore.getState().pressing).toBeNull();
    // And a mouse click is still a move, with nothing swallowed.
    fireEvent.click(card);
    expect(useStore.getState().ui.mode).not.toEqual({ kind: 'idle' });
  });
});

describe('tap is untouched', () => {
  it('still selects a card in hand, with no pointer sequence at all', () => {
    loadState(heldBoard);
    render(<GameScreen />);
    fireEvent.click(playableHandCard());
    expect(useStore.getState().ui.mode).not.toEqual({ kind: 'idle' });
  });
});

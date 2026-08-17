import { create } from 'zustand';
import {
  applyAction,
  legalActions,
  playerView,
  redactEvent,
  redactLog,
  redactPending,
  PLAYER_IDS,
} from '@optcg/engine';
import type {
  Action,
  GameEvent,
  GameState,
  InstanceId,
  PlayerId,
  PlayerView,
  ViewEvent,
} from '@optcg/engine';
import { getAffordances, indexAffordances } from '../game/affordances';
import type { Affordances } from '../game/affordances';
import { initialLocale, saveLocale } from '../i18n/locale';
import type { Locale } from '../i18n/locale';
import { initialPlaymats, savePlaymat } from '../game/playmat';
import type { PlaymatId } from '../game/playmat';
import { groupEvents } from '../game/animQueue';
import type { AnimGroup } from '../game/animQueue';
import { toAction } from '../game/intent';
import { createGameFromSetup } from '../game/newGame';
import type { SetupConfig } from '../game/newGame';
import { ensureModeValid, reduceUiMode } from '../game/uiMode';
import type { UiEvent, UiMode } from '../game/uiMode';

export type { SetupConfig } from '../game/newGame';

/**
 * **Everything on screen is drawn from a `PlayerView`, in both modes.**
 *
 * Networked, the view is what the server sent: the client owns no `GameState`,
 * runs no `applyAction`, computes no `legalActions`. Hot-seat, the client still
 * owns the state — it is the harness the whole card corpus is driven through —
 * but it *renders* `playerView(state, priority)` all the same, so there is one
 * render path rather than two. Two paths would be the same rule encoded twice,
 * and the redaction is exactly the rule where one copy quietly stops matching
 * the other.
 *
 * The rendered seat in hot-seat is **whoever holds priority**, which is what
 * pass-and-play already meant: the device is in the hands of the player who
 * acts, they see their own cards, and the other half of the table is backs and
 * counts.
 */
export type ClientMode = 'hotseat' | 'network';

export interface NetState {
  /** Where the socket stands. `lost` is what raises the reconnect banner. */
  status: 'connecting' | 'open' | 'lost';
  matchId: string;
  seat: PlayerId | null;
  /** A transport-level refusal (bad token, unknown match) — terminal. */
  error: string | null;
}

export interface UiState {
  mode: UiMode;
  veilOpponentHand: boolean;
  /**
   * The card under the pointer, for the preview panel. Presentation only: it
   * never gates an action and is deliberately not part of `mode`, because a
   * mode is a step of an interaction and hovering is not one.
   */
  hovered: InstanceId | null;
  /**
   * Whose trash is open in the pile viewer, or null.
   *
   * Presentation only, and deliberately not a `UiMode`: a mode is a step of an
   * interaction that ends in an action, and looking through a trash pile ends
   * in nothing. Keeping it out means it cannot be invalidated by a priority
   * change or clobber a targeting mode a player was halfway through.
   */
  viewingTrash: PlayerId | null;
}

export interface StoreState {
  screen: 'setup' | 'playing';
  mode: ClientMode;
  /**
   * The language everything on screen is drawn in.
   *
   * Store state because it is read from every corner of the tree and has to
   * re-render all of it at once — and store state **only**: it is never part of
   * a game frame, never derived from one, and never sent anywhere. Changing it
   * mid-match is a re-render, which is why the control is offered during play.
   */
  locale: Locale;
  /**
   * The mat each seat plays on. Same rule as the locale, seat by seat: local,
   * cosmetic, and never on the wire. See `game/playmat.ts`.
   */
  playmats: Record<PlayerId, PlaymatId>;
  setup: SetupConfig | null;
  /**
   * Hot-seat only: the authoritative state this client owns and drives. Null
   * over a network, where the state is the server's and this client has no
   * copy of it — which is the whole point of the mode.
   */
  gameState: GameState | null;
  /**
   * The view the **server** sent. Null in hot-seat, where the client owns the
   * state and derives its own — read it through `selectView`, never directly,
   * so both modes come out of one accessor.
   */
  netView: PlayerView | null;
  /** What the acting seat may do, indexed from the engine's own list. */
  affordances: Affordances | null;
  /**
   * The client's own journal of redacted event batches, per seat.
   *
   * History is accumulated, never re-derived — PR #44's finding applied on
   * this side of the wire: the engine's redaction is memoryless, so folding
   * the log again later shows a player *less* than they watched. Networked,
   * only this client's seat is ever filled (from the server's batches, and
   * from the journal a rejoin replays). Hot-seat fills both, because the one
   * screen is handed between two players and each must read their own history.
   */
  journals: Record<PlayerId, ViewEvent[]>;
  animQueue: AnimGroup[];
  ui: UiState;
  /** Player the device was handed to; drives PassDeviceScreen in hot-seat. */
  deviceAckFor: PlayerId | null;
  /**
   * The card being held down under a touch pointer — see `game/longPress.ts`.
   *
   * Top-level rather than inside `ui` because several suites build a `ui`
   * object by hand, and a field none of them cares about should not make all
   * of them mention it. It is presentation either way: looking, never a move.
   */
  pressing: InstanceId | null;
  net: NetState | null;
  /**
   * The last rejection, for the player who caused it. With the affordances
   * travelling this should not happen; a lost race can still produce one, and
   * a notice that the next update clears is the honest way to say so.
   */
  notice: string | null;
  /** Switches language, in place and mid-match. Persisted; never dispatched. */
  setLocale: (locale: Locale) => void;
  setPlaymat: (player: PlayerId, id: PlaymatId) => void;
  newGame: (cfg: SetupConfig) => void;
  /** Replays the stored setup — same seed, same game. */
  rematch: () => void;
  toSetup: () => void;
  /** The ONLY applyAction call site in the client, and hot-seat only. */
  dispatch: (action: Action) => void;
  /** Routes UI clicks through reduceUiMode; blocked while animations run. */
  uiEvent: (ev: UiEvent) => void;
  /** Pops the head animation group once its duration elapsed. */
  animTick: (groupId: number) => void;
  endTurn: () => void;
  pass: () => void;
  concede: () => void;
  /** Mulligan answer for whoever holds priority. */
  answerMulligan: (accept: boolean) => void;
  toggleVeil: () => void;
  /** Confirms the handoff to the player who holds priority. */
  ackDevice: () => void;
  /** Points the preview panel at a card, or clears it. Never blocked. */
  hover: (instanceId: InstanceId | null) => void;
  /** Opens or closes the held-card view. Looking, never a move. */
  pressCard: (instanceId: InstanceId | null) => void;
  /** Opens or closes the trash viewer. Reading a public zone, never an action. */
  viewTrash: (player: PlayerId | null) => void;
  // --- network mode -------------------------------------------------------
  /** Enters network mode; the connection layer feeds the three hooks below. */
  netStart: (matchId: string) => void;
  netStatus: (status: NetState['status']) => void;
  /** The server accepted the seat: present plus the journal it kept for us. */
  netJoined: (payload: {
    seat: PlayerId;
    view: PlayerView;
    journal: ViewEvent[][];
    actions: Action[];
  }) => void;
  netUpdate: (payload: { view: PlayerView; events: ViewEvent[]; actions: Action[] }) => void;
  netRejected: (reason: string) => void;
  netError: (code: string) => void;
}

function idleUi(): UiState {
  return { mode: { kind: 'idle' }, veilOpponentHand: false, hovered: null, viewingTrash: null };
}

function emptyJournals(): Record<PlayerId, ViewEvent[]> {
  return { p1: [], p2: [] };
}

/**
 * The hot-seat frame: one state in, everything the board needs out.
 *
 * The view is derived for whoever holds priority, and the new events are
 * redacted **once per seat** and appended to that seat's journal — the same
 * shape the server keeps, for the same reason. A single shared journal would
 * hand the player who picks up the device the other one's history.
 */
function hotSeatFrame(
  state: GameState,
  events: readonly GameEvent[],
  journals: Record<PlayerId, ViewEvent[]>,
): {
  affordances: Affordances;
  journals: Record<PlayerId, ViewEvent[]>;
  /** The rendered seat's batch — what the animation queue plays. */
  viewerEvents: ViewEvent[];
} {
  const viewer = state.priority;
  const next: Record<PlayerId, ViewEvent[]> = { p1: [...journals.p1], p2: [...journals.p2] };
  const batches: Record<PlayerId, ViewEvent[]> = { p1: [], p2: [] };
  for (const seat of PLAYER_IDS) {
    // The dropped-choice set is per batch here rather than threaded: it exists
    // so a dropped yes/no offer takes its answer with it, and in hot-seat both
    // arrive inside the same batch — the engine settles an opt-in and its
    // answer without an action in between.
    const dropped = new Set<string>();
    for (const event of events) {
      const redacted = redactEvent(state, seat, event, dropped);
      if (redacted !== null) {
        next[seat].push(redacted);
        batches[seat].push(redacted);
      }
    }
  }
  return {
    affordances: indexAffordances(
      legalActions(state, viewer),
      viewer,
      redactPending(state, viewer),
    ),
    journals: next,
    // Animate what this seat saw, not what happened: a card the viewer may not
    // name has no tile to light up, and the group that would have highlighted
    // it still runs, still takes its time, and highlights nothing.
    viewerEvents: batches[viewer],
  };
}

/**
 * Everything a hot-seat position implies, from a state alone.
 *
 * `newGame` uses it, and so does every prepared position — a mid-game board
 * that no constructor path through the store can produce. Exported so those
 * two agree by construction: a caller that assembled the view, the affordances
 * and the journal by hand would be deriving the board a second way, which is
 * the one thing this whole PR is about not doing.
 *
 * The journal is the **whole log redacted**, which is the one case where
 * re-deriving history is honest: a reader with no journal to catch up from
 * never saw the live version to be short-changed against. Every other frame
 * appends the batch it was given.
 */
export function hotSeatSnapshot(
  state: GameState,
): Pick<StoreState, 'gameState' | 'netView' | 'affordances' | 'journals'> {
  return {
    gameState: state,
    netView: null,
    affordances: hotSeatFrame(state, [], emptyJournals()).affordances,
    journals: { p1: redactLog(state, 'p1'), p2: redactLog(state, 'p2') },
  };
}

// Single-entry memo, keyed by state identity — exact, because engine states are
// frozen and replaced rather than mutated.
let memoState: GameState | null = null;
let memoView: PlayerView | null = null;

/**
 * **The board, in one accessor, for both modes.**
 *
 * Networked it is the payload the server sent. Hot-seat it is
 * `playerView(state, priority)` — derived here, on read, rather than stored on
 * every action. The derivation is pure and memoized by state identity, so
 * reading it a hundred times costs one; and a driver that never draws a board
 * — every headless suite in this package — pays nothing at all, which is what
 * keeps a hundred cards' worth of `getPower` out of a loop that only wanted to
 * click.
 *
 * There is still exactly one render path: every selector in this package comes
 * through here, and what it gets back is a `PlayerView` either way.
 */
export function selectView(s: StoreState): PlayerView | null {
  if (s.mode === 'network') {
    return s.netView;
  }
  const state = s.gameState;
  if (state === null) {
    return null;
  }
  if (memoState !== state && state !== null) {
    memoState = state;
    memoView = playerView(state, state.priority);
  }
  return memoView;
}

export const useStore = create<StoreState>()((set, get) => {
  // Global affordances become store actions so components never build Actions.
  // The legality gate lives here, not in the JSX that renders each button.
  const GLOBAL_FLAGS = {
    PASS: 'canPass',
    END_TURN: 'canEndTurn',
    CONCEDE: 'canConcede',
  } as const;

  const globalAction =
    (type: 'PASS' | 'END_TURN' | 'CONCEDE') =>
    (): void => {
      const { affordances, animQueue, dispatch } = get();
      if (affordances === null || animQueue.length > 0) {
        return;
      }
      if (!affordances.global[GLOBAL_FLAGS[type]]) {
        return;
      }
      dispatch(toAction({ type }, affordances.whoActs));
    };

  return {
    screen: 'setup',
    mode: 'hotseat',
    locale: initialLocale(),
    playmats: initialPlaymats(),
    setup: null,
    gameState: null,
    netView: null,
    affordances: null,
    journals: emptyJournals(),
    ui: idleUi(),
    animQueue: [],
    deviceAckFor: null,
    pressing: null,
    net: null,
    notice: null,

    setLocale: (locale) => {
      if (get().locale === locale) {
        return;
      }
      saveLocale(locale);
      // Nothing else moves. No action, no socket write, no state rebuild: the
      // board is derived from a `PlayerView` that knows nothing about language,
      // so the whole of a language change is this line plus a render.
      set({ locale });
    },

    setPlaymat: (player, id) => {
      const current = get().playmats;
      if (current[player] === id) {
        return;
      }
      savePlaymat(player, id);
      // And nothing else, for exactly the reasons above. A mat is paint.
      set({ playmats: { ...current, [player]: id } });
    },

    newGame: (cfg) => {
      const gameState = createGameFromSetup(cfg);
      set({
        screen: 'playing',
        mode: 'hotseat',
        setup: cfg,
        ...hotSeatSnapshot(gameState),
        ui: idleUi(),
        animQueue: [],
        net: null,
        notice: null,
        // The device already sits with the first player to act.
        deviceAckFor: gameState.priority,
      });
    },

    rematch: () => {
      const setup = get().setup;
      if (setup === null) {
        return;
      }
      get().newGame(setup);
    },

    toSetup: () =>
      set({
        screen: 'setup',
        mode: 'hotseat',
        gameState: null,
        netView: null,
        affordances: null,
        journals: emptyJournals(),
        ui: idleUi(),
        animQueue: [],
        deviceAckFor: null,
        net: null,
        notice: null,
      }),

    dispatch: (action) => {
      const { mode, gameState, animQueue, ui, journals } = get();
      if (mode === 'network') {
        // Nothing local happens: the action goes to the server and the board
        // moves when the update comes back. `netSend` is installed by the
        // connection layer, which owns the socket.
        netSend?.(action);
        return;
      }
      if (gameState === null) {
        return;
      }
      const result = applyAction(gameState, action);
      if (!result.ok) {
        // Acceptance criterion: an illegal action from the UI is a UI bug and
        // must be loud. No throw — the board simply does not change.
        console.error('UI bug: illegal action', action, result.reason);
        return;
      }
      const frame = hotSeatFrame(result.state, result.events, journals);
      set({
        gameState: result.state,
        affordances: frame.affordances,
        journals: frame.journals,
        animQueue: [...animQueue, ...groupEvents(frame.viewerEvents)],
        ui: { ...ui, mode: ensureModeValid(ui.mode, frame.affordances) },
      });
    },

    uiEvent: (ev) => {
      const { affordances, animQueue, ui, dispatch } = get();
      if (affordances === null || animQueue.length > 0) {
        return; // input blocked while animations play
      }
      const result = reduceUiMode(ui.mode, ev, affordances);
      set({ ui: { ...ui, mode: result.mode } });
      if (result.intent !== undefined) {
        dispatch(toAction(result.intent, affordances.whoActs));
      }
    },

    animTick: (groupId) => {
      const queue = get().animQueue;
      const head = queue[0];
      if (head === undefined || head.id !== groupId) {
        return; // stale tick
      }
      set({ animQueue: queue.slice(1) });
    },

    endTurn: globalAction('END_TURN'),
    pass: globalAction('PASS'),
    concede: globalAction('CONCEDE'),

    answerMulligan: (accept) => {
      const { affordances, animQueue, dispatch } = get();
      if (affordances === null || animQueue.length > 0) {
        return;
      }
      if (!affordances.global.mustAnswerMulligan) {
        return;
      }
      dispatch(toAction({ type: 'MULLIGAN', accept }, affordances.whoActs));
    },

    toggleVeil: () => {
      const ui = get().ui;
      set({ ui: { ...ui, veilOpponentHand: !ui.veilOpponentHand } });
    },

    hover: (instanceId) => {
      // Not gated on the animation queue: the queue blocks *input*, and looking
      // at a card is not input. Freezing the preview mid-animation would hide
      // the one thing a player wants to read while the board settles.
      const ui = get().ui;
      if (ui.hovered === instanceId) {
        return;
      }
      set({ ui: { ...ui, hovered: instanceId } });
    },

    pressCard: (instanceId) => {
      // Holding a card is looking at it, so it drives the same preview a hover
      // does — and additionally raises the overlay, because the rail a hover
      // fills is not on screen on the pointer that needs this.
      //
      // A top-level field rather than one inside `ui` on purpose: several
      // suites build a `ui` object by hand, and a field none of them cares
      // about should not make all of them mention it.
      const ui = get().ui;
      set({ pressing: instanceId, ui: { ...ui, hovered: instanceId } });
    },

    viewTrash: (player) => {
      // The trash is public information in the real game — both players may
      // read either pile, at any time, and doing so is not a move.
      const ui = get().ui;
      if (ui.viewingTrash === player) {
        return;
      }
      set({ ui: { ...ui, viewingTrash: player } });
    },

    ackDevice: () => {
      const state = get().gameState;
      if (state === null) {
        return;
      }
      set({ deviceAckFor: state.priority });
    },

    netStart: (matchId) =>
      set({
        screen: 'playing',
        mode: 'network',
        gameState: null,
        netView: null,
        affordances: null,
        journals: emptyJournals(),
        ui: idleUi(),
        animQueue: [],
        deviceAckFor: null,
        notice: null,
        net: { status: 'connecting', matchId, seat: null, error: null },
      }),

    netStatus: (status) => {
      const net = get().net;
      if (net === null) {
        return;
      }
      set({ net: { ...net, status } });
    },

    netJoined: ({ seat, view, journal, actions }) => {
      const net = get().net;
      const ui = get().ui;
      const affordances = indexAffordances(actions, seat, view.pending);
      set({
        netView: view,
        affordances,
        // The journal replaces whatever this client had: the server's copy is
        // the authority, and after a reconnection it is also strictly longer.
        journals: { ...emptyJournals(), [seat]: journal.flat() },
        // No animation replay on joining. The queue exists to show a board
        // moving; a rejoining player is catching up on a board that already
        // moved, and re-playing it would be theatre over a stale position.
        animQueue: [],
        net: net === null ? null : { ...net, status: 'open', seat, error: null },
        ui: { ...ui, mode: ensureModeValid(ui.mode, affordances) },
        notice: null,
      });
    },

    netUpdate: ({ view, events, actions }) => {
      const { journals, animQueue, ui, net } = get();
      const seat = net?.seat ?? view.viewer;
      const affordances = indexAffordances(actions, view.viewer, view.pending);
      set({
        netView: view,
        affordances,
        journals: { ...journals, [seat]: [...(journals[seat] ?? []), ...events] },
        animQueue: [...animQueue, ...groupEvents(events)],
        ui: { ...ui, mode: ensureModeValid(ui.mode, affordances) },
        notice: null,
      });
    },

    netRejected: (reason) => set({ notice: reason }),

    netError: (code) => {
      const net = get().net;
      set({ net: net === null ? null : { ...net, status: 'lost', error: code } });
    },
  };
});

/**
 * The socket sink, installed by the connection layer.
 *
 * A module-level hook rather than a field on the store, so nothing that a
 * component can reach holds a live socket: the store stays plain data that a
 * test can build by hand, which is what every jsdom suite in this package
 * depends on.
 */
let netSend: ((action: Action) => void) | null = null;

export function setNetSend(send: ((action: Action) => void) | null): void {
  netSend = send;
}

/**
 * The installed sink. The symmetric read of `setNetSend`, and the one thing
 * that lets a test hold two seats in one process: each has to be able to put
 * its own socket back in front of the store when its turn to act comes round.
 */
export function getNetSend(): ((action: Action) => void) | null {
  return netSend;
}

/** Re-exported so tests and the hot-seat path share one affordance source. */
export { getAffordances };

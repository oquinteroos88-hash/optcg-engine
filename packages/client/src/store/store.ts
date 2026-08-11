import { create } from 'zustand';
import { applyAction } from '@optcg/engine';
import type { Action, GameState, InstanceId, PlayerId } from '@optcg/engine';
import { getAffordances } from '../game/affordances';
import { groupEvents } from '../game/animQueue';
import type { AnimGroup } from '../game/animQueue';
import { toAction } from '../game/intent';
import { createGameFromSetup } from '../game/newGame';
import type { SetupConfig } from '../game/newGame';
import { ensureModeValid, reduceUiMode } from '../game/uiMode';
import type { UiEvent, UiMode } from '../game/uiMode';

export type { SetupConfig } from '../game/newGame';

export interface UiState {
  mode: UiMode;
  veilOpponentHand: boolean;
  /**
   * The card under the pointer, for the preview panel. Presentation only: it
   * never gates an action and is deliberately not part of `mode`, because a
   * mode is a step of an interaction and hovering is not one.
   */
  hovered: InstanceId | null;
}

export interface StoreState {
  screen: 'setup' | 'playing';
  setup: SetupConfig | null;
  gameState: GameState | null;
  ui: UiState;
  animQueue: AnimGroup[];
  /** Player the device was handed to; drives PassDeviceScreen when enabled. */
  deviceAckFor: PlayerId | null;
  newGame: (cfg: SetupConfig) => void;
  /** Replays the stored setup — same seed, same game. */
  rematch: () => void;
  toSetup: () => void;
  /** The ONLY applyAction call site in the client. */
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
}

function idleUi(): UiState {
  return { mode: { kind: 'idle' }, veilOpponentHand: false, hovered: null };
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
      const { gameState, animQueue, dispatch } = get();
      if (gameState === null || animQueue.length > 0) {
        return;
      }
      const aff = getAffordances(gameState);
      if (!aff.global[GLOBAL_FLAGS[type]]) {
        return;
      }
      dispatch(toAction({ type }, aff.whoActs));
    };

  return {
    screen: 'setup',
    setup: null,
    gameState: null,
    ui: idleUi(),
    animQueue: [],
    deviceAckFor: null,

    newGame: (cfg) => {
      const gameState = createGameFromSetup(cfg);
      set({
        screen: 'playing',
        setup: cfg,
        gameState,
        ui: idleUi(),
        animQueue: [],
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
        gameState: null,
        ui: idleUi(),
        animQueue: [],
        deviceAckFor: null,
      }),

    dispatch: (action) => {
      const { gameState, animQueue, ui } = get();
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
      set({
        gameState: result.state,
        animQueue: [...animQueue, ...groupEvents(result.events)],
        ui: { ...ui, mode: ensureModeValid(ui.mode, result.state) },
      });
    },

    uiEvent: (ev) => {
      const { gameState, animQueue, ui, dispatch } = get();
      if (gameState === null || animQueue.length > 0) {
        return; // input blocked while animations play
      }
      const aff = getAffordances(gameState);
      const result = reduceUiMode(ui.mode, ev, aff);
      set({ ui: { ...ui, mode: result.mode } });
      if (result.intent !== undefined) {
        dispatch(toAction(result.intent, aff.whoActs));
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
      const { gameState, animQueue, dispatch } = get();
      if (gameState === null || animQueue.length > 0) {
        return;
      }
      const aff = getAffordances(gameState);
      if (!aff.global.mustAnswerMulligan) {
        return;
      }
      dispatch(toAction({ type: 'MULLIGAN', accept }, aff.whoActs));
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

    ackDevice: () => {
      const gameState = get().gameState;
      if (gameState === null) {
        return;
      }
      set({ deviceAckFor: gameState.priority });
    },
  };
});

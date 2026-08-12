// View-model layer: besides game/, the only place allowed to import engine
// VALUES. Components consume these hooks and stay rule-blind.
import {
  getAbilities,
  getCardDef,
  getPower,
  getPowerWithoutStatics,
  hasKeyword,
  KEYWORDS,
  PRINTED_KEYWORD,
} from '@optcg/engine';
import type { GameEvent, GameState, InstanceId, PlayerId } from '@optcg/engine';
import { getAffordances } from '../game/affordances';
import type { Affordances, ChoiceView } from '../game/affordances';
import { clickStateOf } from '../game/clickState';
import type { ClickState } from '../game/clickState';
import { printedTextOf } from '../game/printed';
import { menuOptions } from '../game/uiMode';
import type { MenuOption, UiMode } from '../game/uiMode';
import { useStore } from './store';

export function playerLabel(player: PlayerId): string {
  return player === 'p1' ? 'Jugador 1' : 'Jugador 2';
}

// ---------------------------------------------------------------------------
// Card view

export interface CardView {
  /** The printed card, not the instance. Only the art layer needs it. */
  cardId: string;
  name: string;
  /** null when the card has no printed cost (leaders) — no badge is drawn. */
  cost: number | null;
  power: number;
  counter: number | null;
  colorClass: string;
  rested: boolean;
  donCount: number;
  /** Printed text. Null on the TEST cards, which print none. */
  effectText: string | null;
  triggerText: string | null;
}

function printedText(cardId: string): { effectText: string | null; triggerText: string | null } {
  const text = printedTextOf(cardId);
  return { effectText: text.effectText, triggerText: text.triggerText };
}

const cardViewCache = new WeakMap<GameState, Map<InstanceId, CardView | null>>();

function cardViewOf(state: GameState, id: InstanceId): CardView | null {
  let perState = cardViewCache.get(state);
  if (perState === undefined) {
    perState = new Map();
    cardViewCache.set(state, perState);
  }
  const cached = perState.get(id);
  if (cached !== undefined) {
    return cached;
  }
  const card = state.cards[id];
  if (card === undefined) {
    perState.set(id, null);
    return null;
  }
  const def = getCardDef(card.cardId);
  const view: CardView = {
    cardId: card.cardId,
    name: def.name,
    // Leaders are printed without a cost; the engine stores 0 for them.
    cost: def.category === 'leader' ? null : def.cost,
    // Single source of truth for power, everywhere: getPower already returns the
    // printed value when nothing modifies the card.
    power: getPower(state, id),
    counter: def.counter,
    colorClass: def.color,
    rested: card.orientation === 'rested',
    donCount: card.attachedDon.length,
    ...printedText(card.cardId),
  };
  perState.set(id, view);
  return view;
}

export function useCardView(id: InstanceId): CardView | null {
  return useStore((s) => (s.gameState === null ? null : cardViewOf(s.gameState, id)));
}

// ---------------------------------------------------------------------------
// Banner

export type PhaseKey = 'mulligan' | 'main' | 'blockStep' | 'counterStep' | 'finished';

export interface BannerView {
  activePlayer: PlayerId;
  priority: PlayerId;
  phase: PhaseKey;
  /** True when the non-active player holds priority — battle or open choice. */
  defenderResponds: boolean;
  /**
   * True while a choice is open. Priority follows `pending.player`, so this is
   * also how a life card's [Trigger] hands control to the damaged player: the
   * phase 1 defender banner already covered the crossing, this names it.
   */
  choiceOpen: boolean;
  winner: PlayerId | null;
}

const bannerCache = new WeakMap<GameState, BannerView>();

function bannerOf(state: GameState): BannerView {
  const cached = bannerCache.get(state);
  if (cached !== undefined) {
    return cached;
  }
  let phase: PhaseKey;
  if (state.status === 'mulligan') {
    phase = 'mulligan';
  } else if (state.status === 'finished') {
    phase = 'finished';
  } else if (state.battle?.step === 'block') {
    phase = 'blockStep';
  } else if (state.battle?.step === 'counter') {
    phase = 'counterStep';
  } else {
    phase = 'main';
  }
  const view: BannerView = {
    activePlayer: state.activePlayer,
    priority: state.priority,
    phase,
    defenderResponds: state.status === 'playing' && state.priority !== state.activePlayer,
    choiceOpen: state.pending !== null,
    winner: state.winner,
  };
  bannerCache.set(state, view);
  return view;
}

export function useBanner(): BannerView | null {
  return useStore((s) => (s.gameState === null ? null : bannerOf(s.gameState)));
}

// ---------------------------------------------------------------------------
// Event log

export interface LogEntry {
  id: number;
  turn: number;
  player: PlayerId | null;
  text: string;
}

function nameOf(state: GameState, id: InstanceId): string {
  const card = state.cards[id];
  return card === undefined ? id : getCardDef(card.cardId).name;
}

function zoneLabel(zone: 'hand' | 'deck' | 'trash' | 'life'): string {
  switch (zone) {
    case 'hand':
      return 'la mano';
    case 'deck':
      return 'el mazo';
    case 'trash':
      return 'el descarte';
    case 'life':
      return 'la vida';
  }
}

function formatEvent(event: GameEvent, state: GameState): { player: PlayerId | null; text: string } {
  switch (event.type) {
    case 'gameStarted':
      return { player: null, text: `Comienza la partida (empieza ${playerLabel(event.firstPlayer)})` };
    case 'mulliganTaken':
      return {
        player: event.player,
        text: event.accepted ? 'toma mulligan y roba una mano nueva' : 'conserva su mano inicial',
      };
    case 'lifeSet':
      return { player: event.player, text: `coloca ${event.count} cartas de vida` };
    case 'turnStarted':
      return { player: event.player, text: `comienza el turno ${event.turn}` };
    case 'cardDrawn':
      return { player: event.player, text: `roba ${nameOf(state, event.instanceId)}` };
    case 'donGained':
      return { player: event.player, text: `gana ${event.count} DON!!` };
    case 'donAttached':
      return { player: event.player, text: `adjunta ${event.count} DON!! a ${nameOf(state, event.to)}` };
    case 'donPaid':
      return { player: event.player, text: `paga ${event.count} DON!!` };
    case 'donReturned':
      // DON!! coming back from a card that left the field return rested, so they
      // cannot be spent this turn; refresh-phase returns come back active.
      return {
        player: event.player,
        text: event.rested
          ? `recupera ${event.count} DON!! agotados (no usables este turno)`
          : `recupera ${event.count} DON!! activos`,
      };
    // El jugador es el dueno de los DON!!, que no siempre es quien activa el
    // efecto: una carta puede agotar los DON!! del rival.
    case 'donOrientationChanged':
      return {
        player: event.player,
        text:
          event.orientation === 'rested'
            ? `agota ${event.count} DON!! de su area de coste`
            : `activa ${event.count} DON!! de su area de coste`,
      };
    case 'cardPlayed':
      return { player: event.player, text: `juega ${nameOf(state, event.instanceId)}` };
    case 'characterTrashedForRoom':
      return {
        player: event.player,
        text: `descarta ${nameOf(state, event.instanceId)} para hacer sitio`,
      };
    case 'stageReplaced':
      return {
        player: event.player,
        text: `reemplaza ${nameOf(state, event.oldStage)} por ${nameOf(state, event.newStage)}`,
      };
    case 'attackDeclared':
      return {
        player: event.player,
        text: `ataca con ${nameOf(state, event.attacker)} a ${nameOf(state, event.target)}`,
      };
    case 'blockDeclared':
      return { player: event.player, text: `bloquea con ${nameOf(state, event.blocker)}` };
    case 'counterPlayed':
      return {
        player: event.player,
        text: `usa ${nameOf(state, event.instanceId)} como contraataque (+${event.value}) sobre ${nameOf(state, event.target)}`,
      };
    case 'battleResolved': {
      // battleResolved carries no player: derive it from the attacker.
      const attackerCard = state.cards[event.attacker];
      const player = attackerCard === undefined ? null : attackerCard.controller;
      const outcome =
        event.outcome === 'ko'
          ? `${nameOf(state, event.target)} queda KO`
          : event.outcome === 'lifeDamage'
            ? 'el ataque impacta en la vida'
            : 'el ataque no tiene efecto';
      return { player, text: `combate resuelto: ${outcome}` };
    }
    case 'battleEndedEarly': {
      // Deliberately not "el ataque no tiene efecto", which is what a battle
      // that reached the Damage Step and lost says. This one never got there:
      // a participant left the field first (CR 7-1-1-4 / 7-1-2-3 / 7-1-3-3),
      // and a player who cannot tell the two apart cannot tell whether their
      // Character survived a hit or was never hit.
      const attackerCard = state.cards[event.attacker];
      const player = attackerCard === undefined ? null : attackerCard.controller;
      const who =
        event.gone === 'attacker'
          ? nameOf(state, event.attacker)
          : event.gone === 'target'
            ? nameOf(state, event.target)
            : 'ambos combatientes';
      return { player, text: `el combate se disipa: ${who} ya no está en juego` };
    }
    case 'lifeTaken':
      return { player: event.player, text: `pierde una carta de vida (quedan ${event.remaining})` };
    case 'koed':
      return { player: event.player, text: `${nameOf(state, event.instanceId)} queda KO` };
    // Efectos de carta. El log es exhaustivo a proposito (no hay `default`),
    // asi que estos casos existen para que el switch siga cerrado. Con los
    // mazos por defecto ninguno de estos eventos llega a ocurrir: esas cartas
    // no tienen habilidades.
    case 'abilityTriggered':
      return {
        player: event.player,
        text: `activa la habilidad de ${nameOf(state, event.source)}`,
      };
    case 'abilityDeclined':
      return {
        player: event.player,
        text: `no activa la habilidad de ${nameOf(state, event.source)}`,
      };
    case 'choiceOpened':
      return { player: event.player, text: `debe elegir: ${event.prompt}` };
    case 'choiceAnswered':
      return { player: event.player, text: 'responde la eleccion' };
    case 'powerGranted':
      return {
        player: state.cards[event.target]?.controller ?? null,
        text: `${nameOf(state, event.target)} gana ${event.value} de poder`,
      };
    case 'keywordGranted':
      return {
        player: state.cards[event.target]?.controller ?? null,
        text: `${nameOf(state, event.target)} gana ${PRINTED_KEYWORD[event.keyword]}`,
      };
    case 'orientationChanged':
      return {
        player: state.cards[event.instanceId]?.controller ?? null,
        text:
          event.orientation === 'rested'
            ? `${nameOf(state, event.instanceId)} queda agotada`
            : `${nameOf(state, event.instanceId)} se activa`,
      };
    case 'cardMoved':
      return {
        player: event.player,
        text: `mueve ${nameOf(state, event.instanceId)} a ${zoneLabel(event.to)}`,
      };
    case 'cardDiscarded':
      return { player: event.player, text: `descarta ${nameOf(state, event.instanceId)}` };
    case 'cardsRevealed':
      return {
        player: event.player,
        text: `revela ${event.instanceIds.map((id) => nameOf(state, id)).join(', ')}`,
      };
    case 'donReturnedToDeck':
      return { player: event.player, text: `devuelve ${event.count} DON!! al mazo de DON!!` };
    case 'lifeBanished':
      return {
        player: event.player,
        text: `pierde una carta de vida al descarte (quedan ${event.remaining})`,
      };
    case 'turnEnded':
      return { player: event.player, text: `termina el turno ${event.turn}` };
    case 'gameEnded': {
      const reason =
        event.endReason === 'lifeOut'
          ? 'sin vida'
          : event.endReason === 'deckOut'
            ? 'sin mazo'
            : 'por concesión';
      return { player: event.winner, text: `gana la partida (${reason})` };
    }
  }
}

/**
 * Events that count as "something happened" inside an ability's window, and the
 * ones that close that window without anything having happened.
 *
 * A resolved ability emits `abilityTriggered` and then, if it resolves into
 * nothing — an "up to 1" answered with nothing, a K.O. with no legal target —
 * emits nothing else. On the board that is indistinguishable from a bug: the
 * player sees the effect fire and sees no change. Naming it in the log is the
 * cheapest honest fix. `choiceOpened`/`choiceAnswered` are neither: an ability
 * that only asked a question still has not done anything.
 */
const EFFECT_EVENTS = new Set<GameEvent['type']>([
  'powerGranted',
  'keywordGranted',
  'koed',
  'cardMoved',
  'cardDiscarded',
  'cardsRevealed',
  'cardDrawn',
  'donAttached',
  'donGained',
  'donReturned',
  'donOrientationChanged',
  'donReturnedToDeck',
  'orientationChanged',
  'lifeTaken',
  'lifeBanished',
  'stageReplaced',
  'characterTrashedForRoom',
]);

const WINDOW_CLOSERS = new Set<GameEvent['type']>([
  'abilityTriggered',
  'abilityDeclined',
  'cardPlayed',
  'attackDeclared',
  'blockDeclared',
  'counterPlayed',
  'battleResolved',
  // Closes an ability window like `battleResolved` does: it is the battle's
  // last word, so an `abilityTriggered` before it with nothing in between
  // really did resolve to nothing.
  'battleEndedEarly',
  'turnStarted',
  'turnEnded',
  'gameEnded',
]);

function resolvedIntoNothing(state: GameState, at: number): boolean {
  const log = state.log;
  for (let i = at + 1; i < log.length; i += 1) {
    const type = log[i]?.type;
    if (type === undefined || WINDOW_CLOSERS.has(type)) {
      return true;
    }
    if (EFFECT_EVENTS.has(type)) {
      return false;
    }
  }
  // Ran off the end of the log: the ability is the last thing that happened, so
  // it has only finished if the engine has nothing left in flight. Mid-choice it
  // has not — labelling it "sin efecto" while the player is still being asked
  // what it should do would be wrong, and it is exactly what a choice-opening
  // ability looks like at the moment the overlay comes up.
  return state.pending === null && state.stack.length === 0 && state.resume.length === 0;
}

const logCache = new WeakMap<GameState, LogEntry[]>();

function logEntriesOf(state: GameState): LogEntry[] {
  const cached = logCache.get(state);
  if (cached !== undefined) {
    return cached;
  }
  let turn = 0;
  const entries = state.log.map((event, index) => {
    if (event.type === 'turnStarted') {
      turn = event.turn;
    }
    const { player, text } = formatEvent(event, state);
    const suffix =
      event.type === 'abilityTriggered' && resolvedIntoNothing(state, index)
        ? ' — sin efecto'
        : '';
    return { id: index, turn, player, text: text + suffix };
  });
  logCache.set(state, entries);
  return entries;
}

const EMPTY_LOG: LogEntry[] = [];

export function useLogEntries(): LogEntry[] {
  return useStore((s) => (s.gameState === null ? EMPTY_LOG : logEntriesOf(s.gameState)));
}

// ---------------------------------------------------------------------------
// Affordances

export function useAffordances(): Affordances | null {
  return useStore((s) => (s.gameState === null ? null : getAffordances(s.gameState)));
}

/** Who acts now — the perspective every affordance is computed for. */
export function useWhoActs(): PlayerId | null {
  return useStore((s) => (s.gameState === null ? null : getAffordances(s.gameState).whoActs));
}

const NO_GLOBALS: Affordances['global'] = Object.freeze({
  canEndTurn: false,
  canPass: false,
  canConcede: false,
  mustAnswerMulligan: false,
  mustAnswerChoice: false,
});

export function useGlobalAffordances(): Affordances['global'] {
  return useStore((s) => (s.gameState === null ? NO_GLOBALS : getAffordances(s.gameState).global));
}

/** Visual state of one card for the current mode. */
export function useClickState(id: InstanceId): ClickState {
  return useStore((s) =>
    s.gameState === null ? 'inert' : clickStateOf(s.ui.mode, getAffordances(s.gameState), id),
  );
}

/** True when at least one card can receive DON!! (makes the DON area clickable). */
export function useCanAttachDon(): boolean {
  return useStore((s) => {
    if (s.gameState === null) {
      return false;
    }
    return Object.values(getAffordances(s.gameState).byCard).some((card) => card.canReceiveDon);
  });
}

const NO_IDS: readonly InstanceId[] = Object.freeze([]);

/** Sacrifice candidates for a pending full-board play. */
export function useTrashCandidates(cardToPlay: InstanceId): readonly InstanceId[] {
  return useStore((s) => {
    if (s.gameState === null) {
      return NO_IDS;
    }
    return getAffordances(s.gameState).byCard[cardToPlay]?.trashCandidates ?? NO_IDS;
  });
}

/** True while the animation queue holds input. */
export function useInputBlocked(): boolean {
  return useStore((s) => s.animQueue.length > 0);
}

// ---------------------------------------------------------------------------
// Mulligan

export interface MulliganView {
  player: PlayerId;
  hand: readonly InstanceId[];
}

const mulliganCache = new WeakMap<GameState, MulliganView>();

function mulliganViewOf(state: GameState): MulliganView {
  const cached = mulliganCache.get(state);
  if (cached !== undefined) {
    return cached;
  }
  // Always the player who holds priority: the decision is sequential.
  const view: MulliganView = { player: state.priority, hand: state.players[state.priority].hand };
  mulliganCache.set(state, view);
  return view;
}

export function useMulliganView(): MulliganView | null {
  return useStore((s) => {
    if (s.gameState === null || !getAffordances(s.gameState).global.mustAnswerMulligan) {
      return null;
    }
    return mulliganViewOf(s.gameState);
  });
}

// ---------------------------------------------------------------------------
// Battle

export interface BattleView {
  step: 'attack' | 'block' | 'counter' | 'damage';
  attacker: InstanceId;
  attackerName: string;
  attackerPower: number;
  attackerOwner: PlayerId;
  target: InstanceId;
  targetName: string;
  targetPower: number;
  defender: PlayerId;
  wasBlocked: boolean;
}

const battleCache = new WeakMap<GameState, BattleView>();

function battleViewOf(state: GameState, battle: NonNullable<GameState['battle']>): BattleView {
  const cached = battleCache.get(state);
  if (cached !== undefined) {
    return cached;
  }
  const attackerCard = state.cards[battle.attacker];
  const targetCard = state.cards[battle.target];
  const view: BattleView = {
    step: battle.step,
    attacker: battle.attacker,
    attackerName: nameOf(state, battle.attacker),
    // Live power: counters are endOfBattle power modifiers, so this number
    // moves the instant a PLAY_COUNTER lands and returns to base on resolution.
    attackerPower: getPower(state, battle.attacker),
    attackerOwner: attackerCard?.controller ?? state.activePlayer,
    target: battle.target,
    targetName: nameOf(state, battle.target),
    targetPower: getPower(state, battle.target),
    defender: targetCard?.controller ?? state.priority,
    wasBlocked: battle.wasBlocked,
  };
  battleCache.set(state, view);
  return view;
}

export function useBattleView(): BattleView | null {
  return useStore((s) => {
    if (s.gameState === null || s.gameState.battle === null) {
      return null;
    }
    return battleViewOf(s.gameState, s.gameState.battle);
  });
}

// ---------------------------------------------------------------------------
// End of game / handoff / animation highlight

export interface GameOverView {
  winner: PlayerId;
  endReason: 'lifeOut' | 'deckOut' | 'concede';
}

const gameOverCache = new WeakMap<GameState, GameOverView>();

/** Non-null only once the animation queue has drained, so the board settles first. */
export function useGameOver(): GameOverView | null {
  return useStore((s) => {
    const state = s.gameState;
    if (
      state === null ||
      state.status !== 'finished' ||
      state.winner === null ||
      state.endReason === null ||
      s.animQueue.length > 0
    ) {
      return null;
    }
    const cached = gameOverCache.get(state);
    if (cached !== undefined) {
      return cached;
    }
    const view: GameOverView = { winner: state.winner, endReason: state.endReason };
    gameOverCache.set(state, view);
    return view;
  });
}

/** True when the device must be handed to another player before they act. */
export function useNeedsHandoff(): PlayerId | null {
  return useStore((s) => {
    if (s.gameState === null || s.gameState.status === 'finished') {
      return null;
    }
    return s.deviceAckFor === s.gameState.priority ? null : s.gameState.priority;
  });
}

/** True while the card belongs to the animation group currently playing. */
export function useIsHighlighted(id: InstanceId): boolean {
  return useStore((s) => s.animQueue[0]?.cardIds.includes(id) ?? false);
}

/** The card waiting on a sacrifice choice, or null when no choice is pending. */
export function useChoosingTrash(): InstanceId | null {
  return useStore((s) => (s.ui.mode.kind === 'choosingTrash' ? s.ui.mode.cardToPlay : null));
}

/** True while the UI is asking the player to pick a target. */
export function useTargeting(): boolean {
  return useStore((s) => {
    const kind = s.ui.mode.kind;
    return (
      kind === 'attacking' ||
      kind === 'attachingDon' ||
      kind === 'countering' ||
      kind === 'answeringChoice'
    );
  });
}

// ---------------------------------------------------------------------------
// Choice

/**
 * Single-entry memo over the inputs a view is derived from.
 *
 * `useStore` re-runs its selector on every snapshot read and compares the
 * result by reference, so a selector that builds a fresh object each call makes
 * React see a changed store forever: "Maximum update depth exceeded", a blank
 * screen. The rest of this file dodges it with `WeakMap<GameState, …>` caches,
 * which is not enough here — these two views also depend on `ui.mode`, which is
 * not a key a WeakMap can be built on alone. So: remember the last inputs by
 * identity and hand back the same object while they hold. Both the engine state
 * and the UI mode are replaced rather than mutated, so identity is exact.
 */
function memoize1<A extends readonly unknown[], R>(compute: (...args: A) => R): (...args: A) => R {
  let lastArgs: A | null = null;
  let lastResult: R;
  return (...args: A): R => {
    if (
      lastArgs !== null &&
      lastArgs.length === args.length &&
      lastArgs.every((a, i) => a === args[i])
    ) {
      return lastResult;
    }
    lastArgs = args;
    lastResult = compute(...args);
    return lastResult;
  };
}

export interface ChoiceOverlayView {
  choiceId: string;
  kind: ChoiceView['kind'];
  /** The engine's prompt, verbatim. It is card text, and card text is English. */
  prompt: string;
  /** Who is answering — not always the player whose turn it is. */
  player: PlayerId;
  candidates: readonly InstanceId[];
  min: number;
  max: number;
  selected: readonly InstanceId[];
  canConfirm: boolean;
  /** The card whose ability is asking, so the prompt is not a bare ability id. */
  sourceName: string | null;
  sourceText: string | null;
}

/**
 * The open choice, or null.
 *
 * Null while the animation queue is draining, which is the whole of the
 * ordering decision: the board finishes showing what happened, and only then is
 * the player asked to decide about it. Deciding on top of a board that has not
 * caught up yet is how a player answers a question about a state they cannot
 * see. The queue always drains — AnimationDriver runs unconditionally and every
 * group has a finite duration — so a choice cannot be buried by it.
 */
const choiceOverlayOf = memoize1(
  (state: GameState | null, mode: UiMode, blocked: boolean): ChoiceOverlayView | null => {
    if (state === null || blocked) {
      return null;
    }
    const choice = getAffordances(state).pendingChoice;
    if (choice === null || mode.kind !== 'answeringChoice' || mode.choiceId !== choice.id) {
      return null;
    }
    // The ability that is asking sits on top of the stack. Naming it turns
    // "Activate ST01-014-trigger?" into a question about a card.
    const top = state.stack[state.stack.length - 1];
    const source = top === undefined ? undefined : state.cards[top.source];
    const selected = mode.selected;
    return {
      choiceId: choice.id,
      kind: choice.kind,
      prompt: choice.prompt,
      player: state.priority,
      candidates: choice.candidates,
      min: choice.min,
      max: choice.max,
      selected,
      canConfirm: selected.length >= choice.min && selected.length <= choice.max,
      sourceName: source === undefined ? null : getCardDef(source.cardId).name,
      sourceText:
        source === undefined
          ? null
          : (printedTextOf(source.cardId).effectText ?? printedTextOf(source.cardId).triggerText),
    };
  },
);

export function useChoiceOverlay(): ChoiceOverlayView | null {
  return useStore((s) => choiceOverlayOf(s.gameState, s.ui.mode, s.animQueue.length > 0));
}

// ---------------------------------------------------------------------------
// Pile viewer

export interface TrashView {
  player: PlayerId;
  /** Most recent first, which is the order the engine already stores. */
  ids: readonly InstanceId[];
}

const trashOf = memoize1((state: GameState | null, player: PlayerId | null): TrashView | null => {
  if (state === null || player === null) {
    return null;
  }
  return { player, ids: state.players[player].trash };
});

export function useTrashView(): TrashView | null {
  return useStore((s) => trashOf(s.gameState, s.ui.viewingTrash));
}

// ---------------------------------------------------------------------------
// Preview panel

export interface PreviewView {
  instanceId: InstanceId;
  cardId: string;
  name: string;
  cost: number | null;
  power: number;
  counter: number | null;
  colorClass: string;
  effectText: string | null;
  triggerText: string | null;
  /** The same lines the tile puts in its tooltip, at a readable size. */
  powerLines: readonly string[];
  printedPower: number;
  /** True when this card is on show because an effect of it is resolving. */
  fromEffect: boolean;
}

/**
 * Which card the preview panel shows.
 *
 * Two sources, in this order: the card under the pointer, and — when nothing is
 * hovered — the card whose ability is currently asking a question. The second
 * one is why the panel is not simply a hover tooltip: an open choice is exactly
 * the moment a player needs to read the card that opened it, and they are about
 * to move the pointer onto a candidate, not onto the source.
 *
 * Hover wins, because a player who moves the pointer is asking about that card.
 */
const previewOf = memoize1(
  (state: GameState | null, hovered: InstanceId | null, mode: UiMode): PreviewView | null => {
    if (state === null) {
      return null;
    }
    let instanceId = hovered;
    let fromEffect = false;
    if (instanceId === null && mode.kind === 'answeringChoice') {
      const top = state.stack[state.stack.length - 1];
      if (top !== undefined) {
        instanceId = top.source;
        fromEffect = true;
      }
    }
    if (instanceId === null) {
      return null;
    }
    const view = cardViewOf(state, instanceId);
    if (view === null) {
      return null;
    }
    const parts = powerBreakdown(state, instanceId);
    return {
      instanceId,
      cardId: view.cardId,
      name: view.name,
      cost: view.cost,
      power: view.power,
      counter: view.counter,
      colorClass: view.colorClass,
      effectText: view.effectText,
      triggerText: view.triggerText,
      powerLines: powerLinesOf(parts),
      printedPower: parts.printed,
      fromEffect,
    };
  },
);

export function usePreview(): PreviewView | null {
  return useStore((s) => previewOf(s.gameState, s.ui.hovered, s.ui.mode));
}

// ---------------------------------------------------------------------------
// Contextual menu

export interface CardMenuView {
  card: InstanceId;
  name: string;
  options: readonly { label: string; hint: string | null }[];
}

/** Spanish labels for the N entries; ability entries carry their printed text. */
function labelFor(option: MenuOption, cardId: string): { label: string; hint: string | null } {
  switch (option.kind) {
    case 'play':
      return { label: 'Jugar', hint: null };
    case 'attack':
      return { label: 'Atacar', hint: null };
    case 'block':
      return { label: 'Bloquear', hint: null };
    case 'counter':
      return { label: 'Usar de contraataque', hint: null };
    case 'counterEvent':
      return { label: 'Jugar como evento [Counter]', hint: printedTextOf(cardId).effectText };
    case 'activate':
      return { label: 'Activar habilidad', hint: printedTextOf(cardId).effectText };
  }
}

const cardMenuOf = memoize1((state: GameState | null, mode: UiMode): CardMenuView | null => {
  if (state === null || mode.kind !== 'cardMenu') {
    return null;
  }
  const card = state.cards[mode.card];
  if (card === undefined) {
    return null;
  }
  const options = menuOptions(getAffordances(state), mode.card);
  // Numbered only when there is more than one to tell apart: a card with a
  // single activated ability should not read as "Activar habilidad 1".
  const activatedCount = options.filter((option) => option.kind === 'activate').length;
  let seen = 0;
  return {
    card: mode.card,
    name: getCardDef(card.cardId).name,
    options: options.map((option) => {
      const entry = labelFor(option, card.cardId);
      if (option.kind !== 'activate' || activatedCount < 2) {
        return entry;
      }
      seen += 1;
      return { ...entry, label: `${entry.label} ${seen}` };
    }),
  };
});

export function useCardMenu(): CardMenuView | null {
  return useStore((s) => cardMenuOf(s.gameState, s.ui.mode));
}

// ---------------------------------------------------------------------------
// Why this card has that power

export interface PowerBreakdown {
  printed: number;
  fromDon: number;
  /** Temporary grants — counters, resolved effects — with what granted them. */
  fromModifiers: number;
  modifierSources: readonly string[];
  /** Continuous (`static`) contribution. Never an event, never a modifier. */
  fromStatics: number;
  staticSources: readonly string[];
  /** Keywords the card does not print but currently has. */
  grantedKeywords: readonly string[];
}

const EMPTY_BREAKDOWN: PowerBreakdown = Object.freeze({
  printed: 0,
  fromDon: 0,
  fromModifiers: 0,
  modifierSources: Object.freeze([]),
  fromStatics: 0,
  staticSources: Object.freeze([]),
  grantedKeywords: Object.freeze([]),
});

/**
 * Why a Character shows +1000.
 *
 * Continuous effects emit no events at all — they are read at lookup time and
 * write nothing to the state — so the log can never explain one. The only way
 * to answer the question is to derive it from the board, which is what this
 * does: the static contribution is exactly `getPower - getPowerWithoutStatics`,
 * a subtraction the engine's own definition guarantees.
 *
 * Attribution is separate from the amount, and deliberately weaker. A `static`
 * whose `affects` is `{self: true}` names its own card and is attributed
 * exactly; one that reaches other cards through a selector would need the
 * engine's internal `resolveSelector` to attribute, so it is left unnamed
 * rather than guessed at. Every static in ST-01/ST-02 is self-targeting today,
 * which is why the fallback is rarely reached — `continuousBadge.test.ts` pins
 * that, so the day a foreign static arrives it reads as unattributed instead of
 * as the wrong card.
 */
function breakdownOf(state: GameState, id: InstanceId): PowerBreakdown {
  const card = state.cards[id];
  if (card === undefined) {
    return EMPTY_BREAKDOWN;
  }
  const def = getCardDef(card.cardId);
  const nameOfCard = (instanceId: InstanceId): string => nameOf(state, instanceId);

  let fromModifiers = 0;
  const modifierSources: string[] = [];
  for (const modifier of state.modifiers) {
    if (modifier.kind === 'power' && modifier.target === id) {
      fromModifiers += modifier.value;
      modifierSources.push(nameOfCard(modifier.source));
    }
  }

  const fromStatics = getPower(state, id) - getPowerWithoutStatics(state, id);
  const staticSources: string[] = [];
  if (fromStatics !== 0) {
    for (const ability of getAbilities(card.cardId)) {
      if (
        ability.trigger === 'static' &&
        ability.affects !== undefined &&
        'self' in ability.affects
      ) {
        staticSources.push(def.name);
      }
    }
  }

  const grantedKeywords: string[] = [];
  for (const keyword of KEYWORDS) {
    const printed = def.keywords.includes(PRINTED_KEYWORD[keyword]);
    if (!printed && hasKeyword(state, id, keyword)) {
      grantedKeywords.push(PRINTED_KEYWORD[keyword]);
    }
  }

  return {
    printed: def.power,
    fromDon: card.attachedDon.length * 1000,
    fromModifiers,
    modifierSources: [...new Set(modifierSources)],
    fromStatics,
    staticSources: [...new Set(staticSources)],
    grantedKeywords,
  };
}

/**
 * The breakdown as lines a person can read.
 *
 * Lives here rather than in `CardTile` because two places show it now — the
 * tile's tooltip and the preview panel — and the day they disagree is the day
 * one of them is lying about the board.
 */
export function powerLinesOf(parts: PowerBreakdown): string[] {
  const lines: string[] = [];
  if (parts.fromDon > 0) {
    lines.push(`+${parts.fromDon} por DON!! adjuntados`);
  }
  if (parts.fromModifiers !== 0) {
    const from = parts.modifierSources.length > 0 ? ` (${parts.modifierSources.join(', ')})` : '';
    lines.push(`${parts.fromModifiers > 0 ? '+' : ''}${parts.fromModifiers} temporal${from}`);
  }
  if (parts.fromStatics !== 0) {
    const from =
      parts.staticSources.length > 0 ? ` (${parts.staticSources.join(', ')})` : ' (efecto continuo)';
    lines.push(`${parts.fromStatics > 0 ? '+' : ''}${parts.fromStatics} continuo${from}`);
  }
  if (parts.grantedKeywords.length > 0) {
    lines.push(`Otorgado: ${parts.grantedKeywords.join(', ')}`);
  }
  return lines;
}

const breakdownCache = new WeakMap<GameState, Map<InstanceId, PowerBreakdown>>();

export function powerBreakdown(state: GameState, id: InstanceId): PowerBreakdown {
  let perState = breakdownCache.get(state);
  if (perState === undefined) {
    perState = new Map();
    breakdownCache.set(state, perState);
  }
  const cached = perState.get(id);
  if (cached !== undefined) {
    return cached;
  }
  const value = breakdownOf(state, id);
  perState.set(id, value);
  return value;
}

export function usePowerBreakdown(id: InstanceId): PowerBreakdown {
  return useStore((s) =>
    s.gameState === null ? EMPTY_BREAKDOWN : powerBreakdown(s.gameState, id),
  );
}

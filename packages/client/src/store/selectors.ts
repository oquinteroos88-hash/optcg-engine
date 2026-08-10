// View-model layer: besides game/, the only place allowed to import engine
// VALUES. Components consume these hooks and stay rule-blind.
import { getCardDef, getPower, PRINTED_KEYWORD } from '@optcg/engine';
import type { GameEvent, GameState, InstanceId, PlayerId } from '@optcg/engine';
import { getAffordances } from '../game/affordances';
import type { Affordances } from '../game/affordances';
import { clickStateOf } from '../game/clickState';
import type { ClickState } from '../game/clickState';
import { useStore } from './store';

export function playerLabel(player: PlayerId): string {
  return player === 'p1' ? 'Jugador 1' : 'Jugador 2';
}

// ---------------------------------------------------------------------------
// Card view

export interface CardView {
  name: string;
  /** null when the card has no printed cost (leaders) — no badge is drawn. */
  cost: number | null;
  power: number;
  counter: number | null;
  colorClass: string;
  rested: boolean;
  donCount: number;
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
  /** True when the non-active player holds priority during a battle. */
  defenderResponds: boolean;
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
    return { id: index, turn, player, text };
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
    return kind === 'attacking' || kind === 'attachingDon' || kind === 'countering';
  });
}

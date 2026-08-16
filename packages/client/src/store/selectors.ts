// View-model layer: besides game/, the only place allowed to import engine
// VALUES. Components consume these hooks and stay rule-blind.
//
// **Everything here reads a `PlayerView`.** Not a `GameState` — not even in
// hot-seat, where the client still owns one. A second render path over the raw
// state would be the redaction rule encoded twice, and the copy nobody
// exercises is the copy that leaks. What the view cannot answer, the engine
// answers *inside* it: `power`, `powerWithoutStatics` and `keywords` ride on
// every visible card, because computing them needs the whole state and this
// side of the wire does not have one.
import { getAbilities, getCardDef, KEYWORDS, PRINTED_KEYWORD } from '@optcg/engine';
import type { InstanceId, PlayerId, PlayerView, ViewCard, ViewEvent } from '@optcg/engine';
import type { Affordances, ChoiceView } from '../game/affordances';
import { clickStateOf } from '../game/clickState';
import type { ClickState } from '../game/clickState';
import { printedTextOf } from '../game/printed';
import { menuOptions } from '../game/uiMode';
import type { MenuOption, UiMode } from '../game/uiMode';
import { selectView, useStore } from './store';

export function playerLabel(player: PlayerId): string {
  return player === 'p1' ? 'Jugador 1' : 'Jugador 2';
}

/** A card the viewer cannot name, said the way the board shows it: a back. */
const HIDDEN_CARD = 'una carta';

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

const cardViewCache = new WeakMap<PlayerView, Map<InstanceId, CardView | null>>();

function cardViewOf(view: PlayerView, id: InstanceId): CardView | null {
  let perView = cardViewCache.get(view);
  if (perView === undefined) {
    perView = new Map();
    cardViewCache.set(view, perView);
  }
  const cached = perView.get(id);
  if (cached !== undefined) {
    return cached;
  }
  const card = view.cards[id];
  if (card === undefined) {
    // Not a bug: a card this viewer may not name has no entry at all, which is
    // how the per-player layer says "back of a card" — see `HandRow`.
    perView.set(id, null);
    return null;
  }
  const def = getCardDef(card.cardId);
  const cardView: CardView = {
    cardId: card.cardId,
    name: def.name,
    // Leaders are printed without a cost; the engine stores 0 for them.
    cost: def.category === 'leader' ? null : def.cost,
    // The engine's own reading, carried on the card: effective power with
    // modifiers and continuous effects applied.
    power: card.power,
    counter: def.counter,
    colorClass: def.color,
    rested: card.orientation === 'rested',
    donCount: card.attachedDon.length,
    ...printedText(card.cardId),
  };
  perView.set(id, cardView);
  return cardView;
}

export function useCardView(id: InstanceId): CardView | null {
  return useStore((s) => {
    const view = selectView(s);
    return view === null ? null : cardViewOf(view, id);
  });
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

const bannerCache = new WeakMap<PlayerView, BannerView>();

function bannerOf(view: PlayerView): BannerView {
  const cached = bannerCache.get(view);
  if (cached !== undefined) {
    return cached;
  }
  let phase: PhaseKey;
  if (view.status === 'mulligan') {
    phase = 'mulligan';
  } else if (view.status === 'finished') {
    phase = 'finished';
  } else if (view.battle?.step === 'block') {
    phase = 'blockStep';
  } else if (view.battle?.step === 'counter') {
    phase = 'counterStep';
  } else {
    phase = 'main';
  }
  const banner: BannerView = {
    activePlayer: view.activePlayer,
    priority: view.priority,
    phase,
    defenderResponds: view.status === 'playing' && view.priority !== view.activePlayer,
    choiceOpen: view.pending !== null,
    winner: view.winner,
  };
  bannerCache.set(view, banner);
  return banner;
}

export function useBanner(): BannerView | null {
  return useStore((s) => {
    const view = selectView(s);
    return view === null ? null : bannerOf(view);
  });
}

// ---------------------------------------------------------------------------
// Opponent's turn to decide

export interface OpponentChoiceView {
  player: PlayerId;
  kind: string;
}

/**
 * Non-null while the **other** seat owes an answer.
 *
 * The redacted `pending` says who is deciding and of what kind, and nothing
 * about between what — so that is exactly what the board says. It is state,
 * not an overlay of its own: the player is not being asked anything, and the
 * only affordance they hold is `[CONCEDE]`, which is what the server offers
 * them (CR 1-2-3 — either player may concede at any point).
 */
export function useOpponentChoosing(): OpponentChoiceView | null {
  return useStore((s) => {
    const pending = selectView(s)?.pending ?? null;
    if (pending === null || pending.audience !== 'other') {
      return null;
    }
    return opponentChoiceOf(pending.player, pending.kind);
  });
}

const opponentChoiceCache = new Map<string, OpponentChoiceView>();

function opponentChoiceOf(player: PlayerId, kind: string): OpponentChoiceView {
  const key = `${player}|${kind}`;
  let cached = opponentChoiceCache.get(key);
  if (cached === undefined) {
    cached = { player, kind };
    opponentChoiceCache.set(key, cached);
  }
  return cached;
}

// ---------------------------------------------------------------------------
// Event log

export interface LogEntry {
  id: number;
  turn: number;
  player: PlayerId | null;
  text: string;
}

function nameOf(view: PlayerView, id: InstanceId): string {
  const card = view.cards[id];
  return card === undefined ? HIDDEN_CARD : getCardDef(card.cardId).name;
}

/**
 * A card the event may or may not have been allowed to name.
 *
 * Every `InstanceId | null` in `ViewEvent` passes through here, and the null
 * branch is not a fallback — it is the redaction rendered. "Una carta" is what
 * a player at the table sees when a face-down card moves, so the line says
 * that rather than inventing a name or dropping a real happening from history.
 */
function nameOrHidden(view: PlayerView, id: InstanceId | null): string {
  return id === null ? HIDDEN_CARD : nameOf(view, id);
}

function controllerOf(view: PlayerView, id: InstanceId | null): PlayerId | null {
  return id === null ? null : (view.cards[id]?.controller ?? null);
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

function cardsWord(count: number): string {
  return count === 1 ? '1 carta' : `${count} cartas`;
}

/**
 * One redacted event as a line of history.
 *
 * The switch has no `default` on purpose, and PR #45 is where that paid off a
 * second time: every case had to decide what it reads as when the identity is
 * **withheld** rather than merely absent, and the compiler asked case by case.
 * The rule the answers follow: say the fact, never the face. A rival's draw is
 * a draw; a look is a count; a partition is two counts. Nothing here guesses a
 * name, and nothing drops a line because it could not print one — a player who
 * cannot see *what* moved is still entitled to know *that* something did.
 */
function formatEvent(event: ViewEvent, view: PlayerView): { player: PlayerId | null; text: string } {
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
      // CR 4-5-1 draws "without revealing it to the other player", so the rival
      // gets the fact and the owner gets the face. Both are the same line with
      // the identity in or out of it.
      return {
        player: event.player,
        text: event.instanceId === null ? 'roba una carta' : `roba ${nameOf(view, event.instanceId)}`,
      };
    case 'donGained':
      return { player: event.player, text: `gana ${event.count} DON!!` };
    case 'donAttached':
      return {
        player: event.player,
        text: `adjunta ${event.count} DON!! a ${nameOrHidden(view, event.to)}`,
      };
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
      // The Character area is an open area (CR 3-7-2), so this one is never
      // actually redacted — the null branch exists because the type allows it
      // and a line that cannot be written is worse than one that can.
      return { player: event.player, text: `juega ${nameOrHidden(view, event.instanceId)}` };
    case 'characterTrashedForRoom':
      return {
        player: event.player,
        text: `descarta ${nameOrHidden(view, event.instanceId)} para hacer sitio`,
      };
    case 'stageReplaced':
      return {
        player: event.player,
        text: `reemplaza ${nameOrHidden(view, event.oldStage)} por ${nameOrHidden(view, event.newStage)}`,
      };
    case 'attackDeclared':
      return {
        player: event.player,
        text: `ataca con ${nameOrHidden(view, event.attacker)} a ${nameOrHidden(view, event.target)}`,
      };
    case 'blockDeclared':
      return { player: event.player, text: `bloquea con ${nameOrHidden(view, event.blocker)}` };
    case 'counterPlayed':
      return {
        player: event.player,
        text: `usa ${nameOrHidden(view, event.instanceId)} como contraataque (+${event.value}) sobre ${nameOrHidden(view, event.target)}`,
      };
    case 'battleResolved': {
      // battleResolved carries no player: derive it from the attacker.
      const player = controllerOf(view, event.attacker);
      // `koPrevented` deliberately does not share wording with `noEffect`: the
      // attack won its comparison and the Character stood anyway, which is a
      // different thing from an attack that lost.
      const outcome =
        event.outcome === 'ko'
          ? `${nameOrHidden(view, event.target)} queda KO`
          : event.outcome === 'lifeDamage'
            ? 'el ataque impacta en la vida'
            : event.outcome === 'koPrevented'
              ? `${nameOrHidden(view, event.target)} no puede quedar KO en combate`
              : 'el ataque no tiene efecto';
      return { player, text: `combate resuelto: ${outcome}` };
    }
    case 'battleEndedEarly': {
      // Deliberately not "el ataque no tiene efecto", which is what a battle
      // that reached the Damage Step and lost says. This one never got there:
      // a participant left the field first (CR 7-1-1-4 / 7-1-2-3), and a player
      // who cannot tell the two apart cannot tell whether their Character
      // survived a hit or was never hit.
      const player = controllerOf(view, event.attacker);
      const who =
        event.gone === 'attacker'
          ? nameOrHidden(view, event.attacker)
          : event.gone === 'target'
            ? nameOrHidden(view, event.target)
            : 'ambos combatientes';
      return { player, text: `el combate se disipa: ${who} ya no está en juego` };
    }
    case 'lifeTaken':
      // The count moved in front of both players; the face is the owner's
      // (CR 10-1-5-2 adds it to hand without revealing it). The line never
      // named the card even before there was a redaction to make it.
      return { player: event.player, text: `pierde una carta de vida (quedan ${event.remaining})` };
    case 'koed':
      return { player: event.player, text: `${nameOrHidden(view, event.instanceId)} queda KO` };
    // Efectos de carta. El log es exhaustivo a proposito (no hay `default`).
    case 'abilityTriggered':
      return {
        player: event.player,
        text: `activa la habilidad de ${nameOf(view, event.source)}`,
      };
    case 'abilityDeclined':
      return {
        player: event.player,
        text: `no activa la habilidad de ${nameOf(view, event.source)}`,
      };
    case 'choiceOpened':
      // A foreign prompt is withheld, because a prompt can name cards ("Trash 1
      // {Land of Wano} type card") and it is the *other* player's question.
      return {
        player: event.player,
        text: event.prompt === null ? 'debe elegir' : `debe elegir: ${event.prompt}`,
      };
    case 'choiceAnswered':
      return { player: event.player, text: 'responde la eleccion' };
    case 'powerGranted':
      return {
        player: controllerOf(view, event.target),
        text: `${nameOrHidden(view, event.target)} gana ${event.value} de poder`,
      };
    case 'keywordGranted':
      return {
        player: controllerOf(view, event.target),
        text: `${nameOrHidden(view, event.target)} gana ${PRINTED_KEYWORD[event.keyword]}`,
      };
    case 'legalitySet': {
      const question =
        event.question === 'activateBlocker'
          ? 'activar [Blocker]'
          : event.question === 'attack'
            ? 'elegir a quien atacar'
            : 'quedar KO en combate';
      const verb = event.effect === 'forbid' ? 'restringe' : 'amplia';
      return {
        player: controllerOf(view, event.source),
        text: `${nameOrHidden(view, event.source)} ${verb}: ${question}`,
      };
    }
    case 'orientationChanged':
      return {
        player: controllerOf(view, event.instanceId),
        text:
          event.orientation === 'rested'
            ? `${nameOrHidden(view, event.instanceId)} queda agotada`
            : `${nameOrHidden(view, event.instanceId)} se activa`,
      };
    case 'cardMoved':
      return {
        player: event.player,
        text: `mueve ${nameOrHidden(view, event.instanceId)} a ${zoneLabel(event.to)}`,
      };
    case 'cardDiscarded':
      return { player: event.player, text: `descarta ${nameOrHidden(view, event.instanceId)}` };
    case 'cardsRevealed': {
      // A reveal was watched by both players, so the *positions* survive for
      // everyone and each id survives only while its card is still trackable —
      // a card since shuffled back into a deck is a card nobody can name any
      // more. So the line names what it can and counts the rest.
      const named = event.instanceIds.filter((id): id is InstanceId => id !== null);
      const hidden = event.instanceIds.length - named.length;
      const parts = [
        ...named.map((id) => nameOf(view, id)),
        ...(hidden > 0 ? [cardsWord(hidden)] : []),
      ];
      return { player: event.player, text: `revela ${parts.join(', ')}` };
    }
    case 'cardsLookedAt':
      // The count, never the cards: CR 11-3-1 makes looking private to the
      // player of the effect. The engine hands the looker their ids and the
      // rival a bare count; the line is the same sentence either way, which is
      // why it reads off `count` for both.
      return {
        player: event.player,
        text: `mira ${cardsWord(event.count)} del tope de su mazo`,
      };
    case 'deckPartitioned':
      // The counts, and only the counts, because that is what a player at a
      // table sees: cards going to each end without their faces.
      return {
        player: event.player,
        text: `pone ${event.topCount} cartas al tope y ${event.bottomCount} al fondo del mazo`,
      };
    case 'deckOrdered':
      return {
        player: event.player,
        text: `pone ${cardsWord(event.count)} al fondo del mazo en el orden que eligió`,
      };
    case 'deckShuffled':
      // The one event with nothing to redact: the new order is hidden from both
      // players at a real table too, so the line says the whole truth.
      return { player: event.player, text: `baraja su mazo (${event.count} cartas)` };
    case 'donAdded':
      // Deliberately worded apart from `donGained`, which is the DON!! Phase's
      // own step: this one names a card effect's doing, and it names the
      // orientation because an active DON!! is spendable this turn and a rested
      // one is not.
      return {
        player: event.player,
        text:
          event.orientation === 'active'
            ? `agrega ${event.count} DON!! activo del mazo de DON!!`
            : `agrega ${event.count} DON!! agotado del mazo de DON!!`,
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
const EFFECT_EVENTS = new Set<ViewEvent['type']>([
  'powerGranted',
  'keywordGranted',
  // An ability whose whole output is a legality rule changes nothing a board
  // reading can show. Without this line it would look exactly like an "up to 1"
  // answered with nothing, which is the bug this set exists to prevent.
  'legalitySet',
  'koed',
  'cardMoved',
  'cardDiscarded',
  'cardsRevealed',
  // Both count as "something happened": an ability whose whole visible output
  // is five cards going to the bottom of a deck has still done its job, and
  // without these it would read as an ability that resolved to nothing.
  'cardsLookedAt',
  'deckOrdered',
  'deckPartitioned',
  // A search that found nothing still shuffles, and the shuffle is the only
  // thing on screen when it does — without this line the ability would read as
  // one that resolved into nothing.
  'deckShuffled',
  'cardDrawn',
  'donAttached',
  'donGained',
  'donReturned',
  'donAdded',
  'donOrientationChanged',
  'donReturnedToDeck',
  'orientationChanged',
  'lifeTaken',
  'lifeBanished',
  'stageReplaced',
  'characterTrashedForRoom',
]);

const WINDOW_CLOSERS = new Set<ViewEvent['type']>([
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

function resolvedIntoNothing(log: readonly ViewEvent[], view: PlayerView, at: number): boolean {
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
  return view.pending === null && view.stack.length === 0 && view.resume.length === 0;
}

const logCache = new WeakMap<readonly ViewEvent[], LogEntry[]>();

/**
 * The rendered history, folded from the **journal** — the batches this seat was
 * actually sent — and never from a log re-derived now.
 *
 * That is PR #44's finding on this side of the wire: the engine's redaction is
 * memoryless, so re-folding the whole log at render time would show a player
 * *less* than they watched live, one card at a time, as shuffles erased what
 * reveals had taught them. The journal is what was seen, so the journal is what
 * is drawn.
 */
function logEntriesOf(journal: readonly ViewEvent[], view: PlayerView): LogEntry[] {
  const cached = logCache.get(journal);
  if (cached !== undefined) {
    return cached;
  }
  let turn = 0;
  const entries = journal.map((event, index) => {
    if (event.type === 'turnStarted') {
      turn = event.turn;
    }
    const { player, text } = formatEvent(event, view);
    const suffix =
      event.type === 'abilityTriggered' && resolvedIntoNothing(journal, view, index)
        ? ' — sin efecto'
        : '';
    return { id: index, turn, player, text: text + suffix };
  });
  logCache.set(journal, entries);
  return entries;
}

/**
 * The fold itself, for tests that check one line at a time.
 *
 * Exported rather than reached through the hook because the interesting cases
 * are per event and per seat, and a React tree around each of them would test
 * the tree. The board uses the same function through `useLogEntries`.
 */
export function logEntries(journal: readonly ViewEvent[], view: PlayerView): LogEntry[] {
  return logEntriesOf(journal, view);
}

const EMPTY_LOG: LogEntry[] = [];

export function useLogEntries(): LogEntry[] {
  return useStore((s) => {
    const view = selectView(s);
    if (view === null) {
      return EMPTY_LOG;
    }
    return logEntriesOf(s.journals[view.viewer] ?? EMPTY_JOURNAL, view);
  });
}

const EMPTY_JOURNAL: readonly ViewEvent[] = Object.freeze([]);

// ---------------------------------------------------------------------------
// Affordances

export function useAffordances(): Affordances | null {
  return useStore((s) => s.affordances);
}

/** Who acts now — the perspective every affordance is computed for. */
export function useWhoActs(): PlayerId | null {
  return useStore((s) => s.affordances?.whoActs ?? null);
}

/** Whose board this is — the seat every zone is drawn from. */
export function useViewer(): PlayerId | null {
  return useStore((s) => selectView(s)?.viewer ?? null);
}

const NO_GLOBALS: Affordances['global'] = Object.freeze({
  canEndTurn: false,
  canPass: false,
  canConcede: false,
  mustAnswerMulligan: false,
  mustAnswerChoice: false,
});

export function useGlobalAffordances(): Affordances['global'] {
  return useStore((s) => s.affordances?.global ?? NO_GLOBALS);
}

/** Visual state of one card for the current mode. */
export function useClickState(id: InstanceId): ClickState {
  return useStore((s) =>
    s.affordances === null ? 'inert' : clickStateOf(s.ui.mode, s.affordances, id),
  );
}

/** True when at least one card can receive DON!! (makes the DON area clickable). */
export function useCanAttachDon(): boolean {
  return useStore((s) => {
    if (s.affordances === null) {
      return false;
    }
    return Object.values(s.affordances.byCard).some((card) => card.canReceiveDon);
  });
}

const NO_IDS: readonly InstanceId[] = Object.freeze([]);

/** Sacrifice candidates for a pending full-board play. */
export function useTrashCandidates(cardToPlay: InstanceId): readonly InstanceId[] {
  return useStore((s) => s.affordances?.byCard[cardToPlay]?.trashCandidates ?? NO_IDS);
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

const mulliganCache = new WeakMap<PlayerView, MulliganView>();

function mulliganViewOf(view: PlayerView): MulliganView {
  const cached = mulliganCache.get(view);
  if (cached !== undefined) {
    return cached;
  }
  // Always the player who is being asked, and always their own hand — the one
  // the view publishes in full, because it is theirs (CR 3-4-2).
  const own: MulliganView = {
    player: view.viewer,
    hand: view.players[view.viewer].hand.cards ?? NO_IDS,
  };
  mulliganCache.set(view, own);
  return own;
}

export function useMulliganView(): MulliganView | null {
  return useStore((s) => {
    const view = selectView(s);
    if (view === null || s.affordances === null || !s.affordances.global.mustAnswerMulligan) {
      return null;
    }
    return mulliganViewOf(view);
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

const battleCache = new WeakMap<PlayerView, BattleView>();

function battleViewOf(view: PlayerView, battle: NonNullable<PlayerView['battle']>): BattleView {
  const cached = battleCache.get(view);
  if (cached !== undefined) {
    return cached;
  }
  const attackerCard = view.cards[battle.attacker];
  const targetCard = view.cards[battle.target];
  const battleView: BattleView = {
    step: battle.step,
    attacker: battle.attacker,
    attackerName: nameOf(view, battle.attacker),
    // Live power: counters are endOfBattle power modifiers, so this number
    // moves the instant a PLAY_COUNTER lands and returns to base on resolution.
    // Both battle participants are on the field, which is open (CR 3-7-2), so
    // the view always carries them.
    attackerPower: attackerCard?.power ?? 0,
    attackerOwner: attackerCard?.controller ?? view.activePlayer,
    target: battle.target,
    targetName: nameOf(view, battle.target),
    targetPower: targetCard?.power ?? 0,
    defender: targetCard?.controller ?? view.priority,
    wasBlocked: battle.wasBlocked,
  };
  battleCache.set(view, battleView);
  return battleView;
}

export function useBattleView(): BattleView | null {
  return useStore((s) => {
    const view = selectView(s);
    if (view === null || view.battle === null) {
      return null;
    }
    return battleViewOf(view, view.battle);
  });
}

// ---------------------------------------------------------------------------
// End of game / handoff / animation highlight

export interface GameOverView {
  winner: PlayerId;
  endReason: 'lifeOut' | 'deckOut' | 'concede';
}

const gameOverCache = new WeakMap<PlayerView, GameOverView>();

/** Non-null only once the animation queue has drained, so the board settles first. */
export function useGameOver(): GameOverView | null {
  return useStore((s) => {
    const view = selectView(s);
    if (
      view === null ||
      view.status !== 'finished' ||
      view.winner === null ||
      view.endReason === null ||
      s.animQueue.length > 0
    ) {
      return null;
    }
    const cached = gameOverCache.get(view);
    if (cached !== undefined) {
      return cached;
    }
    const over: GameOverView = { winner: view.winner, endReason: view.endReason };
    gameOverCache.set(view, over);
    return over;
  });
}

/**
 * True when the device must be handed to another player before they act.
 *
 * Hot-seat only, and now structurally so: over a network the two players hold
 * two devices, and there is nothing to hand over.
 */
export function useNeedsHandoff(): PlayerId | null {
  return useStore((s) => {
    const view = selectView(s);
    if (s.mode !== 'hotseat' || view === null || view.status === 'finished') {
      return null;
    }
    return s.deviceAckFor === view.priority ? null : view.priority;
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
 * screen. The rest of this file dodges it with `WeakMap<PlayerView, …>` caches,
 * which is not enough here — these two views also depend on `ui.mode`, which is
 * not a key a WeakMap can be built on alone. So: remember the last inputs by
 * identity and hand back the same object while they hold. Both the view and the
 * UI mode are replaced rather than mutated, so identity is exact.
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
  /** Candidates flagged for the top of the deck. Only a partition uses it. */
  toTop: readonly InstanceId[];
  canConfirm: boolean;
  /** The card whose ability is asking, so the prompt is not a bare ability id. */
  sourceName: string | null;
  sourceText: string | null;
  /**
   * A blind choice: how many faceless candidates, and which are picked.
   *
   * `null` for every ordinary choice. When set, `candidates` is empty and the
   * overlay draws backs — there is no face to enlarge and no name to show, and
   * the overlay says so in a line rather than leaving a hole.
   */
  blind: { count: number; selected: readonly number[] } | null;
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
  (
    view: PlayerView | null,
    aff: Affordances | null,
    mode: UiMode,
    blocked: boolean,
  ): ChoiceOverlayView | null => {
    if (view === null || aff === null || blocked) {
      return null;
    }
    const choice = aff.pendingChoice;
    if (choice === null || mode.kind !== 'answeringChoice' || mode.choiceId !== choice.id) {
      return null;
    }
    // The ability that is asking sits on top of the stack. Naming it turns
    // "Activate ST01-014-trigger?" into a question about a card — when the
    // asker is one this seat may see: a stack item whose source is hidden
    // publishes no id at all, and the overlay simply has no name to show.
    const top = view.stack[view.stack.length - 1];
    const sourceId = top?.source ?? null;
    const source = sourceId === null ? undefined : view.cards[sourceId];
    const selected = mode.selected;
    const toTop = mode.toTop;
    const blind = choice.blindHandles;
    return {
      choiceId: choice.id,
      kind: choice.kind,
      prompt: choice.prompt,
      player: view.priority,
      candidates: choice.candidates,
      min: choice.min,
      max: choice.max,
      selected,
      toTop,
      canConfirm:
        blind === null
          ? selected.length >= choice.min && selected.length <= choice.max
          : mode.handles.length >= choice.min && mode.handles.length <= choice.max,
      sourceName: source === undefined ? null : getCardDef(source.cardId).name,
      sourceText:
        source === undefined
          ? null
          : (printedTextOf(source.cardId).effectText ?? printedTextOf(source.cardId).triggerText),
      blind: blind === null ? null : { count: blind, selected: mode.handles },
    };
  },
);

export function useChoiceOverlay(): ChoiceOverlayView | null {
  return useStore((s) =>
    choiceOverlayOf(selectView(s), s.affordances, s.ui.mode, s.animQueue.length > 0),
  );
}

// ---------------------------------------------------------------------------
// Pile viewer

export interface TrashView {
  player: PlayerId;
  /** Most recent first, which is the order the engine already stores. */
  ids: readonly InstanceId[];
}

const trashOf = memoize1((view: PlayerView | null, player: PlayerId | null): TrashView | null => {
  if (view === null || player === null) {
    return null;
  }
  return { player, ids: view.players[player].trash };
});

export function useTrashView(): TrashView | null {
  return useStore((s) => trashOf(selectView(s), s.ui.viewingTrash));
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
  (view: PlayerView | null, hovered: InstanceId | null, mode: UiMode): PreviewView | null => {
    if (view === null) {
      return null;
    }
    let instanceId = hovered;
    let fromEffect = false;
    if (instanceId === null && mode.kind === 'answeringChoice') {
      const top = view.stack[view.stack.length - 1];
      if (top?.source != null) {
        instanceId = top.source;
        fromEffect = true;
      }
    }
    if (instanceId === null) {
      return null;
    }
    const cardView = cardViewOf(view, instanceId);
    if (cardView === null) {
      return null;
    }
    const parts = powerBreakdown(view, instanceId);
    return {
      instanceId,
      cardId: cardView.cardId,
      name: cardView.name,
      cost: cardView.cost,
      power: cardView.power,
      counter: cardView.counter,
      colorClass: cardView.colorClass,
      effectText: cardView.effectText,
      triggerText: cardView.triggerText,
      powerLines: powerLinesOf(parts),
      printedPower: parts.printed,
      fromEffect,
    };
  },
);

export function usePreview(): PreviewView | null {
  return useStore((s) => previewOf(selectView(s), s.ui.hovered, s.ui.mode));
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

const cardMenuOf = memoize1(
  (view: PlayerView | null, aff: Affordances | null, mode: UiMode): CardMenuView | null => {
    if (view === null || aff === null || mode.kind !== 'cardMenu') {
      return null;
    }
    const card = view.cards[mode.card];
    if (card === undefined) {
      return null;
    }
    const options = menuOptions(aff, mode.card);
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
  },
);

export function useCardMenu(): CardMenuView | null {
  return useStore((s) => cardMenuOf(selectView(s), s.affordances, s.ui.mode));
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
 * does: the static contribution is exactly `power - powerWithoutStatics`, a
 * subtraction the engine's own definition guarantees and which now arrives on
 * the card, because computing either half needs a whole state.
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
function breakdownOf(view: PlayerView, id: InstanceId): PowerBreakdown {
  const card = view.cards[id];
  if (card === undefined) {
    return EMPTY_BREAKDOWN;
  }
  const def = getCardDef(card.cardId);

  let fromModifiers = 0;
  const modifierSources: string[] = [];
  for (const modifier of view.modifiers) {
    if (modifier.kind === 'power' && modifier.target === id) {
      fromModifiers += modifier.value;
      modifierSources.push(nameOf(view, modifier.source));
    }
  }

  const fromStatics = card.power - card.powerWithoutStatics;
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
    if (!printed && card.keywords.includes(keyword)) {
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

const breakdownCache = new WeakMap<PlayerView, Map<InstanceId, PowerBreakdown>>();

export function powerBreakdown(view: PlayerView, id: InstanceId): PowerBreakdown {
  let perView = breakdownCache.get(view);
  if (perView === undefined) {
    perView = new Map();
    breakdownCache.set(view, perView);
  }
  const cached = perView.get(id);
  if (cached !== undefined) {
    return cached;
  }
  const value = breakdownOf(view, id);
  perView.set(id, value);
  return value;
}

export function usePowerBreakdown(id: InstanceId): PowerBreakdown {
  return useStore((s) => {
    const view = selectView(s);
    return view === null ? EMPTY_BREAKDOWN : powerBreakdown(view, id);
  });
}

// ---------------------------------------------------------------------------
// Zones, straight off the view

export interface SideView {
  leader: InstanceId;
  characters: readonly InstanceId[];
  stage: InstanceId | null;
  /** Own hand: the ids. Foreign hand: `null`, and `handCount` backs. */
  hand: readonly InstanceId[] | null;
  handCount: number;
  deckCount: number;
  lifeCount: number;
  trashCount: number;
  donActive: number;
  donRested: number;
  donDeck: number;
}

const sideCache = new WeakMap<PlayerView, Map<PlayerId, SideView>>();

/** One player's zones as the viewer is entitled to see them. */
export function useSide(player: PlayerId): SideView | null {
  return useStore((s) => {
    const view = selectView(s);
    if (view === null) {
      return null;
    }
    let perView = sideCache.get(view);
    if (perView === undefined) {
      perView = new Map();
      sideCache.set(view, perView);
    }
    const cached = perView.get(player);
    if (cached !== undefined) {
      return cached;
    }
    const ps = view.players[player];
    const don = (kind: 'active' | 'rested' | 'deck'): number =>
      ps.don.filter((card) =>
        kind === 'deck'
          ? card.location.kind === 'donDeck'
          : card.location.kind === 'cost' && card.location.orientation === kind,
      ).length;
    const side: SideView = {
      leader: ps.leader,
      characters: ps.characters,
      stage: ps.stage,
      hand: ps.hand.cards,
      handCount: ps.hand.count,
      deckCount: ps.deck.count,
      lifeCount: ps.life.count,
      trashCount: ps.trash.length,
      donActive: don('active'),
      donRested: don('rested'),
      donDeck: don('deck'),
    };
    perView.set(player, side);
    return side;
  });
}

// ---------------------------------------------------------------------------
// Network

export interface NetworkView {
  status: 'connecting' | 'open' | 'lost';
  matchId: string;
  seat: PlayerId | null;
  error: string | null;
}

export function useNetwork(): NetworkView | null {
  return useStore((s) => s.net);
}

/** The last rejection, cleared by the next update. */
export function useNotice(): string | null {
  return useStore((s) => s.notice);
}

/** Typed accessor for the raw card record, for the few places that need it. */
export function useViewCard(id: InstanceId): ViewCard | null {
  return useStore((s) => selectView(s)?.cards[id] ?? null);
}

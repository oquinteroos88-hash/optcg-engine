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
import type { InstanceId, Keyword, PlayerId, PlayerView, ViewCard, ViewEvent } from '@optcg/engine';
import type { Affordances, ChoiceView } from '../game/affordances';
import { clickStateOf } from '../game/clickState';
import type { ClickState } from '../game/clickState';
import { messagesFor } from '../i18n';
import type { Locale, Messages } from '../i18n';
import type { AnimGroup } from '../game/animQueue';
import { printedTextOf } from '../game/printed';
import { menuOptions } from '../game/uiMode';
import type { MenuOption, UiMode } from '../game/uiMode';
import { selectView, useStore } from './store';

/**
 * The two seats, named.
 *
 * Takes the dictionary rather than reading one, so it stays a pure function the
 * log fold and a test can both call. There are only two seats and they are not
 * people, so this is a message and not a name.
 */
export function playerLabel(player: PlayerId, m: Messages): string {
  return player === 'p1' ? m.common.playerOne : m.common.playerTwo;
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

function printedText(
  cardId: string,
  locale: Locale,
): { effectText: string | null; triggerText: string | null } {
  const text = printedTextOf(cardId, locale);
  return { effectText: text.effectText, triggerText: text.triggerText };
}

// Keyed by locale as well as by card: the printed text on a `CardView` is the
// one field of it that changes language, and a cache that ignored that would
// keep showing the language the card was first looked at in.
const cardViewCache = new WeakMap<PlayerView, Map<string, CardView | null>>();

function cardViewOf(view: PlayerView, id: InstanceId, locale: Locale): CardView | null {
  let perView = cardViewCache.get(view);
  if (perView === undefined) {
    perView = new Map();
    cardViewCache.set(view, perView);
  }
  const key = `${locale}|${id}`;
  const cached = perView.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const card = view.cards[id];
  if (card === undefined) {
    // Not a bug: a card this viewer may not name has no entry at all, which is
    // how the per-player layer says "back of a card" — see `HandRow`.
    perView.set(key, null);
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
    ...printedText(card.cardId, locale),
  };
  perView.set(key, cardView);
  return cardView;
}

export function useCardView(id: InstanceId): CardView | null {
  return useStore((s) => {
    const view = selectView(s);
    return view === null ? null : cardViewOf(view, id, s.locale);
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
// The phase track the mat prints

/** The five phases of a turn, as the rules and the printed sheet name them. */
export type TurnPhase = 'refresh' | 'draw' | 'don' | 'main' | 'end';

export const TURN_PHASES: readonly TurnPhase[] = Object.freeze([
  'refresh',
  'draw',
  'don',
  'main',
  'end',
]);

export interface PhaseTrackView {
  /**
   * The phase on the wire — and in practice always `main` while anyone is
   * looking.
   *
   * Refresh, Draw and DON!! happen inside one reducer step at the top of a
   * turn (`reducer/startTurn.ts`), and the engine asserts that every resting
   * playing state is in `main` (`invariants.ts`). So the printed five-box track
   * is signage, faithfully reproduced, and the box that lights up is this one.
   */
  phase: TurnPhase;
  /**
   * What is actually happening, which is the part that moves.
   *
   * The engine's phase cannot distinguish a Block Step from a quiet Main phase;
   * the client's `PhaseKey` can, and does, and always has — it is what the
   * Banner reads. The track shows it as a marker on the lit box, so the mat
   * stays the mat and the player still learns where in the turn they are.
   */
  moment: PhaseKey;
  activePlayer: PlayerId;
  /**
   * False during the mulligan and after the game ends. `view.phase` still holds
   * a value then, and lighting a box would claim a turn structure that is not
   * running. Nothing lit is better than something wrong.
   */
  live: boolean;
}

const phaseTrackCache = new WeakMap<PlayerView, PhaseTrackView>();

function phaseTrackOf(view: PlayerView): PhaseTrackView {
  const cached = phaseTrackCache.get(view);
  if (cached !== undefined) {
    return cached;
  }
  const track: PhaseTrackView = {
    phase: view.phase,
    moment: bannerOf(view).phase,
    activePlayer: view.activePlayer,
    live: view.status === 'playing',
  };
  phaseTrackCache.set(view, track);
  return track;
}

export function usePhaseTrack(): PhaseTrackView | null {
  return useStore((s) => {
    const view = selectView(s);
    return view === null ? null : phaseTrackOf(view);
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

/**
 * A card's name — **never translated**, in any locale.
 *
 * The art prints it in English and the engine resolves names by English string,
 * so the log says "Monkey.D.Luffy" to a Spanish reader too. What is translated
 * is everything around it.
 */
function nameOfCard(view: PlayerView, id: InstanceId): string | null {
  const card = view.cards[id];
  return card === undefined ? null : getCardDef(card.cardId).name;
}

function nameOf(view: PlayerView, id: InstanceId, m: Messages): string {
  return nameOfCard(view, id) ?? m.common.hiddenCard;
}

/**
 * A card the event may or may not have been allowed to name.
 *
 * Every `InstanceId | null` in `ViewEvent` passes through here, and the null
 * branch is not a fallback — it is the redaction rendered. "Una carta" is what
 * a player at the table sees when a face-down card moves, so the line says
 * that rather than inventing a name or dropping a real happening from history.
 */
function nameOrHidden(view: PlayerView, id: InstanceId | null, m: Messages): string {
  return id === null ? m.common.hiddenCard : nameOf(view, id, m);
}

function controllerOf(view: PlayerView, id: InstanceId | null): PlayerId | null {
  return id === null ? null : (view.cards[id]?.controller ?? null);
}

function zoneLabel(zone: 'hand' | 'deck' | 'trash' | 'life', m: Messages): string {
  switch (zone) {
    case 'hand':
      return m.log.zone.hand;
    case 'deck':
      return m.log.zone.deck;
    case 'trash':
      return m.log.zone.trash;
    case 'life':
      return m.log.zone.life;
  }
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
function formatEvent(
  event: ViewEvent,
  view: PlayerView,
  m: Messages,
): { player: PlayerId | null; text: string } {
  switch (event.type) {
    case 'gameStarted':
      return { player: null, text: m.log.gameStarted(playerLabel(event.firstPlayer, m)) };
    case 'mulliganTaken':
      return { player: event.player, text: m.log.mulliganTaken(event.accepted) };
    case 'lifeSet':
      return { player: event.player, text: m.log.lifeSet(event.count) };
    case 'turnStarted':
      return { player: event.player, text: m.log.turnStarted(event.turn) };
    case 'cardDrawn':
      // CR 4-5-1 draws "without revealing it to the other player", so the rival
      // gets the fact and the owner gets the face. Both are the same line with
      // the identity in or out of it.
      return {
        player: event.player,
        text:
          event.instanceId === null
            ? m.log.cardDrawnHidden
            : m.log.cardDrawn(nameOf(view, event.instanceId, m)),
      };
    case 'donGained':
      return { player: event.player, text: m.log.donGained(event.count) };
    case 'donAttached':
      return {
        player: event.player,
        text: m.log.donAttached(event.count, nameOrHidden(view, event.to, m)),
      };
    case 'donPaid':
      return { player: event.player, text: m.log.donPaid(event.count) };
    case 'donReturned':
      // DON!! coming back from a card that left the field return rested, so they
      // cannot be spent this turn; refresh-phase returns come back active.
      return {
        player: event.player,
        text: event.rested
          ? m.log.donReturnedRested(event.count)
          : m.log.donReturnedActive(event.count),
      };
    // The player is the owner of the DON!!, who is not always whoever activated
    // the effect: a card can rest the opponent's DON!!.
    case 'donOrientationChanged':
      return {
        player: event.player,
        text:
          event.orientation === 'rested'
            ? m.log.donRested(event.count)
            : m.log.donSetActive(event.count),
      };
    case 'cardPlayed':
      // The Character area is an open area (CR 3-7-2), so this one is never
      // actually redacted — the null branch exists because the type allows it
      // and a line that cannot be written is worse than one that can.
      return {
        player: event.player,
        text: m.log.cardPlayed(nameOrHidden(view, event.instanceId, m)),
      };
    case 'characterTrashedForRoom':
      return {
        player: event.player,
        text: m.log.characterTrashedForRoom(nameOrHidden(view, event.instanceId, m)),
      };
    case 'stageReplaced':
      return {
        player: event.player,
        text: m.log.stageReplaced(
          nameOrHidden(view, event.oldStage, m),
          nameOrHidden(view, event.newStage, m),
        ),
      };
    case 'attackDeclared':
      return {
        player: event.player,
        text: m.log.attackDeclared(
          nameOrHidden(view, event.attacker, m),
          nameOrHidden(view, event.target, m),
        ),
      };
    case 'blockDeclared':
      return {
        player: event.player,
        text: m.log.blockDeclared(nameOrHidden(view, event.blocker, m)),
      };
    case 'counterPlayed':
      return {
        player: event.player,
        text: m.log.counterPlayed(
          nameOrHidden(view, event.instanceId, m),
          event.value,
          nameOrHidden(view, event.target, m),
        ),
      };
    case 'battleResolved': {
      // battleResolved carries no player: derive it from the attacker.
      const player = controllerOf(view, event.attacker);
      // `koPrevented` deliberately does not share wording with `noEffect`: the
      // attack won its comparison and the Character stood anyway, which is a
      // different thing from an attack that lost.
      const outcome =
        event.outcome === 'ko'
          ? m.log.outcomeKo(nameOrHidden(view, event.target, m))
          : event.outcome === 'lifeDamage'
            ? m.log.outcomeLifeDamage
            : event.outcome === 'koPrevented'
              ? m.log.outcomeKoPrevented(nameOrHidden(view, event.target, m))
              : m.log.outcomeNoEffect;
      return { player, text: m.log.battleResolved(outcome) };
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
          ? nameOrHidden(view, event.attacker, m)
          : event.gone === 'target'
            ? nameOrHidden(view, event.target, m)
            : m.log.bothCombatants;
      return { player, text: m.log.battleEndedEarly(who) };
    }
    case 'lifeTaken':
      // The count moved in front of both players; the face is the owner's
      // (CR 10-1-5-2 adds it to hand without revealing it). The line never
      // named the card even before there was a redaction to make it.
      return { player: event.player, text: m.log.lifeTaken(event.remaining) };
    case 'koed':
      return {
        player: event.player,
        text: m.log.koed(nameOrHidden(view, event.instanceId, m)),
      };
    // Card effects. The log is exhaustive on purpose (there is no `default`),
    // and now every arm of it also has to exist in both languages.
    case 'abilityTriggered':
      return { player: event.player, text: m.log.abilityTriggered(nameOf(view, event.source, m)) };
    case 'abilityDeclined':
      return { player: event.player, text: m.log.abilityDeclined(nameOf(view, event.source, m)) };
    case 'choiceOpened':
      // A foreign prompt is withheld, because a prompt can name cards ("Trash 1
      // {Land of Wano} type card") and it is the *other* player's question.
      //
      // The prompt itself is the engine's, and the engine's strings are English
      // card text — it is not translated here and must not be: the choice is
      // the ability speaking, and `ChoiceOverlay` marks it `lang="en"` for the
      // same reason.
      return {
        player: event.player,
        text: event.prompt === null ? m.log.choiceOpenedBare : m.log.choiceOpened(event.prompt),
      };
    case 'choiceAnswered':
      return { player: event.player, text: m.log.choiceAnswered };
    case 'powerGranted':
      return {
        player: controllerOf(view, event.target),
        text: m.log.powerGranted(nameOrHidden(view, event.target, m), event.value),
      };
    case 'keywordGranted':
      return {
        player: controllerOf(view, event.target),
        text: m.log.keywordGranted(
          nameOrHidden(view, event.target, m),
          m.keyword[event.keyword],
        ),
      };
    case 'legalitySet': {
      const question =
        event.question === 'activateBlocker'
          ? m.log.legalityActivateBlocker
          : event.question === 'attack'
            ? m.log.legalityAttack
            : m.log.legalityKoInBattle;
      return {
        player: controllerOf(view, event.source),
        text: m.log.legalitySet(nameOrHidden(view, event.source, m), event.effect, question),
      };
    }
    case 'orientationChanged':
      return {
        player: controllerOf(view, event.instanceId),
        text:
          event.orientation === 'rested'
            ? m.log.becameRested(nameOrHidden(view, event.instanceId, m))
            : m.log.becameActive(nameOrHidden(view, event.instanceId, m)),
      };
    case 'cardMoved':
      return {
        player: event.player,
        text: m.log.cardMoved(nameOrHidden(view, event.instanceId, m), zoneLabel(event.to, m)),
      };
    case 'cardDiscarded':
      return {
        player: event.player,
        text: m.log.cardDiscarded(nameOrHidden(view, event.instanceId, m)),
      };
    case 'cardsRevealed': {
      // A reveal was watched by both players, so the *positions* survive for
      // everyone and each id survives only while its card is still trackable —
      // a card since shuffled back into a deck is a card nobody can name any
      // more. So the line names what it can and counts the rest.
      const named = event.instanceIds.filter((id): id is InstanceId => id !== null);
      const hidden = event.instanceIds.length - named.length;
      const parts = [
        ...named.map((id) => nameOf(view, id, m)),
        ...(hidden > 0 ? [m.common.cards(hidden)] : []),
      ];
      return { player: event.player, text: m.log.cardsRevealed(parts.join(', ')) };
    }
    case 'cardsLookedAt':
      // The count, never the cards: CR 11-3-1 makes looking private to the
      // player of the effect. The engine hands the looker their ids and the
      // rival a bare count; the line is the same sentence either way, which is
      // why it reads off `count` for both.
      return { player: event.player, text: m.log.cardsLookedAt(m.common.cards(event.count)) };
    case 'deckPartitioned':
      // The counts, and only the counts, because that is what a player at a
      // table sees: cards going to each end without their faces.
      return {
        player: event.player,
        text: m.log.deckPartitioned(event.topCount, event.bottomCount),
      };
    case 'deckOrdered':
      return { player: event.player, text: m.log.deckOrdered(m.common.cards(event.count)) };
    case 'deckShuffled':
      // The one event with nothing to redact: the new order is hidden from both
      // players at a real table too, so the line says the whole truth.
      return { player: event.player, text: m.log.deckShuffled(event.count) };
    case 'donAdded':
      // Deliberately worded apart from `donGained`, which is the DON!! Phase's
      // own step: this one names a card effect's doing, and it names the
      // orientation because an active DON!! is spendable this turn and a rested
      // one is not.
      return {
        player: event.player,
        text:
          event.orientation === 'active'
            ? m.log.donAddedActive(event.count)
            : m.log.donAddedRested(event.count),
      };
    case 'donReturnedToDeck':
      return { player: event.player, text: m.log.donReturnedToDeck(event.count) };
    case 'lifeBanished':
      return { player: event.player, text: m.log.lifeBanished(event.remaining) };
    case 'turnEnded':
      return { player: event.player, text: m.log.turnEnded(event.turn) };
    case 'gameEnded': {
      const reason =
        event.endReason === 'lifeOut'
          ? m.log.endReasonLifeOut
          : event.endReason === 'deckOut'
            ? m.log.endReasonDeckOut
            : m.log.endReasonConcede;
      return { player: event.winner, text: m.log.gameEnded(reason) };
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

const logCache = new WeakMap<readonly ViewEvent[], Map<Locale, LogEntry[]>>();

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
function logEntriesOf(
  journal: readonly ViewEvent[],
  view: PlayerView,
  locale: Locale,
): LogEntry[] {
  let perJournal = logCache.get(journal);
  if (perJournal === undefined) {
    perJournal = new Map();
    logCache.set(journal, perJournal);
  }
  const cached = perJournal.get(locale);
  if (cached !== undefined) {
    return cached;
  }
  const m = messagesFor(locale);
  let turn = 0;
  const entries = journal.map((event, index) => {
    if (event.type === 'turnStarted') {
      turn = event.turn;
    }
    const { player, text } = formatEvent(event, view, m);
    const suffix =
      event.type === 'abilityTriggered' && resolvedIntoNothing(journal, view, index)
        ? m.log.noEffect
        : '';
    return { id: index, turn, player, text: text + suffix };
  });
  perJournal.set(locale, entries);
  return entries;
}

/**
 * The fold itself, for tests that check one line at a time.
 *
 * Exported rather than reached through the hook because the interesting cases
 * are per event and per seat, and a React tree around each of them would test
 * the tree. The board uses the same function through `useLogEntries`.
 */
export function logEntries(
  journal: readonly ViewEvent[],
  view: PlayerView,
  locale: Locale,
): LogEntry[] {
  return logEntriesOf(journal, view, locale);
}

const EMPTY_LOG: LogEntry[] = [];

export function useLogEntries(): LogEntry[] {
  return useStore((s) => {
    const view = selectView(s);
    if (view === null) {
      return EMPTY_LOG;
    }
    return logEntriesOf(s.journals[view.viewer] ?? EMPTY_JOURNAL, view, s.locale);
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
  /**
   * Null only when the view cannot name the card, which both battle
   * participants always can be — the field is an open area. Kept nullable
   * anyway so this view model carries no language: card names are never
   * translated, and the word for "a card" is.
   */
  attackerName: string | null;
  attackerPower: number;
  attackerOwner: PlayerId;
  target: InstanceId;
  targetName: string | null;
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
    attackerName: nameOfCard(view, battle.attacker),
    // Live power: counters are endOfBattle power modifiers, so this number
    // moves the instant a PLAY_COUNTER lands and returns to base on resolution.
    // Both battle participants are on the field, which is open (CR 3-7-2), so
    // the view always carries them.
    attackerPower: attackerCard?.power ?? 0,
    attackerOwner: attackerCard?.controller ?? view.activePlayer,
    target: battle.target,
    targetName: nameOfCard(view, battle.target),
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

/**
 * Whether the engine will accept playing this card right now.
 *
 * The one question drag asks. It is the affordance verbatim — no cost maths, no
 * zone check, no reasoning about the board — so a card is draggable exactly
 * when it is playable, and the UI has decided nothing.
 */
export function useCanPlay(id: InstanceId): boolean {
  return useStore((s) => s.affordances?.byCard[id]?.canPlay ?? false);
}

/** True while the card belongs to the animation group currently playing. */
export function useIsHighlighted(id: InstanceId): boolean {
  return useStore((s) => s.animQueue[0]?.cardIds.includes(id) ?? false);
}

/**
 * Cards the group now playing is turning face-up.
 *
 * **Read off the redacted events, and therefore correct by construction.** A
 * card is flipped here only when an event names it with a real id, and the view
 * gives a real id exactly when the viewer is entitled to the face:
 *
 *  - `cardDrawn` carries an id for the drawer and `null` for the other seat, so
 *    your draw turns over and theirs stays a back that travels.
 *  - `lifeTaken` carries an id for its owner alone — the card went to their hand
 *    unrevealed (CR 10-1-5-2).
 *  - `abilityTriggered` is kept only for a viewer who knows the source, because
 *    activating from a secret zone is what revealed it (CR 10-1-5-1). That is
 *    what makes the `[Trigger]` flip legal for the opponent to watch: the rules
 *    turned the card over, so the animation may too.
 *
 * The case this deliberately cannot animate is a **declined** `[Trigger]`, for
 * the opponent. The rules keep a decline unrevealed, so the view drops the whole
 * offer — and a flip there would reveal a card the game is hiding. The missing
 * data is the point, not a gap: see docs/board-design.md.
 */
function flippingIdsOf(group: AnimGroup | null): readonly InstanceId[] {
  if (group === null) {
    return [];
  }
  const ids: InstanceId[] = [];
  for (const event of group.events) {
    if (event.type === 'cardDrawn' || event.type === 'lifeTaken') {
      if (event.instanceId !== null) {
        ids.push(event.instanceId);
      }
    } else if (event.type === 'abilityTriggered') {
      ids.push(event.source);
    }
  }
  return ids;
}

export function useIsFlipping(id: InstanceId): boolean {
  return useStore((s) => flippingIdsOf(s.animQueue[0] ?? null).includes(id));
}

/**
 * The attacker of the battle now playing, for the lunge.
 *
 * A short shove towards the target and back — the gesture a player makes at the
 * table. It is drawn from the event rather than from `view.battle` because it
 * belongs to the moment the attack is declared, not to the whole battle: the
 * card should shove once, not lean for the length of the Block Step.
 */
export function useLungingAttacker(): InstanceId | null {
  return useStore((s) => {
    const group = s.animQueue[0];
    if (group === undefined) {
      return null;
    }
    for (const event of group.events) {
      if (event.type === 'attackDeclared') {
        return event.attacker;
      }
    }
    return null;
  });
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
  /**
   * The engine's prompt, verbatim. It is card text, and card text is English.
   *
   * Deliberately not translated even when the rest of the overlay is: the
   * prompt is a string the engine composed from a script, not a message this
   * client owns, and `cards.es.json` translates printed text rather than the
   * engine's own prose. The overlay marks it `lang="en"` and shows the card's
   * translated effect text underneath, which is the sentence a player can
   * actually read.
   */
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
    locale: Locale,
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
          : (printedTextOf(source.cardId, locale).effectText ??
            printedTextOf(source.cardId, locale).triggerText),
      blind: blind === null ? null : { count: blind, selected: mode.handles },
    };
  },
);

export function useChoiceOverlay(): ChoiceOverlayView | null {
  return useStore((s) =>
    choiceOverlayOf(selectView(s), s.affordances, s.ui.mode, s.animQueue.length > 0, s.locale),
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
  /** True when the text above is the fan translation rather than the printing. */
  translated: boolean;
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
  (
    view: PlayerView | null,
    hovered: InstanceId | null,
    mode: UiMode,
    locale: Locale,
  ): PreviewView | null => {
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
    const cardView = cardViewOf(view, instanceId, locale);
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
      translated: printedTextOf(cardView.cardId, locale).translated,
      powerLines: powerLinesOf(parts, messagesFor(locale)),
      printedPower: parts.printed,
      fromEffect,
    };
  },
);

export function usePreview(): PreviewView | null {
  return useStore((s) => previewOf(selectView(s), s.ui.hovered, s.ui.mode, s.locale));
}

// ---------------------------------------------------------------------------
// Contextual menu

export interface CardMenuView {
  card: InstanceId;
  /** The printed card, for the art the phone sheet shows. */
  cardId: string;
  name: string;
  options: readonly { label: string; hint: string | null }[];
}

/** Labels for the N entries; ability entries carry their printed text. */
function labelFor(
  option: MenuOption,
  cardId: string,
  locale: Locale,
  m: Messages,
): { label: string; hint: string | null } {
  switch (option.kind) {
    case 'play':
      return { label: m.menu.play, hint: null };
    case 'attack':
      return { label: m.menu.attack, hint: null };
    case 'block':
      return { label: m.menu.block, hint: null };
    case 'counter':
      return { label: m.menu.counter, hint: null };
    case 'counterEvent':
      return { label: m.menu.counterEvent, hint: printedTextOf(cardId, locale).effectText };
    case 'activate':
      return { label: m.menu.activate, hint: printedTextOf(cardId, locale).effectText };
  }
}

const cardMenuOf = memoize1(
  (
    view: PlayerView | null,
    aff: Affordances | null,
    mode: UiMode,
    locale: Locale,
  ): CardMenuView | null => {
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
    const m = messagesFor(locale);
    let seen = 0;
    return {
      card: mode.card,
      cardId: card.cardId,
      name: getCardDef(card.cardId).name,
      options: options.map((option) => {
        const entry = labelFor(option, card.cardId, locale, m);
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
  return useStore((s) => cardMenuOf(selectView(s), s.affordances, s.ui.mode, s.locale));
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
  /**
   * Keywords the card does not print but currently has, as engine values.
   *
   * Values rather than printed names: a keyword has a name in each language,
   * and choosing it here would bake one of them into a view model the other
   * language also reads. `powerLinesOf` names them, once, with a dictionary.
   */
  grantedKeywords: readonly Keyword[];
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
      // A source this seat may not name is left out rather than written as
      // "a card": the amount is the fact, the attribution is the extra, and an
      // unattributed "+2000 temporary" is the same shape a foreign static
      // already takes. It also keeps this structure free of any language —
      // card names are never translated, so nothing else in it is either.
      const name = view.cards[modifier.source] === undefined ? null : nameOfCard(view, modifier.source);
      if (name !== null) {
        modifierSources.push(name);
      }
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

  const grantedKeywords: Keyword[] = [];
  for (const keyword of KEYWORDS) {
    // `def.keywords` is the printed list, spelled the way the card prints it —
    // English, and matched against the engine's own English table. Nothing
    // here reads a translation.
    const printed = def.keywords.includes(PRINTED_KEYWORD[keyword]);
    if (!printed && card.keywords.includes(keyword)) {
      grantedKeywords.push(keyword);
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
export function powerLinesOf(parts: PowerBreakdown, m: Messages): string[] {
  const lines: string[] = [];
  if (parts.fromDon > 0) {
    lines.push(m.power.fromDon(parts.fromDon));
  }
  if (parts.fromModifiers !== 0) {
    lines.push(m.power.temporary(parts.fromModifiers, parts.modifierSources));
  }
  if (parts.fromStatics !== 0) {
    lines.push(m.power.continuous(parts.fromStatics, parts.staticSources));
  }
  if (parts.grantedKeywords.length > 0) {
    lines.push(m.power.granted(parts.grantedKeywords.map((keyword) => m.keyword[keyword])));
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
  /**
   * The card face-up on top of the trash. Public information (CR 3-5-2), which
   * is why this is the one pile that shows a face and the one pile that opens.
   *
   * `trash[0]` — the view keeps the pile most-recent-first, the same order
   * `PileViewer` lists it in.
   */
  trashTop: { id: InstanceId; cardId: string; name: string } | null;
  donActive: number;
  donRested: number;
  donDeck: number;
  /**
   * DON!! attached to a card of this side, by instance. A card with none is
   * absent rather than present as zero.
   *
   * On the table the attached cards fan out from under the one carrying them,
   * and the board draws them that way. It is a count and never an id: which
   * DON!! is attached is not a thing anybody needs to know.
   */
  attachedDon: Readonly<Record<InstanceId, number>>;
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
    const topId = ps.trash[0];
    const topCard = topId === undefined ? undefined : view.cards[topId];
    // Counted here rather than read off a card in a component: components may
    // not import engine values at all (tests/architecture.test.ts), and this is
    // the layer that is allowed to know what `attachedDon` is.
    // Leader and Characters only: those are the cards DON!! may be given to.
    // A Stage cannot receive one, so looking for it there would imply a rule
    // that does not exist.
    const attachedDon: Record<InstanceId, number> = {};
    for (const id of [ps.leader, ...ps.characters]) {
      const count = view.cards[id]?.attachedDon.length ?? 0;
      if (count > 0) {
        attachedDon[id] = count;
      }
    }
    const side: SideView = {
      leader: ps.leader,
      characters: ps.characters,
      stage: ps.stage,
      hand: ps.hand.cards,
      handCount: ps.hand.count,
      deckCount: ps.deck.count,
      lifeCount: ps.life.count,
      trashCount: ps.trash.length,
      trashTop:
        topId === undefined || topCard === undefined
          ? null
          : // A card name is not a message: it is identical in both locales, so
            // this stays out of the locale-keyed part of the cache.
            { id: topId, cardId: topCard.cardId, name: getCardDef(topCard.cardId).name },
      donActive: don('active'),
      donRested: don('rested'),
      donDeck: don('deck'),
      attachedDon,
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

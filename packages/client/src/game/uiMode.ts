import type { InstanceId, PlayerId } from '@optcg/engine';
import { cardAffordance } from './affordances';
import type { Affordances } from './affordances';
import type { ActionIntent } from './driver-types';

/**
 * Every non-idle mode records the player it was opened for. Without that stamp
 * `attachingDon` — the only mode carrying no instance id — survived a turn
 * change, handing the next player a board already in DON-targeting mode.
 *
 * `cardSelected` was absent in phase 1 because it was unreachable by
 * construction: `canPlay` only ever describes a card in hand and `canAttack`
 * only a card on the field, so no card could carry both (0 hits across 10,082
 * sampled states). `ACTIVATE_ABILITY` breaks that — a character on the field
 * can attack AND activate — so it is back as `cardMenu`, and with the shape the
 * phase 1 note predicted: N variable options, not a fixed Jugar/Atacar pair.
 * The options are indices into a list the store builds from affordances, so a
 * card with two activated abilities offers three entries without the mode
 * learning anything about what an option is.
 *
 * `answeringChoice` is the one mode nothing clicks into. It is imposed by
 * `ensureModeValid` whenever the engine opens a choice for the player who acts,
 * and it cannot be escaped: an open choice has no cancel, so `escape` and a
 * click on the background are both no-ops while it holds.
 */
export type UiMode =
  | { kind: 'idle' }
  | { kind: 'attacking'; owner: PlayerId; attacker: InstanceId }
  | { kind: 'attachingDon'; owner: PlayerId }
  | { kind: 'choosingTrash'; owner: PlayerId; cardToPlay: InstanceId }
  | { kind: 'countering'; owner: PlayerId; counterCard: InstanceId }
  | { kind: 'cardMenu'; owner: PlayerId; card: InstanceId }
  | {
      kind: 'answeringChoice';
      owner: PlayerId;
      choiceId: string;
      /** Selection so far, in click order. Always a subset of `candidates`. */
      selected: readonly InstanceId[];
      /**
       * Candidates the player has flipped to the **top** of the deck.
       * `partitionCards` only; empty and inert for every other kind.
       *
       * A set rather than a second ordered list, because the order is already
       * in `selected` and having it twice is having it in two states. The
       * answer is `selected` filtered by membership here, which keeps one
       * sequence and one question — *which side* — apart from each other.
       *
       * The default side is the bottom. It is the burying end, it is where the
       * only other placement op in the game puts things, and a player who
       * confirms without touching a toggle gets the answer they would have got
       * from `orderToBottom`.
       */
      toTop: readonly InstanceId[];
      /**
       * Selection for a **blind** choice, by handle rather than by id.
       *
       * A second list rather than a reuse of `selected`, for the reason the
       * engine keeps `handles` apart from `cards` in its answer union: the two
       * name different things. `selected` holds cards the player can see and
       * point at; this holds positions in an order the player is not entitled
       * to resolve. Sharing one list would mean inventing an id for a card
       * with no face, which is the one thing the whole per-player layer exists
       * to avoid. Empty and inert for every choice that is not blind.
       */
      handles: readonly number[];
    };

export type UiEvent =
  | { kind: 'clickHandCard'; instanceId: InstanceId }
  | { kind: 'clickFieldCard'; instanceId: InstanceId; mine: boolean }
  | { kind: 'clickDonArea' }
  | { kind: 'clickEmpty' }
  | { kind: 'escape' }
  /** Contextual menu: the index is into `menuOptions(aff, card)`. */
  | { kind: 'chooseMenuOption'; index: number }
  /** Toggles one candidate of the open choice on or off. */
  | { kind: 'toggleChoiceCandidate'; instanceId: InstanceId }
  /** Flips one candidate between the top and the bottom of the deck. */
  | { kind: 'toggleChoiceSide'; instanceId: InstanceId }
  /** Toggles one faceless candidate of a blind choice, by handle. */
  | { kind: 'toggleChoiceHandle'; handle: number }
  /** Submits the current selection (`selectCards`) — legal only within min/max. */
  | { kind: 'confirmChoice' }
  /** Submits a `yesNo` choice. */
  | { kind: 'answerYesNo'; value: boolean };

/** Everything except the two events that unconditionally reset to idle. */
type BoardEvent = Exclude<UiEvent, { kind: 'escape' } | { kind: 'clickEmpty' }>;

export interface UiModeResult {
  mode: UiMode;
  intent?: ActionIntent;
}

const IDLE: UiMode = { kind: 'idle' };

/**
 * One entry of the contextual menu. Variable in number: a Character that can
 * attack and activate two abilities offers three.
 */
export type MenuOption =
  | { kind: 'play' }
  | { kind: 'attack' }
  | { kind: 'block' }
  | { kind: 'counter' }
  | { kind: 'counterEvent' }
  | { kind: 'activate'; abilityId: string };

/**
 * Everything one card can start right now, in a stable order.
 *
 * Zone-blind on purpose: the affordances themselves are already zone-exclusive
 * — `canPlay` and `canCounter` only ever describe a card in hand, `canAttack`,
 * `canBlock` and `canActivate` only one on the field — so asking the zone again
 * would be re-deriving a rule the engine already decided.
 *
 * The order is the phase 1 click precedence (counter before play, attack before
 * block) with activated abilities appended in `legalActions` order, so adding an
 * ability to a card never renumbers the options that were already there.
 */
export function menuOptions(aff: Affordances, id: InstanceId): MenuOption[] {
  const card = cardAffordance(aff, id);
  const options: MenuOption[] = [];
  if (card.canCounter) {
    options.push({ kind: 'counter' });
  }
  if (card.canPlayCounterEvent) {
    options.push({ kind: 'counterEvent' });
  }
  if (card.canPlay) {
    options.push({ kind: 'play' });
  }
  if (card.canAttack) {
    options.push({ kind: 'attack' });
  }
  if (card.canBlock) {
    options.push({ kind: 'block' });
  }
  for (const abilityId of card.activatableAbilities) {
    options.push({ kind: 'activate', abilityId });
  }
  return options;
}

function anyCanReceiveDon(aff: Affordances): boolean {
  return Object.values(aff.byCard).some((card) => card.canReceiveDon);
}

function playOutcome(instanceId: InstanceId, aff: Affordances): UiModeResult {
  const card = cardAffordance(aff, instanceId);
  if (card.playRequiresTrash) {
    return { mode: { kind: 'choosingTrash', owner: aff.whoActs, cardToPlay: instanceId } };
  }
  return { mode: IDLE, intent: { type: 'PLAY_CARD', instanceId } };
}

/** Applies one menu entry — the same outcomes a single-option click produces. */
function applyOption(option: MenuOption, id: InstanceId, aff: Affordances): UiModeResult {
  const owner = aff.whoActs;
  switch (option.kind) {
    case 'play':
      return playOutcome(id, aff);
    case 'attack':
      return { mode: { kind: 'attacking', owner, attacker: id } };
    case 'block':
      return { mode: IDLE, intent: { type: 'DECLARE_BLOCK', blocker: id } };
    case 'counter':
      return { mode: { kind: 'countering', owner, counterCard: id } };
    case 'counterEvent':
      // No target step: a [Counter] Event picks its own through `pending`.
      return { mode: IDLE, intent: { type: 'PLAY_COUNTER_EVENT', instanceId: id } };
    case 'activate':
      return {
        mode: IDLE,
        intent: { type: 'ACTIVATE_ABILITY', instanceId: id, abilityId: option.abilityId },
      };
  }
}

/**
 * A click on a card.
 *
 * `alwaysConfirm` is what a card in **hand** gets: the menu opens even when
 * there is only one thing to do, so playing a card is two clicks and the first
 * one is recoverable. On the field a single-option click still acts directly —
 * there is no version of "click your own attacker" that a player does by
 * accident, and every one of those paths has a second step of its own anyway.
 *
 * A click on a card that can do nothing returns `current` untouched, identity
 * included — a no-op must not re-render the board.
 */
function clickCard(
  id: InstanceId,
  aff: Affordances,
  current: UiMode,
  alwaysConfirm: boolean,
): UiModeResult {
  const options = menuOptions(aff, id);
  const only = options[0];
  if (only === undefined) {
    return { mode: current };
  }
  if (options.length === 1 && !alwaysConfirm) {
    return applyOption(only, id, aff);
  }
  return { mode: { kind: 'cardMenu', owner: aff.whoActs, card: id } };
}

function answeringChoiceFor(aff: Affordances, choiceId: string): UiMode {
  return {
    kind: 'answeringChoice',
    owner: aff.whoActs,
    choiceId,
    selected: [],
    toTop: [],
    handles: [],
  };
}

/**
 * Pure UI-mode reducer. Clicks are interpreted strictly through affordances;
 * a click that matches nothing returns the same mode with no intent.
 */
export function reduceUiMode(mode: UiMode, ev: UiEvent, aff: Affordances): UiModeResult {
  // An open choice is not cancellable and not escapable: it is the only move
  // its owner has, so nothing outside the choice may reach the reducer while it
  // holds. This is checked before the escape shortcut, which would otherwise
  // silently drop the player out of a mode they cannot re-enter by clicking.
  if (mode.kind === 'answeringChoice') {
    return reduceAnsweringChoice(mode, ev, aff);
  }
  if (ev.kind === 'escape' || ev.kind === 'clickEmpty') {
    return { mode: IDLE };
  }

  switch (mode.kind) {
    case 'idle':
      return reduceIdle(mode, ev, aff);
    case 'attacking': {
      if (ev.kind === 'clickFieldCard') {
        const attacker = cardAffordance(aff, mode.attacker);
        if (attacker.attackTargets.includes(ev.instanceId)) {
          return {
            mode: IDLE,
            intent: { type: 'DECLARE_ATTACK', attacker: mode.attacker, target: ev.instanceId },
          };
        }
      }
      return { mode };
    }
    case 'attachingDon': {
      if (ev.kind === 'clickFieldCard' && ev.mine && cardAffordance(aff, ev.instanceId).canReceiveDon) {
        return { mode: IDLE, intent: { type: 'ATTACH_DON', to: ev.instanceId, count: 1 } };
      }
      // Clicking the DON area again toggles the mode off instead of dead-ending.
      if (ev.kind === 'clickDonArea') {
        return { mode: IDLE };
      }
      return { mode };
    }
    case 'choosingTrash': {
      if (ev.kind === 'clickFieldCard' && ev.mine) {
        const pending = cardAffordance(aff, mode.cardToPlay);
        if (pending.trashCandidates.includes(ev.instanceId)) {
          return {
            mode: IDLE,
            intent: { type: 'PLAY_CARD', instanceId: mode.cardToPlay, trashCharacter: ev.instanceId },
          };
        }
      }
      return { mode };
    }
    case 'countering': {
      if (ev.kind === 'clickFieldCard' && ev.mine) {
        const counter = cardAffordance(aff, mode.counterCard);
        if (counter.counterTargets.includes(ev.instanceId)) {
          return {
            mode: IDLE,
            intent: { type: 'PLAY_COUNTER', instanceId: mode.counterCard, target: ev.instanceId },
          };
        }
      }
      return { mode };
    }
    case 'cardMenu': {
      if (ev.kind === 'chooseMenuOption') {
        const option = menuOptions(aff, mode.card)[ev.index];
        if (option !== undefined) {
          return applyOption(option, mode.card, aff);
        }
        return { mode };
      }
      // Any other click closes the menu and is then interpreted from idle, so a
      // player who opened it by mistake is not trapped one extra click deep.
      return reduceUiMode(IDLE, ev, aff);
    }
    // No `answeringChoice` branch: the guard at the top of the function already
    // narrowed it away, and TypeScript enforces that it stays that way.
  }
}

/**
 * The choice overlay: toggle candidates, then confirm — or answer yes/no.
 *
 * Cardinality is enforced here rather than only in the button's `disabled`
 * attribute: a confirm outside `[min, max]` never becomes an intent, so the
 * engine cannot be handed a `choiceCardinality` rejection from the UI. `min: 0`
 * confirms an empty selection, which is what "up to" means and is the common
 * case, not the corner one.
 */
function reduceAnsweringChoice(
  mode: Extract<UiMode, { kind: 'answeringChoice' }>,
  ev: UiEvent,
  aff: Affordances,
): UiModeResult {
  const choice = aff.pendingChoice;
  if (choice === null || choice.id !== mode.choiceId) {
    return { mode: IDLE };
  }
  // Candidates are cards on the board, so a click on the board is a click on a
  // candidate. Routing it here rather than in the tile keeps the components
  // rule-blind: they keep firing the same zone events they always did.
  const target =
    ev.kind === 'toggleChoiceCandidate'
      ? ev.instanceId
      : ev.kind === 'clickFieldCard' || ev.kind === 'clickHandCard'
        ? ev.instanceId
        : null;

  switch (ev.kind) {
    case 'clickFieldCard':
    case 'clickHandCard':
    case 'toggleChoiceCandidate': {
      if (target === null || choice.kind === 'yesNo' || !choice.candidates.includes(target)) {
        return { mode };
      }
      const already = mode.selected.includes(target);
      const selected = already
        ? mode.selected.filter((id) => id !== target)
        : [...mode.selected, target];
      // Past the ceiling the click is refused rather than silently evicting an
      // earlier pick: which one left would be invisible.
      if (selected.length > choice.max) {
        return { mode };
      }
      return { mode: { ...mode, selected } };
    }
    case 'toggleChoiceHandle': {
      // A blind choice's candidates have no ids to click, so its toggle names
      // a position instead. Inert on every other choice for `toggleChoiceSide`'s
      // reason: the components fire what they render and the reducer decides
      // what it means.
      if (choice.blindHandles === null || ev.handle < 0 || ev.handle >= choice.blindHandles) {
        return { mode };
      }
      const already = mode.handles.includes(ev.handle);
      const handles = already
        ? mode.handles.filter((handle) => handle !== ev.handle)
        : [...mode.handles, ev.handle];
      if (handles.length > choice.max) {
        return { mode };
      }
      return { mode: { ...mode, handles } };
    }
    case 'toggleChoiceSide': {
      // The one event that belongs to a single choice kind. It is inert
      // everywhere else rather than absent, because the alternative is a mode
      // that has to know which events it is allowed to receive — and the whole
      // point of this reducer is that the components do not.
      if (choice.kind !== 'partitionCards' || !choice.candidates.includes(ev.instanceId)) {
        return { mode };
      }
      const onTop = mode.toTop.includes(ev.instanceId);
      return {
        mode: {
          ...mode,
          toTop: onTop
            ? mode.toTop.filter((id) => id !== ev.instanceId)
            : [...mode.toTop, ev.instanceId],
        },
      };
    }
    case 'confirmChoice': {
      if (choice.kind === 'yesNo') {
        return { mode };
      }
      // A blind choice answers in the only alphabet its chooser has. The
      // cardinality gate is the same one; what changes is what is being
      // counted, because there are no cards to count.
      if (choice.blindHandles !== null) {
        if (mode.handles.length < choice.min || mode.handles.length > choice.max) {
          return { mode };
        }
        return {
          mode: IDLE,
          intent: {
            type: 'ANSWER_CHOICE',
            choiceId: choice.id,
            answer: { kind: 'handles', selected: [...mode.handles] },
          },
        };
      }
      if (mode.selected.length < choice.min || mode.selected.length > choice.max) {
        return { mode };
      }
      return {
        mode: IDLE,
        intent: {
          type: 'ANSWER_CHOICE',
          choiceId: choice.id,
          // An ordering answers with the sequence, not the set. `selected` has
          // been an ordered list of click order since it was written — for
          // `selectCards` the order is ignored, and here it is the whole answer.
          // The cardinality gate above is what makes it a permutation: the
          // engine opens an ordering with min === max === candidates.length, so
          // a partial sequence never becomes an intent.
          // A partition answers with two sequences cut out of the one the
          // player clicked. `selected` is the order — filtering it by side is
          // order-preserving, so each side comes out in the order the cards
          // were clicked, which is what the overlay's numbers showed.
          answer:
            choice.kind === 'partitionCards'
              ? {
                  kind: 'partition',
                  top: mode.selected.filter((id) => mode.toTop.includes(id)),
                  bottom: mode.selected.filter((id) => !mode.toTop.includes(id)),
                }
              : choice.kind === 'orderCards'
                ? { kind: 'order', order: [...mode.selected] }
                : { kind: 'cards', selected: [...mode.selected] },
        },
      };
    }
    case 'answerYesNo': {
      if (choice.kind !== 'yesNo') {
        return { mode };
      }
      return {
        mode: IDLE,
        intent: {
          type: 'ANSWER_CHOICE',
          choiceId: choice.id,
          answer: { kind: 'yesNo', value: ev.value },
        },
      };
    }
    // Escape, background clicks and board clicks are all inert: there is no way
    // to decline an open choice.
    default:
      return { mode };
  }
}

// Exhaustive over BoardEvent on purpose: no `default`, so a new UiEvent cannot
// be added without TypeScript demanding a branch here.
function reduceIdle(mode: UiMode, ev: BoardEvent, aff: Affordances): UiModeResult {
  switch (ev.kind) {
    // Only meaningful while a partition is open, which is never in idle.
    case 'toggleChoiceSide':
      return { mode };
    // A card leaves your hand for good the moment it is played, and a hand is
    // a row of small overlapping tiles you are dragging a pointer across. One
    // click was enough to commit, which made a misplay a hand-tremor away —
    // so from hand the click selects and asks, and never commits.
    case 'clickHandCard':
      return clickCard(ev.instanceId, aff, mode, true);
    case 'clickFieldCard':
      return ev.mine ? clickCard(ev.instanceId, aff, mode, false) : { mode };
    case 'clickDonArea': {
      if (anyCanReceiveDon(aff)) {
        return { mode: { kind: 'attachingDon', owner: aff.whoActs } };
      }
      return { mode };
    }
    // The choice events only mean anything inside `answeringChoice`.
    case 'chooseMenuOption':
    case 'toggleChoiceCandidate':
    case 'toggleChoiceHandle':
    case 'confirmChoice':
    case 'answerYesNo':
      return { mode };
  }
}

/**
 * Re-validate a mode against a (new) affordance set: a mode opened by a player
 * who no longer acts is dropped outright, and otherwise the referenced card
 * must still carry the corresponding affordance.
 *
 * Takes the affordances rather than the state, for the reason
 * `indexAffordances` does: over a network there is no state to re-derive them
 * from. `aff.whoActs` is the player this set was built for — priority in
 * hot-seat, the seat in a networked game — and a mode belonging to anyone else
 * is a mode from before the board moved.
 */
export function ensureModeValid(mode: UiMode, aff: Affordances): UiMode {
  // An open choice imposes its mode: nothing clicks into `answeringChoice`, and
  // no other mode may survive next to it. Answering is the only legal move, so
  // the UI has to be in the only state that can produce it — including when the
  // choice belongs to the player who was NOT taking the turn, which is how a
  // life card's [Trigger] reaches the damaged player.
  if (aff.pendingChoice !== null) {
    if (
      mode.kind === 'answeringChoice' &&
      mode.owner === aff.whoActs &&
      mode.choiceId === aff.pendingChoice.id
    ) {
      // Keep the selection, minus anything that stopped being a candidate — and
      // the side flags with it, or a card that left the choice could come back
      // to a different one still marked for the top.
      const selected = mode.selected.filter((id) => aff.pendingChoice?.candidates.includes(id));
      const toTop = mode.toTop.filter((id) => aff.pendingChoice?.candidates.includes(id));
      // Handles are positions in a list that only exists while this exact
      // choice does, so a surviving choice keeps them and nothing else can.
      const limit = aff.pendingChoice.blindHandles ?? 0;
      const handles = mode.handles.filter((handle) => handle < limit);
      return selected.length === mode.selected.length &&
        toTop.length === mode.toTop.length &&
        handles.length === mode.handles.length
        ? mode
        : { ...mode, selected, toTop, handles };
    }
    return answeringChoiceFor(aff, aff.pendingChoice.id);
  }
  if (mode.kind !== 'idle' && mode.owner !== aff.whoActs) {
    return IDLE;
  }
  switch (mode.kind) {
    case 'idle':
      return mode;
    case 'attacking':
      return cardAffordance(aff, mode.attacker).canAttack ? mode : IDLE;
    case 'attachingDon':
      return anyCanReceiveDon(aff) ? mode : IDLE;
    case 'choosingTrash': {
      const card = cardAffordance(aff, mode.cardToPlay);
      return card.canPlay && card.playRequiresTrash ? mode : IDLE;
    }
    case 'countering':
      return cardAffordance(aff, mode.counterCard).canCounter ? mode : IDLE;
    case 'cardMenu':
      // Still ambiguous, or the ambiguity is gone and so is the menu.
      return menuOptions(aff, mode.card).length > 1 ? mode : IDLE;
    case 'answeringChoice':
      // Reached only with no choice open — the branch above owns the other case.
      return IDLE;
  }
}

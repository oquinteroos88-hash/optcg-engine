import type { Keyword } from './abilities/dsl.js';
import { KEYWORDS } from './abilities/dsl.js';
import { getPower, getPowerWithoutStatics, hasKeyword } from './selectors.js';
import type {
  Battle,
  CardInstance,
  DonCard,
  GameState,
  InstanceId,
  LegalityRule,
  Modifier,
  PendingChoice,
  PlayerId,
  ResumeStep,
  StackItem,
} from './types.js';
import { PLAYER_IDS } from './types.js';
import { blindHandleOrder, knows } from './visibility.js';

/**
 * What one player has the right to see — a pure derivation of the `GameState`
 * that already exists, never a second state. Nothing is maintained and nothing
 * can drift: the same state produces the same view byte for byte, and the view
 * of a rehydrated state is the view of the original.
 *
 * What never leaves, without exception: the `rng` (seed and cursor — the seed
 * *is* both decks' order), the order of any deck, and the `InstanceId` or
 * `CardId` of any card the viewer does not know by `visibility.ts`'s one
 * question. Where a list would betray an order the viewer has no right to —
 * the known contents of a deck, a look's sequence — the view sorts it, because
 * a set is what the viewer actually owns.
 */
export interface PlayerView {
  version: 1;
  viewer: PlayerId;
  status: GameState['status'];
  winner: PlayerId | null;
  endReason: GameState['endReason'];
  turn: number;
  activePlayer: PlayerId;
  firstPlayer: PlayerId;
  phase: GameState['phase'];
  priority: PlayerId;
  players: Record<PlayerId, PlayerZonesView>;
  /**
   * Instances the viewer knows, and no other key: an unknown card's id must
   * not appear even as a property name. Keys in sorted order, so equal states
   * stringify equal.
   */
  cards: Record<InstanceId, ViewCard>;
  battle: Battle | null;
  modifiers: Modifier[];
  legality: LegalityRule[];
  stack: ViewStackItem[];
  pending: PendingView | null;
  resume: ResumeStep[];
  rules: GameState['rules'];
  /**
   * **No `log`, and its absence is a decision PR #45 took by trying to render
   * one.** A view is the *present*; history is the journal, and PR #44 already
   * settled why the two cannot be the same thing — the engine's redaction is
   * memoryless, so a log re-derived now is strictly *more* redacted than what
   * the player watched live (a revealed card since shuffled back nulls out
   * even in the reveal that showed it). A `log` on the view is therefore
   * history that nobody may correctly render, sitting in every payload: it was
   * **56% of the average update** on the wire and it grew with the game.
   *
   * So the reader that wants history keeps a journal of the batches it was
   * sent, exactly as the server does. `redactLog` still exists for the one
   * reader that has no journal to keep — someone joining a match already in
   * progress with nothing to catch up from — and it is honest there precisely
   * because such a reader never saw the live version to be short-changed
   * against.
   */
}

/**
 * A card instance plus the three rule readings a board has to draw, computed
 * here because **only the engine can compute them and only from the whole
 * state**.
 *
 * `getPower` walks every live modifier and every `static` on both fields, and a
 * static's own condition may ask about zones this viewer cannot see —
 * `OP01-068` Gecko Moria gates on its controller's hand size, `OP01-109`
 * Who's.Who on DON!! — so a client re-deriving power from a redacted view
 * would not merely be encoding a rule twice, it would get a different number.
 * That is why these three ride on the view rather than being recomputed by
 * whoever renders it: the engine computes, the server carries, the client
 * draws.
 *
 * `powerWithoutStatics` is here for one reason, and it is a UI reason: the
 * difference between the two is exactly the continuous contribution, which is
 * the only way a board can explain a badge — continuous effects emit no events
 * and write nothing to the state, so the log can never account for one.
 */
export interface ViewCard extends CardInstance {
  /** Effective power, everything applied (CR 2-6-3). */
  power: number;
  /** The same without continuous effects; the difference is their whole
   * contribution. */
  powerWithoutStatics: number;
  /** Every keyword the card answers to now, printed or granted. */
  keywords: Keyword[];
}

export interface PlayerZonesView {
  leader: InstanceId;
  characters: InstanceId[];
  stage: InstanceId | null;
  /**
   * The viewer's own hand keeps its order (CR 3-4-2 lets an owner view and
   * arrange their hand freely); a foreign hand is a count plus the sorted ids
   * the viewer happens to know — sorted, because *which position* a known card
   * sits at is exactly what a fan of backs does not show (3-4-3).
   */
  hand: { count: number; cards: InstanceId[] | null; known: InstanceId[] };
  /** Count public (CR 3-1-4); `known` is entitlement (a search not yet
   * shuffled away, a revealed card put back), sorted — never deck order. */
  deck: { count: number; known: InstanceId[] };
  /** Secret to its own owner too (CR 3-10-2), so both sides look the same. */
  life: { count: number; known: InstanceId[] };
  trash: InstanceId[];
  don: DonCard[];
  hasMulliganed: boolean;
}

/**
 * A stack entry with the source's identity gated by knowledge: a suspended
 * life-card [Trigger] is an entry the rival may know exists (the wait is as
 * observable as thinking time at a table) without learning which card is
 * waiting — `abilityId` names the card, so it hides with the source.
 */
export interface ViewStackItem {
  controller: PlayerId;
  status: StackItem['status'];
  source: InstanceId | null;
  abilityId: string | null;
}

/**
 * The pending question, by audience:
 *
 * - `chooser` — the viewer must answer and sees everything the answer needs.
 * - `chooserBlind` — the viewer must answer a choice over cards they may not
 *   see (CR 8-4-4-2, Kanjuro's shape): handles and a count, never identities.
 * - `other` — someone else is choosing. Kind and player, nothing more: when
 *   the rival is deciding what to bury out of a look, your view knows *that*
 *   they are choosing and of what kind, not *between what*.
 */
export type PendingView =
  | {
      audience: 'chooser';
      id: string;
      player: PlayerId;
      kind: PendingChoice['kind'];
      prompt: string;
      /** Sorted — a selection is over a set, and candidate order can carry
       * zone order (a deck search's matches arrive in deck order). */
      candidates: InstanceId[];
      min: number;
      max: number;
    }
  | {
      audience: 'chooserBlind';
      id: string;
      player: PlayerId;
      kind: 'selectCards';
      prompt: string;
      /** Answer with `{ kind: 'handles', selected: [...] }`, indices in
       * `0..handleCount-1`. The engine resolves them; the mapping never
       * travels. */
      handleCount: number;
      min: number;
      max: number;
    }
  | { audience: 'other'; id: string; player: PlayerId; kind: PendingChoice['kind'] };

/** Same state, same player, same bytes — see the interface note. */
export function playerView(state: GameState, viewer: PlayerId): PlayerView {
  const sees = (id: InstanceId): boolean => knows(state, viewer, id);
  const knownSorted = (ids: readonly InstanceId[]): InstanceId[] => ids.filter(sees).sort();

  const players = {} as Record<PlayerId, PlayerZonesView>;
  for (const player of PLAYER_IDS) {
    const ps = state.players[player];
    players[player] = {
      leader: ps.leader,
      characters: [...ps.characters],
      stage: ps.stage,
      hand:
        player === viewer
          ? { count: ps.hand.length, cards: [...ps.hand], known: [] }
          : { count: ps.hand.length, cards: null, known: knownSorted(ps.hand) },
      deck: { count: ps.deck.length, known: knownSorted(ps.deck) },
      life: { count: ps.life.length, known: knownSorted(ps.life) },
      trash: [...ps.trash],
      don: [...ps.don],
      hasMulliganed: ps.hasMulliganed,
    };
  }

  // Sorted keys: `JSON.stringify` follows insertion order, and two equal
  // states must not stringify differently because their records were built in
  // a different sequence.
  const cards = {} as Record<InstanceId, ViewCard>;
  for (const id of Object.keys(state.cards).sort()) {
    if (sees(id)) {
      cards[id] = {
        ...(state.cards[id] as CardInstance),
        power: getPower(state, id),
        powerWithoutStatics: getPowerWithoutStatics(state, id),
        keywords: KEYWORDS.filter((keyword) => hasKeyword(state, id, keyword)),
      };
    }
  }

  return {
    version: 1,
    viewer,
    // No `matchId`, and not as an oversight: `createGame` derives it as
    // `optcg-${seed}`, so carrying it would publish the seed — and the seed
    // *is* the order of both decks. Any identifier derived from it is
    // enumerable back to it; naming the match is the transport's job.
    status: state.status,
    winner: state.winner,
    endReason: state.endReason,
    turn: state.turn,
    activePlayer: state.activePlayer,
    firstPlayer: state.firstPlayer,
    phase: state.phase,
    priority: state.priority,
    players,
    cards,
    battle: state.battle,
    modifiers: state.modifiers.filter((modifier) => sees(modifier.target) && sees(modifier.source)),
    legality: state.legality.filter((rule) => legalityVisible(rule, sees)),
    stack: state.stack.map((item) => viewStackItem(item, sees)),
    pending: state.pending === null ? null : pendingView(state.pending, viewer),
    resume: [...state.resume],
    rules: state.rules,
  };
}

/**
 * Timed records name field cards almost always — but "almost" is a leak, not
 * an argument, so both are filtered: a rule or grant about a card the viewer
 * cannot name is withheld whole rather than published with a hole in it.
 */
function legalityVisible(rule: LegalityRule, sees: (id: InstanceId) => boolean): boolean {
  if (!sees(rule.source)) {
    return false;
  }
  if (rule.whileAttacker !== undefined && !sees(rule.whileAttacker)) {
    return false;
  }
  return 'is' in rule.subject ? sees(rule.subject.is) : true;
}

function viewStackItem(item: StackItem, sees: (id: InstanceId) => boolean): ViewStackItem {
  const visible = sees(item.source);
  return {
    controller: item.controller,
    status: item.status,
    source: visible ? item.source : null,
    abilityId: visible ? item.abilityId : null,
  };
}

/**
 * The open choice as one seat may read it, without building a whole view.
 *
 * The affordance indexer needs exactly this and nothing else — the answer
 * space of an open choice is the one thing a client takes from the state
 * rather than from `legalActions` — and deriving a full `PlayerView` to read a
 * single field means computing the power and keywords of a hundred cards to
 * answer a question about one. Same redaction, same function underneath.
 */
export function redactPending(state: GameState, viewer: PlayerId): PendingView | null {
  return state.pending === null ? null : pendingView(state.pending, viewer);
}

function pendingView(pending: PendingChoice, viewer: PlayerId): PendingView {
  if (viewer !== pending.player) {
    return { audience: 'other', id: pending.id, player: pending.player, kind: pending.kind };
  }
  if (pending.blind === true) {
    return {
      audience: 'chooserBlind',
      id: pending.id,
      player: pending.player,
      kind: 'selectCards',
      prompt: pending.prompt,
      // The count is the whole mapping the chooser gets. `blindHandleOrder`
      // stays on the engine side of the line: handle i resolves there.
      handleCount: blindHandleOrder(pending.id, pending.candidates).length,
      min: pending.min,
      max: pending.max,
    };
  }
  return {
    audience: 'chooser',
    id: pending.id,
    player: pending.player,
    kind: pending.kind,
    prompt: pending.prompt,
    candidates: [...pending.candidates].sort(),
    min: pending.min,
    max: pending.max,
  };
}

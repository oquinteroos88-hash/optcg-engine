import type { Duration, Keyword, LegalityEffect, LegalityQuestion } from './abilities/dsl.js';
import type { GameEvent } from './events.js';
import type { CardId, GameState, InstanceId, PlayerId } from './types.js';
import { knows } from './visibility.js';

/**
 * The per-player face of the log. `GameEvent` is perfect-information by
 * declared design; this union is what one player is entitled to read of it,
 * and every id-bearing field says so in its type: `InstanceId | null` is a
 * field the viewer may or may not deserve, a plain `InstanceId` is one the
 * event only survives redaction carrying.
 *
 * The shape mirrors `GameEvent` name for name so a client can switch over
 * `type` the way it already does — and `redactEvent` switches over the same
 * union **with no default**, so the next event added to `events.ts` does not
 * compile until someone declares its visibility here. That is the point: an
 * event whose privacy was never thought about must be a type error, not a
 * leak.
 *
 * Redaction reads the viewer's **current** entitlement (`knows`), not what the
 * viewer once watched. A revealed card that has since been shuffled back shows
 * as `null` even in the reveal that showed it — the view is memoryless on
 * purpose, because a view that carried old ids would let its reader track an
 * instance through the shuffle that was supposed to erase it (CR 3-2-2,
 * 3-2-4). A live client remembers what it saw; the engine's job is never to
 * hand over more than the viewer deserves *now*.
 */
export type ViewEvent =
  /** No `matchId`: it is derived from the seed (`optcg-${seed}`), and the seed
   * is the one thing that never leaves — see `playerView`'s note. */
  | { type: 'gameStarted'; firstPlayer: PlayerId }
  | { type: 'mulliganTaken'; player: PlayerId; accepted: boolean }
  | { type: 'lifeSet'; player: PlayerId; count: number }
  | { type: 'turnStarted'; turn: number; player: PlayerId }
  /** Identity to the owner (CR 4-5-1 draws "without revealing it to the other
   * player"); the rival reads the event itself as the count. */
  | { type: 'cardDrawn'; player: PlayerId; instanceId: InstanceId | null }
  | { type: 'donGained'; player: PlayerId; count: number }
  | { type: 'donAttached'; player: PlayerId; to: InstanceId | null; count: number }
  | { type: 'donPaid'; player: PlayerId; count: number }
  | { type: 'donReturned'; player: PlayerId; count: number; rested: boolean }
  | { type: 'donOrientationChanged'; player: PlayerId; orientation: 'active' | 'rested'; count: number }
  | { type: 'cardPlayed'; player: PlayerId; instanceId: InstanceId | null; cardId: CardId | null }
  | { type: 'characterTrashedForRoom'; player: PlayerId; instanceId: InstanceId | null }
  | { type: 'stageReplaced'; player: PlayerId; oldStage: InstanceId | null; newStage: InstanceId | null }
  | { type: 'attackDeclared'; player: PlayerId; attacker: InstanceId | null; target: InstanceId | null }
  | { type: 'blockDeclared'; player: PlayerId; blocker: InstanceId | null }
  | {
      type: 'counterPlayed';
      player: PlayerId;
      instanceId: InstanceId | null;
      target: InstanceId | null;
      value: number;
    }
  | {
      type: 'battleResolved';
      attacker: InstanceId | null;
      target: InstanceId | null;
      outcome: 'ko' | 'lifeDamage' | 'noEffect' | 'koPrevented';
    }
  | {
      type: 'battleEndedEarly';
      attacker: InstanceId | null;
      target: InstanceId | null;
      gone: 'attacker' | 'target' | 'both';
    }
  /** Identity to the owner alone — the card went to their hand unrevealed
   * (CR 10-1-5-2); `remaining` is the count both sides watched change. */
  | { type: 'lifeTaken'; player: PlayerId; instanceId: InstanceId | null; remaining: number }
  | { type: 'koed'; player: PlayerId; instanceId: InstanceId | null }
  /** Kept only for a viewer who knows the source: activating from a secret
   * zone revealed it (CR 10-1-5-1), so a kept event carries a real id. */
  | { type: 'abilityTriggered'; player: PlayerId; source: InstanceId; abilityId: string }
  | { type: 'abilityDeclined'; player: PlayerId; source: InstanceId; abilityId: string }
  /** Foreign choices lose their prompt (prompts can name hidden cards), and a
   * foreign yes/no offer is dropped whole: its existence says a hidden card
   * had something to offer — the declined-[Trigger] tell (CR 10-1-5-2 keeps a
   * decline unrevealed, so the offer must be as invisible as the card). */
  | {
      type: 'choiceOpened';
      player: PlayerId;
      choiceId: string;
      kind: 'selectCards' | 'yesNo' | 'selectOption' | 'orderCards' | 'partitionCards';
      prompt: string | null;
    }
  | { type: 'choiceAnswered'; player: PlayerId; choiceId: string }
  | { type: 'powerGranted'; target: InstanceId | null; value: number; duration: Duration }
  | { type: 'keywordGranted'; target: InstanceId | null; keyword: Keyword; duration: Duration }
  | {
      type: 'legalitySet';
      source: InstanceId | null;
      effect: LegalityEffect;
      question: LegalityQuestion;
      duration: Duration;
    }
  | { type: 'orientationChanged'; instanceId: InstanceId | null; orientation: 'active' | 'rested' }
  | { type: 'cardMoved'; player: PlayerId; instanceId: InstanceId | null; to: 'hand' | 'deck' | 'trash' | 'life' }
  | { type: 'cardDiscarded'; player: PlayerId; instanceId: InstanceId | null }
  /** A reveal was watched by both players, so the *positions* survive for
   * everyone; each id survives only while its card is still trackable. */
  | { type: 'cardsRevealed'; player: PlayerId; instanceIds: (InstanceId | null)[] }
  /** Ids to the looker (CR 11-3-1), count to the rival — and the looker's ids
   * arrive **sorted**, because the sequence they were seen in is deck order
   * and deck order never leaves the engine. */
  | { type: 'cardsLookedAt'; player: PlayerId; count: number; instanceIds: InstanceId[] | null }
  | { type: 'deckOrdered'; player: PlayerId; count: number; instanceIds: InstanceId[] | null }
  /** The first event whose *shape* is public while its contents are private:
   * a real table shows everyone how many cards went to each end (PR #36's
   * finding), so the rival keeps the two lengths and loses the faces. */
  | {
      type: 'deckPartitioned';
      player: PlayerId;
      topCount: number;
      bottomCount: number;
      top: InstanceId[] | null;
      bottom: InstanceId[] | null;
    }
  | { type: 'deckShuffled'; player: PlayerId; count: number }
  | { type: 'donReturnedToDeck'; player: PlayerId; count: number }
  | { type: 'donAdded'; player: PlayerId; count: number; orientation: 'active' | 'rested' }
  | { type: 'lifeBanished'; player: PlayerId; instanceId: InstanceId | null; remaining: number }
  | { type: 'turnEnded'; turn: number; player: PlayerId }
  | { type: 'gameEnded'; winner: PlayerId; endReason: 'lifeOut' | 'deckOut' | 'concede' };

/** The whole log for one viewer. A fold rather than a map, because a dropped
 * offer has to take its answer with it: `choiceAnswered` for a choice this
 * viewer never saw opened would be an event about nothing. */
export function redactLog(state: GameState, viewer: PlayerId): ViewEvent[] {
  const droppedChoices = new Set<string>();
  const out: ViewEvent[] = [];
  for (const event of state.log) {
    const redacted = redactEvent(state, viewer, event, droppedChoices);
    if (redacted !== null) {
      out.push(redacted);
    }
  }
  return out;
}

/**
 * One event, one viewer, one visibility decision — and no `default`, so the
 * next member of `GameEvent` fails to compile until its row is written here.
 */
export function redactEvent(
  state: GameState,
  viewer: PlayerId,
  event: GameEvent,
  droppedChoices: Set<string>,
): ViewEvent | null {
  const hide = (id: InstanceId): InstanceId | null => (knows(state, viewer, id) ? id : null);
  const knownSorted = (ids: readonly InstanceId[]): InstanceId[] =>
    ids.filter((id) => knows(state, viewer, id)).sort();

  switch (event.type) {
    case 'gameStarted':
      return { type: 'gameStarted', firstPlayer: event.firstPlayer };
    // Public bookkeeping: counts, turns, DON!! (the DON!! deck and cost area
    // are open, CR 3-3-2 and 3-9-2), and the shuffle that never carried ids.
    case 'mulliganTaken':
    case 'lifeSet':
    case 'turnStarted':
    case 'donGained':
    case 'donPaid':
    case 'donReturned':
    case 'donOrientationChanged':
    case 'deckShuffled':
    case 'donReturnedToDeck':
    case 'donAdded':
    case 'turnEnded':
    case 'gameEnded':
      return event;
    case 'cardDrawn':
      // CR 4-5-1: the draw shows the other player nothing. The owner's id is
      // still filtered by current knowledge — a card drawn and later shuffled
      // back is a card nobody can point at any more.
      return {
        type: 'cardDrawn',
        player: event.player,
        instanceId: viewer === event.player ? hide(event.instanceId) : null,
      };
    case 'donAttached':
      return { ...event, to: hide(event.to) };
    case 'cardPlayed': {
      const id = hide(event.instanceId);
      return { ...event, instanceId: id, cardId: id === null ? null : event.cardId };
    }
    case 'characterTrashedForRoom':
      return { ...event, instanceId: hide(event.instanceId) };
    case 'stageReplaced':
      return { ...event, oldStage: hide(event.oldStage), newStage: hide(event.newStage) };
    case 'attackDeclared':
      return { ...event, attacker: hide(event.attacker), target: hide(event.target) };
    case 'blockDeclared':
      return { ...event, blocker: hide(event.blocker) };
    case 'counterPlayed':
      return { ...event, instanceId: hide(event.instanceId), target: hide(event.target) };
    case 'battleResolved':
    case 'battleEndedEarly':
      return { ...event, attacker: hide(event.attacker), target: hide(event.target) };
    case 'lifeTaken':
      // CR 10-1-5-2: added to the hand without revealing it. The count moved
      // in front of both players; the face is the owner's.
      return {
        type: 'lifeTaken',
        player: event.player,
        instanceId: viewer === event.player ? hide(event.instanceId) : null,
        remaining: event.remaining,
      };
    case 'koed':
      return { ...event, instanceId: hide(event.instanceId) };
    case 'abilityTriggered':
    case 'abilityDeclined':
      // Kept only while the viewer knows the source. An activation from a
      // secret zone revealed it (CR 10-1-5-1), so the triggered case is
      // normally kept; a declined hidden [Trigger] was never revealed
      // (10-1-5-2) and its record would tell the rival the card had one.
      return knows(state, viewer, event.source) ? event : null;
    case 'choiceOpened': {
      if (viewer === event.player) {
        return event;
      }
      if (event.kind === 'yesNo') {
        // The offer itself is the tell — see the union's note.
        droppedChoices.add(event.choiceId);
        return null;
      }
      return { ...event, prompt: null };
    }
    case 'choiceAnswered':
      return droppedChoices.has(event.choiceId) ? null : event;
    case 'powerGranted':
    case 'keywordGranted':
      return { ...event, target: hide(event.target) };
    case 'legalitySet':
      return { ...event, source: hide(event.source) };
    case 'orientationChanged':
      return { ...event, instanceId: hide(event.instanceId) };
    case 'cardMoved':
      return { ...event, instanceId: hide(event.instanceId) };
    case 'cardDiscarded':
      return { ...event, instanceId: hide(event.instanceId) };
    case 'cardsRevealed':
      return { ...event, instanceIds: event.instanceIds.map(hide) };
    case 'cardsLookedAt':
      return {
        type: 'cardsLookedAt',
        player: event.player,
        count: event.instanceIds.length,
        instanceIds: viewer === event.player ? knownSorted(event.instanceIds) : null,
      };
    case 'deckOrdered':
      return {
        type: 'deckOrdered',
        player: event.player,
        count: event.instanceIds.length,
        instanceIds: viewer === event.player ? knownSorted(event.instanceIds) : null,
      };
    case 'deckPartitioned':
      return {
        type: 'deckPartitioned',
        player: event.player,
        topCount: event.top.length,
        bottomCount: event.bottom.length,
        top: viewer === event.player ? knownSorted(event.top) : null,
        bottom: viewer === event.player ? knownSorted(event.bottom) : null,
      };
    case 'lifeBanished':
      return { ...event, instanceId: hide(event.instanceId) };
  }
}

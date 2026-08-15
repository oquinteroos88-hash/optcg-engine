import type { GameState, InstanceId, PlayerId } from './types.js';
import { PLAYER_IDS } from './types.js';

/**
 * **The single place that answers "does player X know which card instance Y
 * is?"** — the question every piece of the per-player layer hangs off: the
 * view's known-card lists, the event redaction, the opaque handles. The
 * project's law applies with no discount here: if this question were answered
 * in two sites, one would get fixed and the other would not, and the second
 * would be the leak.
 *
 * The answer has two halves, and both live in this file:
 *
 * - **Where the card is now.** CR 3-1-5 splits every area into open and
 *   secret, and the split is per-area, not per-card: the field and the trash
 *   show their faces to both players, the hand to its owner alone, the deck
 *   and the Life area to nobody — the Life area's owner included (3-10-2:
 *   "neither player can check the contents of those cards").
 * - **What a player has legitimately seen.** `GameState.knownBy` is the
 *   engine's record of entitlement: a reveal widens it to both players
 *   (CR 11-2-1, 11-2-2), a look widens it to the looker alone (11-3-1), a
 *   search widens the whole deck to the searcher (8-4-4-4 has them "check the
 *   cards' faces"), and moving a card never narrows it — the physical game
 *   does not erase memories, so a Character bounced off the field is a card
 *   both players can still name while it sits in a hand. Exactly one act
 *   narrows it: a shuffle (3-2-4) makes the deck's contents and order
 *   unknowable again (3-2-2), which is the only way the game ever takes
 *   knowledge back.
 */

/** The zones a card instance can occupy. DON!! live elsewhere and are public. */
export type CardZone = 'leader' | 'characters' | 'stage' | 'hand' | 'deck' | 'trash' | 'life';

/**
 * Which zone holds a card right now, and under which player's side of the
 * table. Field zones are searched under both players because a card sits in
 * its **controller**'s field arrays while every off-field zone is kept under
 * its **owner** — asking membership everywhere means this function cannot
 * drift from wherever the reducer chose to put the card.
 */
export function zoneOf(state: GameState, id: InstanceId): { holder: PlayerId; zone: CardZone } {
  for (const holder of PLAYER_IDS) {
    const ps = state.players[holder];
    if (ps.leader === id) {
      return { holder, zone: 'leader' };
    }
    if (ps.characters.includes(id)) {
      return { holder, zone: 'characters' };
    }
    if (ps.stage === id) {
      return { holder, zone: 'stage' };
    }
    for (const zone of ['hand', 'deck', 'trash', 'life'] as const) {
      if (ps[zone].includes(id)) {
        return { holder, zone };
      }
    }
  }
  throw new Error(`Engine bug: ${id} is in no zone`);
}

/**
 * Who an area shows its faces to, by rule and with the rule.
 *
 * - Leader, Character and Stage areas are open (CR 3-6-2, 3-7-2, 3-8-2), and
 *   so is the trash, order included (3-5-2).
 * - The hand is secret, but its owner "can freely view the contents" (3-4-2);
 *   the other player cannot (3-4-3).
 * - The deck shows itself to nobody (3-2-2) and the Life area shows itself to
 *   nobody either — its owner is not an exception (3-10-2), which is why a
 *   player's own life cards are as unknown to them as their opponent's.
 */
function zoneAudience(zone: CardZone, holder: PlayerId): readonly PlayerId[] {
  switch (zone) {
    case 'leader':
    case 'characters':
    case 'stage':
    case 'trash':
      return PLAYER_IDS;
    case 'hand':
      return [holder];
    case 'deck':
    case 'life':
      return [];
  }
}

/** The one question. Current zone first, remembered entitlement second. */
export function knows(state: GameState, viewer: PlayerId, id: InstanceId): boolean {
  const { holder, zone } = zoneOf(state, id);
  if (zoneAudience(zone, holder).includes(viewer)) {
    return true;
  }
  return state.knownBy[id]?.includes(viewer) ?? false;
}

/** Insertion keeping the canonical p1-before-p2 order, so states round-trip. */
export function remember(draft: GameState, id: InstanceId, player: PlayerId): void {
  const entry = draft.knownBy[id];
  if (entry === undefined) {
    draft.knownBy[id] = [player];
    return;
  }
  if (!entry.includes(player)) {
    draft.knownBy[id] = PLAYER_IDS.filter((p) => p === player || entry.includes(p));
  }
}

/**
 * A reveal: the act that makes cards known to a player who could not see them.
 * CR 11-2-2 turns the cards face-down again once the effect resolves, but the
 * players keep what they saw — this record *is* that memory, and only a
 * shuffle ever takes it away.
 */
export function rememberRevealed(draft: GameState, ids: readonly InstanceId[]): void {
  for (const id of ids) {
    for (const player of PLAYER_IDS) {
      remember(draft, id, player);
    }
  }
}

/** A look: private to the player of the effect (CR 11-3-1), and only to them. */
export function rememberLooked(
  draft: GameState,
  ids: readonly InstanceId[],
  looker: PlayerId,
): void {
  for (const id of ids) {
    remember(draft, id, looker);
  }
}

/**
 * A search: the widest private read in the game. CR 8-4-4-4 has the searcher
 * "check the cards' faces and choose the specified cards", so the searcher has
 * read the **whole** deck — not the matches — and CR 11-3-1 keeps everything
 * they read to themselves. Marked even when the search finds nothing, because
 * the player read the deck either way.
 */
export function rememberDeckSearched(draft: GameState, owner: PlayerId, searcher: PlayerId): void {
  for (const id of draft.players[owner].deck) {
    remember(draft, id, searcher);
  }
}

/**
 * The one mechanism that takes knowledge away. A shuffle randomly reorders the
 * deck (CR 3-2-4) inside an area neither player may inspect (3-2-2), so every
 * card in it stops being trackable by anyone: whatever a search taught its
 * searcher, whatever a reveal taught both players about a card that went back —
 * after this, the deck's instances are backs again. Knowledge of cards
 * *outside* the shuffled deck is untouched.
 */
export function forgetShuffled(draft: GameState, player: PlayerId): void {
  for (const id of draft.players[player].deck) {
    if (draft.knownBy[id] !== undefined) {
      delete draft.knownBy[id];
    }
  }
}

/**
 * Turns zone-derived sight into remembered entitlement **at the moment a card
 * leaves its zone** — the only moment sight can be lost. While a card sits
 * somewhere, `knows` answers from the zone itself; when it moves, whoever the
 * old zone showed it to keeps it, which is what makes "movement never erases
 * knowledge" a property of the engine instead of a discipline. Recording at
 * departure instead of sweeping every card at every action boundary is also
 * what keeps the bookkeeping O(cards moved): a full sweep through immer's
 * proxies nearly doubled the cost of `applyAction`, measured, and a moved card
 * is the only card whose knowledge can change.
 *
 * Called from the two removal chokepoints (`detachFromField`,
 * `removeFromNonFieldZone`) and the few sites that splice a hand directly.
 */
export function rememberDeparture(
  draft: GameState,
  id: InstanceId,
  zone: CardZone,
  holder: PlayerId,
): void {
  for (const player of zoneAudience(zone, holder)) {
    remember(draft, id, player);
  }
}


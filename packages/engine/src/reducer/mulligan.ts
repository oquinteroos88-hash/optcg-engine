import type { GameEvent } from '../events.js';
import { getCardDef } from '../registry.js';
import { shuffle } from '../rng.js';
import { getOpponent } from '../selectors.js';
import type { GameState, PlayerId } from '../types.js';
import { emit, mustGetCard } from './helpers.js';
import { startTurn } from './turn.js';

// Decisions are sequential and tracked by priority: firstPlayer decides first,
// then the opponent; the second decision completes setup. Once-only is
// structural (status leaves 'mulligan'), so hasMulliganed is bookkeeping that
// records only an accepted redraw.
export function applyMulligan(
  draft: GameState,
  action: { player: PlayerId; accept: boolean },
  events: GameEvent[],
): void {
  const player = action.player;
  const ps = draft.players[player];
  if (action.accept) {
    ps.deck.push(...ps.hand);
    ps.hand = [];
    const shuffled = shuffle(ps.deck, draft.rng);
    draft.rng = shuffled.rng;
    ps.hand = shuffled.items.slice(0, 5);
    ps.deck = shuffled.items.slice(5);
    ps.hasMulliganed = true;
  }
  emit(draft, events, { type: 'mulliganTaken', player, accepted: action.accept });

  if (player === draft.firstPlayer) {
    draft.priority = getOpponent(player);
    return;
  }
  placeLifeAndStart(draft, events);
}

function placeLifeAndStart(draft: GameState, events: GameEvent[]): void {
  draft.status = 'playing';
  const order: PlayerId[] = [draft.firstPlayer, getOpponent(draft.firstPlayer)];
  for (const player of order) {
    const ps = draft.players[player];
    const lifeCount = getCardDef(mustGetCard(draft, ps.leader).cardId).life;
    // life[0] = former top of the deck.
    ps.life = ps.deck.slice(0, lifeCount);
    ps.deck = ps.deck.slice(lifeCount);
    emit(draft, events, { type: 'lifeSet', player, count: lifeCount });
  }
  startTurn(draft, draft.firstPlayer, events);
}

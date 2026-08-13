import { freeze } from 'immer';
import type { GameEvent } from './events.js';
import { getCardDef } from './registry.js';
import type { RngState } from './rng.js';
import { shuffle } from './rng.js';
import type {
  CardInstance,
  Decklist,
  DonCard,
  GameState,
  InstanceId,
  PlayerId,
  PlayerState,
} from './types.js';
import { PLAYER_IDS } from './types.js';

const DECK_SIZE = 50;
const DON_COUNT = 10;
const OPENING_HAND = 5;

function validateDecklist(player: PlayerId, decklist: Decklist): void {
  const leaderDef = getCardDef(decklist.leader);
  if (leaderDef.category !== 'leader') {
    throw new Error(`${player} decklist: ${decklist.leader} is not a leader card`);
  }
  if (decklist.cards.length !== DECK_SIZE) {
    throw new Error(
      `${player} decklist: expected exactly ${DECK_SIZE} cards, got ${decklist.cards.length}`,
    );
  }
  for (const cardId of decklist.cards) {
    const def = getCardDef(cardId);
    if (def.category === 'leader') {
      throw new Error(`${player} decklist: leader card ${cardId} cannot be in the main deck`);
    }
  }
}

function makeInstance(instanceId: InstanceId, cardId: string, owner: PlayerId): CardInstance {
  return {
    instanceId,
    cardId,
    owner,
    controller: owner,
    orientation: 'active',
    attachedDon: [],
    playedOnTurn: null,
    usedThisTurn: [],
  };
}

function buildPlayer(
  player: PlayerId,
  decklist: Decklist,
  cards: Record<InstanceId, CardInstance>,
  rng: RngState,
): { playerState: PlayerState; rng: RngState } {
  const leaderId: InstanceId = `${player}-c0`;
  cards[leaderId] = makeInstance(leaderId, decklist.leader, player);
  const deckIds = decklist.cards.map((cardId, i) => {
    const id: InstanceId = `${player}-c${i + 1}`;
    cards[id] = makeInstance(id, cardId, player);
    return id;
  });
  const shuffled = shuffle(deckIds, rng);
  const don: DonCard[] = Array.from({ length: DON_COUNT }, (_, i) => ({
    instanceId: `${player}-d${i}`,
    location: { kind: 'donDeck' },
  }));
  return {
    playerState: {
      leader: leaderId,
      characters: [],
      stage: null,
      hand: shuffled.items.slice(0, OPENING_HAND),
      deck: shuffled.items.slice(OPENING_HAND),
      trash: [],
      life: [],
      don,
      hasMulliganed: false,
    },
    rng: shuffled.rng,
  };
}

export function createGame(opts: {
  seed: number;
  decks: Record<PlayerId, Decklist>;
  firstPlayer: PlayerId;
}): GameState {
  if (opts.firstPlayer !== 'p1' && opts.firstPlayer !== 'p2') {
    throw new Error(`Invalid firstPlayer: ${String(opts.firstPlayer)}`);
  }
  for (const player of PLAYER_IDS) {
    validateDecklist(player, opts.decks[player]);
  }

  const cards: Record<InstanceId, CardInstance> = {};
  let rng: RngState = { seed: opts.seed, cursor: 0 };
  const p1 = buildPlayer('p1', opts.decks.p1, cards, rng);
  rng = p1.rng;
  const p2 = buildPlayer('p2', opts.decks.p2, cards, rng);
  rng = p2.rng;

  const matchId = `optcg-${opts.seed}`;
  const started: GameEvent = { type: 'gameStarted', matchId, firstPlayer: opts.firstPlayer };
  const state: GameState = {
    version: 1,
    matchId,
    status: 'mulligan',
    winner: null,
    endReason: null,
    turn: 0,
    activePlayer: opts.firstPlayer,
    firstPlayer: opts.firstPlayer,
    phase: 'main',
    priority: opts.firstPlayer,
    players: { p1: p1.playerState, p2: p2.playerState },
    cards,
    battle: null,
    modifiers: [],
    legality: [],
    stack: [],
    pending: null,
    resume: [],
    rng,
    log: [started],
    rules: {
      firstPlayerCannotAttackTurnOne: true,
      doubleAttackCanWinFromOneLife: false,
      playFromEffectPaysCost: false,
      effectPlayIsPlayingACharacter: true,
      placedRestedBecomesRested: false,
      nextTurnExcludesTurnInProgress: true,
    },
  };
  return freeze(state, true);
}

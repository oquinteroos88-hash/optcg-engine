import type { GameEvent } from './events.js';

export type PlayerId = 'p1' | 'p2';
export type CardId = string; // "TEST-001", the printed card
export type InstanceId = string; // "p1-c14", this physical copy
export type Orientation = 'active' | 'rested';

export const PLAYER_IDS: readonly PlayerId[] = ['p1', 'p2'];

export interface GameState {
  version: 1;
  matchId: string;
  status: 'mulligan' | 'playing' | 'finished';
  winner: PlayerId | null;
  endReason: 'lifeOut' | 'deckOut' | 'concede' | null;
  turn: number;
  activePlayer: PlayerId;
  firstPlayer: PlayerId;
  phase: 'refresh' | 'draw' | 'don' | 'main' | 'end';
  priority: PlayerId; // who acts NOW (defender during block/counter)
  players: Record<PlayerId, PlayerState>;
  cards: Record<InstanceId, CardInstance>;
  battle: Battle | null;
  modifiers: Modifier[];
  rng: { seed: number; cursor: number };
  log: GameEvent[];
  rules: { firstPlayerCannotAttackTurnOne: boolean };
}

export interface PlayerState {
  leader: InstanceId;
  characters: InstanceId[]; // max 5, order = board position
  stage: InstanceId | null;
  hand: InstanceId[];
  deck: InstanceId[]; // [0] = top
  trash: InstanceId[]; // [0] = most recent
  life: InstanceId[]; // [0] = top; damage takes from here
  don: DonCard[]; // the 10 DON!!, each with its location
  hasMulliganed: boolean; // true only when the player accepted the redraw
}

export interface CardInstance {
  instanceId: InstanceId;
  cardId: CardId;
  owner: PlayerId;
  controller: PlayerId;
  orientation: Orientation; // only relevant on the field
  attachedDon: InstanceId[];
  playedOnTurn: number | null;
}

export interface DonCard {
  instanceId: InstanceId;
  location:
    | { kind: 'donDeck' }
    | { kind: 'cost'; orientation: Orientation }
    | { kind: 'attached'; to: InstanceId };
}

export interface Battle {
  step: 'attack' | 'block' | 'counter' | 'damage';
  attacker: InstanceId;
  target: InstanceId; // changes if a Blocker enters
  originalTarget: InstanceId;
  wasBlocked: boolean;
}

export interface Modifier {
  id: string;
  target: InstanceId;
  kind: 'power'; // only power in this phase
  value: number;
  duration: 'endOfBattle' | 'endOfTurn';
  source: InstanceId;
}

export interface Decklist {
  leader: CardId;
  cards: CardId[]; // exactly 50
}

export type Action =
  | { type: 'MULLIGAN'; player: PlayerId; accept: boolean }
  | { type: 'PLAY_CARD'; player: PlayerId; instanceId: InstanceId; trashCharacter?: InstanceId }
  | { type: 'ATTACH_DON'; player: PlayerId; to: InstanceId; count: number }
  | { type: 'DECLARE_ATTACK'; player: PlayerId; attacker: InstanceId; target: InstanceId }
  | { type: 'DECLARE_BLOCK'; player: PlayerId; blocker: InstanceId }
  | { type: 'PLAY_COUNTER'; player: PlayerId; instanceId: InstanceId; target: InstanceId }
  | { type: 'PASS'; player: PlayerId }
  | { type: 'END_TURN'; player: PlayerId }
  | { type: 'CONCEDE'; player: PlayerId };

export type ApplyResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; reason: string };

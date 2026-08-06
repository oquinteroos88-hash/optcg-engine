import type { Keyword } from './abilities/dsl.js';
import type { CardId, InstanceId, Orientation, PlayerId } from './types.js';

// The log is perfect-information by design (hidden-information views are out of
// scope for Phase 0), so events may carry instance ids from any zone.
export type GameEvent =
  | { type: 'gameStarted'; matchId: string; firstPlayer: PlayerId }
  | { type: 'mulliganTaken'; player: PlayerId; accepted: boolean }
  | { type: 'lifeSet'; player: PlayerId; count: number }
  | { type: 'turnStarted'; turn: number; player: PlayerId }
  | { type: 'cardDrawn'; player: PlayerId; instanceId: InstanceId }
  | { type: 'donGained'; player: PlayerId; count: number }
  | { type: 'donAttached'; player: PlayerId; to: InstanceId; count: number }
  | { type: 'donPaid'; player: PlayerId; count: number }
  | { type: 'donReturned'; player: PlayerId; count: number; rested: boolean }
  | { type: 'cardPlayed'; player: PlayerId; instanceId: InstanceId; cardId: CardId }
  | { type: 'characterTrashedForRoom'; player: PlayerId; instanceId: InstanceId }
  | { type: 'stageReplaced'; player: PlayerId; oldStage: InstanceId; newStage: InstanceId }
  | { type: 'attackDeclared'; player: PlayerId; attacker: InstanceId; target: InstanceId }
  | { type: 'blockDeclared'; player: PlayerId; blocker: InstanceId }
  | { type: 'counterPlayed'; player: PlayerId; instanceId: InstanceId; target: InstanceId; value: number }
  | { type: 'battleResolved'; attacker: InstanceId; target: InstanceId; outcome: 'ko' | 'lifeDamage' | 'noEffect' }
  | { type: 'lifeTaken'; player: PlayerId; instanceId: InstanceId; remaining: number }
  | { type: 'koed'; player: PlayerId; instanceId: InstanceId }
  // Card effects.
  | { type: 'abilityTriggered'; player: PlayerId; source: InstanceId; abilityId: string }
  | { type: 'abilityDeclined'; player: PlayerId; source: InstanceId; abilityId: string }
  | {
      type: 'choiceOpened';
      player: PlayerId;
      choiceId: string;
      kind: 'selectCards' | 'yesNo' | 'selectOption' | 'orderCards';
      prompt: string;
    }
  | { type: 'choiceAnswered'; player: PlayerId; choiceId: string }
  | { type: 'powerGranted'; target: InstanceId; value: number; duration: 'endOfBattle' | 'endOfTurn' }
  | {
      type: 'keywordGranted';
      target: InstanceId;
      keyword: Keyword;
      duration: 'endOfBattle' | 'endOfTurn';
    }
  | { type: 'orientationChanged'; instanceId: InstanceId; orientation: Orientation }
  | { type: 'cardMoved'; player: PlayerId; instanceId: InstanceId; to: 'hand' | 'deck' | 'trash' | 'life' }
  | { type: 'cardDiscarded'; player: PlayerId; instanceId: InstanceId }
  | { type: 'cardsRevealed'; player: PlayerId; instanceIds: InstanceId[] }
  | { type: 'donReturnedToDeck'; player: PlayerId; count: number }
  | { type: 'lifeBanished'; player: PlayerId; instanceId: InstanceId; remaining: number }
  | { type: 'turnEnded'; turn: number; player: PlayerId }
  | { type: 'gameEnded'; winner: PlayerId; endReason: 'lifeOut' | 'deckOut' | 'concede' };

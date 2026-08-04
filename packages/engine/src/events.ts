import type { CardId, InstanceId, PlayerId } from './types.js';

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
  | { type: 'turnEnded'; turn: number; player: PlayerId }
  | { type: 'gameEnded'; winner: PlayerId; endReason: 'lifeOut' | 'deckOut' | 'concede' };

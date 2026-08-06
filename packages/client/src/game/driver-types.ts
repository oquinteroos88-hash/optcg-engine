import type { InstanceId } from '@optcg/engine';

/**
 * Parallel union of the engine's Action minus the `player` field. The store
 * materializes an ActionIntent into an Action by adding the acting player;
 * with exactOptionalPropertyTypes on, PLAY_CARD intents omit the
 * `trashCharacter` key entirely instead of carrying `undefined`.
 */
export type ActionIntent =
  | { type: 'MULLIGAN'; accept: boolean }
  | { type: 'PLAY_CARD'; instanceId: InstanceId; trashCharacter?: InstanceId }
  | { type: 'ATTACH_DON'; to: InstanceId; count: number }
  | { type: 'DECLARE_ATTACK'; attacker: InstanceId; target: InstanceId }
  | { type: 'DECLARE_BLOCK'; blocker: InstanceId }
  | { type: 'PLAY_COUNTER'; instanceId: InstanceId; target: InstanceId }
  | { type: 'PASS' }
  | { type: 'END_TURN' }
  | { type: 'CONCEDE' };

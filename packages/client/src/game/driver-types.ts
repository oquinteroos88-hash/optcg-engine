import type { ChoiceAnswer, InstanceId } from '@optcg/engine';

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
  | { type: 'PLAY_COUNTER_EVENT'; instanceId: InstanceId }
  | { type: 'ACTIVATE_ABILITY'; instanceId: InstanceId; abilityId: string }
  // The one intent whose payload the client assembles from `state.pending`
  // rather than from a `legalActions` entry — see ChoiceView in affordances.ts.
  | { type: 'ANSWER_CHOICE'; choiceId: string; answer: ChoiceAnswer }
  | { type: 'PASS' }
  | { type: 'END_TURN' }
  | { type: 'CONCEDE' };

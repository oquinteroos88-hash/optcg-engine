import type { Action, PlayerId } from '@optcg/engine';
import type { ActionIntent } from './driver-types';

/**
 * Materializes a UI intent into an engine Action by adding the acting player.
 * Components never build Actions; this is the single conversion point.
 */
export function toAction(intent: ActionIntent, player: PlayerId): Action {
  switch (intent.type) {
    case 'MULLIGAN':
      return { type: 'MULLIGAN', player, accept: intent.accept };
    case 'PLAY_CARD':
      // exactOptionalPropertyTypes: the key must be ABSENT, never undefined.
      return intent.trashCharacter === undefined
        ? { type: 'PLAY_CARD', player, instanceId: intent.instanceId }
        : {
            type: 'PLAY_CARD',
            player,
            instanceId: intent.instanceId,
            trashCharacter: intent.trashCharacter,
          };
    case 'ATTACH_DON':
      return { type: 'ATTACH_DON', player, to: intent.to, count: intent.count };
    case 'DECLARE_ATTACK':
      return { type: 'DECLARE_ATTACK', player, attacker: intent.attacker, target: intent.target };
    case 'DECLARE_BLOCK':
      return { type: 'DECLARE_BLOCK', player, blocker: intent.blocker };
    case 'PLAY_COUNTER':
      return { type: 'PLAY_COUNTER', player, instanceId: intent.instanceId, target: intent.target };
    case 'PLAY_COUNTER_EVENT':
      return { type: 'PLAY_COUNTER_EVENT', player, instanceId: intent.instanceId };
    case 'ACTIVATE_ABILITY':
      return {
        type: 'ACTIVATE_ABILITY',
        player,
        instanceId: intent.instanceId,
        abilityId: intent.abilityId,
      };
    case 'ANSWER_CHOICE':
      return { type: 'ANSWER_CHOICE', player, choiceId: intent.choiceId, answer: intent.answer };
    case 'PASS':
      return { type: 'PASS', player };
    case 'END_TURN':
      return { type: 'END_TURN', player };
    case 'CONCEDE':
      return { type: 'CONCEDE', player };
  }
}

// Single source of truth for every reason code returned by applyAction.
// Codes are part of the public contract: stable, never renamed.
export const REASONS = {
  gameFinished: 'gameFinished',
  unknownPlayer: 'unknownPlayer',
  malformedAction: 'malformedAction',
  notYourPriority: 'notYourPriority',
  wrongStatus: 'wrongStatus',
  battleInProgress: 'battleInProgress',
  noBattle: 'noBattle',
  wrongBattleStep: 'wrongBattleStep',
  cardNotInHand: 'cardNotInHand',
  unplayableCategory: 'unplayableCategory',
  notEnoughDon: 'notEnoughDon',
  trashChoiceRequired: 'trashChoiceRequired',
  trashChoiceNotAllowed: 'trashChoiceNotAllowed',
  invalidTrashChoice: 'invalidTrashChoice',
  invalidCount: 'invalidCount',
  invalidAttachTarget: 'invalidAttachTarget',
  notEnoughActiveDon: 'notEnoughActiveDon',
  invalidAttacker: 'invalidAttacker',
  attackerNotActive: 'attackerNotActive',
  cannotAttackYet: 'cannotAttackYet',
  firstTurnAttackForbidden: 'firstTurnAttackForbidden',
  invalidTarget: 'invalidTarget',
  targetNotRested: 'targetNotRested',
  invalidBlocker: 'invalidBlocker',
  notABlocker: 'notABlocker',
  blockerNotActive: 'blockerNotActive',
  // A card forbade this block (ST01-012 and its family). Distinct from
  // notABlocker and blockerNotActive: those describe a card that never could
  // block, this one a card that could until an effect said otherwise.
  blockForbidden: 'blockForbidden',
  // A card forbade this attack, or the target is one only a permission could
  // have reached and no permission is in force.
  attackForbidden: 'attackForbidden',
  noCounterValue: 'noCounterValue',
  invalidCounterTarget: 'invalidCounterTarget',
  // PLAY_COUNTER_EVENT: the card is not an Event carrying a [Counter] ability.
  notACounterEvent: 'notACounterEvent',

  // ACTIVATE_ABILITY
  unknownAbility: 'unknownAbility',
  abilityNotActivatable: 'abilityNotActivatable',
  abilitySourceNotOnField: 'abilitySourceNotOnField',
  abilityConditionUnmet: 'abilityConditionUnmet',
  abilityCostUnpayable: 'abilityCostUnpayable',
  abilityAlreadyUsed: 'abilityAlreadyUsed',

  // ANSWER_CHOICE. One code per way an answer can be wrong: a caller that gets
  // a rejection has to be able to tell which rule it broke.
  choicePending: 'choicePending',
  noPendingChoice: 'noPendingChoice',
  missingAnswer: 'missingAnswer',
  wrongChoiceId: 'wrongChoiceId',
  notYourChoice: 'notYourChoice',
  choiceKindMismatch: 'choiceKindMismatch',
  choiceCardinality: 'choiceCardinality',
  choiceCandidateUnknown: 'choiceCandidateUnknown',
  choiceDuplicateSelection: 'choiceDuplicateSelection',
  choiceOptionOutOfRange: 'choiceOptionOutOfRange',
  // A `handles` answer to a choice that is not blind: handles exist so a
  // chooser can answer without seeing (CR 8-4-4-2); a choice whose candidates
  // are the chooser's to see is answered by id.
  choiceNotBlind: 'choiceNotBlind',
  // A handle outside 0..handleCount-1, or not an integer.
  choiceHandleOutOfRange: 'choiceHandleOutOfRange',
} as const;

export type ReasonCode = (typeof REASONS)[keyof typeof REASONS];

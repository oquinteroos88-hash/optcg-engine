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
} as const;

export type ReasonCode = (typeof REASONS)[keyof typeof REASONS];

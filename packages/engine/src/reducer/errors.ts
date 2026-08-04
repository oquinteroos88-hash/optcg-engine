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
} as const;

export type ReasonCode = (typeof REASONS)[keyof typeof REASONS];

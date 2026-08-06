export { createGame } from './createGame.js';
export { applyAction } from './applyAction.js';
export { legalActions } from './legalActions.js';
// assertSerializationRoundTrip is intentionally absent: it is a test-only helper
// that imports node:assert, and exposing it here dragged a Node builtin into
// every consumer's dependency tree. It lives behind the ./testing subpath.
export { assertInvariants, checkInvariants, checkTurnLeak } from './invariants.js';
export { REASONS } from './reducer/errors.js';
export type { ReasonCode } from './reducer/errors.js';
export {
  getActiveCostDon,
  getBasePower,
  getOpponent,
  getPower,
  hasKeyword,
  isOnField,
  isOwnLeaderOrCharacter,
} from './selectors.js';
export type {
  Ability,
  AbilityContext,
  Color,
  Condition,
  Cost,
  Duration,
  Instruction,
  Keyword,
  PlayerRef,
  Ref,
  Selector,
  Trigger,
  VarValue,
  ZoneRef,
} from './abilities/dsl.js';
export { KEYWORDS, LOOP_VAR, PRINTED_KEYWORD } from './abilities/dsl.js';
export { deadMarks, mark, markCounts, marksEnabled, MARK_NAMES, resetMarks } from './instrument.js';
export type { MarkCount, MarkName } from './instrument.js';
export { next, nextInt, shuffle } from './rng.js';
export type { RngState } from './rng.js';
export { getAbilities, getCardDef, registerCardSet } from './registry.js';
export type { CardCategory, CardDefinition } from './registry.js';
export { PLAYER_IDS } from './types.js';
export type {
  Action,
  ApplyResult,
  Battle,
  CardId,
  CardInstance,
  ChoiceAnswer,
  Decklist,
  DonCard,
  Frame,
  GameState,
  InstanceId,
  LoopState,
  Modifier,
  Orientation,
  PathStep,
  PendingChoice,
  PlayerId,
  PlayerState,
  ResumeStep,
  StackItem,
} from './types.js';
export type { GameEvent } from './events.js';

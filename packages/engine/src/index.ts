export { createGame } from './createGame.js';
export { applyAction } from './applyAction.js';
export { legalActions } from './legalActions.js';
// The per-player layer: one question ("does X know card Y?"), one derivation
// (the view), one log redaction. Consumers ask the engine rather than deciding
// visibility themselves — the law that keeps the answer in one place.
export { blindHandleOrder, knows, zoneOf } from './visibility.js';
export { playerView } from './playerView.js';
export type {
  PendingView,
  PlayerView,
  PlayerZonesView,
  ViewCard,
  ViewStackItem,
} from './playerView.js';
export { redactEvent, redactLog } from './viewEvents.js';
export type { ViewEvent } from './viewEvents.js';
// assertSerializationRoundTrip is intentionally absent: it is a test-only helper
// that imports node:assert, and exposing it here dragged a Node builtin into
// every consumer's dependency tree. It lives behind the ./testing subpath.
export { assertInvariants, checkInvariants, checkTurnLeak } from './invariants.js';
export { REASONS } from './reducer/errors.js';
// The three legality questions. Exported for the same reason `getPower` is: a
// consumer that wants to know whether a move is allowed must be able to ask the
// engine rather than reimplement the rule.
export { canActivateBlocker, canAttack, canBeKOdInBattle } from './legality.js';
export type { ReasonCode } from './reducer/errors.js';
export {
  EFFECTIVE,
  getActiveCostDon,
  getCost,
  getOpponent,
  getPower,
  getPowerWithoutStatics,
  hasKeyword,
  hasKeywordWithoutStatics,
  isOnField,
  isOwnLeaderOrCharacter,
  WITHOUT_STATICS,
} from './selectors.js';
// The one question the engine asks about card names, exported for the reason
// `hasKeyword` is: a consumer that wants to know whether a card answers to a
// name must ask the engine rather than read `CardDefinition.name` itself.
export { hasName } from './abilities/query.js';
export type {
  Ability,
  AbilityContext,
  CardFilter,
  CardPredicate,
  Color,
  Condition,
  Cost,
  Duration,
  Instruction,
  Keyword,
  LegalityClause,
  LegalityEffect,
  LegalityQuestion,
  LegalitySubjectSpec,
  PlayerRef,
  Ref,
  Selector,
  Trigger,
  VarValue,
  ZoneRef,
} from './abilities/dsl.js';
export { BATTLE_OPPONENT_VAR, KEYWORDS, LOOP_VAR, PRINTED_KEYWORD } from './abilities/dsl.js';
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
  LegalityRule,
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

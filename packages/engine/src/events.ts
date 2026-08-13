import type { Duration, Keyword, LegalityEffect, LegalityQuestion } from './abilities/dsl.js';
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
  /**
   * `count` is how many DON!! actually turned, which is not what the card asked
   * for whenever some were already in that orientation. The event is not
   * emitted at all when nothing moved.
   */
  | { type: 'donOrientationChanged'; player: PlayerId; orientation: Orientation; count: number }
  | { type: 'cardPlayed'; player: PlayerId; instanceId: InstanceId; cardId: CardId }
  | { type: 'characterTrashedForRoom'; player: PlayerId; instanceId: InstanceId }
  | { type: 'stageReplaced'; player: PlayerId; oldStage: InstanceId; newStage: InstanceId }
  | { type: 'attackDeclared'; player: PlayerId; attacker: InstanceId; target: InstanceId }
  | { type: 'blockDeclared'; player: PlayerId; blocker: InstanceId }
  | { type: 'counterPlayed'; player: PlayerId; instanceId: InstanceId; target: InstanceId; value: number }
  /**
   * `koPrevented` is the fourth outcome and reports a comparison the attacker
   * won against a Character that survived it anyway (CR 7-1-4-1-2 plus a card
   * saying "cannot be K.O.'d in battle"). Deliberately not folded into
   * `noEffect`, which reports an attack that lost: a client that showed the
   * same words for both would be describing a Character that shrugged off a hit
   * and a Character that was never hit in the same breath.
   */
  | {
      type: 'battleResolved';
      attacker: InstanceId;
      target: InstanceId;
      outcome: 'ko' | 'lifeDamage' | 'noEffect' | 'koPrevented';
    }
  /**
   * The battle ended before the Damage Step because a participant left the
   * field (CR 7-1-1-4 / 7-1-2-3 / 7-1-3-3).
   *
   * A separate event from `battleResolved` rather than a fourth `outcome`,
   * because it is a different rule: `battleResolved` reports a comparison of
   * powers that happened, and this reports one that never did. A UI that showed
   * "the attack had no effect" for both would be describing a Character that
   * survived a hit and a Character that was never hit in the same words.
   *
   * `attacker` and `target` are the participants as the battle knew them —
   * `target` is the *current* one, so after a [Blocker] it names the blocker.
   * At least one of them is off the field by the time this is emitted, which is
   * what `gone` says.
   */
  | {
      type: 'battleEndedEarly';
      attacker: InstanceId;
      target: InstanceId;
      gone: 'attacker' | 'target' | 'both';
    }
  | { type: 'lifeTaken'; player: PlayerId; instanceId: InstanceId; remaining: number }
  | { type: 'koed'; player: PlayerId; instanceId: InstanceId }
  // Card effects.
  | { type: 'abilityTriggered'; player: PlayerId; source: InstanceId; abilityId: string }
  | { type: 'abilityDeclined'; player: PlayerId; source: InstanceId; abilityId: string }
  | {
      type: 'choiceOpened';
      player: PlayerId;
      choiceId: string;
      kind: 'selectCards' | 'yesNo' | 'selectOption' | 'orderCards' | 'partitionCards';
      prompt: string;
    }
  | { type: 'choiceAnswered'; player: PlayerId; choiceId: string }
  | { type: 'powerGranted'; target: InstanceId; value: number; duration: Duration }
  | {
      type: 'keywordGranted';
      target: InstanceId;
      keyword: Keyword;
      duration: Duration;
    }
  /**
   * A timed legality rule was written onto the state.
   *
   * It names the question and the direction rather than restating the whole
   * rule, for the reason `powerGranted` names a value and not the selector that
   * found its target: the log says what changed about the game, and the rule
   * itself is in the state for anyone who needs its shape.
   */
  | {
      type: 'legalitySet';
      source: InstanceId;
      effect: LegalityEffect;
      question: LegalityQuestion;
      duration: Duration;
    }
  | { type: 'orientationChanged'; instanceId: InstanceId; orientation: Orientation }
  | { type: 'cardMoved'; player: PlayerId; instanceId: InstanceId; to: 'hand' | 'deck' | 'trash' | 'life' }
  | { type: 'cardDiscarded'; player: PlayerId; instanceId: InstanceId }
  | { type: 'cardsRevealed'; player: PlayerId; instanceIds: InstanceId[] }
  /**
   * Cards seen but not moved (CR 11-3-2). Private to the looker by CR 11-3-1;
   * the ids are here because this log is perfect-information by design, and the
   * privacy is the client's to keep. See the header above.
   */
  | { type: 'cardsLookedAt'; player: PlayerId; instanceIds: InstanceId[] }
  /** Placed at the bottom of the deck in this order, first card shallowest. */
  | { type: 'deckOrdered'; player: PlayerId; instanceIds: InstanceId[] }
  | { type: 'donReturnedToDeck'; player: PlayerId; count: number }
  /**
   * DON!! moved from the DON!! deck into the cost area by a card effect.
   *
   * Distinct from `donGained`, which is the DON!! Phase's own step (CR 6-4-1):
   * that one is bounded by the turn and always places active, this one by a
   * printed number and places in whichever orientation the card names. And
   * distinct from `donReturnedToDeck`, which is the *inverse* movement that
   * sixteen cards in the full set watch for — `count` here is DON!! that
   * arrived, never DON!! that left.
   */
  | { type: 'donAdded'; player: PlayerId; count: number; orientation: Orientation }
  | { type: 'lifeBanished'; player: PlayerId; instanceId: InstanceId; remaining: number }
  | { type: 'turnEnded'; turn: number; player: PlayerId }
  | { type: 'gameEnded'; winner: PlayerId; endReason: 'lifeOut' | 'deckOut' | 'concede' };

/**
 * Semantic branch instrument.
 *
 * Line coverage cannot answer the question this project actually cares about.
 * `attackPower >= defensePower` is a single line covering two semantically
 * different rules — winning by margin and winning a tie — and a report that
 * calls that line "covered" hides the case most likely to be wrong.
 *
 * So rule decision points call `mark()` with a name. The set of names is
 * declared up front, which is what makes "never reached" observable at all: a
 * counter alone can only show what did happen.
 *
 * Two constraints hold by construction:
 * - Nothing here enters GameState. Counts live in a module-level map, so the
 *   state stays serializable and the reducer's output is unchanged.
 * - It is a no-op unless OPTCG_MARKS=1 is set in the environment when the
 *   module loads, so production pays one boolean check per call.
 */

export const MARK_NAMES = [
  // Battle outcomes. The three are mutually exclusive and must all be seen.
  'battle.tie',
  'battle.attackerWinsByMargin',
  'battle.attackerLoses',
  'battle.blocked',
  'battle.characterKo',
  'battle.leaderDamageToHand',
  // The battle that never reached the Damage Step because a participant left
  // the field (CR 7-1-1-4 / 7-1-2-3 / 7-1-3-3). Separate from the three
  // outcomes above, which all report a comparison that happened.
  'battle.endedEarly',

  // Counters.
  'counter.played',
  'counter.onNonBattlingCard',
  'counter.stacked',
  // A [Counter] Event activated from hand — a different play from a counter
  // card discarded for its printed value.
  'counterEvent.played',

  // Field limits.
  'field.sixthCharacter',
  'field.stageReplaced',

  // DON!! lifecycle. The two return paths differ in orientation, which is the
  // rule most likely to be mistimed.
  'don.returnedRestedOnLeave',
  'don.returnedActiveOnRefresh',
  'don.attached',
  'don.gainCappedByCostArea',
  'don.gainCappedByDonDeck',

  // Turn flow.
  'turn.firstPlayerSkipsDraw',
  'turn.ended',

  // Plays.
  'play.character',
  'play.event',
  'play.stage',

  // Setup.
  'mulligan.accepted',
  'mulligan.declined',

  // Game endings.
  'deckOut',
  'lifeOut',
  'concede',

  // Card effects. The suspend/resume cycle and the ordering rules are the
  // branches most likely to be silently wrong, so each gets its own name.
  'choice.opened',
  'choice.noCandidates',
  'choice.answered',
  'ability.activated',
  'ability.resolved',
  'ability.declined',
  'ability.costLostBeforeResolution',
  'trigger.chained',
  'cost.returnDon',
  'cost.trashSelf',
  'cost.restSelf',
  'cost.discardHand',
  'cost.discardChoice',

  // Instructions.
  'op.ko',
  'op.rest',
  'op.setActive',
  'op.addPower',
  'op.grantKeyword',
  'op.moveCard',
  'op.draw',
  'op.discard',
  'op.giveDon',
  'op.orientDon',
  'op.reveal',
  'op.if',
  'op.ifElse',
  'op.forEach',
  'op.targetGone',

  // Keywords in combat.
  'keyword.rushAttack',
  'keyword.blockerUsed',
  'keyword.doubleAttack',
  'keyword.banish',
  'static.powerApplied',
  'static.keywordApplied',

  // Damage.
  'damage.absorbedByEmptyLife',
  'damage.banished',
  'damage.lifeTriggerOffered',
] as const;

export type MarkName = (typeof MARK_NAMES)[number];

export interface MarkCount {
  name: MarkName;
  hits: number;
}

// Read once at module load: enabling later would produce a half-instrumented
// run, which is worse than no data.
const enabled =
  typeof process !== 'undefined' && process.env !== undefined && process.env['OPTCG_MARKS'] === '1';

const counts = new Map<MarkName, number>();

export function mark(name: MarkName): void {
  if (!enabled) {
    return;
  }
  counts.set(name, (counts.get(name) ?? 0) + 1);
}

export function marksEnabled(): boolean {
  return enabled;
}

export function resetMarks(): void {
  counts.clear();
}

/** Every declared mark with its hit count, declaration order preserved. */
export function markCounts(): MarkCount[] {
  return MARK_NAMES.map((name) => ({ name, hits: counts.get(name) ?? 0 }));
}

/** Declared marks that were never reached — the point of the whole module. */
export function deadMarks(): MarkName[] {
  return MARK_NAMES.filter((name) => (counts.get(name) ?? 0) === 0);
}

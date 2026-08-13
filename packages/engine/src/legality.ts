import type { LegalityClause, LegalityQuestion } from './abilities/dsl.js';
import { matchesPredicate } from './abilities/query.js';
import { mark } from './instrument.js';
import { EFFECTIVE, forEachStatic, getOpponent, isOnField } from './selectors.js';
import type { GameState, InstanceId, LegalityRule } from './types.js';

/**
 * The aggregation side of modifiable legality — `getPower`'s twin for the
 * question "may this happen".
 *
 * `getPower` is the single point where a card's printed value, its DON!!, every
 * live `Modifier` and every applicable `static` are added up, and the reason the
 * engine has no bug where one caller sees a buffed Character and another does
 * not is that **there is only one such point**. Legality needed the same thing,
 * and for the same reason: the block offer in `legalActions`, the revalidation
 * in `applyAction`, and the Damage Step are three readers that must never
 * disagree about whether a move is allowed.
 *
 * So there is one walk, `forEachRule`, and three thin questions on top of it.
 * The three exist because the answer has to be *visible* in three different
 * buildings — the Block Step, the attack target set, and K.O. resolution — not
 * because the rules differ. The rules do not differ: every one of them is
 * `decide`.
 */

/**
 * The card a rule is being asked about, plus the second card when the question
 * has one. `attack` is the only question with a pair.
 */
interface Candidate {
  /** The card whose action is in question: the blocker, the attacker, the K.O.'d. */
  subject: InstanceId;
  /** The other end of an `attack` question. */
  target?: InstanceId;
}

/** Whether a written rule's `subject` covers the candidate. */
function subjectCovers(state: GameState, rule: LegalityRule, subject: InstanceId): boolean {
  if ('is' in rule.subject) {
    return rule.subject.is === subject;
  }
  const card = state.cards[subject];
  if (card === undefined || card.controller !== rule.subject.player) {
    return false;
  }
  const match = rule.subject.match;
  return match === undefined || matchesPredicate(state, match, subject, EFFECTIVE);
}

/**
 * Whether a clause's own conditions hold for the candidate.
 *
 * Only `attack` has any: the clause's `target` predicate describes the card
 * being attacked, which is what widens CR 7-1-1-2's "1 of their **rested**
 * Character cards" to include active ones for OP01-021 Franky. A rule whose
 * clause names a target and a question that has no target is not a match — the
 * two are asking about different things.
 */
function clauseHolds(state: GameState, clause: LegalityClause, candidate: Candidate): boolean {
  if (clause.question !== 'attack' || clause.target === undefined) {
    return true;
  }
  const target = candidate.target;
  if (target === undefined) {
    return false;
  }
  return matchesPredicate(state, clause.target, target, EFFECTIVE);
}

/**
 * Every rule in force right now that speaks to `question` about `candidate`,
 * from both faces of the mechanism.
 *
 * **Written rules** come off `state.legality`, gated by `whileAttacker` — the
 * field that makes ST01-016 a rule rather than a special case. That rule is
 * written when the Event resolves and lives until the turn ends, so at the
 * moment it is consulted the battle it applies to may not be the battle it was
 * born in, or there may be no battle at all. Asking "is the named card the one
 * attacking *now*" is the whole of it.
 *
 * **Continuous rules** come from `forEachStatic`, which already answers exactly
 * the question needed here — which statics apply to this card — and needs no
 * second walk. A static grant carries no subject because `affects` is the
 * subject, which is the same contract `power` and `keyword` grants have had
 * since PR #12.
 */
function forEachRule(
  state: GameState,
  question: LegalityQuestion,
  candidate: Candidate,
  visit: (effect: 'allow' | 'forbid') => void,
): void {
  for (const rule of state.legality) {
    if (rule.clause.question !== question) {
      continue;
    }
    if (rule.whileAttacker !== undefined && state.battle?.attacker !== rule.whileAttacker) {
      continue;
    }
    if (!subjectCovers(state, rule, candidate.subject) || !clauseHolds(state, rule.clause, candidate)) {
      continue;
    }
    visit(rule.effect);
  }
  forEachStatic(state, candidate.subject, (grants) => {
    const granted = grants.legality;
    if (granted === undefined || granted.clause.question !== question) {
      return;
    }
    if (!clauseHolds(state, granted.clause, candidate)) {
      return;
    }
    mark('static.legalityApplied');
    visit(granted.effect);
  });
}

/**
 * The one decision procedure, applied to all three questions.
 *
 * A permission only matters where the base rule says no — that is what "can
 * **also** attack your opponent's active Characters" means, and it is why
 * `allow` is not consulted when the rules already allow the move. A prohibition
 * always matters, and it is checked last because it always wins:
 *
 * > CR 1-3-3: "If a card's effect requires a player to carry out an action
 * > while a currently active effect prohibits that action, the prohibiting
 * > effect always takes precedence."
 *
 * The rule is written about a *requirement* meeting a prohibition, and the
 * reading extends to a permission meeting one for the reason the two are not
 * symmetric: a permission enlarges the set of moves a player *may* make and a
 * prohibition removes from it, so a card that grants and a card that forbids
 * are not both satisfiable and only one of them can be. CR 1-3-3 is the game's
 * standing answer to which. See docs/starter-card-inventory.md for the search
 * that found no rule closer to the question — section 4-9 is "Base", not
 * effect conflicts.
 */
function decide(
  state: GameState,
  question: LegalityQuestion,
  candidate: Candidate,
  base: boolean,
): boolean {
  let allowed = base;
  let forbidden = false;
  forEachRule(state, question, candidate, (effect) => {
    if (effect === 'allow') {
      allowed = true;
    } else {
      forbidden = true;
    }
  });
  if (!allowed) {
    return false;
  }
  if (forbidden) {
    mark('legality.forbidden');
    return false;
  }
  if (!base) {
    mark('legality.allowed');
  }
  return true;
}

/**
 * May this card activate its `[Blocker]` in the open battle?
 *
 * Asked only of cards that already have the keyword and are active — the base
 * rule (CR 7-1-2-1, 10-1-4-1, and the Q&A "Can I activate the [Blocker] of a
 * rested Character? No, you cannot") is the caller's, and this is the layer
 * above it. So `base` is `true`: every card that reaches this question is one
 * the rules would otherwise let block.
 */
export function canActivateBlocker(state: GameState, blocker: InstanceId): boolean {
  return decide(state, 'activateBlocker', { subject: blocker }, true);
}

/**
 * May `attacker` attack `target`?
 *
 * The base rule is CR 7-1 and 7-1-1-2 in one line: the opponent's Leader, or
 * one of their **rested** Characters. Everything else about the attacker —
 * being active, summoning sickness, the first-turn rule — is a different
 * question and stays where it was.
 */
export function canAttack(state: GameState, attacker: InstanceId, target: InstanceId): boolean {
  const defender = getOpponent(state.cards[attacker]?.controller ?? 'p1');
  const enemy = state.players[defender];
  const base =
    enemy.leader === target ||
    (enemy.characters.includes(target) && state.cards[target]?.orientation === 'rested');
  return decide(state, 'attack', { subject: attacker, target }, base);
}

/**
 * May this Character be K.O.'d by the Damage Step?
 *
 * Consulted where the K.O. is **decided** (CR 7-1-4-1-2), not where it is
 * carried out, because the two are different rules with different scopes:
 * CR 10-2-1-3 makes "cannot be K.O.'d" valid "when the card is K.O.'d by an
 * effect **or** due to the result of a battle", and every card in scope prints
 * the narrower "in battle". A card that prevented every K.O. would need a
 * second clause, not a second call site.
 */
export function canBeKOdInBattle(state: GameState, card: InstanceId): boolean {
  return decide(state, 'koInBattle', { subject: card }, true);
}

/**
 * Drops the rules a card takes with it when it leaves the field.
 *
 * CR 3-1-6: "When a card is moved from the Character area or Stage area to
 * another area, unless otherwise specified, the card is treated as a **new
 * card** in a new area. Effects that were applied to the card in the original
 * area are not carried over" — and CR 10-2-13-4 applies exactly that reading to
 * a card that leaves and comes back. So a rule that names one card by identity
 * dies with it, whether the card is named as the subject (OP01-112's permission
 * for itself) or as the attacker the rule is waiting on (ST01-016's chosen
 * card). Either way the card that returns is not the card the rule meant.
 *
 * A rule whose subject is a *set* survives: "your opponent cannot activate
 * [Blocker]" is about a side, not about any particular card, and no card
 * leaving the field can carry it away. So does a rule whose **source** left —
 * ST01-016's source is an Event in the trash before the rule is ever read, the
 * same way a Counter's power modifier outlives the card that granted it.
 *
 * The twin of `detachFromField`'s modifier purge, and called from it, so there
 * is one place where a card leaving forgets what was said about it.
 */
export function dropLegalityNaming(state: GameState, id: InstanceId): void {
  state.legality = state.legality.filter(
    (rule) => !('is' in rule.subject && rule.subject.is === id) && rule.whileAttacker !== id,
  );
}

/** Rules whose lifetime has run out (CR 7-1-5-3 / 7-1-5-4 for a battle). */
export function expireLegality(state: GameState, duration: 'endOfBattle' | 'endOfTurn'): void {
  state.legality = state.legality.filter((rule) => rule.duration !== duration);
}

/** Whether every card a rule names by identity is still on the field. */
export function isLegalityRuleLive(state: GameState, rule: LegalityRule): boolean {
  if ('is' in rule.subject && !isOnField(state, rule.subject.is)) {
    return false;
  }
  return rule.whileAttacker === undefined || isOnField(state, rule.whileAttacker);
}

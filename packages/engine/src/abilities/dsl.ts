import type { CardCategory } from '../registry.js';
import type { InstanceId, Orientation, PlayerId } from '../types.js';

/**
 * The card-effect DSL.
 *
 * Everything here is *definition* data: it lives in the card registry beside
 * the printed stat line and never enters GameState. What enters GameState is
 * only the position inside a script (see `StackItem` in types.ts), which is why
 * a suspended effect survives a JSON round trip.
 *
 * Two distinctions in this file are load-bearing and deliberately encoded as
 * different types rather than as fields of one thing:
 *
 * - `Condition` is a requirement that is *checked*. `Cost` is a price that is
 *   *paid* and can fail. `[DON!! x2]` is a Condition (`donAttached`); `DON!! -1`
 *   is a Cost (`returnDon`). They never share a field.
 * - An ability with `trigger: 'static'` is continuous: it is true while its
 *   source is on the field and it mutates nothing. It has no script and never
 *   reaches the interpreter; it is read by `getPower` and `hasKeyword`.
 */

export type Keyword = 'rush' | 'blocker' | 'doubleAttack' | 'banish';

/**
 * The lifetimes the engine can expire — shared by `Modifier` and `LegalityRule`,
 * which is why the third member arrived once and served both.
 *
 * `endOfOpponentNextTurn` is that third member, and PR #31 is what proved the
 * union was short one. A prohibition aimed at an opponent's Character with an
 * `endOfTurn` lifetime **expires before that Character can act** — the turn ends,
 * the rule dies, and the opponent's turn begins unencumbered. That is why
 * `OP01-085` prints "until the end of your opponent's next turn" and not "during
 * this turn": Bandai needed a duration the engine did not have, and 43 cards in
 * the full set print it.
 *
 * It is the only duration that spans a change of turn player, which is what
 * makes it different in kind rather than in length. The other two are measured
 * against something the engine is already inside — a battle, a turn — and this
 * one is measured against **whose** turn ends, so `Modifier` and `LegalityRule`
 * both had to start recording their controller and the turn they were written
 * on. CR 6-6-1-2 is the rule it implements, and it splits the End Phase's expiry
 * step by player for exactly this reason: "(1) Process any continuous effects of
 * the **turn player** … due to be processed at the end of this turn or at the
 * end of your turn … (2) Process any continuous effects of the **non-turn
 * player**". An `endOfOpponentNextTurn` effect is always in clause (2) when it
 * dies, because it dies on its controller's opponent's turn.
 */
export type Duration = 'endOfBattle' | 'endOfTurn' | 'endOfOpponentNextTurn';

/** Resolved against the ability's controller, not the state's active player. */
export type PlayerRef = 'you' | 'opponent';

/**
 * `CardDefinition.color` is a plain string in the registry, so a color here is
 * one too. Kept as a named alias because the DSL reads better with it and so a
 * future enum has one place to land.
 */
export type Color = string;

/**
 * When an ability wakes up.
 *
 * Most members name something the *source* did or had done to it. The rest name
 * something that happened **elsewhere on the board**, and they exist because the
 * card text does: "when your opponent activates an Event", "when your
 * opponent's Character is K.O.'d", "when your opponent activates [Blocker]".
 * The side lives in the trigger name rather than in a condition, following
 * `whenOpponentAttacks` — the firing site decides who is notified, so an ability
 * that watches the wrong side is unspellable rather than merely wrong.
 *
 * **Four of these are observers of a fact, not of an action**, and they were all
 * found by the same prose sweep (`docs/trigger-reachability.md`): no bracket tag
 * marks them, so no `[Tag]` search this project ran could see them. The rule
 * they share is the one PR #30 wrote down — *the trigger fires where the fact
 * happens*, never at each caller that can cause it. `whenBecomingRested` is the
 * sharpest case: five code paths rest a card and the trigger sits in none of
 * them, it sits in the orientation transition they all go through.
 */
export type Trigger =
  | 'onPlay'
  | 'whenAttacking'
  | 'onBlock'
  | 'onKO'
  | 'whenOpponentAttacks'
  /**
   * The activator's own field, when they use an Event card from hand.
   *
   * CR 8-5-2 defines *card activation* as "using an Event card from your hand",
   * which is what "when you activate an Event" names — so both the `[Main]` and
   * the `[Counter]` route fire it, and an Event's `[Trigger]` fired out of the
   * Life area does not. The official Q&A says the last part outright: activating
   * an Event card's `[Trigger]` instead of adding it to hand does not activate
   * effects that read "when you activate an Event".
   */
  | 'whenActivatingEvent'
  /** The other player's field, on the same event. */
  | 'whenOpponentActivatesEvent'
  /**
   * The other player's field, when one of your Characters is K.O.'d.
   *
   * A K.O. only — CR 3-7-6-1-1 makes the 6th-Character trash "processing a
   * rule, and no effect can be applied", and the Q&A repeats it: "the trashed
   * Character is not K.O.'d, but directly moved to your trash".
   */
  | 'whenOpponentCharacterKOd'
  /**
   * The DON!!'s own controller's field, when a DON!! card on it goes back to
   * their DON!! deck — "when a DON!! card on your field is returned to your
   * DON!! deck".
   *
   * **The event has existed since PR #11 and nothing listened.** `payCost`'s
   * `returnDon` is the one and only place in the engine where a DON!! card's
   * location becomes `donDeck`, so this trigger has exactly one firing site and
   * needed no routine extracted to reach it. PR #33 wrote the other half of the
   * guarantee from the far side: `addDon` moves DON!! the *other* way and emits
   * `donAdded`, never this event, so no observer can wake on a card that added
   * DON!! rather than returning them.
   *
   * `you` in the printed text is the DON!!'s controller, which is always the
   * controller of the ability that paid — a DON!! belongs to one player and
   * returns to that player's deck. Sixteen cards in the full set read this way;
   * fourteen say "on your field", one says "on **the** field" (`OP02-071`) and
   * means the same thing, because it still names *your* DON!! deck and no DON!!
   * of the opponent's can reach it. Two narrow it further with "by your effect"
   * (`EB03-033`, `OP04-058`) — a `condition`'s job, not a second trigger's, and
   * no card in scope prints it.
   */
  | 'whenDonReturnedToDeck'
  /**
   * The source itself, when it goes from active to rested — "when this
   * Character becomes rested".
   *
   * A **transition**, which is the whole of the design: "becomes" is a change of
   * state, and a card that is already rested has none to make. That is why this
   * lives in `setOrientation` and in nothing else. Five things rest a card — an
   * attack (CR 7-1-1-1), a block (CR 10-1-4-1), a `restSelf` cost, a `rest`
   * instruction, and a card placed rested by an effect — and the trigger is not
   * printed with a cause on it, so it answers to all of them that are transitions
   * and the firing site is the transition rather than each caller.
   *
   * The Refresh Phase is the one thing that looks like a counterexample and is
   * the clearest confirmation: CR 6-2-4 sets rested cards **active**, which is
   * the inverse movement, so it can no more fire this than `addDon` can fire
   * `whenDonReturnedToDeck`.
   *
   * The fifth path — placement — is the one genuine ambiguity and is behind
   * `rules.placedRestedBecomesRested`; see `types.ts`.
   */
  | 'whenBecomingRested'
  /**
   * The **attacker's** field, when the defender activates `[Blocker]`.
   *
   * The mirror of `whenOpponentActivatesEvent`, and the second half of a
   * mechanism PR #31 built the first half of. That PR defined what the
   * prohibition *forbids* — `LegalityQuestion['activateBlocker']`, which CR
   * 10-1-4-1 makes "activate it by resting this card during the Block Step" and
   * CR 7-1-2-1 lets the defender do "only once during that battle". This defines
   * what the trigger *observes*, and the two have to be the same act or a card
   * could watch a block that a card forbidding blocks had already stopped.
   *
   * So it fires on the **declaration** — `applyDeclareBlock`, beside `onBlock`,
   * after `blockDeclared` — and not on the target redirection that CR 7-1-2-2
   * performs next. The redirection is a consequence of the activation; the
   * activation is the act the card names.
   */
  | 'whenOpponentActivatesBlocker'
  /**
   * The **non-playing** player's field, when a Character enters the other
   * player's Character area — "when your opponent plays a Character".
   *
   * Fires from `enterCharacterArea`, which is the one routine that puts a
   * Character on the field, so the paid `PLAY_CARD` route and the `play`
   * instruction's route both reach it. That is deliberate and it is CR 3-7-3:
   * the bare placing of a card in the Character area is *playing* it. PR #29
   * separated the two senses of the word for **cost** (`6-5-3-1` pays, `3-7-3`
   * does not) and that separation is about payment alone; a card put down by an
   * effect has still been played. The reading is behind
   * `rules.effectPlayIsPlayingACharacter` because the Comprehensive Rules never
   * reconcile the two senses outright — see `types.ts`.
   *
   * The 6th-Character trash is not a play in either direction: it is a card
   * *leaving*, and CR 3-7-6-1-1 makes it "processing a rule".
   */
  | 'whenOpponentPlaysCharacter'
  | 'activateMain'
  | 'trigger'
  | 'counterEvent'
  | 'mainEvent'
  | 'endOfTurn'
  | 'static';

/**
 * The printed properties of a card, without the zone and owner that say *where*
 * to look for it.
 *
 * Split out of `Selector` for one caller. A `discardHand` cost always looks in
 * its own controller's hand — "trash 1 {Land of Wano} type card from your hand"
 * names the filter and nothing else — so the cost should not be able to say
 * anything about zone or owner, right or wrong. Everything here reads off the
 * card definition and needs no board state.
 */
export interface CardFilter {
  category?: CardCategory[];
  colors?: Color[];
  types?: string[];
  /**
   * Printed attributes, matched by sharing — "＜Strike＞ attribute Characters".
   *
   * `types`' shape exactly, because it is `types`' question: both are printed
   * lists on the card and both are asked "is one of mine one of yours". A card
   * with `＜Slash＞＜Strike＞` answers a `＜Strike＞` filter yes, which is CR
   * 2-5-7 read the way CR 2-3-5 is read for colours — a card is *of* every
   * attribute it possesses, and seventeen cards in the game possess two.
   *
   * **One card in OP-01 asks and six in the set**, and it enters here rather
   * than on `Selector` for the reason `names` did: the shared predicate is read
   * at four sites — a script `Selector`, `Condition.countCards`, a static's
   * `Audience`, and a `LegalityClause`'s target — and a field added here is
   * answered at all four without any of them learning a word. `OP01-024` needs
   * exactly the fourth of those, which is the site the other three would have
   * left untested; `tests/lastFourMechanisms.test.ts` writes all four at once
   * rather than waiting for a card to find the gap.
   */
  attributes?: string[];
  costMax?: number;
  costMin?: number;
  /**
   * Card names, matched exactly — "play up to 1 **[Penguin]** from your hand".
   *
   * CR 2-1-2 is the whole reading: "Some text will include text in brackets
   * without a clarifying noun afterwards. This refers to cards with the card
   * name specified in the brackets." A name is printed data like `types` and
   * `colors`, so it belongs beside them, and the list is an *or* like theirs —
   * one card, several acceptable names.
   *
   * **A name is not an id.** Nine names in OP-01 alone sit on two card numbers
   * (`Roronoa Zoro` is both `OP01-001` and `OP01-025`), and three of the twelve
   * cards this field was built for reach across sets: `ST01-006` is a second
   * `Tony Tony.Chopper`, `ST01-007` a second `Nami`, `ST02-012` a second `Bepo`.
   * A filter here names *every* card with the name and never a card number.
   * CR 2-14-2 keeps the two apart from the other end — deck construction counts
   * "cards with the same card number", not the same name.
   *
   * **Not asked of `CardDefinition.name` directly**, ever: `hasName` is the one
   * place that reads it, for the reason spelled out there.
   */
  names?: string[];
  /**
   * Card names that disqualify — "…Character card **other than [Uta]**".
   *
   * Its own field rather than a polarity on `names`, following `excludeSelf`,
   * which is the engine's existing spelling for an exclusion: nothing in a
   * predicate is a tagged union, everything is conjunctive, and a card is free
   * to print both halves at once. Six OP-01 cards print this form and none
   * prints the pair, but a union would make the pair *unspellable* to buy
   * nothing.
   *
   * **It is not `excludeSelf`, and the difference is the whole point.**
   * `excludeSelf` drops one *instance* — the card whose ability is running.
   * This drops every card with the name, and both halves of that matter: the
   * copies of [Uta] in `OP01-005`'s trash are other instances that `excludeSelf`
   * would happily offer, and `OP01-099`'s static must exempt **both** Kurozumi
   * Semimaru on the field from each other's rule, which `excludeSelf` cannot say
   * from either side.
   */
  excludeNames?: string[];
}

/**
 * Everything a card can be tested for, without saying *where* to look for it.
 *
 * `CardFilter` reads off the definition alone; this adds the three questions
 * that need the board — power, orientation, keyword — and stops exactly there.
 * It was split out of `Selector` for a second caller: a legality rule names the
 * cards it speaks about ("a [Blocker] Character that has 5000 or more power")
 * and has no zone to name, because the card it is testing is already in hand as
 * the candidate for an action. A selector is this plus a place to look.
 *
 * `keyword` is asked of `hasKeyword`, never of the printed list, for the reason
 * that function exists: a Character that *gained* `[Blocker]` is a `[Blocker]`
 * Character, and ST01-016's `[Trigger]` has to see it.
 */
export interface CardPredicate extends CardFilter {
  powerMax?: number;
  powerMin?: number;
  orientation?: Orientation;
  keyword?: Keyword;
}

/**
 * A filter over cards in one zone. `owner` is relative to the ability's
 * controller.
 *
 * `deckTop` is the only zone where `count` means anything: it takes the first
 * `count` cards of the deck rather than filtering the whole deck.
 */
export interface Selector extends CardPredicate {
  zone: 'field' | 'hand' | 'trash' | 'deckTop' | 'life';
  owner: 'you' | 'opponent' | 'any';
  excludeSelf?: boolean;
  count?: number;
  /**
   * **"…of a different color than the card this variable names"** —
   * `OP01-002` Trafalgar Law's "a different color than the returned Character".
   *
   * On `Selector` and deliberately not on `CardPredicate`, which is one level
   * up: evaluating it needs `AbilityContext` to read the variable, and
   * `matchesPredicate` has none — it is exported for legality rules, which
   * resolve a candidate the caller already holds and have no script frame at
   * all. Putting it here keeps that signature untouched and makes the clause
   * unspellable in the two places that could not honour it.
   *
   * **What "different color" means against a two-colour card** is settled by CR
   * 2-3-5: "cards with multiple colors, such as red and green, are treated as **a
   * card of every color they possess**". A red/green candidate *is* a red card,
   * so against a red returned Character it is not of a different colour. That is
   * the no-shared-colour reading, and it is behind
   * `rules.differentColorMeansNoSharedColor` because the step from "is a card of
   * every colour it has" to "is not *different* from" is an inference rather
   * than a sentence — and exactly two cards in the game print the phrase.
   */
  differentColorFrom?: string;
}

/**
 * How an instruction names the cards it acts on.
 *
 * `minus` is the fifth member and the one that names something no selector can:
 * **the cards the player did not take.** "Look at 5, reveal up to 1, then place
 * the rest at the bottom" cannot say "the rest" any other way — how many are
 * left depends on how many the player took, and the DSL has no arithmetic.
 *
 * It is a difference over ids already in `vars`, never a selector re-run. The
 * distinction matters: after the take, the untaken cards *are* still the top of
 * the deck, so `deckTop(N - taken)` would give the same answer today — and it
 * would be quietly wrong the first time a script did anything else to the deck
 * in between. Recording what was looked at makes the assumption unnecessary
 * rather than merely true.
 */
export type Ref =
  | { self: true }
  | { var: string }
  | { battle: 'attacker' | 'target' }
  | { selector: Selector }
  | { minus: { of: Ref; without: Ref } };

/**
 * A destination zone. Cards always move to the zones of their *owner*, which
 * is the physical rule, so no owner field is needed or wanted here.
 */
export interface ZoneRef {
  zone: 'hand' | 'deck' | 'trash' | 'life';
}

/**
 * Who a `static` ability applies to.
 *
 * Reuses the two `Ref` shapes that mean something for a continuous effect — the
 * card that carries it, or everything a selector matches — and deliberately
 * leaves out `{var}` and `{battle}`. A static has no script frame and no
 * variables, and it is read outside any battle, so those two could only ever
 * name something that does not exist; making them unspellable here is the point.
 *
 * `{self: true}` is the exact inverse of `Selector.excludeSelf`: "only the
 * source", where `excludeSelf` says "everyone the selector matches but the
 * source". Neither can be written in terms of the other, which is why both
 * exist.
 */
export type Audience = { self: true } | { selector: Selector };

/**
 * Legality, as data.
 *
 * The engine's fourth structural hole, and the last one that was still open:
 * `Modifier` could say two things about a card, `power` and `grantKeyword`, and
 * **everything that changes what a player may *do* fell outside it** — in
 * either direction. "Your opponent cannot activate [Blocker]" (ST01-012) and
 * "this Character can also attack your opponent's active Characters"
 * (OP01-021) are the same hole seen from its two sides, which is why they are
 * one mechanism here and not two kept in a mirror.
 *
 * Three questions, because the answer has to be visible in three different
 * buildings and the Comprehensive Rules ask them in three different places:
 *
 * - `activateBlocker` — the Block Step. CR 10-1-4-1 defines `[Blocker]` as a
 *   keyword effect "allowing you to activate it by **resting this card** during
 *   the Block Step", and CR 7-1-2-1 has the defender "activate the [Blocker]
 *   effect of their card only once during that battle". So the thing a card
 *   forbids is that **activation** — the block declaration — and not the
 *   keyword and not resting as such. The game words the wider restriction
 *   differently: the official Q&A for "cannot be rested" says those effects
 *   stop "any actions that require them to be rested, such as attacking or
 *   activating [Blocker]" *and* stop the card being rested by other effects.
 *   Two different restrictions, two different printed phrasings, and this is
 *   the narrow one.
 * - `attack` — the target set of CR 7-1-1-2, which by rule is "the opponent's
 *   Leader card or 1 of their **rested** Character cards". The only question
 *   with two cards in it, so the clause carries the other end of the pair.
 * - `koInBattle` — the Damage Step. CR 7-1-4-1-2 K.O.s a Character that lost;
 *   CR 10-2-1-3 says effects reading "cannot be K.O.'d" are valid when the card
 *   is K.O.'d "by an effect **or** due to the result of a battle", so the
 *   printed "in battle" is a narrowing the clause has to keep. The unqualified
 *   form is a wider clause and no card in scope prints it.
 *
 * The subject — *whose* cards, and which of them — is deliberately **not** in
 * the clause. It lives beside it (`LegalityRule.subject` for a written rule,
 * `Ability.affects` for a continuous one), so the two faces of the mechanism
 * spell the same clause the same way.
 */
export type LegalityQuestion = 'activateBlocker' | 'attack' | 'koInBattle';

export type LegalityClause =
  | { question: 'activateBlocker' }
  /** `target` is the *other* card in the pair, never the subject. */
  | { question: 'attack'; target?: CardPredicate }
  | { question: 'koInBattle' };

/**
 * `forbid` narrows, `allow` widens.
 *
 * When both speak to the same question the prohibition wins, which is CR 1-3-3:
 * "If a card's effect requires a player to carry out an action while a
 * currently active effect prohibits that action, the prohibiting effect always
 * takes precedence."
 */
export type LegalityEffect = 'allow' | 'forbid';

/** How a `setLegality` instruction names the cards its rule speaks about. */
export type LegalitySubjectSpec =
  | { player: PlayerRef; match?: CardPredicate }
  | { cards: Ref };

/**
 * `restSelf` is "rest this card" as the price of its own ability, and it is the
 * one cost whose payability depends on the source's *orientation* rather than
 * on a pool of resources.
 *
 * A rested card cannot pay it. Resting is a state change, and a card already in
 * that state has none to make — the same reason CR 7-1-1-1 has an attack rest
 * "their active Leader card or 1 active Character card", never a rested one.
 * Official Q&A groups the two outright: an effect reading "cannot be rested"
 * stops "any actions that require them to be rested, such as attacking or
 * activating [Blocker]", and names "[Activate: Main] You may rest this
 * Character:" as one of them. An unpayable part of an activation cost makes the
 * whole cost unpayable (CR 8-3-1-3), so the ability is not activatable at all —
 * which `canPayCosts` reports and `legalActions` therefore honours for free.
 *
 * The consequence is the card's own limiter: the source only returns to active
 * in its controller's Refresh Phase (CR 6-2-4, which names the Stage area), so
 * the ability is once per turn without printing [Once Per Turn]. Cards that
 * print the keyword as well still say so; this is not a substitute for it.
 */
export type Cost =
  | { kind: 'restDon'; count: number }
  | { kind: 'returnDon'; count: number }
  | { kind: 'trashSelf' }
  | { kind: 'restSelf' }
  /**
   * "Trash N card(s) from your hand" as the price of an ability.
   *
   * The one cost the *player* pays a choice for. CR 8-3-1-5 spells the shape out
   * for the DON!! symbol — the player "must select" the cards that pay — and
   * CR 8-4-1-3 puts that selection inside the payment step ("determine the
   * activation costs and pay all activation costs"), not in 8-4-1-2, which only
   * specifies *which effect* is being activated. So the choice suspends the
   * payment, and the interpreter treats a cost list the way it treats a script:
   * a cursor, and an answer that advances it.
   *
   * `filter` is the printed restriction and nothing more. Absent, any card in
   * hand can pay; present, only matching cards are candidates — and
   * `canPayCosts` counts *matching* cards, so an ability whose filter no hand
   * card satisfies is never offered.
   */
  | { kind: 'discardHand'; count: number; filter?: CardFilter }
  /**
   * "Place N card(s) from your hand at the **bottom of your deck**" —
   * `OP01-011` Gordon.
   *
   * `discardHand`'s sibling and not a variant of it: the two take from the same
   * zone and put the card in different places, and a card that goes under the
   * deck is a card its owner can draw again. Trashing it would be a different
   * price on the same sentence.
   *
   * **No ordering, because the printed count is one.** "Place them at the bottom
   * in any order" is a real mechanism — PR #32 built it as `orderToBottom` — and
   * it does not arise here: this cost form is printed on **exactly one card in
   * the game** and it names one card. A second copy of a single card has one
   * arrangement, so there is nothing to ask. The day a card prints two, this
   * grows the question rather than inventing an order for the player.
   */
  | { kind: 'bottomDeckHand'; count: number }
  /**
   * "Return N Character(s) to your hand" — `OP01-047` Trafalgar Law.
   *
   * **Your own Characters**, and the card is the only one in the game that says
   * so this way. Every other card with this cost prints "return 1 **of your
   * Characters** to the **owner's** hand" (17 of them); `OP01-047` prints
   * "return 1 Character to **your** hand", which is OP-01 wording that later
   * sets standardised. Two independent readings land in the same place: "your
   * hand" is only true of a card you own, and `ZoneRef` has no owner field
   * because a card always returns to *its owner's* zone — so a selector that
   * offered the opponent's Character would move it to the opponent's hand and
   * contradict the printed sentence.
   *
   * **It can name the source itself.** Nothing in the text excludes it, and the
   * exclusion is a thing cards say when they mean it — `OP08-047` prints
   * "return 1 of your Characters **other than this Character**". So Law paying
   * with Law is legal, and the script then runs with its source in the hand.
   * That is behind `rules.selfReturnResolvesEffect`; see `types.ts`.
   */
  | { kind: 'returnCharacters'; count: number }
  /**
   * "Rest N of your Characters" — `OP01-055` You Can Be My Samurai!!.
   *
   * `restSelf`'s sibling, and the pair is the whole reason both exist: that one
   * rests **the source** and can only be printed on a card that is on the field.
   * `OP01-055` is an **Event**, which is in the trash by the time its effect
   * resolves (CR 8-4-2), so there is no source to rest and the cost has to name
   * other cards.
   *
   * Only **active** Characters can pay, for `restSelf`'s reason: resting is a
   * state change and a card already rested has none to make. With fewer than
   * `count` active, CR 8-3-1-3 makes the whole cost unpayable — "if it is not
   * possible to pay some or all of the activation cost, the activation cost to
   * activate the effect cannot be paid at all" — so `canPayCosts` refuses it and
   * the ability never reaches `legalActions`.
   */
  | { kind: 'restCharacters'; count: number }
  /**
   * "Add N card(s) from your Life area to your hand" — `OP01-008` Cavendish and
   * `OP01-013` Sanji, the **only two cards in the game** that word it this way
   * against 75 that say "the top of your Life cards".
   *
   * **The top card, and the player does not choose.** CR 3-10-2 settles it for
   * every wording at once: the Life area is a secret area and "when moving a
   * card from their Life area to another area, a player must select the card at
   * the top of their Life cards unless otherwise specified". Neither card
   * otherwise-specifies. So this is the one new cost in this batch that opens no
   * choice at all.
   *
   * **It does not fire the card's `[Trigger]`.** CR 2-11-1 defines `[Trigger]`
   * as "an effect that can be activated **instead of the player adding the card
   * from their Life area to their hand on taking damage**", and CR 4-6-3 offers
   * it only for a card added to hand "during this procedure" — the damage
   * procedure of CR 4-6-2. A cost payment is not damage, so the card arrives in
   * hand as an ordinary card. That also keeps PR #29's declared divergence (a
   * life card with no zone while its `[Trigger]` resolves) out of this batch
   * entirely: no `[Trigger]` resolves, so there is no such window.
   *
   * **Paying your last Life card is legal and does not lose the game.** The
   * defeat condition is CR 1-2-1-1-1, "when you have 0 Life cards **and your
   * Leader takes damage**", repeated as CR 9-2-1-1 in rule processing. Reaching
   * zero is not itself a condition, so a player may pay down to nothing and the
   * game continues — until the next damage.
   */
  | { kind: 'lifeToHand'; count: number };

export type Condition =
  | { kind: 'donAttached'; min: number }
  | { kind: 'isYourTurn' }
  | { kind: 'lifeAtMost'; player: PlayerRef; value: number }
  | { kind: 'countCards'; selector: Selector; min?: number; max?: number }
  /**
   * **How many DON!! cards you have on your field** — "if you have 8 or more
   * DON!! cards on your field".
   *
   * `countCards`' sibling in shape and deliberately not `countCards` itself.
   * DON!! are not in any `Selector` zone and are not going into one: PR #13
   * settled that they are **fungible**, operated by quantity rather than as
   * selectable entities, and `orientDon` and `addDon` both take a number for
   * that reason. A question that only ever needs a *count* does not need them
   * to become selectable — so this is a condition that counts, with the same
   * optional `min`/`max` bounds `countCards` has carried since Phase 2A.
   *
   * **"On your field" is the cost area plus what is given.** CR 3-1-2 collects
   * the Leader, Character, Stage and cost areas under "the field"; CR 3-9-1 puts
   * DON!! cards in the cost area; and CR 6-5-5-1 has giving place a DON!!
   * "underneath your Leader or a Character card ... such that it remains
   * visible", which leaves it on the field in the Leader or Character area. So
   * the count is every DON!! whose `location` is not `donDeck`.
   *
   * **Orientation does not enter it.** The printed sentence says "DON!! cards on
   * your field", not "active DON!!", and CR 4-4-2 makes given DON!! "neither
   * active nor rested" — a count that filtered on orientation could not include
   * them at all, which is the opposite of what the cards mean. `OP01-091` King
   * asks for 10, and with a 10-card DON!! deck (CR 5-1-2) that is *every DON!!
   * deployed*, rested and given ones included.
   *
   * **No `player` field**, and that is `addDon`'s precedent rather than an
   * oversight: an op or a condition that can only ever read its own controller's
   * zone should not be able to say otherwise, right or wrong. 16 cards in the
   * full set do ask about the **opponent's** DON!! count, and that is one of the
   * three DON!! forms PR #33 deslindó and left declared — no card in scope
   * prints it, and the day one does this grows one field.
   *
   * Read flat. DON!! carry no abilities and no statics, so evaluating this
   * inside `forEachStatic` re-enters nothing — which is why it needs no `Lens`
   * anchor where `power` and `keyword` do. `OP01-109` Who's.Who is a `static`
   * gated on exactly this count and is the card that proves it.
   */
  | { kind: 'donOnField'; min?: number; max?: number }
  /**
   * Whether a `confirm` answered yes. Not in the Phase 2A brief's Condition
   * list, and added because without it `confirm` is unreachable: the op writes
   * a boolean into `vars` that no other part of the DSL can read, so a "you may
   * do X, otherwise Y" card could be written but never behave differently.
   * `optional: true` covers "you may activate at all"; this covers a branch
   * *inside* a script.
   */
  | { kind: 'varTrue'; name: string }
  /**
   * **Who caused the K.O. that woke this ability** — "when this Character is
   * K.O.'d by your opponent's effect".
   *
   * The one family of the five that is *not* a new trigger, and saying so is the
   * finding. Six cards in the full set print it and every one of them is an
   * ordinary `[On K.O.]` with a question attached: `onKO` already fires on every
   * route to a K.O., and the only thing it could not say was **what did it**.
   * A second trigger would have been a second firing site for a fact that has
   * one, which is the mistake `whenBecomingRested` exists to avoid.
   *
   * Three answers, because a K.O. has exactly three causes and CR 10-2-1-3 names
   * the split outright: a card can be K.O.'d "by an effect **or** due to the
   * result of a battle". So `battle` is the Damage Step (CR 7-1-4-1-2) and is
   * *not* an effect — the printed "by your opponent's effect" excludes it, and
   * a card K.O.'d in combat does not fire. `you` and `opponent` are relative to
   * the ability's controller and name the player who **controls the effect**,
   * which is CR 8-1-1's reading of whose effect an effect is: the player who
   * activated it, not the player who owns the card it points at.
   *
   * Read out of `vars[KO_CAUSE_VAR]`, seeded by `leaveField` at the moment of the
   * K.O. and carried on the stack item from there, so it survives a suspension
   * and a JSON round trip like any other variable. Asked outside an `onKO`
   * frame there is no cause to read and the condition is false — the same answer
   * `varTrue` gives for a variable nothing wrote.
   */
  | { kind: 'koCause'; by: PlayerRef | 'battle' }
  /**
   * The source's own orientation — "**if this Character is rested**".
   *
   * The narrowest thing that answers the question, and narrow on purpose. The
   * obvious wider shape was a `CardPredicate` aimed at the source, reusing the
   * whole selector vocabulary at once, and it is the wrong shape twice over. A
   * predicate can filter on `powerMin` and `keyword`, and **all seven printed
   * cards in this family are permanent effects** — so a self-predicate asking
   * about power would be evaluated inside static evaluation, against the
   * without-statics lens, which is the recursion anchor `getPowerWithoutStatics`
   * exists to be. The condition would silently answer a different question than
   * the same predicate asks anywhere else. `orientation` needs no lens at all:
   * it is read straight off `CardInstance`.
   *
   * The vocabulary it reuses is `Selector.orientation`'s, which is the same
   * `Orientation` and has meant the same thing since Phase 0. What it does not
   * reuse is the *selector*, because there is no "only me" selector to reuse —
   * `Selector.excludeSelf` is the exact inverse, and `Audience`'s `{self: true}`
   * belongs to a static's `affects` and cannot be counted.
   *
   * Both orientations are printed, which is why this takes an `Orientation`
   * rather than being spelled `isRested`: five cards ask "if this Character is
   * rested" (`ST02-014`, `OP01-051`, `OP04-119`, `OP14-026`, `OP14-027`) and two
   * ask "if this Character is active" (`OP08-029`, `OP12-024`). A boolean would
   * have had to be negated by a `not` the DSL does not have.
   *
   * Off the field there is nothing to ask, and the answer is `false` rather than
   * a throw — a card whose orientation is normalized on exit (`detachFromField`
   * sets it active) would otherwise answer "active" from the trash.
   */
  | { kind: 'selfOrientation'; orientation: Orientation }
  /**
   * **Whether a card a variable names matches a predicate** — `OP01-063`
   * Arlong's "if the revealed card is an Event".
   *
   * The census's row 16, and it arrives as two narrow pieces rather than one
   * comparator: this is the *condition* half, and `Selector.differentColorFrom`
   * is the *filter* half. They ask different questions in different places and
   * sharing a shape would have meant inventing a comparison language neither
   * card needs.
   *
   * A variable holding several ids matches when **every** one of them does — the
   * printed cards name one card each, and "all of them" is the reading that
   * degrades sensibly rather than the one that silently passes on a longer list.
   * A variable holding nothing does not match: there is no card to be an Event.
   *
   * `match` is a `CardPredicate` and not a `Selector`, because the card is
   * already found — there is no zone left to name. Same split `LegalityClause`
   * makes for the same reason.
   */
  | { kind: 'varMatches'; name: string; match: CardPredicate }
  /**
   * The negation of any condition — `[Opponent's Turn]`, which is
   * `not(isYourTurn)`.
   *
   * A general `not` rather than an `isOpponentTurn` member, and the inventory
   * argued it before the card existed: the member closes one card and the
   * variant closes 77 in the full set, at the same cost. Nothing else in
   * `Condition` needed changing for it.
   *
   * Negating inside static evaluation touches no recursion anchor of its own.
   * `not` evaluates its inner condition through the same `Lens` it was handed,
   * so a negated *power* condition rides PR #31's `WITHOUT_STATICS` anchor
   * exactly as the un-negated one does — the guard governs, and this does not
   * change it. Both cards in scope negate flat conditions.
   */
  | { kind: 'not'; of: Condition }
  | { kind: 'and'; of: Condition[] }
  | { kind: 'or'; of: Condition[] };

export type Instruction =
  // Suspend execution and wait for a player. Usually the controller — `discard`
  // is the one that can ask the other side.
  | { op: 'select'; as: string; from: Selector; min: number; max: number; prompt: string }
  | { op: 'confirm'; as: string; prompt: string }
  // Mutate the state.
  | { op: 'ko'; target: Ref }
  | { op: 'rest'; target: Ref }
  | { op: 'setActive'; target: Ref }
  | { op: 'addPower'; target: Ref; value: number; duration: Duration }
  | { op: 'grantKeyword'; target: Ref; keyword: Keyword; duration: Duration }
  | { op: 'moveCard'; target: Ref; to: ZoneRef; position?: 'top' | 'bottom' }
  | { op: 'draw'; player: PlayerRef; count: number }
  /**
   * Trashes `count` cards from a hand, **chosen by a player**.
   *
   * The oldest divergence in the project, closed. Phase 2A took from the front
   * of the hand and wrote the debt down; PR #28 bought the **cost** half
   * (`Cost.discardHand`), and this is the instruction half. There is no
   * deterministic form left beside it, deliberately: **no printed card in the
   * game means "trash the leftmost card in your hand"**, so an op that did that
   * was correct for zero cards and available to every author.
   *
   * **Two players, not one, and they are independent.** Three printed shapes
   * exist and the third is what forces the pair:
   *
   * | Printed | `chooser` | `owner` | Cards in the set |
   * | --- | --- | --- | --- |
   * | "trash N cards from your hand" | `you` | `you` | 142 |
   * | "your opponent trashes N cards from their hand" | `opponent` | `opponent` | 21 |
   * | "your opponent **chooses** N cards from **your** hand" | `opponent` | `you` | **1** |
   *
   * That last row is `OP01-038` Kanjuro and it is the **only card in the entire
   * game** that separates the two. One card would normally be a declared row by
   * this project's standard — but that standard prices a *mechanism* built for
   * one asker, and this is one `PlayerRef` on an instruction being built anyway
   * for the other 163. Collapsing them to a single "whose hand" field would make
   * Kanjuro unspellable and would have to be undone the first time a card prints
   * the mirror ("choose 1 card from your opponent's hand and trash it" — which
   * no card prints today, and which this op can already say).
   *
   * **The chooser does not see the hand, and the engine shows it anyway.** The
   * hand is a secret area (CR 3-1-5), CR 11-3-1 confines looking to "the player
   * of that effect" unless the card says otherwise, and CR 8-4-4-2 spells out
   * the consequence: choosing from a secret area, "players cannot guarantee that
   * the chosen card meets the required conditions". So Kanjuro's opponent points
   * at a face-down card. This engine is perfect-information by declared design,
   * so `PendingChoice.candidates` carries real ids to the chooser — the first
   * time that leak is *reachable* rather than theoretical. Filed with the
   * per-player-view debt in `docs/op01-inventory.md`; **not** modelled as a
   * random pick, because the rules say the opponent chooses and a die roll is a
   * different game.
   *
   * **Mandatory, and short hands are not a special case.** No printed form says
   * "may". CR 8-4-4-1 takes "as many as they can, up to the number specified",
   * and CR 1-3-2 performs "as many of the actions as possible" — so a hand
   * shorter than `count` trashes what there is and an empty one trashes nothing
   * and asks nothing.
   *
   * No filter. Every printed card in all three shapes says "card" with no
   * restriction, so there is nothing for a `CardFilter` to carry and the op does
   * not offer one. `Cost.discardHand` has one because its cards print one.
   */
  | { op: 'discard'; chooser: PlayerRef; owner: PlayerRef; count: number }
  | { op: 'giveDon'; target: Ref; count: number }
  /**
   * Turns up to `count` of a player's cost-area DON!! to `orientation`.
   *
   * The one instruction that names cards by *quantity* rather than by `Ref`,
   * because DON!! are fungible: "rest up to 1 of your opponent's DON!! cards"
   * does not care which one, and no printed card in the game asks to point at a
   * particular DON!! card. Making them selectable would mean giving DON!! a
   * `Selector` zone and putting them in front of the player as choices, which is
   * a large capability answering a question nothing has asked. If a card ever
   * does need to name one, that is the moment to add it.
   *
   * `player` is relative to the controller, like `draw` and `discard`: 'you' for
   * a card that refreshes its own DON!!, 'opponent' for one that rests theirs.
   *
   * Only the cost area. A given DON!! has no orientation to change (CR 4-4-2:
   * "given DON!! cards are neither active nor rested"), so attached DON!! are
   * not merely skipped, they are not candidates. Official Q&A for ST02-008 says
   * both halves outright: a DON!! given to a Character cannot be rested by it,
   * and neither can one that is rested already — "you must choose up to 1 active
   * DON!! card from your opponent's cost area."
   */
  | { op: 'orientDon'; player: PlayerRef; orientation: Orientation; count: number }
  /**
   * Moves up to `count` DON!! from the controller's DON!! deck into their cost
   * area, in `orientation`.
   *
   * `orientDon`'s sibling, and by the same decision: DON!! are **fungible** and
   * are operated by quantity, never as selectable entities. There is nothing to
   * choose between two face-down DON!! in a deck (CR 3-3-2 lets both players see
   * and reorder that deck freely, which is precisely why which one moves cannot
   * matter), so this takes a number and never opens a choice.
   *
   * **Two shapes and one mechanism.** 141 cards in the full set add DON!! this
   * way, in fifteen distinct phrasings, and every one of them reduces to a count
   * and an orientation: "add up to 1 … and set it as active", "add up to 1 …
   * and rest it", "add 1 …" without the "up to", and the compound "set 1 active,
   * and add 1 additional and rest it" — which is this op twice. Nothing adds a
   * DON!! *attached* to a card, and exactly one card in the game adds from the
   * **opponent's** DON!! deck (`OP12-075`), which is why there is no `player`
   * field here: `discardHand` and `lookAt` set the precedent that an op which
   * can only ever touch its own controller's zone should not be able to say
   * otherwise, right or wrong.
   *
   * `orientation` is required rather than defaulted, because the printed text
   * always says. CR 3-9-3 does supply a default — "when placing DON!! cards in
   * the cost area, they should be set as active unless otherwise specified" —
   * and an optional field carrying it would be a field no card ever sets.
   *
   * **A short DON!! deck yields what there is**, and an empty one yields
   * nothing: CR 1-3-2 performs "as many of the actions as possible", CR 8-4-4-1
   * says the same of a specified number, and the DON!! Phase already reads that
   * way in the rules themselves (CR 6-4-2 places 1 from a 1-card deck, 6-4-3
   * places none from an empty one).
   *
   * **It cannot overfill the cost area, and not because a rule stops it.** No
   * rule caps that area at ten. CR 5-1-2 gives each player "a 10-card DON!!
   * deck" and those ten cards are the whole supply, so a cost area of eleven
   * would need an eleventh DON!! card to exist. The engine's own DON!!
   * conservation invariant says the same thing from the other side.
   *
   * **It adds; it never returns.** The inverse movement — a DON!! going back to
   * the deck — is `returnDon`'s, and it emits `donReturnedToDeck`. Sixteen cards
   * in the full set watch for that event ("when a DON!! card on your field is
   * returned to your DON!! deck") and none of them may wake on this op, so this
   * one emits `donAdded` and nothing else.
   */
  | { op: 'addDon'; count: number; orientation: Orientation }
  | { op: 'reveal'; as: string; from: Selector }
  /**
   * Reveals the cards a variable **already names** — `OP01-105` Bao Huang's
   * "choose 2 cards from your opponent's hand; your opponent reveals those
   * cards", and the middle of `OP01-063` Arlong.
   *
   * A second shape of the same op rather than a `Ref` on the first, and the
   * discipline is `Audience`'s: open the door only as wide as the cards knock.
   * A full `Ref` here would admit `{battle}`, `{self}` and `{minus}` — none of
   * which any printed reveal names — and `{selector}` would duplicate `from`.
   * The variable form carries no `as`, because there is nothing to bind: the
   * ids are already in a variable and re-writing them under a second name is a
   * second place for them to disagree.
   *
   * The two shapes are told apart by which key is present, the way `Ref`'s five
   * members are.
   *
   * CR 11-2-1 makes a secret-to-secret move revealed whether the card says so or
   * not; this is the other case — a reveal the card asks for outright, of cards
   * that stay where they are.
   */
  | { op: 'reveal'; var: string }
  /**
   * Records the top `count` cards of the controller's deck in `vars[as]`,
   * **without moving them**.
   *
   * Not moving them is the rule, not an optimisation: CR 11-3-2 says "cards
   * remain in their original areas while being looked at". So this op writes no
   * card into any zone and only the variable changes.
   *
   * It is a different act from `reveal`, and the printed cards keep them
   * apart in one sentence — "**Look at** 5 cards from the top of your deck;
   * **reveal** up to 1 {Supernovas} type card and add it to your hand". CR
   * 11-3-1 makes looking private: "such effects apply only to the player of that
   * effect". Revealing is public and CR 11-2-1 makes it compulsory for the card
   * that then moves deck-to-hand, secret area to secret area.
   *
   * The engine's log is perfect-information by design (see `events.ts`), so
   * `cardsLookedAt` carries the ids and the privacy lives in the client's
   * rendering. Filed with the other hidden-information debts — this engine does
   * not model per-player views, and that is a declared divergence rather than an
   * oversight.
   *
   * No `player` field. Every printed card in this family says "your deck", and
   * `discardHand` set the precedent: a cost or an op that can only ever look at
   * its own controller's zone should not be able to say otherwise, right or
   * wrong. A short deck yields what there is (CR 8-4-4-1); an empty one yields
   * nothing and the whole effect degrades to a no-op.
   */
  | { op: 'lookAt'; as: string; count: number }
  /**
   * Puts `cards` at the bottom of their owner's deck in an order the controller
   * chooses — "place the rest at the bottom of your deck in any order".
   *
   * The fourth suspending op, and the one that brought `orderCards` back. It
   * opens a `PendingChoice` whose answer is a **permutation** of the candidates,
   * and the answer is the placement: `order[0]` ends up nearest the top of the
   * deck and `order.at(-1)` deepest, so the list reads as *the order the cards
   * will be drawn in*. That follows CR 3-2-3 — "when multiple cards in a deck
   * are moved simultaneously, they should be moved one by one" — placed one by
   * one at the bottom, the last one placed is the deepest.
   *
   * With one card or none there is exactly one possible answer, so nothing is
   * asked. The engine deciding that is deliberate: a UI auto-answering a
   * one-option question is a UI holding a rule.
   *
   * No `top` sibling, and the absence was the finding rather than an omission.
   * The printed top-**or**-bottom cards ask the player to *split* the looked-at
   * cards between two ends and order each side — a partition plus an order,
   * which a permutation cannot express. That is `orderToDeckEnds` below.
   */
  | { op: 'orderToBottom'; cards: Ref; prompt: string }
  /**
   * Splits `cards` between the **top and the bottom** of their owner's deck,
   * each side in an order the controller chooses — "place them at the top or
   * bottom of the deck in any order".
   *
   * `orderToBottom`'s sibling and the second of the two mechanisms PR #32 found
   * under one printed phrase. 35 cards in the full set place at the two ends;
   * 27 print an explicit "in any order" and the other 8 have a window of exactly
   * one card, where there is nothing to order and the clause is simply left off.
   * **One op serves both**, because a window of one is a partition whose sides
   * happen to be trivially ordered — and the side itself is still a real choice.
   *
   * **Both sides of the answer read as draw order.** `top[0]` is the card its
   * owner draws first of all; then the rest of the top group; then whatever the
   * deck already held; then `bottom[0]` down to the deepest card in the game.
   * That is one sentence for two destinations on purpose: the alternative — each
   * side read from the end nearest its own edge — is the ambiguity two
   * implementers resolve in opposite directions, and it is the reason
   * `placeAtDeckEnds` states the mapping in one loop rather than two.
   *
   * The bottom half is unchanged from `orderToBottom`, deliberately: CR 3-2-3
   * has cards moved "one by one", and one by one onto the bottom leaves the last
   * placed deepest. The top half is the same rule applied to the other end, and
   * "in any order" is what makes the *player* the one who picks the sequence
   * they are placed in — so the answer names the arrangement and the engine
   * realises it, rather than the answer naming a placement procedure.
   *
   * **With one card the question is still asked**, which is where this parts
   * company with `orderToBottom`'s shortcut: one card has one permutation but
   * two ends. With none, nothing is asked and nothing is placed. The engine
   * decides that, not the UI.
   */
  | { op: 'orderToDeckEnds'; cards: Ref; prompt: string }
  /**
   * Puts one card into its controller's Character area — "play up to 1 red
   * Character card with a cost of 2 or less from your hand", or the whole text
   * of "[Trigger] Play this card".
   *
   * **It plays, it does not move.** `moveCard` shuffles a card between zones and
   * `ZoneRef` has no `field` member on purpose: putting a card on the field is
   * a routine, not a destination. It stamps `playedOnTurn` so CR 3-7-4's
   * summoning sickness applies, places the card active unless `rested` says
   * otherwise (CR 3-7-5), resolves the 6th-Character sacrifice by *asking*
   * (CR 3-7-6-1), and fires the card's `[On Play]` (official Q&A). All of that
   * is `enterCharacterArea`, shared with the `PLAY_CARD` action.
   *
   * **No cost is paid.** CR 6-5-3-1's "you can pay the cost and play a
   * Character card" is the Main Phase *action*; CR 3-7-3 calls the bare placing
   * of a card in the Character area "playing" it too, and that is the sense a
   * card effect uses. Both readings exist in the text, so the choice is behind
   * `rules.playFromEffectPaysCost` — see the README.
   *
   * **One card.** The `Ref` may name several and only the first is placed; a
   * script that puts down two writes `forEach`, whose frame cursor already
   * tracks which iteration it is on. Every printed card in this set says "up to
   * 1", and a single-card instruction is what keeps the suspension honest: the
   * sacrifice choice carries the entering card in its own sink, so there is no
   * state in which a card is half onto the field.
   */
  | { op: 'play'; target: Ref; rested?: boolean }
  /**
   * Writes a timed legality rule onto the state — the `addPower` of the fourth
   * `Modifier` member that never was.
   *
   * It is one op rather than a `forbid`/`allow` pair because a card that says
   * "cannot" and a card that says "can also" are asking the same machinery the
   * same question in opposite directions, and two ops would be two places to
   * keep the answer.
   *
   * `whileAttacker` is the third of ST01-016's shapes and the one that decides
   * whether the design is cut right: "your opponent cannot activate [Blocker]
   * **if that Leader or Character attacks** during this turn" outlives the
   * battle it was written in, so the rule cannot be a property of a battle. It
   * is dormant while any other card is attacking and wakes when the named card
   * declares — including for an attack declared long after the Event resolved.
   * A `Ref` that names nothing writes no rule at all: an "up to 1" answered
   * with nothing leaves a prohibition with no card to hang on, and rule 1 of
   * the interpreter says that is a no-op, not a failure.
   */
  | {
      op: 'setLegality';
      effect: LegalityEffect;
      subject: LegalitySubjectSpec;
      clause: LegalityClause;
      duration: Duration;
      whileAttacker?: Ref;
    }
  // Control flow. Both nest, which is why the cursor is a frame stack.
  | { op: 'if'; cond: Condition; then: Instruction[]; else?: Instruction[] }
  | { op: 'forEach'; in: Ref; do: Instruction[] };

export interface Ability {
  id: string;
  trigger: Trigger;
  /** Checked, never paid. Fails silently: the ability just does not fire. */
  condition?: Condition;
  /** Paid before the script runs. Unpayable means the ability cannot fire. */
  cost?: Cost[];
  /** "You may" rather than "you must": the controller is asked to opt in. */
  optional?: boolean;
  oncePerTurn?: boolean;
  /** Empty for `trigger: 'static'`. */
  script: Instruction[];
  /** `static` only: who the continuous effect applies to. */
  affects?: Audience;
  /**
   * `static` only: what it grants them.
   *
   * `legality` is the continuous face of the same mechanism `setLegality`
   * writes, and it carries no subject for the same reason `power` and `keyword`
   * carry none: `affects` already said who. CR keeps the two apart as well —
   * 8-1-3-3 has permanent effects "constantly affect gameplay while they are
   * valid" (OP01-021 Franky, whose `[DON!! x1]` is a condition re-read every
   * time the question is asked), against 8-1-4-2's continuous effects that last
   * "for a specified duration" (OP01-112 Page One, the same permission bought
   * for a turn). Same clause, two lifetimes, one reader.
   */
  grants?: {
    power?: number;
    keyword?: Keyword;
    legality?: { effect: LegalityEffect; clause: LegalityClause };
    /**
     * **A change to what a card costs to play** — `OP01-067` Crocodile's "give
     * blue Events in your hand −1 cost".
     *
     * The engine's third aggregated reading, after `getPower` and `hasKeyword`,
     * and it arrived the same way both of those did: nothing could change a cost
     * because nothing *asked* for a cost through one function. Six places read
     * `CardDefinition.cost` directly before this — two in `legalActions`, two in
     * the play reducer, two in the Counter-Event reducer — and unifying them
     * behind `getCost` was the whole of the work. Adding the grant was four
     * lines.
     *
     * **Negative inside, floored outside.** CR 1-3-6-2 is unusually precise: a
     * cost "may become a negative value **only for the duration of that
     * calculation**. Outside of such calculations, the cost of a card whose
     * value becomes negative is treated as being 0." And CR 1-3-6-2-1 keeps the
     * negative in play for further arithmetic — "if a card whose cost is already
     * negative would have its cost further increased or decreased by an effect,
     * that negative value is included in those calculations". So `getCost` sums
     * every grant into a possibly-negative running total and clamps **once**, at
     * the boundary. Clamping per grant would make two −1s and a +3 on a 1-cost
     * card read 3 instead of 2.
     *
     * The audience is a `Selector` like any other static's, and Crocodile's
     * names cards **in hand** — which needed nothing new: `resolveSelector`
     * has reached `{zone: 'hand'}` since Phase 2A, and `forEachStatic` never
     * cared which zone the cards it matches are in.
     *
     * **Only the continuous face is built.** `Modifier` gains no `cost` kind,
     * because no card in scope writes one from a script: `OP01-067` is the whole
     * of row 12 in OP-01. `setLegality`/`grants.legality` came as a pair in PR
     * #31 because both faces had printed cards; this one does not, and a
     * `Modifier` member no card can produce is a member the coverage sweep would
     * correctly report as dead.
     */
    cost?: number;
    /**
     * **Power that counts something** — "+1000 power for every card in your
     * hand" (`OP01-072` Smiley), "for every **2** Events in your trash"
     * (`OP01-083` Mr.1).
     *
     * A separate field rather than making `power` a union, because the two say
     * different things and a card may print both: `power` is a fixed number the
     * card names, this is an arithmetic the board decides. Ten cards in the full
     * set scale this way.
     *
     * `value` per `per` matches, floored — `Math.floor(count / per) * value`.
     * `per` defaults to 1, which is Smiley; Mr.1 passes 2. The floor is not a
     * choice: CR 8-4-4 and the printed "for every 2" describe complete groups,
     * and a partial group is not a group. One Event in the trash is +0.
     *
     * **Evaluated at read time, like every static.** Nothing is written to
     * `state.modifiers`; draw a card and Smiley is bigger the next time anyone
     * asks. That is the property the tests pin, because it is the one a
     * modifier-writing implementation would silently lose.
     *
     * **The counting selector must not filter on power**, and it does not have
     * to be forbidden for the reason it might look: `forEachStatic` already
     * evaluates a static's own selectors through `WITHOUT_STATICS`, so a count
     * that asked about power would get the without-statics reading and
     * terminate. It would also silently answer a different question than the
     * same predicate asks anywhere else — the exact cost PR #31 declared for
     * that anchor. Both cards here count with flat selectors (the hand, the
     * trash), so the case is unreached; it is written down rather than gated.
     */
    powerPer?: {
      /** What to count. Flat predicates only — see the note above. */
      of: Selector;
      /** Power per complete group. */
      value: number;
      /** Group size; defaults to 1. `OP01-083` is the only card that sets it. */
      per?: number;
    };
  };
}

/**
 * The reserved variable a `forEach` binds on each iteration.
 *
 * Nested loops shadow it, and it keeps the last item after the loop ends. The
 * alternative — a per-loop binding name — would need `forEach` to carry an `as`
 * field, which the DSL does not have.
 */
export const LOOP_VAR = 'it';

/**
 * The reserved variable an `onKO` trigger is seeded with: who caused the K.O.
 *
 * A `PlayerId` when an effect did it — the player who **controls** that effect —
 * and the literal `'battle'` when the Damage Step did. Only `koCause` reads it,
 * and only `leaveField` writes it, which is why it is a seeded variable rather
 * than a new field on `StackItem`: `vars` already survives suspension and
 * serialization, and a second channel for one datum would need both taught to
 * carry it.
 *
 * `LOOP_VAR`'s sibling and the second reserved name in the DSL. A script that
 * writes either is overwriting something the engine put there; both are spelled
 * out here so that a card author can see the whole reserved list in one place.
 */
export const KO_CAUSE_VAR = 'koCause';

/** The `KO_CAUSE_VAR` value for a K.O. that was not caused by any effect. */
export const KO_BY_BATTLE = 'battle';

/**
 * Printed keyword spellings. `CardDefinition.keywords` stores the printed form
 * (`'Blocker'`), which Phase 0 already shipped and `blocker.test.ts` depends on;
 * the DSL speaks in lowercase identifiers. This map is the only bridge, and
 * `hasKeyword` is the only thing allowed to cross it.
 */
export const PRINTED_KEYWORD: Readonly<Record<Keyword, string>> = Object.freeze({
  rush: 'Rush',
  blocker: 'Blocker',
  doubleAttack: 'Double Attack',
  banish: 'Banish',
});

export const KEYWORDS: readonly Keyword[] = Object.freeze([
  'rush',
  'blocker',
  'doubleAttack',
  'banish',
]);

/** Everything a script may park in `vars`: ids and scalars, never objects. */
export type VarValue = string | number | boolean | InstanceId[];

/** Resolution context for refs, selectors and conditions. */
export interface AbilityContext {
  source: InstanceId;
  controller: PlayerId;
  vars: Record<string, VarValue>;
}

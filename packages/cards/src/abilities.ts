import type { Ability, CardCategory, CardId, Condition, Instruction } from '@optcg/engine';

/**
 * Card effects for the real cards, written in the engine's DSL.
 *
 * The `TEST` and `ABIL` sets declare their abilities inline in the
 * `CardDefinition` literal. These cards cannot: their definitions come out of
 * `data/cards.en.json`, and a script is code, not data. So the abilities live
 * here keyed by card id and are attached to the matching definitions as they
 * are loaded — same shape on the other side, same public registry, same
 * `getAbilities` lookup. Nothing about the engine changes.
 *
 * Scope of this file today: **72 cards** — the 21 starter cards whose printed
 * abilities the DSL can express, **all 35** of OP-01 pile A, and the 16 OP-01
 * cards that a chosen payment (3), putting cards into play (8), two missing
 * rules (2) and modifiable legality (3) freed out of pile C. It
 * opened with the pile-A cards of `docs/starter-card-inventory.md` and has
 * grown one closed gap at a time (PRs #11, #12, #13, and the rest-the-source
 * cost), so the pile labels no longer describe its starter contents. The two
 * inventories' card-by-card tables are the map; this file is the code.
 *
 * The map was called `STARTER_ABILITIES` until OP-01 arrived in it. Nothing
 * about it was ever starter-specific — `cards.ts` looks up every English card
 * here, and `starters.ts` looks up the starter subset — so the name was the
 * only thing that had to change.
 *
 * Four cards are absent on purpose, so their absence is not read as an
 * oversight:
 *
 * - `ST01-006` and `ST02-004` — their whole printed text is the `[Blocker]`
 *   reminder, and a printed keyword is already a rule the engine applies from
 *   `CardDefinition.keywords`. Writing an ability for them would be writing the
 *   same rule twice.
 * `ST02-005` and `ST02-017` were on this list for four batches, each with one
 * printed half the DSL could express and one that needed a card *put into
 * play*. Batch 6 built that, and both are scripted below.
 *
 * `ST01-002`, `ST01-012` and `ST01-016` were the three starter cards the DSL
 * could not say a word of: the `[Blocker]` prohibitions, gap 5 of the starter
 * inventory and the one it said needed a design conversation rather than an
 * implementation. Batch 8 had it. All three are scripted below, `ST01-002`
 * whole — its `[Trigger]` half had been waiting on batch 6 since.
 *
 * `OP01-017` Nico Robin was in this list for one PR and is not any more. She
 * was written, her table cases passed, and she was withheld because the
 * **engine** could not survive her: K.O.ing the very Character her attack was
 * targeting left `state.battle.target` naming a card in the trash, and the
 * Damage Step threw on it. That was a missing rule rather than a missing word,
 * and the rule now exists — CR 7-1-1-4, in `endBattleIfParticipantLeft`. She is
 * scripted below like any other card.
 *
 * Every script here is a transcription of the card's printed text. Where the
 * text and the inventory disagreed, the text won.
 */

/**
 * "K.O. up to 1 of your opponent's Characters with 6000 power or less."
 *
 * Shared, not duplicated, between ST01-015's two abilities. The card's own
 * `[Trigger]` text is "Activate this card's [Main] effect" — it does not
 * restate the effect, it points at it, and one shared list is the only encoding
 * where the two cannot drift apart. Scripts are read-only to the engine: the
 * interpreter never writes to an `Instruction`, it walks a cursor that lives on
 * the stack item, so two abilities reading one list stay independent at run
 * time.
 */
/**
 * "Look at N cards from the top of your deck; reveal up to 1 <filter> card and
 * add it to your hand. Then, place the rest at the bottom of your deck in any
 * order."
 *
 * Four printed cards say this with one word changed, so it is written once.
 *
 * Four instructions, and the order of them is the printed order:
 *
 * 1. **`lookAt`** records the top N in `looked` and moves nothing — CR 11-3-2,
 *    "cards remain in their original areas while being looked at". It is what
 *    makes step 4 possible at all.
 * 2. **`select`** offers the matching ones. Its `deckTop` count has to be the
 *    same N `lookAt` used, and nothing in the type system says so; it is safe
 *    because `lookAt` does not suspend, so nothing can run between them, and
 *    `abilCardShapes.test.ts` checks the pairing rather than trusting this
 *    comment. Reading the candidates out of `looked` instead would need a
 *    selector predicated on a variable — gap 16, and a different PR.
 *    `min: 0` because "up to 1" may take nothing (CR 8-4-4-1), and because
 *    CR 8-4-4-2 lets a player decline a secret-area choice outright.
 * 3. **`moveCard`** takes it to hand. The printed "reveal" is not decoration:
 *    CR 11-2-1 makes a deck-to-hand move revealed whether the card says so or
 *    not, secret area to secret area.
 * 4. **`orderToBottom`** buries what is left, `looked` minus what step 2 took.
 */
function lookKeepBury(
  count: number,
  types: string[],
  prompt: string,
  category?: CardCategory[],
): Instruction[] {
  return [
    { op: 'lookAt', as: 'looked', count },
    {
      op: 'select',
      as: 'kept',
      from: {
        zone: 'deckTop',
        owner: 'you',
        count,
        types,
        ...(category === undefined ? {} : { category }),
      },
      min: 0,
      max: 1,
      prompt,
    },
    { op: 'moveCard', target: { var: 'kept' }, to: { zone: 'hand' } },
    {
      op: 'orderToBottom',
      cards: { minus: { of: { var: 'looked' }, without: { var: 'kept' } } },
      prompt: 'Place the rest at the bottom of your deck, first card drawn first',
    },
  ];
}

/**
 * `OP01-115`'s [Main], shared with its [Trigger] the way JET_PISTOL is: the
 * card's [Trigger] reads "Activate this card's [Main] effect" and points at the
 * effect rather than restating it.
 */
const MARCHOO: Instruction[] = [
  {
    op: 'select',
    as: 'victim',
    from: { zone: 'field', owner: 'opponent', category: ['character'], costMax: 2 },
    min: 0,
    max: 1,
    prompt: "K.O. up to 1 of your opponent's Characters with a cost of 2 or less",
  },
  { op: 'ko', target: { var: 'victim' } },
  { op: 'addDon', count: 1, orientation: 'active' },
];

/** ST02-007, OP01-041, OP01-030 and OP01-084, one sentence apart. */
const SABAODY: Instruction[] = lookKeepBury(
  5,
  ['Straw Hat Crew'],
  'Reveal up to 1 {Straw Hat Crew} type Character card',
  ['character'],
);

/**
 * `OP01-116`'s [Main], shared with its [Trigger] the way JET_PISTOL is.
 *
 * The same four steps with the middle one changed: it **plays** the card it
 * found rather than adding it to hand, and plays it out of the deck. Nothing
 * about `play` cares which zone the card came from — `removeFromNonFieldZone`
 * covers all four — so this needed no engine change beyond the ordering itself.
 */
const SMILE: Instruction[] = [
  { op: 'lookAt', as: 'looked', count: 5 },
  {
    op: 'select',
    as: 'summoned',
    from: {
      zone: 'deckTop',
      owner: 'you',
      count: 5,
      types: ['SMILE'],
      category: ['character'],
      costMax: 3,
    },
    min: 0,
    max: 1,
    prompt: 'Play up to 1 {SMILE} type Character card with a cost of 3 or less',
  },
  { op: 'play', target: { var: 'summoned' } },
  {
    op: 'orderToBottom',
    cards: { minus: { of: { var: 'looked' }, without: { var: 'summoned' } } },
    prompt: 'Place the rest at the bottom of your deck, first card drawn first',
  },
];

/**
 * "Play up to 1 {Baroque Works} type Character card with a cost of 3 or less
 * from your hand."
 *
 * Shared between OP01-087's two halves for the same reason JET_PISTOL is: the
 * card's [Trigger] reads "Activate this card's [Counter] effect", which points
 * at the effect rather than restating it.
 */
const OFFICER_AGENTS: Instruction[] = [
  {
    op: 'select',
    as: 'recruit',
    from: {
      zone: 'hand',
      owner: 'you',
      category: ['character'],
      types: ['Baroque Works'],
      costMax: 3,
    },
    min: 0,
    max: 1,
    prompt: 'Play up to 1 {Baroque Works} type Character card with a cost of 3 or less',
  },
  { op: 'play', target: { var: 'recruit' } },
];
const JET_PISTOL: Instruction[] = [
  {
    op: 'select',
    as: 'victim',
    from: { zone: 'field', owner: 'opponent', category: ['character'], powerMax: 6000 },
    min: 0,
    max: 1,
    prompt: "K.O. up to 1 of your opponent's Characters with 6000 power or less",
  },
  { op: 'ko', target: { var: 'victim' } },
];

/**
 * "Give up to 1 rested DON!! card to your Leader or 1 of your Characters."
 *
 * Shared by ST01-001 and ST01-007, whose effects are word-for-word the same.
 * The "up to 1" quantity rides on the target select's `min: 0`: pick a
 * recipient and it takes one rested DON!!, pick none and nothing moves. giveDon
 * only ever draws from rested DON!!, so an empty rested pool resolves the same
 * way — the ability does nothing rather than gift an active DON!! the card does
 * not authorize.
 */
const GIVE_ONE_RESTED_DON: Instruction[] = [
  {
    op: 'select',
    as: 'recipient',
    from: { zone: 'field', owner: 'you', category: ['leader', 'character'] },
    min: 0,
    max: 1,
    prompt: 'Give up to 1 rested DON!! card to your Leader or 1 of your Characters',
  },
  { op: 'giveDon', target: { var: 'recipient' }, count: 1 },
];

/**
 * "Set up to 1 of your DON!! cards as active."
 *
 * The "up to 1" is a quantity, and the DSL chooses cards or yes/no, never a
 * number — so it rides on a `confirm`, the shape Brook established. One question
 * covers both answers here: no leaves the op unreached, yes turns one DON!!.
 * `orientDon` only counts DON!! that actually change, so a cost area with
 * nothing rested resolves the same way a "no" does.
 *
 * Shared by the [Counter] halves of ST02-015 and ST02-016, whose second
 * sentence is word for word the same.
 */
const SET_ONE_DON_ACTIVE: Instruction[] = [
  { op: 'confirm', as: 'refresh', prompt: 'Set up to 1 of your DON!! cards as active?' },
  {
    op: 'if',
    cond: { kind: 'varTrue', name: 'refresh' },
    then: [{ op: 'orientDon', player: 'you', orientation: 'active', count: 1 }],
  },
];

/**
 * "[Counter] Up to 1 of your Leader or Character cards gains +X power during
 *  this battle. Then, set up to 1 of your DON!! cards as active."
 *
 * ST02-015 and ST02-016 are the same card with a different number, so the shape
 * is written once and the number passed in. A shared constant would not do:
 * `value` appears in the prompt as well as in the instruction, and two lists
 * built by hand are two lists that can drift.
 *
 * Official Q&A for both cards: "Can I choose not to set any DON!! cards as
 * active when using this [Counter] effect?" — "Yes, you can." That is the
 * `confirm`, and answering no is a complete resolution of the card.
 */
function counterBoostThenRefresh(value: number): Instruction[] {
  return [...counterBoost(value), ...SET_ONE_DON_ACTIVE];
}

/**
 * "Up to 1 of your Leader or Character cards gains +X power during this battle."
 *
 * The opening sentence of six printed [Counter] Events so far — ST02-015,
 * ST02-016, and four of OP-01's — word for word, with only the number moving.
 * `duration: 'endOfBattle'` is the [Counter] half of the pair Guard Point
 * established: a [Counter] boost lasts the battle, a [Trigger] boost lasts the
 * turn, and the two halves of one card use different durations for that reason.
 *
 * The variable is named `ally` on purpose: OP01-029 needs to add to *that same
 * card* a moment later, and a second selection would let the player see the
 * first result before committing.
 */
function counterBoost(value: number): Instruction[] {
  return [
    {
      op: 'select',
      as: 'ally',
      from: { zone: 'field', owner: 'you', category: ['leader', 'character'] },
      min: 0,
      max: 1,
      prompt: `Give up to 1 of your Leader or Character cards +${value} power`,
    },
    { op: 'addPower', target: { var: 'ally' }, value, duration: 'endOfBattle' },
  ];
}

/**
 * "Give up to 1 of your opponent's … −N power during this turn."
 *
 * OP01-027's [Main] and OP01-026's [Trigger] are the same sentence with
 * different numbers and different audiences, so the audience is a parameter
 * too. Negative power has no floor — CR 2-6-3 makes power higher *or* lower than
 * printed and names no minimum — which is what makes −10000 a removal effect on
 * anything under that.
 */
function minusPower(value: number, category: ('leader' | 'character')[]): Instruction[] {
  const who = category.includes('leader') ? 'Leader or Character cards' : 'Characters';
  return [
    {
      op: 'select',
      as: 'victim',
      from: { zone: 'field', owner: 'opponent', category },
      min: 0,
      max: 1,
      prompt: `Give up to 1 of your opponent's ${who} −${value} power`,
    },
    { op: 'addPower', target: { var: 'victim' }, value: -value, duration: 'endOfTurn' },
  ];
}

/**
 * OP01-028 Green Star Rafflesia, both halves.
 *
 * Its [Trigger] text is "Activate this card's [Counter] effect" — it does not
 * restate the effect, it points at it. One shared list is the only encoding
 * where the two cannot drift apart, which is the rule ST01-015's Jet Pistol set.
 *
 * Note what is *not* shared: the duration. This card's [Counter] gives −2000
 * "during this turn", not during this battle, so the same list is correct for
 * both halves. A card whose [Counter] said "during this battle" could not share
 * its list with a [Trigger] at all.
 */
const RAFFLESIA: Instruction[] = minusPower(2000, ['leader', 'character']);

/**
 * "K.O. up to 1 of your opponent's Characters with a cost of N or less."
 *
 * `as` is a parameter because OP01-096 King runs two of these back to back and
 * the two selections must not share a variable — the second would overwrite the
 * first before the first K.O. ran.
 */
function koOpponentByCost(costMax: number, as = 'victim'): Instruction[] {
  return [
    {
      op: 'select',
      as,
      from: { zone: 'field', owner: 'opponent', category: ['character'], costMax },
      min: 0,
      max: 1,
      prompt: `K.O. up to 1 of your opponent's Characters with a cost of ${costMax} or less`,
    },
    { op: 'ko', target: { var: as } },
  ];
}

/**
 * "Return up to 1 … Character with a cost of N or less to the owner's hand."
 *
 * `owner: 'any'` because the printed text says "1 Character", not "1 of your
 * opponent's Characters" — these cards can bounce their controller's own board,
 * and OP01-089 in particular is sometimes played to save a Character from a
 * battle it would lose. `moveCard` always moves to the *owner's* zones, which is
 * the physical rule and why the destination needs no side.
 */
function bounceByCost(costMax: number, orientation?: 'active' | 'rested'): Instruction[] {
  const which = orientation === undefined ? '' : `${orientation} `;
  return [
    {
      op: 'select',
      as: 'bounced',
      from: {
        zone: 'field',
        owner: 'any',
        category: ['character'],
        costMax,
        ...(orientation === undefined ? {} : { orientation }),
      },
      min: 0,
      max: 1,
      prompt: `Return up to 1 ${which}Character with a cost of ${costMax} or less to the owner's hand`,
    },
    { op: 'moveCard', target: { var: 'bounced' }, to: { zone: 'hand' } },
  ];
}

/**
 * OP01-078 Boa Hancock's one printed sentence, reachable from two triggers.
 *
 * "[DON!! x1] [When Attacking]/[On Block] Draw 1 card if you have 5 or less
 * cards in your hand." The slash is the card saying one effect twice over, so
 * the condition and the script are each written once and shared.
 */
const HANCOCK_CONDITION: Condition = {
  kind: 'and',
  of: [
    { kind: 'donAttached', min: 1 },
    { kind: 'countCards', selector: { zone: 'hand', owner: 'you' }, max: 5 },
  ],
};

const HANCOCK_DRAW: Instruction[] = [{ op: 'draw', player: 'you', count: 1 }];

/** "If your Leader has the {T} type" — a `countCards` over the Leader slot. */
function leaderHasType(type: string): Condition {
  return {
    kind: 'countCards',
    selector: { zone: 'field', owner: 'you', category: ['leader'], types: [type] },
    min: 1,
  };
}

export const CARD_ABILITIES: Readonly<Record<CardId, readonly Ability[]>> = Object.freeze({
  // ST01-001 Monkey.D.Luffy (Leader)
  // "[Activate: Main] [Once Per Turn] Give this Leader or 1 of your Characters
  //  up to 1 rested DON!! card."
  'ST01-001': [
    { id: 'ST01-001-main', trigger: 'activateMain', oncePerTurn: true, script: GIVE_ONE_RESTED_DON },
  ],

  // ST01-007 Nami
  // "[Activate: Main] [Once Per Turn] Give up to 1 rested DON!! card to your
  //  Leader or 1 of your Characters."
  'ST01-007': [
    { id: 'ST01-007-main', trigger: 'activateMain', oncePerTurn: true, script: GIVE_ONE_RESTED_DON },
  ],

  // ST01-011 Brook
  // "[On Play] Give up to 2 rested DON!! cards to your Leader or 1 of your
  //  Characters."
  //
  // "Up to 2" is a choice of *quantity*, and the DSL only chooses cards
  // (`select`) or yes/no (`confirm`), never a number. Modeled as two opt-in
  // confirms, each gating a `giveDon` of 1 to the one recipient: no/no gives 0,
  // yes/no or no/yes gives 1, yes/yes gives 2 — every count in 0..2 is
  // reachable. `varTrue` reads each confirm's answer, which is the only reason
  // that condition exists.
  //
  // The confirms are asked even when the target select was left empty (the DSL
  // has no "selection is non-empty" guard); `giveDon` no-ops on an empty target,
  // so that path is harmless, just two dead questions.
  'ST01-011': [
    {
      id: 'ST01-011-onPlay',
      trigger: 'onPlay',
      script: [
        {
          op: 'select',
          as: 'recipient',
          from: { zone: 'field', owner: 'you', category: ['leader', 'character'] },
          min: 0,
          max: 1,
          prompt: 'Give up to 2 rested DON!! cards to your Leader or 1 of your Characters',
        },
        { op: 'confirm', as: 'give1', prompt: 'Give a rested DON!! card?' },
        {
          op: 'if',
          cond: { kind: 'varTrue', name: 'give1' },
          then: [{ op: 'giveDon', target: { var: 'recipient' }, count: 1 }],
        },
        { op: 'confirm', as: 'give2', prompt: 'Give another rested DON!! card?' },
        {
          op: 'if',
          cond: { kind: 'varTrue', name: 'give2' },
          then: [{ op: 'giveDon', target: { var: 'recipient' }, count: 1 }],
        },
      ],
    },
  ],

  // ST01-013 Roronoa Zoro
  // "[DON!! x1] This Character gains +1000 power."
  // A continuous that names its own source: affects {self: true}, gated on one
  // attached DON!!.
  'ST01-013': [
    {
      id: 'ST01-013-static',
      trigger: 'static',
      condition: { kind: 'donAttached', min: 1 },
      script: [],
      affects: { self: true },
      grants: { power: 1000 },
    },
  ],

  // ST01-004 Sanji
  // "[DON!! x2] This Character gains [Rush]."
  // The keyword sibling of Zoro: same self-targeting shape, granting Rush once
  // two DON!! are attached.
  'ST01-004': [
    {
      id: 'ST01-004-static',
      trigger: 'static',
      condition: { kind: 'donAttached', min: 2 },
      script: [],
      affects: { self: true },
      grants: { keyword: 'rush' },
    },
  ],

  // ST02-003 Urouge
  // "[DON!! x1] If you have 3 or more Characters, this card gains +2000 power."
  // Self-targeting again, behind a compound condition: one attached DON!! and a
  // board of three or more Characters — Urouge counts itself toward the three.
  'ST02-003': [
    {
      id: 'ST02-003-static',
      trigger: 'static',
      condition: {
        kind: 'and',
        of: [
          { kind: 'donAttached', min: 1 },
          {
            kind: 'countCards',
            selector: { zone: 'field', owner: 'you', category: ['character'] },
            min: 3,
          },
        ],
      },
      script: [],
      affects: { self: true },
      grants: { power: 2000 },
    },
  ],

  // ST01-005 Jinbe
  // "[DON!! x1] [When Attacking] Up to 1 of your Leader or Character cards
  //  other than this card gains +1000 power during this turn."
  'ST01-005': [
    {
      id: 'ST01-005-whenAttacking',
      trigger: 'whenAttacking',
      // `[DON!! xN]` is a Condition, never a Cost: it asks how many DON!! are
      // attached and nothing is spent.
      condition: { kind: 'donAttached', min: 1 },
      script: [
        {
          op: 'select',
          as: 'ally',
          from: {
            zone: 'field',
            owner: 'you',
            category: ['leader', 'character'],
            excludeSelf: true,
          },
          min: 0,
          max: 1,
          prompt: 'Give up to 1 other Leader or Character +1000 power',
        },
        { op: 'addPower', target: { var: 'ally' }, value: 1000, duration: 'endOfTurn' },
      ],
    },
  ],

  // ST01-014 Guard Point
  // "[Counter] Up to 1 of your Leader or Character cards gains +3000 power
  //  during this battle."
  // "[Trigger] Up to 1 of your Leader or Character cards gains +1000 power
  //  during this turn."
  //
  // Both halves are written now that the engine can play a Counter Event from
  // hand (PLAY_COUNTER_EVENT). The `[Counter]` effect is reached during the
  // Counter Step; the `[Trigger]` effect off a life card.
  //
  // The two durations are genuinely different: the Counter effect lasts the
  // battle, the Trigger effect lasts the turn. They are the same shape of script
  // with a different number and a different duration, not one ability reused.
  'ST01-014': [
    {
      id: 'ST01-014-counter',
      trigger: 'counterEvent',
      script: [
        {
          op: 'select',
          as: 'ally',
          from: { zone: 'field', owner: 'you', category: ['leader', 'character'] },
          min: 0,
          max: 1,
          prompt: 'Give up to 1 of your Leader or Character cards +3000 power',
        },
        { op: 'addPower', target: { var: 'ally' }, value: 3000, duration: 'endOfBattle' },
      ],
    },
    {
      id: 'ST01-014-trigger',
      trigger: 'trigger',
      script: [
        {
          op: 'select',
          as: 'ally',
          from: { zone: 'field', owner: 'you', category: ['leader', 'character'] },
          min: 0,
          max: 1,
          prompt: 'Give up to 1 of your Leader or Character cards +1000 power',
        },
        { op: 'addPower', target: { var: 'ally' }, value: 1000, duration: 'endOfTurn' },
      ],
    },
  ],

  // ST01-015 Gum-Gum Jet Pistol
  // "[Main] K.O. up to 1 of your opponent's Characters with 6000 power or less."
  // "[Trigger] Activate this card's [Main] effect."
  'ST01-015': [
    { id: 'ST01-015-main', trigger: 'mainEvent', script: JET_PISTOL },
    { id: 'ST01-015-trigger', trigger: 'trigger', script: JET_PISTOL },
  ],

  // ST01-017 Thousand Sunny (Stage)
  // "[Activate: Main] You may rest this Stage: Up to 1 {Straw Hat Crew} type
  //  Leader or Character card on your field gains +1000 power during this turn."
  //
  // The first card in the set whose price is the card itself staying put. The
  // cost is `restSelf`, and it does the work `[Once Per Turn]` does elsewhere:
  // the Stage comes back active only in its controller's Refresh Phase
  // (CR 6-2-4), so the ability is once per turn without printing the keyword —
  // and it is not printed here, so it is not written here either.
  //
  // "You may rest this Stage" is a cost worded with "may" (CR 8-3-1-4): the
  // player can decline to pay, in which case the effect is not activated. In
  // this engine declining *is* not taking the ACTIVATE_ABILITY action, so
  // `optional: true` would ask the same question a second time, after the fact.
  //
  // The printed text says "Leader or Character card", not "Character" — the
  // {Straw Hat Crew} Leader is a legal target and the selector says so.
  'ST01-017': [
    {
      id: 'ST01-017-main',
      trigger: 'activateMain',
      cost: [{ kind: 'restSelf' }],
      script: [
        {
          op: 'select',
          as: 'ally',
          from: {
            zone: 'field',
            owner: 'you',
            category: ['leader', 'character'],
            types: ['Straw Hat Crew'],
          },
          min: 0,
          max: 1,
          prompt: 'Give up to 1 of your {Straw Hat Crew} Leader or Character cards +1000 power',
        },
        { op: 'addPower', target: { var: 'ally' }, value: 1000, duration: 'endOfTurn' },
      ],
    },
  ],

  // ST02-009 Trafalgar Law
  // "[On Play] Set up to 1 of your {Supernovas} or {Heart Pirates} type rested
  //  Characters with a cost of 5 or less as active."
  'ST02-009': [
    {
      id: 'ST02-009-onPlay',
      trigger: 'onPlay',
      script: [
        {
          op: 'select',
          as: 'ally',
          from: {
            zone: 'field',
            owner: 'you',
            category: ['character'],
            // A Selector's `types` matches any of the listed types, which is
            // exactly the printed "{Supernovas} or {Heart Pirates}".
            types: ['Supernovas', 'Heart Pirates'],
            orientation: 'rested',
            costMax: 5,
          },
          min: 0,
          max: 1,
          prompt: 'Set up to 1 of your rested Supernovas or Heart Pirates Characters as active',
        },
        { op: 'setActive', target: { var: 'ally' } },
      ],
    },
  ],

  // ST02-008 Scratchmen Apoo
  // "[DON!! x1] [When Attacking] Rest up to 1 of your opponent's DON!! cards."
  //
  // The first card in the set that reaches across the table at DON!!. It names
  // no particular DON!! card and could not: official Q&A settles which ones are
  // even candidates — "Can I rest a DON!! card that is already rested?" and
  // "Can I rest a DON!! card that has been given to an opponent's Character?"
  // both answer "No, you cannot. You must choose up to 1 active DON!! card from
  // your opponent's cost area." `orientDon` enforces both by construction, so
  // the script says only "up to 1".
  'ST02-008': [
    {
      id: 'ST02-008-whenAttacking',
      trigger: 'whenAttacking',
      condition: { kind: 'donAttached', min: 1 },
      script: [
        { op: 'confirm', as: 'rest', prompt: "Rest up to 1 of your opponent's DON!! cards?" },
        {
          op: 'if',
          cond: { kind: 'varTrue', name: 'rest' },
          then: [{ op: 'orientDon', player: 'opponent', orientation: 'rested', count: 1 }],
        },
      ],
    },
  ],

  // ST02-015 Scalpel
  // "[Counter] Up to 1 of your Leader or Character cards gains +2000 power
  //  during this battle. Then, set up to 1 of your DON!! cards as active."
  // "[Trigger] Set up to 2 of your DON!! cards as active."
  //
  // A DON!! set active during the opponent's turn is an ordinary active DON!!
  // in your cost area, and CR 7-1-3-2-2 has the defender pay an Event's cost the
  // same way anyone does (2-7-3, 8-3-1-5: rest that many active cost-area
  // DON!!). Nothing scopes either rule by whose turn it is, so this card can pay
  // for the next [Counter] Event in the same battle.
  'ST02-015': [
    { id: 'ST02-015-counter', trigger: 'counterEvent', script: counterBoostThenRefresh(2000) },
    {
      id: 'ST02-015-trigger',
      trigger: 'trigger',
      // "Up to 2" needs every count in 0..2 reachable, and one confirm only
      // reaches 0 and 2 — hence two, each gating a single DON!!, exactly as
      // Brook's "up to 2 rested DON!!" is written. The Q&A confirms 1 is a real
      // answer: asked whether the [Trigger] works without enough DON!! in the
      // cost area, "Yes... In that case, you can choose to set 0 or 1 DON!!
      // cards as active."
      script: [
        { op: 'confirm', as: 'first', prompt: 'Set 1 of your DON!! cards as active?' },
        {
          op: 'if',
          cond: { kind: 'varTrue', name: 'first' },
          then: [{ op: 'orientDon', player: 'you', orientation: 'active', count: 1 }],
        },
        { op: 'confirm', as: 'second', prompt: 'Set another of your DON!! cards as active?' },
        {
          op: 'if',
          cond: { kind: 'varTrue', name: 'second' },
          then: [{ op: 'orientDon', player: 'you', orientation: 'active', count: 1 }],
        },
      ],
    },
  ],

  // ST02-016 Repel
  // "[Counter] Up to 1 of your Leader or Character cards gains +4000 power
  //  during this battle. Then, set up to 1 of your DON!! cards as active."
  // Scalpel's [Counter] half with a bigger number and a bigger cost; no
  // [Trigger] printed.
  'ST02-016': [
    { id: 'ST02-016-counter', trigger: 'counterEvent', script: counterBoostThenRefresh(4000) },
  ],

  // ST02-013 Eustass"Captain"Kid
  // "[Blocker]" — printed keyword, applied from CardDefinition.keywords.
  // "[DON!! x1] [End of Your Turn] Set this Character as active."
  //
  // The inventory wrote this one down as `isYourTurn` alone. The printed text
  // opens with `[DON!! x1]`, so the condition is both: the engine fires
  // `endOfTurn` for every card on the field, both players', which is what makes
  // `isYourTurn` load-bearing rather than decorative.
  'ST02-013': [
    {
      id: 'ST02-013-endOfTurn',
      trigger: 'endOfTurn',
      condition: {
        kind: 'and',
        of: [{ kind: 'donAttached', min: 1 }, { kind: 'isYourTurn' }],
      },
      script: [{ op: 'setActive', target: { self: true } }],
    },
  ],

  /* ------------------------------------------------------------------------
   * OP-01, batch 1.
   *
   * Nine cards from pile A of `docs/op01-inventory.md`, all of them one
   * trigger, at most one choice step, and one op. Nothing here needed anything
   * the DSL did not already have — which is what pile A claimed, now checked
   * against the printed text rather than against the inventory's summary of it.
   * ---------------------------------------------------------------------- */

  // OP01-006 Otama
  // "[On Play] Give up to 1 of your opponent's Characters −2000 power during
  //  this turn."
  //
  // A negative `addPower`. The DSL has no separate "reduce power" op and needs
  // none: `state.modifiers` are summed, so a negative value is subtraction
  // (CR 2-6-3 — effects make a card's power higher *or lower* than printed).
  // Nothing clamps at zero, which is right: a Character at −2000 effective
  // power still loses every comparison, and the printed rule never mentions a
  // floor.
  'OP01-006': [
    {
      id: 'OP01-006-onPlay',
      trigger: 'onPlay',
      script: [
        {
          op: 'select',
          as: 'victim',
          from: { zone: 'field', owner: 'opponent', category: ['character'] },
          min: 0,
          max: 1,
          prompt: "Give up to 1 of your opponent's Characters −2000 power",
        },
        { op: 'addPower', target: { var: 'victim' }, value: -2000, duration: 'endOfTurn' },
      ],
    },
  ],

  // OP01-033 Izo
  // "[On Play] Rest up to 1 of your opponent's Characters with a cost of 4 or
  //  less."
  //
  // No orientation filter, deliberately. The printed text names a cost and
  // nothing else, so an already-rested Character is a legal choice and the
  // effect simply does nothing to it — `rest` skips a card already in that
  // orientation, and fewer than asked is a smaller number rather than a failed
  // effect (CR 8-4-4-1). Contrast `ST02-008`, whose official Q&A *does* require
  // an active DON!!; that ruling is about DON!! and `orientDon`'s by-quantity
  // shape, not a general rule about resting.
  'OP01-033': [
    {
      id: 'OP01-033-onPlay',
      trigger: 'onPlay',
      script: [
        {
          op: 'select',
          as: 'victim',
          from: { zone: 'field', owner: 'opponent', category: ['character'], costMax: 4 },
          min: 0,
          max: 1,
          prompt: "Rest up to 1 of your opponent's Characters with a cost of 4 or less",
        },
        { op: 'rest', target: { var: 'victim' } },
      ],
    },
  ],

  // OP01-048 Nekomamushi
  // "[On Play] Rest up to 1 of your opponent's Characters with a cost of 3 or
  //  less."
  //
  // Izo with a tighter cost gate. Written out rather than shared: the two are
  // the same shape but not the same effect, and a shared helper parameterised
  // by one number would hide that they are independent printed cards which can
  // errata apart.
  'OP01-048': [
    {
      id: 'OP01-048-onPlay',
      trigger: 'onPlay',
      script: [
        {
          op: 'select',
          as: 'victim',
          from: { zone: 'field', owner: 'opponent', category: ['character'], costMax: 3 },
          min: 0,
          max: 1,
          prompt: "Rest up to 1 of your opponent's Characters with a cost of 3 or less",
        },
        { op: 'rest', target: { var: 'victim' } },
      ],
    },
  ],

  // OP01-054 X.Drake
  // "[On Play] K.O. up to 1 of your opponent's rested Characters with a cost of
  //  4 or less."
  //
  // Here the orientation *is* printed, so it belongs in the selector rather
  // than being checked after the fact: a card the effect cannot legally hit
  // must never be offered as a candidate. That is the difference between this
  // and Izo above, and it is the printed text making it.
  'OP01-054': [
    {
      id: 'OP01-054-onPlay',
      trigger: 'onPlay',
      script: [
        {
          op: 'select',
          as: 'victim',
          from: {
            zone: 'field',
            owner: 'opponent',
            category: ['character'],
            orientation: 'rested',
            costMax: 4,
          },
          min: 0,
          max: 1,
          prompt: "K.O. up to 1 of your opponent's rested Characters with a cost of 4 or less",
        },
        { op: 'ko', target: { var: 'victim' } },
      ],
    },
  ],

  // OP01-017 Nico Robin
  // "[DON!! x1] [When Attacking] K.O. up to 1 of your opponent's Characters
  //  with 3000 power or less."
  //
  // `powerMax` reads the power a card has *now*, statics and attached DON!!
  // included (CR 2-6-3, and PR #9 which made the three condition sites agree).
  // So a 2000-power Character carrying one DON!! is 3000 and still a legal
  // target; carrying two it is 4000 and is not.
  //
  // This is the card that found the vanished-participant hole. Nothing about
  // the script changed to fix it — what changed is that the engine now ends the
  // battle when its target leaves the field (CR 7-1-1-4), instead of reaching
  // the Damage Step with a target in the trash. Robin can K.O. the very
  // Character she is attacking, because a rested Character is a legal attack
  // target (CR 7-1-1-2) and nothing stops her choosing it.
  'OP01-017': [
    {
      id: 'OP01-017-whenAttacking',
      trigger: 'whenAttacking',
      condition: { kind: 'donAttached', min: 1 },
      script: [
        {
          op: 'select',
          as: 'victim',
          from: { zone: 'field', owner: 'opponent', category: ['character'], powerMax: 3000 },
          min: 0,
          max: 1,
          prompt: "K.O. up to 1 of your opponent's Characters with 3000 power or less",
        },
        { op: 'ko', target: { var: 'victim' } },
      ],
    },
  ],

  // OP01-022 Brook
  // "[DON!! x1] [When Attacking] Give up to 2 of your opponent's Characters
  //  −2000 power during this turn."
  //
  // "Up to 2" is one select with `max: 2`, not two selects: the card asks for a
  // set of Characters in one breath, and two steps would let a player see the
  // first result before committing to the second. `addPower` loops over every
  // id the variable holds, so one instruction covers both.
  'OP01-022': [
    {
      id: 'OP01-022-whenAttacking',
      trigger: 'whenAttacking',
      condition: { kind: 'donAttached', min: 1 },
      script: [
        {
          op: 'select',
          as: 'victims',
          from: { zone: 'field', owner: 'opponent', category: ['character'] },
          min: 0,
          max: 2,
          prompt: "Give up to 2 of your opponent's Characters −2000 power",
        },
        { op: 'addPower', target: { var: 'victims' }, value: -2000, duration: 'endOfTurn' },
      ],
    },
  ],

  // OP01-035 Okiku
  // "[DON!! x1] [When Attacking] [Once Per Turn] Rest up to 1 of your
  //  opponent's Characters with a cost of 5 or less."
  //
  // The `[Once Per Turn]` is printed and load-bearing: a Character can be
  // attacked back, set active by another effect and attack again in one turn,
  // and without the flag this would fire each time.
  'OP01-035': [
    {
      id: 'OP01-035-whenAttacking',
      trigger: 'whenAttacking',
      condition: { kind: 'donAttached', min: 1 },
      oncePerTurn: true,
      script: [
        {
          op: 'select',
          as: 'victim',
          from: { zone: 'field', owner: 'opponent', category: ['character'], costMax: 5 },
          min: 0,
          max: 1,
          prompt: "Rest up to 1 of your opponent's Characters with a cost of 5 or less",
        },
        { op: 'rest', target: { var: 'victim' } },
      ],
    },
  ],

  // OP01-034 Inuarashi
  // "[DON!! x2] [When Attacking] Set up to 1 of your DON!! cards as active."
  //
  // No select, because DON!! are fungible: `orientDon` takes a player, an
  // orientation and a count, and never asks which one (CR 4-4-2 — a given DON!!
  // is neither active nor rested, so attached DON!! are not candidates at all).
  // The two DON!! this card needs attached to fire are therefore *not* among
  // the ones it can refresh, which is the printed behaviour and not an
  // accident of the op.
  //
  // "Up to 1" rides on `orientDon` itself: with no rested DON!! in the cost
  // area it turns none and emits nothing.
  'OP01-034': [
    {
      id: 'OP01-034-whenAttacking',
      trigger: 'whenAttacking',
      condition: { kind: 'donAttached', min: 2 },
      script: [{ op: 'orientDon', player: 'you', orientation: 'active', count: 1 }],
    },
  ],

  // OP01-052 Raizo
  // "[When Attacking] [Once Per Turn] If you have 2 or more rested Characters,
  //  draw 1 card."
  //
  // The attacker is rested *before* its own [When Attacking] fires
  // (`applyDeclareAttack` sets the orientation, then calls `fireTriggers`),
  // which is CR 7-1-1-1 declaring the attack and 8-4-1 resolving the trigger
  // afterwards. So Raizo counts itself, and needs only one *other* rested
  // Character. That is the printed behaviour and it is worth naming, because
  // reading the card alone suggests two Characters besides the attacker.
  //
  // No `[DON!! xN]` is printed on this one, so there is no `donAttached`.
  'OP01-052': [
    {
      id: 'OP01-052-whenAttacking',
      trigger: 'whenAttacking',
      oncePerTurn: true,
      condition: {
        kind: 'countCards',
        selector: {
          zone: 'field',
          owner: 'you',
          category: ['character'],
          orientation: 'rested',
        },
        min: 2,
      },
      script: [{ op: 'draw', player: 'you', count: 1 }],
    },
  ],

  /* ------------------------------------------------------------------------
   * OP-01, batch 2 — the Events.
   *
   * Seven cards covering three engine paths no OP-01 card had run before:
   * `mainEvent`, `counterEvent` (through `PLAY_COUNTER_EVENT`, CR 7-1-3-2-2)
   * and a life card's `trigger`. Five of the seven carry two halves, and the
   * halves differ in ways worth reading twice — most often in their duration.
   * ---------------------------------------------------------------------- */

  // OP01-027 Round Table
  // "[Main] Give up to 1 of your opponent's Characters −10000 power during this
  //  turn."
  //
  // A removal effect written as arithmetic: nothing in OP-01 has 10000 power,
  // so this reads as "K.O. anything" — except that it is *not* a K.O., and the
  // difference is visible. The Character stays on the field at negative power,
  // so an [On K.O.] never fires, a "K.O. up to 1" effect can still choose it,
  // and it comes back to full power at end of turn if it survives.
  'OP01-027': [
    { id: 'OP01-027-main', trigger: 'mainEvent', script: minusPower(10000, ['character']) },
  ],

  // OP01-056 Demon Face
  // "[Main] K.O. up to 2 of your opponent's rested Characters with a cost of 5
  //  or less."
  //
  // "Up to 2" is one select with `max: 2`, not two selects — the card asks for
  // a set in one breath (the Brook rule). `rested` is printed, so it belongs in
  // the selector: a player is never offered a move the card forbids.
  'OP01-056': [
    {
      id: 'OP01-056-main',
      trigger: 'mainEvent',
      script: [
        {
          op: 'select',
          as: 'victims',
          from: {
            zone: 'field',
            owner: 'opponent',
            category: ['character'],
            orientation: 'rested',
            costMax: 5,
          },
          min: 0,
          max: 2,
          prompt: "K.O. up to 2 of your opponent's rested Characters with a cost of 5 or less",
        },
        { op: 'ko', target: { var: 'victims' } },
      ],
    },
  ],

  // OP01-026 Gum-Gum Fire-Fist Pistol Red Hawk
  // "[Counter] Up to 1 of your Leader or Character cards gains +4000 power
  //  during this battle. Then, K.O. up to 1 of your opponent's Characters with
  //  4000 power or less."
  // "[Trigger] Give up to 1 of your opponent's Leader or Character cards −10000
  //  power during this turn."
  //
  // The two halves are different effects and share nothing, unlike OP01-028
  // below. Note the durations: the [Counter] boost is `endOfBattle`, the
  // [Trigger] penalty `endOfTurn`, exactly as each printed text says.
  //
  // **This card can end the battle it is defending.** The [Counter] resolves
  // during the Counter Step, and "your opponent's Characters" includes the
  // attacker — which is rested, at most 4000 power, and a legal choice. K.O.ing
  // it takes the battle to End of the Battle instead of the Damage Step
  // (CR 7-1-1-4 and its two repeats). The engine routes that since the
  // vanished-participant fix; before it, this card would have crashed the same
  // way OP01-017 did, one step later.
  'OP01-026': [
    {
      id: 'OP01-026-counter',
      trigger: 'counterEvent',
      script: [
        ...counterBoost(4000),
        {
          op: 'select',
          as: 'victim',
          from: { zone: 'field', owner: 'opponent', category: ['character'], powerMax: 4000 },
          min: 0,
          max: 1,
          prompt: "K.O. up to 1 of your opponent's Characters with 4000 power or less",
        },
        { op: 'ko', target: { var: 'victim' } },
      ],
    },
    {
      id: 'OP01-026-trigger',
      trigger: 'trigger',
      script: minusPower(10000, ['leader', 'character']),
    },
  ],

  // OP01-028 Green Star Rafflesia
  // "[Counter] Give up to 1 of your opponent's Leader or Character cards −2000
  //  power during this turn."
  // "[Trigger] Activate this card's [Counter] effect."
  //
  // The Jet Pistol shape: one list, two abilities, two ids. See `RAFFLESIA`.
  'OP01-028': [
    { id: 'OP01-028-counter', trigger: 'counterEvent', script: RAFFLESIA },
    { id: 'OP01-028-trigger', trigger: 'trigger', script: RAFFLESIA },
  ],

  // OP01-029 Radical Beam!!
  // "[Counter] Up to 1 of your Leader or Character cards gains +2000 power
  //  during this battle. Then, if you have 2 or less Life cards, that card
  //  gains an additional +2000 power."
  // "[Trigger] Up to 1 of your Leader or Character cards gains +1000 power
  //  during this turn."
  //
  // "That card" is the one already chosen, so the second grant reads the same
  // variable rather than opening a second selection — asking twice would let a
  // player see the first result before committing to the second, and would also
  // let the two halves land on different cards, which the text forbids.
  //
  // An empty first selection resolves the whole thing to nothing: `addPower`
  // loops over no targets twice. The `if` is still evaluated, which is harmless.
  'OP01-029': [
    {
      id: 'OP01-029-counter',
      trigger: 'counterEvent',
      script: [
        ...counterBoost(2000),
        {
          op: 'if',
          cond: { kind: 'lifeAtMost', player: 'you', value: 2 },
          then: [
            { op: 'addPower', target: { var: 'ally' }, value: 2000, duration: 'endOfBattle' },
          ],
        },
      ],
    },
    {
      id: 'OP01-029-trigger',
      trigger: 'trigger',
      script: [
        {
          op: 'select',
          as: 'ally',
          from: { zone: 'field', owner: 'you', category: ['leader', 'character'] },
          min: 0,
          max: 1,
          prompt: 'Give up to 1 of your Leader or Character cards +1000 power',
        },
        // `endOfTurn`, not `endOfBattle`: a [Trigger] resolves during damage,
        // and by then the battle is already closed. An `endOfBattle` modifier
        // granted here would expire at the *next* battle instead of this one —
        // which is the trap the Guard Point pair was written to avoid.
        { op: 'addPower', target: { var: 'ally' }, value: 1000, duration: 'endOfTurn' },
      ],
    },
  ],

  // OP01-057 Paradise Waterfall
  // "[Counter] Up to 1 of your Leader or Character cards gains +2000 power
  //  during this battle. Then, set up to 1 of your Characters as active."
  // "[Trigger] K.O. up to 1 of your opponent's rested Characters with a cost of
  //  4 or less."
  //
  // The [Trigger] can K.O. the card that just attacked — it is rested, because
  // attacking rested it (CR 7-1-1-1), and the player answering is the one being
  // damaged. That is safe rather than lucky: a life card's [Trigger] resolves
  // *inside* the Damage Step, and `resolveBattle` closes the battle before
  // applying its outcome, so there is no battle left to invalidate. Pinned by
  // `op01Events.test.ts`, including across both damage instances of a
  // [Double Attack].
  'OP01-057': [
    {
      id: 'OP01-057-counter',
      trigger: 'counterEvent',
      script: [
        ...counterBoost(2000),
        {
          op: 'select',
          as: 'waking',
          from: { zone: 'field', owner: 'you', category: ['character'] },
          min: 0,
          max: 1,
          prompt: 'Set up to 1 of your Characters as active',
        },
        { op: 'setActive', target: { var: 'waking' } },
      ],
    },
    {
      id: 'OP01-057-trigger',
      trigger: 'trigger',
      script: [
        {
          op: 'select',
          as: 'victim',
          from: {
            zone: 'field',
            owner: 'opponent',
            category: ['character'],
            orientation: 'rested',
            costMax: 4,
          },
          min: 0,
          max: 1,
          prompt: "K.O. up to 1 of your opponent's rested Characters with a cost of 4 or less",
        },
        { op: 'ko', target: { var: 'victim' } },
      ],
    },
  ],

  // OP01-058 Punk Gibson
  // "[Counter] Up to 1 of your Leader or Character cards gains +4000 power
  //  during this battle. Then, rest up to 1 of your opponent's Characters with
  //  a cost of 4 or less."
  // "[Trigger] Rest up to 1 of your opponent's Characters."
  //
  // The halves differ by more than a number: the [Counter] gates on cost and
  // the [Trigger] does not. Neither prints an orientation, so an already-rested
  // Character is a legal choice whose effect is nothing (the Izo rule,
  // CR 8-4-4-1) — which is why neither selector filters on it.
  'OP01-058': [
    {
      id: 'OP01-058-counter',
      trigger: 'counterEvent',
      script: [
        ...counterBoost(4000),
        {
          op: 'select',
          as: 'victim',
          from: { zone: 'field', owner: 'opponent', category: ['character'], costMax: 4 },
          min: 0,
          max: 1,
          prompt: "Rest up to 1 of your opponent's Characters with a cost of 4 or less",
        },
        { op: 'rest', target: { var: 'victim' } },
      ],
    },
    {
      id: 'OP01-058-trigger',
      trigger: 'trigger',
      script: [
        {
          op: 'select',
          as: 'victim',
          from: { zone: 'field', owner: 'opponent', category: ['character'] },
          min: 0,
          max: 1,
          prompt: "Rest up to 1 of your opponent's Characters",
        },
        { op: 'rest', target: { var: 'victim' } },
      ],
    },
  ],

  /* ------------------------------------------------------------------------
   * OP-01, batch 3 — activated abilities, statics, [On K.O.], [On Block],
   * and the blue/purple half of the set.
   *
   * Two things about costs run through this block:
   *
   * - **"You may" on an *activated* ability is not `optional`.** Activating is
   *   already the player's choice (`ACTIVATE_ABILITY`), so the flag would be
   *   the same question asked twice — the rule Thousand Sunny set.
   * - **"You may" on an *auto* ability is.** An `[On Play]`, `[On K.O.]` or
   *   `[On Block]` fires by itself, so "DON!! −N (You may return…)" can only be
   *   modelled as an opt-in (CR 8-1-2: where a word indicating choice is
   *   included, players may choose not to activate the effect). Every DON!! −N
   *   card below therefore carries `optional: true`, and the two activated ones
   *   carry none.
   * ---------------------------------------------------------------------- */

  // OP01-003 Monkey.D.Luffy (Leader)
  // "[Activate: Main] [Once Per Turn] ➃: Set up to 1 of your {Supernovas} or
  //  {Straw Hat Crew} type Character cards with a cost of 5 or less as active.
  //  It gains +1000 power during this turn."
  //
  // "It" is the card just chosen, so both ops read one variable. The cost is
  // four rested DON!!, which `canPayCosts` gates in `legalActions` — the
  // ability is not offered at all below four active DON!! in the cost area.
  'OP01-003': [
    {
      id: 'OP01-003-main',
      trigger: 'activateMain',
      oncePerTurn: true,
      cost: [{ kind: 'restDon', count: 4 }],
      script: [
        {
          op: 'select',
          as: 'waking',
          from: {
            zone: 'field',
            owner: 'you',
            category: ['character'],
            types: ['Supernovas', 'Straw Hat Crew'],
            costMax: 5,
          },
          min: 0,
          max: 1,
          prompt:
            'Set up to 1 of your {Supernovas} or {Straw Hat Crew} Character cards with a cost of 5 or less as active',
        },
        { op: 'setActive', target: { var: 'waking' } },
        { op: 'addPower', target: { var: 'waking' }, value: 1000, duration: 'endOfTurn' },
      ],
    },
  ],

  // OP01-020 Hyogoro
  // "[Activate: Main] You may rest this Character: Up to 1 of your Leader or
  //  Character cards gains +2000 power during this turn."
  //
  // `restSelf`, the ST01-017 cost. It prints no [Once Per Turn] and needs none:
  // a rested card cannot pay, and it wakes only in its controller's Refresh
  // Phase (CR 6-2-4).
  'OP01-020': [
    {
      id: 'OP01-020-main',
      trigger: 'activateMain',
      cost: [{ kind: 'restSelf' }],
      script: [
        {
          op: 'select',
          as: 'ally',
          from: { zone: 'field', owner: 'you', category: ['leader', 'character'] },
          min: 0,
          max: 1,
          prompt: 'Give up to 1 of your Leader or Character cards +2000 power',
        },
        { op: 'addPower', target: { var: 'ally' }, value: 2000, duration: 'endOfTurn' },
      ],
    },
  ],

  // OP01-068 Gecko Moria
  // "[Your Turn] This Character gains [Double Attack] if you have 5 or more
  //  cards in your hand."
  //
  // A keyword static rather than a power one, which is the shape `hasKeyword`
  // reads. It does **not** touch the declared OP06-002 divergence: that one is a
  // static whose own condition asks about *power*, and this asks about hand
  // size, which `countCards` answers without re-entering `getPower`.
  'OP01-068': [
    {
      id: 'OP01-068-static',
      trigger: 'static',
      condition: {
        kind: 'and',
        of: [
          { kind: 'isYourTurn' },
          { kind: 'countCards', selector: { zone: 'hand', owner: 'you' }, min: 5 },
        ],
      },
      affects: { self: true },
      grants: { keyword: 'doubleAttack' },
      script: [],
    },
  ],

  // OP01-070 Dracule Mihawk
  // "[On Play] Place up to 1 Character with a cost of 7 or less at the bottom
  //  of the owner's deck."
  //
  // "1 Character", not "1 of your opponent's": `owner: 'any'`. Mihawk costs 9
  // and so cannot bottom-deck itself, but the gate is the printed cost and not
  // an `excludeSelf` — writing the exclusion would be encoding a coincidence.
  'OP01-070': [
    {
      id: 'OP01-070-onPlay',
      trigger: 'onPlay',
      script: [
        {
          op: 'select',
          as: 'bottomed',
          from: { zone: 'field', owner: 'any', category: ['character'], costMax: 7 },
          min: 0,
          max: 1,
          prompt: "Place up to 1 Character with a cost of 7 or less at the bottom of the owner's deck",
        },
        { op: 'moveCard', target: { var: 'bottomed' }, to: { zone: 'deck' }, position: 'bottom' },
      ],
    },
  ],

  // OP01-078 Boa Hancock
  // "[Blocker]" — printed keyword.
  // "[DON!! x1] [When Attacking]/[On Block] Draw 1 card if you have 5 or less
  //  cards in your hand."
  //
  // One printed sentence, two triggers, one shared list — the same encoding as
  // ST01-015's two halves, and for the same reason: the card states one effect
  // reachable two ways, and two hand-written copies are two copies that drift.
  'OP01-078': [
    {
      id: 'OP01-078-whenAttacking',
      trigger: 'whenAttacking',
      condition: HANCOCK_CONDITION,
      script: HANCOCK_DRAW,
    },
    {
      id: 'OP01-078-onBlock',
      trigger: 'onBlock',
      condition: HANCOCK_CONDITION,
      script: HANCOCK_DRAW,
    },
  ],

  // OP01-079 Ms. All Sunday
  // "[Blocker]" — printed keyword.
  // "[On K.O.] If your Leader has the {Baroque Works} type, add up to 1 Event
  //  from your trash to your hand."
  //
  // The condition is checked when the ability fires, which is after this card
  // has already reached the trash (`leaveField` trashes, then wakes [On K.O.]).
  // That does not matter here — it asks about the Leader — but it is why the
  // selector says `category: ['event']`: this Character is in the same trash and
  // would otherwise be a candidate to add to hand.
  'OP01-079': [
    {
      id: 'OP01-079-onKO',
      trigger: 'onKO',
      condition: leaderHasType('Baroque Works'),
      script: [
        {
          op: 'select',
          as: 'recovered',
          from: { zone: 'trash', owner: 'you', category: ['event'] },
          min: 0,
          max: 1,
          prompt: 'Add up to 1 Event from your trash to your hand',
        },
        { op: 'moveCard', target: { var: 'recovered' }, to: { zone: 'hand' } },
      ],
    },
  ],

  // OP01-080 Miss Doublefinger(Zala)
  // "[On K.O.] Draw 1 card."
  //
  // The smallest ability in the set, and the one that makes a rule visible:
  // trashing a Character to make room for a sixth is **not** a K.O.
  // (`leaveField` passes `'trashedForRoom'`), so this does not draw then.
  // Pinned by `op01Batch3.test.ts` with this printed card, which is the upgrade
  // `sixthCharacter.test.ts` asked for in its own comment.
  'OP01-080': [
    { id: 'OP01-080-onKO', trigger: 'onKO', script: [{ op: 'draw', player: 'you', count: 1 }] },
  ],

  // OP01-086 Overheat
  // "[Counter] Up to 1 of your Leader or Character cards gains +4000 power
  //  during this battle. Then, return up to 1 active Character with a cost of 3
  //  or less to the owner's hand."
  // "[Trigger] Return up to 1 Character with a cost of 4 or less to the owner's
  //  hand."
  //
  // The [Counter] half prints **active**, which puts it in the selector — and
  // that is what stops this card ending its own battle. Both battle
  // participants are rested by then (the attacker by declaring, a blocker by
  // blocking), so neither is ever a candidate. The [Trigger] half prints no
  // orientation and could name the attacker, but it resolves after the battle
  // has already closed.
  'OP01-086': [
    {
      id: 'OP01-086-counter',
      trigger: 'counterEvent',
      script: [...counterBoost(4000), ...bounceByCost(3, 'active')],
    },
    { id: 'OP01-086-trigger', trigger: 'trigger', script: bounceByCost(4) },
  ],

  // OP01-089 Crescent Cutlass
  // "[Counter] If your Leader has the {The Seven Warlords of the Sea} type,
  //  return up to 1 Character with a cost of 5 or less to the owner's hand."
  //
  // No orientation printed and `owner: 'any'`, so this one **can** name a
  // battle participant — the attacker is a Character and is often within a
  // 5-cost gate. Returning it to hand is "moved areas" under CR 7-1-1-4, so the
  // battle ends without damage. Pinned.
  'OP01-089': [
    {
      id: 'OP01-089-counter',
      trigger: 'counterEvent',
      condition: leaderHasType('The Seven Warlords of the Sea'),
      script: bounceByCost(5),
    },
  ],

  // OP01-094 Kaido
  // "[On Play] DON!! −6: If your Leader has the {Animal Kingdom Pirates} type,
  //  K.O. all Characters other than this Character."
  //
  // No selection at all: "all Characters" is a selector ref, resolved once and
  // acted on. `excludeSelf` is the printed "other than this Character", and
  // `owner: 'any'` is the printed absence of a side — this wipes its own board
  // too, which is the whole cost of the card.
  'OP01-094': [
    {
      id: 'OP01-094-onPlay',
      trigger: 'onPlay',
      optional: true,
      cost: [{ kind: 'returnDon', count: 6 }],
      condition: leaderHasType('Animal Kingdom Pirates'),
      script: [
        {
          op: 'ko',
          target: {
            selector: { zone: 'field', owner: 'any', category: ['character'], excludeSelf: true },
          },
        },
      ],
    },
  ],

  // OP01-096 King
  // "[On Play] DON!! −2: K.O. up to 1 of your opponent's Characters with a cost
  //  of 3 or less and up to 1 of your opponent's Characters with a cost of 2 or
  //  less."
  //
  // **Two selections in one script**, the first card in the repo to do it. They
  // are two separate "up to 1"s joined by "and", not one "up to 2": the gates
  // differ, so a single selection could not express them. The two variables are
  // named apart because the second would otherwise overwrite the first before
  // its K.O. ran.
  //
  // The interpreter has supported this since Phase 2A — the cursor is a frame
  // stack, so it can suspend twice in one script — but nothing printed had ever
  // exercised it. The state *between* the two questions is a real, serializable
  // resting state, which `op01Batch3.test.ts` round-trips.
  'OP01-096': [
    {
      id: 'OP01-096-onPlay',
      trigger: 'onPlay',
      optional: true,
      cost: [{ kind: 'returnDon', count: 2 }],
      script: [...koOpponentByCost(3, 'firstVictim'), ...koOpponentByCost(2, 'secondVictim')],
    },
  ],

  // OP01-097 Queen
  // "[On Play] DON!! −1: This Character gains [Rush] during this turn. Then,
  //  give up to 1 of your opponent's Characters −2000 power during this turn."
  //
  // The Rush is granted to a card that was played this turn, which is the only
  // reason granting it means anything: it lifts exactly the summoning-sickness
  // restriction, and `legalActions` reads it through `hasKeyword`.
  'OP01-097': [
    {
      id: 'OP01-097-onPlay',
      trigger: 'onPlay',
      optional: true,
      cost: [{ kind: 'returnDon', count: 1 }],
      script: [
        { op: 'grantKeyword', target: { self: true }, keyword: 'rush', duration: 'endOfTurn' },
        ...minusPower(2000, ['character']),
      ],
    },
  ],

  // OP01-108 Hitokiri Kamazo
  // "[On K.O.] DON!! −1: K.O. up to 1 of your opponent's Characters with a cost
  //  of 5 or less."
  //
  // The cost is paid from the DON!! area, not from the source, so it is payable
  // even though the source is already in the trash by the time this fires —
  // `canPayCosts` only asks about the source for `trashSelf` and `restSelf`.
  'OP01-108': [
    {
      id: 'OP01-108-onKO',
      trigger: 'onKO',
      optional: true,
      cost: [{ kind: 'returnDon', count: 1 }],
      script: koOpponentByCost(5),
    },
  ],

  // OP01-111 Black Maria
  // "[Blocker]" — printed keyword.
  // "[On Block] DON!! −1: This Character gains +1000 power during this turn."
  //
  // `endOfTurn`, as printed — not `endOfBattle`. The card says "during this
  // turn" and a blocker that survives keeps the buff into the next battle of
  // the same turn, which is a real difference and the reason the two durations
  // are never assumed from context.
  'OP01-111': [
    {
      id: 'OP01-111-onBlock',
      trigger: 'onBlock',
      optional: true,
      cost: [{ kind: 'returnDon', count: 1 }],
      script: [
        { op: 'addPower', target: { self: true }, value: 1000, duration: 'endOfTurn' },
      ],
    },
  ],

  // OP01-117 Sheep's Horn
  // "[Main] DON!! −1: Rest up to 1 of your opponent's Characters with a cost of
  //  6 or less."
  //
  // No orientation printed, so an already-rested Character is a legal choice
  // whose effect is nothing — the Izo rule (CR 8-4-4-1).
  'OP01-117': [
    {
      id: 'OP01-117-main',
      trigger: 'mainEvent',
      optional: true,
      cost: [{ kind: 'returnDon', count: 1 }],
      script: [
        {
          op: 'select',
          as: 'victim',
          from: { zone: 'field', owner: 'opponent', category: ['character'], costMax: 6 },
          min: 0,
          max: 1,
          prompt: "Rest up to 1 of your opponent's Characters with a cost of 6 or less",
        },
        { op: 'rest', target: { var: 'victim' } },
      ],
    },
  ],

  /* ------------------------------------------------------------------------
   * OP-01, batch 4 — the residue.
   *
   * The four pile-A cards batches 1 to 3 left behind. Nothing blocked them:
   * they were cut because batch 3's group came to nineteen against a target of
   * about twelve, and these are the four whose *shapes* that batch already
   * covered. With them, **pile A is complete** — every OP-01 card the DSL can
   * express is written.
   * ---------------------------------------------------------------------- */

  // OP01-001 Roronoa Zoro (Leader)
  // "[DON!! x1] [Your Turn] All of your Characters gain +1000 power."
  //
  // The first `static` in this repo with a **selector** audience rather than
  // `{self: true}`: it buffs cards other than its source. Every static written
  // before it — ST01-004, ST01-013, ST02-003, OP01-032, OP01-068 — names only
  // itself, which is why `packages/client/tests/continuousBadge.test.ts` pins
  // the client's self-attribution fallback and says it becomes visible the day
  // one is not. This is that day, for OP-01; the starter decks the client reads
  // are unaffected.
  //
  // "All of your Characters" excludes the Leader, so the selector is
  // `category: ['character']` and not `['leader', 'character']` — the Leader
  // carrying the ability does not buff itself.
  'OP01-001': [
    {
      id: 'OP01-001-static',
      trigger: 'static',
      condition: {
        kind: 'and',
        of: [{ kind: 'donAttached', min: 1 }, { kind: 'isYourTurn' }],
      },
      affects: { selector: { zone: 'field', owner: 'you', category: ['character'] } },
      grants: { power: 1000 },
      script: [],
    },
  ],

  // OP01-007 Caribou
  // "[On K.O.] K.O. up to 1 of your opponent's Characters with 4000 power or
  //  less."
  //
  // `powerMax` reads the power a card has now (CR 2-6-3), as everywhere else.
  //
  // Worth knowing where this can fire from. The usual route is losing a battle,
  // and by then `resolveBattle` has already closed the battle, so there is
  // nothing to invalidate. The other route is an **effect** K.O.ing Caribou
  // mid-battle — `OP01-017` Nico Robin's [When Attacking] does exactly that —
  // and then Caribou's own K.O. can name the attacker. The battle ends at
  // CR 7-1-1-4 rather than reaching the Damage Step, which the engine has
  // routed since the vanished-participant fix. `op01Batch4.test.ts` pins the
  // whole chain, because it is three printed cards deep and nobody would
  // reconstruct it from this comment alone.
  'OP01-007': [
    {
      id: 'OP01-007-onKO',
      trigger: 'onKO',
      script: [
        {
          op: 'select',
          as: 'victim',
          from: { zone: 'field', owner: 'opponent', category: ['character'], powerMax: 4000 },
          min: 0,
          max: 1,
          prompt: "K.O. up to 1 of your opponent's Characters with 4000 power or less",
        },
        { op: 'ko', target: { var: 'victim' } },
      ],
    },
  ],

  // OP01-032 Ashura Doji
  // "[DON!! x1] If your opponent has 2 or more rested Characters, this
  //  Character gains +2000 power."
  //
  // A power `static` whose condition asks about the **opponent's board**, not
  // about its own power — so it does not touch the declared OP06-002 divergence
  // (a static whose own condition reads power sees the without-statics value,
  // because that is where the recursion guard lives). Nothing in OP-01 pile A
  // does; this is the last of the five statics and the check is now closed.
  //
  // No `[Your Turn]` is printed, so there is no `isYourTurn`: this one is live
  // on both turns, which is exactly what makes it a blocker deterrent.
  'OP01-032': [
    {
      id: 'OP01-032-static',
      trigger: 'static',
      condition: {
        kind: 'and',
        of: [
          { kind: 'donAttached', min: 1 },
          {
            kind: 'countCards',
            selector: {
              zone: 'field',
              owner: 'opponent',
              category: ['character'],
              orientation: 'rested',
            },
            min: 2,
          },
        ],
      },
      affects: { self: true },
      grants: { power: 2000 },
      script: [],
    },
  ],

  // OP01-039 Killer
  // "[Blocker]" — printed keyword.
  // "[DON!! x1] [On Block] If you have 3 or more Characters, draw 1 card."
  //
  // Killer counts itself: it is on the field, and blocking does not remove it.
  // So two others are enough, which reading the card alone does not suggest —
  // the same shape as `OP01-052` Raizo counting itself among rested Characters.
  //
  // It draws and touches nothing on the board, so unlike `OP01-007` above it
  // can never end the battle it is blocking in.
  'OP01-039': [
    {
      id: 'OP01-039-onBlock',
      trigger: 'onBlock',
      condition: {
        kind: 'and',
        of: [
          { kind: 'donAttached', min: 1 },
          {
            kind: 'countCards',
            selector: { zone: 'field', owner: 'you', category: ['character'] },
            min: 3,
          },
        ],
      },
      script: [{ op: 'draw', player: 'you', count: 1 }],
    },
  ],
/* ------------------------------------------------------------------------
   * batch 5 — the cards a *chosen* payment frees
   *
   * "Trash 1 card from your hand:" is a price whose card the player picks, and
   * until this batch the engine picked for them. The rules put that choice
   * inside the payment step — CR 8-4-1-3 is "determine the activation costs and
   * pay all activation costs", while 8-4-1-2 only specifies which effect is
   * being activated — so `Cost.discardHand` now opens a `PendingChoice` and the
   * payment resumes from it.
   *
   * Two of the four filter that choice by type, which is why the cost carries a
   * `CardFilter` and not just a count: "trash 1 {Land of Wano} type card" is a
   * different price from "trash 1 card", and `canPayCosts` counts matching cards
   * so an ability nothing in hand can pay is never offered.
   *
   * Where "You may" sits is the same reading the DON!! −N cards took above:
   * on an **activated** effect the player has already opted in by sending the
   * action, so no `optional`; on an **auto** effect that fires by itself, the
   * "you may" is the only decline the player gets and it becomes `optional: true`
   * (CR 8-1-2, CR 8-3-1-4).
   * --------------------------------------------------------------------- */

  // ST02-001 Eustass"Captain"Kid (Leader)
  // "[Activate: Main] [Once Per Turn] ③ (You may rest the specified number of
  //  DON!! cards in your cost area.) You may trash 1 card from your hand:
  //  Set this Leader as active."
  //
  // Two costs on one ability, and the first card in this repo to have them. The
  // order is the card's, not the player's: CR 8-3-1-1 carries out the actions of
  // one activation cost "in order starting from the text closest to the top", so
  // three DON!! rest and only then is the discard chosen. A player who could pay
  // one half and not the other never gets asked at all — CR 8-3-1-3 makes a
  // partly payable cost unpayable, which `canPayCosts` reports and
  // `legalActions` therefore honours.
  //
  // Neither "You may" takes `optional`. Both are activation costs of an
  // [Activate: Main] effect, and the decline CR 8-3-1-4 describes is the player
  // simply not sending ACTIVATE_ABILITY.
  //
  // Setting the Leader active is what makes it worth paying for: a Leader rests
  // to declare an attack (CR 7-1-1-1) and comes back only in its controller's
  // Refresh Phase (CR 6-2), so this buys a second Leader attack in one turn.
  // Nothing in the script cares whether the Leader is currently rested — `rest`
  // and `setActive` both no-op on a card already in the target orientation.
  'ST02-001': [
    {
      id: 'ST02-001-main',
      trigger: 'activateMain',
      oncePerTurn: true,
      cost: [
        { kind: 'restDon', count: 3 },
        { kind: 'discardHand', count: 1 },
      ],
      script: [{ op: 'setActive', target: { self: true } }],
    },
  ],

  // OP01-031 Kouzuki Oden (Leader)
  // "[Activate: Main] [Once Per Turn] You can trash 1 {Land of Wano} type card
  //  from your hand: Set up to 2 of your DON!! cards as active."
  //
  // The first *filtered* payment written here. "You can trash" is the same
  // optional-cost wording as "You may" (CR 8-3-1-4) and needs no `optional` for
  // the same reason ST02-001 does not.
  //
  // "Set up to 2 of your DON!! cards as active" is `orientDon`, which counts a
  // budget of DON!! *changed* rather than looked at: an already-active DON!! is
  // not something to set active, and attached DON!! are neither active nor
  // rested (CR 4-4-2) so they are not candidates at all. Two rested DON!! in the
  // cost area become two active ones; one becomes one; none is not a failure
  // (CR 8-4-4-1).
  //
  // The card is mono-green, so its deck cannot borrow another colour's {Land of
  // Wano} cards — the fixture that manifests it is mono-green for the same
  // reason `OP01_R_ZORO` is mono-red.
  'OP01-031': [
    {
      id: 'OP01-031-main',
      trigger: 'activateMain',
      oncePerTurn: true,
      cost: [{ kind: 'discardHand', count: 1, filter: { types: ['Land of Wano'] } }],
      script: [{ op: 'orientDon', player: 'you', orientation: 'active', count: 2 }],
    },
  ],

  // OP01-059 BE-BENG!!
  // "[Main] You may trash 1 {Land of Wano} type card from your hand: Set up to 1
  //  of your {Land of Wano} type Character cards with a cost of 3 or less as
  //  active."
  //
  // {Land of Wano} twice over, and the two are not the same filter: the first
  // names cards in hand and is the *price*, the second names Characters on the
  // field and is the *effect*. They are written in different places for that
  // reason — a `CardFilter` on the cost, a `Selector` in the script.
  //
  // The Event is trashed before its effect fires, so it can never pay for
  // itself even though it is a {Land of Wano} card. That is the physical rule
  // the reducer already implements and not something this card had to arrange.
  'OP01-059': [
    {
      id: 'OP01-059-main',
      trigger: 'mainEvent',
      cost: [{ kind: 'discardHand', count: 1, filter: { types: ['Land of Wano'] } }],
      script: [
        {
          op: 'select',
          as: 'waking',
          from: {
            zone: 'field',
            owner: 'you',
            category: ['character'],
            types: ['Land of Wano'],
            costMax: 3,
          },
          min: 0,
          max: 1,
          prompt:
            'Set up to 1 of your {Land of Wano} type Character cards with a cost of 3 or less as active',
        },
        { op: 'setActive', target: { var: 'waking' } },
      ],
    },
  ],

  // OP01-064 Alvida
  // "[DON!! x1] [When Attacking] You may trash 1 card from your hand: Return up
  //  to 1 of your opponent's Characters with a cost of 3 or less to the owner's
  //  hand."
  //
  // The only one of the four that is an **auto** effect, and therefore the only
  // one that takes `optional: true`. `[When Attacking]` fires by itself; without
  // the flag the "you may" would have nowhere to live and the cost would be
  // charged to a player who never agreed to it (CR 8-1-2).
  //
  // The order that follows is worth naming: the opt-in is asked first, the
  // discard is chosen second, and the Character to bounce third. Three
  // questions, one attack — and `canPayCosts` runs before any of them, so a
  // player with an empty hand is never asked the first.
  //
  // Returning a Character can remove a battle participant. This one cannot end
  // its own battle: it fires from the attacker's side and reaches only the
  // opponent's Characters, and the defender of a `[When Attacking]` trigger is
  // whatever the attack was declared against — which may be exactly the
  // Character it bounces. CR 7-1-1-4 covers that, and `endBattleIfParticipantLeft`
  // is the code that does.
  'OP01-064': [
    {
      id: 'OP01-064-whenAttacking',
      trigger: 'whenAttacking',
      optional: true,
      condition: { kind: 'donAttached', min: 1 },
      cost: [{ kind: 'discardHand', count: 1 }],
      script: [
        {
          op: 'select',
          as: 'bounced',
          from: { zone: 'field', owner: 'opponent', category: ['character'], costMax: 3 },
          min: 0,
          max: 1,
          prompt: "Return up to 1 of your opponent's Characters with a cost of 3 or less to hand",
        },
        { op: 'moveCard', target: { var: 'bounced' }, to: { zone: 'hand' } },
      ],
    },
  ],
/* ------------------------------------------------------------------------
   * batch 6 — the cards that put other cards on the field
   *
   * The largest gap the OP-01 inventory measured, and the one it recommended
   * second overall. Nothing in the DSL could put a card in the Character area:
   * `moveCard` moves between zones and `ZoneRef` has no `field` member, which was
   * the visible half. The other half is that "play this card" is a *routine* —
   * an `[On Play]` to fire (official Q&A: you must activate it whenever
   * possible), a summoning-sickness stamp (CR 3-7-4), an orientation (CR 3-7-5),
   * and a 6th-Character sacrifice the controller has to be *asked* about
   * (CR 3-7-6-1). The op is `play`, and it shares `enterCharacterArea` with the
   * `PLAY_CARD` action rather than reimplementing any of it.
   *
   * **No cost is paid.** CR 6-5-3-1's "you can pay the cost and play a Character
   * card" is the Main Phase action; CR 3-7-3 calls the bare placing of a card in
   * the Character area "playing" it. Card effects use the second sense — and two
   * of the cards below settle it on their own, because `OP01-014`'s `[On Block]`
   * and `ST02-017`'s `[Trigger]` both fire on the *opponent's* turn, when the
   * defender's cost area is empty. See `rules.playFromEffectPaysCost`.
   *
   * Six of these are the whole text of their card: "[Trigger] Play this card."
   * They are the cheapest cards in the set to write and were the most expensive
   * to reach.
   * --------------------------------------------------------------------- */

  // ST02-005 Killer
  // "[On Play] K.O. up to 1 of your opponent's rested Characters with a cost of
  //  3 or less."
  // "[Trigger] Play this card."
  //
  // Withheld since the starter inventory with `ST02-017`, for exactly this gap:
  // the `[On Play]` half always fitted and the `[Trigger]` half did not, and a
  // card whose printed text is half implemented is worse than one that is
  // honestly missing.
  //
  // The two halves compose in one direction only, and it is the interesting one:
  // the `[Trigger]` plays this card, which fires its own `[On Play]`. An effect
  // nesting inside an effect, queued underneath the running one, so the
  // `[Trigger]` script finishes before the K.O. resolves.
  'ST02-005': [
    {
      id: 'ST02-005-onPlay',
      trigger: 'onPlay',
      script: [
        {
          op: 'select',
          as: 'victim',
          from: {
            zone: 'field',
            owner: 'opponent',
            category: ['character'],
            orientation: 'rested',
            costMax: 3,
          },
          min: 0,
          max: 1,
          prompt: "K.O. up to 1 of your opponent's rested Characters with a cost of 3 or less",
        },
        { op: 'ko', target: { var: 'victim' } },
      ],
    },
    {
      id: 'ST02-005-trigger',
      trigger: 'trigger',
      script: [{ op: 'play', target: { self: true } }],
    },
  ],

  // ST02-017 Straw Sword
  // "[Main] Rest up to 1 of your opponent's Characters."
  // "[Trigger] Play up to 1 {Supernovas} type card with a cost of 2 or less from
  //  your hand."
  //
  // **A scoped narrowing, declared.** The printed text says "card", and the
  // selector below says Character card. ST-02 holds three {Supernovas} Events at
  // cost 2 or less, so the word is not idle — but "playing" an Event means
  // *activating* it (CR 6-5-3-1 lists "play a Character card or Stage card, or
  // activate an Event card marked with [Main]"), and this `[Trigger]` resolves
  // inside a Damage Step, where CR 6-5-3-1's Main Phase permission does not
  // reach. All three of those Events are `[Counter]` or `[Main]`, so none of
  // them could be activated here anyway: no reachable position tells the two
  // readings apart.
  'ST02-017': [
    {
      id: 'ST02-017-main',
      trigger: 'mainEvent',
      script: [
        {
          op: 'select',
          as: 'target',
          from: { zone: 'field', owner: 'opponent', category: ['character'] },
          min: 0,
          max: 1,
          prompt: "Rest up to 1 of your opponent's Characters",
        },
        { op: 'rest', target: { var: 'target' } },
      ],
    },
    {
      id: 'ST02-017-trigger',
      trigger: 'trigger',
      script: [
        {
          op: 'select',
          as: 'recruit',
          from: {
            zone: 'hand',
            owner: 'you',
            category: ['character'],
            types: ['Supernovas'],
            costMax: 2,
          },
          min: 0,
          max: 1,
          prompt: 'Play up to 1 {Supernovas} type Character card with a cost of 2 or less',
        },
        { op: 'play', target: { var: 'recruit' } },
      ],
    },
  ],

  /* -- the six whose whole text is "[Trigger] Play this card." -------------
   *
   * `{ self: true }` is the target, and it names a card that is *in hand*: the
   * engine adds a damaged life card to the hand and offers its `[Trigger]` from
   * there. CR 10-1-5-3 has the card "not belong in any area" during its own
   * `[Trigger]` and be trashed afterwards "unless otherwise specified" — a
   * different route to the same board, since "play this card" is precisely the
   * "otherwise specified", and a declined `[Trigger]` leaves the card in hand
   * under both readings. The divergence is declared in the engine README and is
   * not observable here.
   *
   * `OP01-009` Carrot prints this line in `effectText` rather than `triggerText`,
   * which is a transcription quirk of the source data and not a rules
   * difference; the ability is a `trigger` either way.
   * --------------------------------------------------------------------- */

  'OP01-009': [
    { id: 'OP01-009-trigger', trigger: 'trigger', script: [{ op: 'play', target: { self: true } }] },
  ],

  'OP01-037': [
    { id: 'OP01-037-trigger', trigger: 'trigger', script: [{ op: 'play', target: { self: true } }] },
  ],

  'OP01-082': [
    { id: 'OP01-082-trigger', trigger: 'trigger', script: [{ op: 'play', target: { self: true } }] },
  ],

  'OP01-104': [
    { id: 'OP01-104-trigger', trigger: 'trigger', script: [{ op: 'play', target: { self: true } }] },
  ],

  // OP01-071 Jinbe
  // "[On Play] Place up to 1 Character with a cost of 3 or less at the bottom of
  //  the owner's deck."
  // "[Trigger] Play this card."
  //
  // "1 Character", not "1 of your opponent's Characters": `owner: 'any'`, and the
  // controller may bottom-deck their own. `moveCard` sends it to the *owner's*
  // deck, which is the physical rule and the reason `ZoneRef` carries no owner.
  //
  // Played by its own `[Trigger]`, its `[On Play]` fires from the field and can
  // reach the board it just joined — it costs 4, so it can never bottom-deck
  // itself.
  'OP01-071': [
    {
      id: 'OP01-071-onPlay',
      trigger: 'onPlay',
      script: [
        {
          op: 'select',
          as: 'sunk',
          from: { zone: 'field', owner: 'any', category: ['character'], costMax: 3 },
          min: 0,
          max: 1,
          prompt: "Place up to 1 Character with a cost of 3 or less at the bottom of the owner's deck",
        },
        { op: 'moveCard', target: { var: 'sunk' }, to: { zone: 'deck' }, position: 'bottom' },
      ],
    },
    { id: 'OP01-071-trigger', trigger: 'trigger', script: [{ op: 'play', target: { self: true } }] },
  ],

  // OP01-014 Jinbe
  // "[Blocker]" — printed keyword.
  // "[DON!! x1] [On Block] Play up to 1 red Character card with a cost of 2 or
  //  less from your hand."
  //
  // An **auto** effect, so no "you may" is printed and none is written: it must
  // activate and resolve to the extent possible (CR 8-1-2). The "up to 1" is the
  // only choice, and choosing nothing is legal (CR 8-4-4-1).
  //
  // It fires on the *opponent's* turn, which is what makes the payment question
  // moot rather than theoretical: a defender who has just blocked has an empty
  // cost area, so a version of this card that charged 2 DON!! would be a card
  // that never worked.
  'OP01-014': [
    {
      id: 'OP01-014-onBlock',
      trigger: 'onBlock',
      condition: { kind: 'donAttached', min: 1 },
      script: [
        {
          op: 'select',
          as: 'recruit',
          from: {
            zone: 'hand',
            owner: 'you',
            category: ['character'],
            colors: ['red'],
            costMax: 2,
          },
          min: 0,
          max: 1,
          prompt: 'Play up to 1 red Character card with a cost of 2 or less from your hand',
        },
        { op: 'play', target: { var: 'recruit' } },
      ],
    },
  ],

  // OP01-087 Officer Agents
  // "[Counter] Play up to 1 {Baroque Works} type Character card with a cost of 3
  //  or less from your hand."
  // "[Trigger] Activate this card's [Counter] effect."
  //
  // The Jet Pistol pattern: the `[Trigger]` does not restate the effect, it
  // points at it, so one shared list is the only encoding where the two cannot
  // drift apart.
  'OP01-087': [
    { id: 'OP01-087-counter', trigger: 'counterEvent', script: OFFICER_AGENTS },
    { id: 'OP01-087-trigger', trigger: 'trigger', script: OFFICER_AGENTS },
  ],
// OP01-060 Donquixote Doflamingo (Leader)
  // "[DON!! x2] [When Attacking] ➀ (You may rest the specified number of DON!!
  //  cards in your cost area.): Reveal 1 card from the top of your deck. If that
  //  card is a {The Seven Warlords of the Sea} type Character card with a cost of
  //  4 or less, you may play that card rested."
  //
  // The only card in this batch that plays from somewhere other than the hand,
  // and the only one that plays a card **rested** — CR 3-7-5 places cards active
  // "unless otherwise specified", and this is the printed card that specifies
  // otherwise. It is therefore also the only one whose new Character is not
  // summoning-sick in any way that matters: it cannot attack this turn either
  // way (CR 3-7-4), and it arrives already unable to block.
  //
  // Three decisions in a row, which is what makes it the most expensive card
  // here to reach: the optional cost (`optional: true`, CR 8-1-2 — an auto effect
  // whose "you may" has nowhere else to live), then the reveal, then a second
  // "you may" on the play itself, which is `confirm` + `varTrue`.
  //
  // "If that card is..." is a predicate about a card the script already holds,
  // which the DSL cannot say. It does not need to: `reveal` moves nothing, so the
  // card is still on top of the deck and a second `deckTop` selector with
  // `count: 1` names the same card. The inventory called this out before any of
  // it was built.
  'OP01-060': [
    {
      id: 'OP01-060-whenAttacking',
      trigger: 'whenAttacking',
      optional: true,
      condition: { kind: 'donAttached', min: 2 },
      cost: [{ kind: 'restDon', count: 1 }],
      script: [
        { op: 'reveal', as: 'top', from: { zone: 'deckTop', owner: 'you', count: 1 } },
        {
          op: 'if',
          cond: {
            kind: 'countCards',
            selector: {
              zone: 'deckTop',
              owner: 'you',
              count: 1,
              category: ['character'],
              types: ['The Seven Warlords of the Sea'],
              costMax: 4,
            },
            min: 1,
          },
          then: [
            {
              op: 'confirm',
              as: 'takeIt',
              prompt: 'Play the revealed {The Seven Warlords of the Sea} Character rested?',
            },
            {
              op: 'if',
              cond: { kind: 'varTrue', name: 'takeIt' },
              then: [{ op: 'play', target: { var: 'top' }, rested: true }],
            },
          ],
        },
      ],
    },
  ],
/* ------------------------------------------------------------------------
   * batch 7 — the two cards that watch what somebody else did
   *
   * Backlog A, not backlog B. Neither was a DSL gap: the vocabulary was not
   * short a word, the **engine did not have the event**. `applyPlayCard` told
   * the Event about itself and nothing else, so a card reading "when your
   * opponent activates an Event" could be written perfectly and never run.
   *
   * That is the distinction `docs/trigger-reachability.md` draws and the reason
   * these outrank their size: a backlog-B gap limits which cards can be written
   * and every written card still plays correctly; a backlog-A gap means the
   * cards sit in the deck and **the games do not resemble the game**. An OP-01
   * Crocodile deck built before this ran a Leader whose printed ability never
   * fired, and the simulation reported results from a game nobody was playing.
   *
   * Both markers are **prose**. No bracket search finds them, which is exactly
   * how they survived the eleven-trigger reachability sweep.
   * --------------------------------------------------------------------- */

  // OP01-004 Usopp
  // "[DON!! x1] [Your Turn] [Once Per Turn] Draw 1 card when your opponent
  //  activates an Event."
  //
  // `whenOpponentActivatesEvent` fires on the field of whoever did *not* use the
  // card, so the side is settled before the ability is consulted — the same
  // shape `whenOpponentAttacks` has, and the reason "your opponent" needs no
  // condition here.
  //
  // `[Your Turn]` on a card that watches the opponent is not the contradiction
  // it looks like: a `[Counter]` Event is activated by the defender during the
  // *attacker's* turn (CR 7-1-3-2-2), so an Usopp on the attacking side is
  // exactly who this fires for. CR 8-5-2's card activation covers both routes.
  'OP01-004': [
    {
      id: 'OP01-004-onEnemyEvent',
      trigger: 'whenOpponentActivatesEvent',
      oncePerTurn: true,
      condition: {
        kind: 'and',
        of: [{ kind: 'donAttached', min: 1 }, { kind: 'isYourTurn' }],
      },
      script: [{ op: 'draw', player: 'you', count: 1 }],
    },
  ],

  // OP01-062 Crocodile (Leader)
  // "[DON!! x1] When you activate an Event, you may draw 1 card if you have 4 or
  //  less cards in your hand and haven't drawn a card using this Leader's effect
  //  during this turn."
  //
  // Three clauses, three existing pieces. "Haven't drawn a card using this
  // Leader's effect during this turn" is `oncePerTurn` — the card spells out
  // what the keyword means rather than printing the keyword. "4 or less cards in
  // your hand" is `countCards` on the hand with `max: 4`, and it is checked
  // **before** the draw, so a hand of exactly 4 becomes 5.
  //
  // "You may" on an auto effect takes `optional: true` (CR 8-1-2): nothing else
  // asks the controller, and without it the once-per-turn use would be spent by
  // an ability they never agreed to.
  //
  // It is the Leader of `OP01_BP_CROCODILE`, which has dealt every blue/purple
  // manifestation game since batch 3 — with its printed ability doing nothing.
  'OP01-062': [
    {
      id: 'OP01-062-onOwnEvent',
      trigger: 'whenActivatingEvent',
      optional: true,
      oncePerTurn: true,
      condition: {
        kind: 'and',
        of: [
          { kind: 'donAttached', min: 1 },
          { kind: 'countCards', selector: { zone: 'hand', owner: 'you' }, max: 4 },
        ],
      },
      script: [{ op: 'draw', player: 'you', count: 1 }],
    },
  ],

  // -------------------------------------------------------------------------
  // Batch 10 — add DON!! from the DON!! deck. Eight cards, all purple.
  //
  // The row check found eight touched and eight freed, against an inventory
  // that recorded five: `OP01-061` was waiting on a trigger PR #30 built,
  // `OP01-101` on a chosen-discard **cost** batch 5 built, and `OP01-106` on
  // put-into-play batch 6 built. The row aged three PRs and nobody re-read it.
  //
  // Every one of the eight is `addDon` with a count of 1 and an orientation the
  // printed text names. That is the whole family: see the op's comment for the
  // 141-card, fifteen-phrasing probe behind that claim.
  // -------------------------------------------------------------------------

  // OP01-061 Kaido (Leader)
  // "[DON!! x1] [Your Turn] [Once Per Turn] When your opponent's Character is
  //  K.O.'d, add up to 1 DON!! card from your DON!! deck and set it as active."
  //
  // **The card that needed two batches and got them in the right order.** The
  // inventory listed it under "a trigger that does not exist" — a Leader
  // watching the *other* player's board — which PR #30 built as
  // `whenOpponentCharacterKOd`. This batch is the other half.
  //
  // `[Your Turn]` is `isYourTurn`, and it matters here rather than being
  // decoration: the trigger fires on either player's turn, so without it Kaido
  // would bank DON!! off the opponent's own trades.
  'OP01-061': [
    {
      id: 'OP01-061-onEnemyKO',
      trigger: 'whenOpponentCharacterKOd',
      oncePerTurn: true,
      condition: {
        kind: 'and',
        of: [{ kind: 'donAttached', min: 1 }, { kind: 'isYourTurn' }],
      },
      script: [{ op: 'addDon', count: 1, orientation: 'active' }],
    },
  ],

  // OP01-093 Ulti
  // "[On Play] ① (You may rest the specified number of DON!! cards in your cost
  //  area.): Add up to 1 DON!! card from your DON!! deck and rest it."
  //
  // Rest one to add one rested: no net DON!! this turn, and one more from the
  // Refresh Phase onward. The cost is `restDon 1` — the ① symbol — and CR
  // 8-3-1-5 has the player select which DON!! pays, which is a selection over
  // fungible cards and therefore a count, exactly as `payDonCost` does it.
  'OP01-093': [
    {
      id: 'OP01-093-onPlay',
      trigger: 'onPlay',
      cost: [{ kind: 'restDon', count: 1 }],
      script: [{ op: 'addDon', count: 1, orientation: 'rested' }],
    },
  ],

  // OP01-101 Sasaki
  // "[DON!! x1] [When Attacking] You may trash 1 card from your hand: Add up to
  //  1 DON!! card from your DON!! deck and rest it."
  //
  // The inventory blocked this on "a chosen discard". That gap had two halves
  // and batch 5 bought the one this card needs: `discardHand` is a **cost** the
  // player picks a card for. The open half is the *instruction* — "your opponent
  // trashes 1 card from their hand" — which this card does not ask for.
  'OP01-101': [
    {
      id: 'OP01-101-whenAttacking',
      trigger: 'whenAttacking',
      condition: { kind: 'donAttached', min: 1 },
      cost: [{ kind: 'discardHand', count: 1 }],
      script: [{ op: 'addDon', count: 1, orientation: 'rested' }],
    },
  ],

  // OP01-106 Basil Hawkins
  // "[On Play] Add up to 1 DON!! card from your DON!! deck and rest it."
  // "[Trigger] Play this card."
  //
  // Blocked on put-into-play until batch 6, which is why the inventory kept it
  // off the freed column. Not to be confused with `ST02-010` Basil Hawkins,
  // which needs a ruling rather than a capability and is still out.
  'OP01-106': [
    {
      id: 'OP01-106-onPlay',
      trigger: 'onPlay',
      script: [{ op: 'addDon', count: 1, orientation: 'rested' }],
    },
    {
      id: 'OP01-106-trigger',
      trigger: 'trigger',
      script: [{ op: 'play', target: { self: true } }],
    },
  ],

  // OP01-113 Holedem
  // "[On K.O.] Add up to 1 DON!! card from your DON!! deck and rest it."
  //
  // The plainest card in the batch: one trigger, one instruction, no gate.
  'OP01-113': [
    {
      id: 'OP01-113-onKO',
      trigger: 'onKO',
      script: [{ op: 'addDon', count: 1, orientation: 'rested' }],
    },
  ],

  // OP01-115 Elephant's Marchoo
  // "[Main] K.O. up to 1 of your opponent's Characters with a cost of 2 or
  //  less, then add up to 1 DON!! card from your DON!! deck and set it as
  //  active."
  // "[Trigger] Activate this card's [Main] effect."
  //
  // "Then" is sequence and not condition (CR 4-10-2: a failed "then" clause does
  // not stop what follows), so the DON!! arrives whether or not the K.O. found
  // a target — which is what the "up to 1" on the front half already implied.
  'OP01-115': [
    { id: 'OP01-115-main', trigger: 'mainEvent', script: MARCHOO },
    { id: 'OP01-115-trigger', trigger: 'trigger', script: MARCHOO },
  ],

  // OP01-118 Ulti-Mortar
  // "[Counter] DON!! −2: Up to 1 of your Leader or Character cards gains +2000
  //  power during this battle. Then, draw 1 card."
  // "[Trigger] Add up to 1 DON!! card from your DON!! deck and set it as
  //  active."
  //
  // The two halves are unrelated effects rather than one pointed at twice, so
  // they are written twice. `DON!! −2` is `returnDon`, which is the *inverse*
  // movement of this batch's op — the card spends two to draw and gains one
  // back only on the other route.
  'OP01-118': [
    {
      id: 'OP01-118-counter',
      trigger: 'counterEvent',
      cost: [{ kind: 'returnDon', count: 2 }],
      script: [
        {
          op: 'select',
          as: 'ally',
          from: { zone: 'field', owner: 'you', category: ['leader', 'character'] },
          min: 0,
          max: 1,
          prompt: 'Up to 1 of your Leader or Character cards gains +2000 power',
        },
        { op: 'addPower', target: { var: 'ally' }, value: 2000, duration: 'endOfBattle' },
        { op: 'draw', player: 'you', count: 1 },
      ],
    },
    {
      id: 'OP01-118-trigger',
      trigger: 'trigger',
      script: [{ op: 'addDon', count: 1, orientation: 'active' }],
    },
  ],

  // OP01-119 Thunder Bagua
  // "[Counter] Up to 1 of your Leader or Character cards gains +4000 power
  //  during this battle. Then, if you have 2 or less Life cards, add up to 1
  //  DON!! card from your DON!! deck and rest it."
  // "[Trigger] Add up to 1 DON!! card from your DON!! deck and set it as
  //  active."
  //
  // The only card in the batch that adds DON!! in **both** orientations, one per
  // half, which is what makes it the one worth reading twice: the `[Counter]`
  // rests what it adds and is gated on being behind on Life, the `[Trigger]`
  // sets it active and is gated on nothing.
  'OP01-119': [
    {
      id: 'OP01-119-counter',
      trigger: 'counterEvent',
      script: [
        {
          op: 'select',
          as: 'ally',
          from: { zone: 'field', owner: 'you', category: ['leader', 'character'] },
          min: 0,
          max: 1,
          prompt: 'Up to 1 of your Leader or Character cards gains +4000 power',
        },
        { op: 'addPower', target: { var: 'ally' }, value: 4000, duration: 'endOfBattle' },
        {
          op: 'if',
          cond: { kind: 'lifeAtMost', player: 'you', value: 2 },
          then: [{ op: 'addDon', count: 1, orientation: 'rested' }],
        },
      ],
    },
    {
      id: 'OP01-119-trigger',
      trigger: 'trigger',
      script: [{ op: 'addDon', count: 1, orientation: 'active' }],
    },
  ],

  // -------------------------------------------------------------------------
  // Batch 9 — look at the top of the deck, keep one, bury the rest in order.
  //
  // Four cards print one sentence with one word changed, and `lookKeepBury`
  // above is that sentence written once. The fifth, `OP01-116`, plays what it
  // finds instead of taking it to hand and so writes its own script.
  // -------------------------------------------------------------------------

  // ST02-007 Jewelry Bonney
  // "[Activate: Main] ➀ You may rest this Character: Look at 5 cards from the
  //  top of your deck; reveal up to 1 {Supernovas} type card and add it to your
  //  hand. Then, place the rest at the bottom of your deck in any order."
  //
  // **The card this whole mechanism was named after.** It has been blocked
  // since the original starter inventory, which listed three walls: the
  // rest-the-source cost (gone in PR #15), `orderCards` and a way to name "the
  // rest" (both gone here). It is the last starter card the two inventories
  // carried as honestly missing.
  //
  // ➀ is `restDon 1` and "You may rest this Character" is `restSelf`, in that
  // printed order — CR 8-3-1-1 pays a cost list "starting from the text closest
  // to the top", and the order is the card's.
  'ST02-007': [
    {
      id: 'ST02-007-main',
      trigger: 'activateMain',
      cost: [{ kind: 'restDon', count: 1 }, { kind: 'restSelf' }],
      script: lookKeepBury(5, ['Supernovas'], 'Reveal up to 1 {Supernovas} type card'),
    },
  ],

  // OP01-041 Kouzuki Momonosuke
  // "[Activate: Main] ➀ You may rest this Character: Look at 5 cards from the
  //  top of your deck; reveal up to 1 {Land of Wano} type card and add it to
  //  your hand. Then, place the rest at the bottom of your deck in any order."
  //
  // Bonney with one type changed, down to the cost list.
  'OP01-041': [
    {
      id: 'OP01-041-main',
      trigger: 'activateMain',
      cost: [{ kind: 'restDon', count: 1 }, { kind: 'restSelf' }],
      script: lookKeepBury(5, ['Land of Wano'], 'Reveal up to 1 {Land of Wano} type card'),
    },
  ],

  // OP01-030 In Two Years!! At the Sabaody Archipelago!!
  // "[Main] Look at 5 cards from the top of your deck; reveal up to 1 {Straw
  //  Hat Crew} type Character card and add it to your hand. Then, place the
  //  rest at the bottom of your deck in any order."
  // "[Trigger] Activate this card's [Main] effect."
  //
  // The `[Trigger]` points at the `[Main]` rather than restating it, so the two
  // abilities share one instruction list — `ST01-015`'s pattern, and the only
  // encoding where the halves cannot drift apart.
  'OP01-030': [
    { id: 'OP01-030-main', trigger: 'mainEvent', script: SABAODY },
    { id: 'OP01-030-trigger', trigger: 'trigger', script: SABAODY },
  ],

  // OP01-084 Mr.2.Bon.Kurei(Bentham)
  // "[DON!! x1] [When Attacking] Look at 5 cards from the top of your deck;
  //  reveal up to 1 {Baroque Works} type Event card and add it to your hand.
  //  Then, place the rest at the bottom of your deck in any order."
  //
  // The only one of the four that filters on a category as well as a type, and
  // the only one behind a `[DON!! xN]` gate.
  'OP01-084': [
    {
      id: 'OP01-084-whenAttacking',
      trigger: 'whenAttacking',
      condition: { kind: 'donAttached', min: 1 },
      script: lookKeepBury(
        5,
        ['Baroque Works'],
        'Reveal up to 1 {Baroque Works} type Event card',
        ['event'],
      ),
    },
  ],

  // OP01-116 Artificial Devil Fruit SMILE
  // "[Main] Look at 5 cards from the top of your deck; play up to 1 {SMILE}
  //  type Character card with a cost of 3 or less. Then, place the rest at the
  //  bottom of your deck in any order."
  // "[Trigger] Activate this card's [Main] effect."
  //
  // The fifth card, and the one that needed two gaps rather than one. It
  // **plays** what it finds instead of taking it to hand, and it plays it from
  // the *deck* — which batch 6 built and `OP01-060` Doflamingo already walks.
  // The inventory listed it under both gaps and it stayed blocked; put-into-play
  // landed first, so this batch is the second half.
  //
  // `select` then `play` rather than `play` straight off the selector: the
  // printed "up to 1" is the player's choice of *which* and *whether*, and a
  // bare `Ref` would have the engine take the first match. The card played is
  // then out of the deck, and "the rest" is the four the `minus` did not remove.
  'OP01-116': [
    { id: 'OP01-116-main', trigger: 'mainEvent', script: SMILE },
    { id: 'OP01-116-trigger', trigger: 'trigger', script: SMILE },
  ],

  // -------------------------------------------------------------------------
  // Batch 8 — modifiable legality. Six cards, five printed shapes.
  //
  // The starter inventory's advice was "do not design it from ST01-012 alone —
  // that is the easy one", and these are what checked it. The unconditional
  // ban, the ban predicated on the candidate's power, the ban tied to a card
  // you chose that outlives its battle, and the permission that widens the
  // attack target set: four shapes, one `setLegality`, no special cases. The
  // fifth — K.O. immunity in battle — is built and reachable and has no printed
  // card here, because both OP-01 cards that print it want something else as
  // well (an attribute filter, a name reference). `ABIL-030` pins it instead,
  // and `docs/op01-inventory.md` says why it is not a card.
  // -------------------------------------------------------------------------

  // ST01-012 Monkey.D.Luffy
  // "[Rush]"
  // "[DON!! x2] [When Attacking] Your opponent cannot activate [Blocker] during
  //  this battle."
  //
  // The simplest of the five and the one that would have led the design astray.
  // No predicate on the candidate, no card to hang on, no life past the battle:
  // a rule about a *side*, for one battle. `[Rush]` is printed and needs nothing
  // written.
  //
  // What it forbids is the **activation** and nothing wider. CR 10-1-4-1
  // defines [Blocker] as a keyword effect "allowing you to activate it by
  // resting this card during the Block Step", and the game words the wider
  // restriction differently: the Q&A for "cannot be rested" stops both the
  // actions that require resting *and* being rested by another card's effect.
  // Two phrasings, two restrictions; this is the narrow one, so an effect that
  // rests the opponent's Blocker for some other reason is untouched.
  'ST01-012': [
    {
      id: 'ST01-012-whenAttacking',
      trigger: 'whenAttacking',
      condition: { kind: 'donAttached', min: 2 },
      script: [
        {
          op: 'setLegality',
          effect: 'forbid',
          subject: { player: 'opponent' },
          clause: { question: 'activateBlocker' },
          duration: 'endOfBattle',
        },
      ],
    },
  ],

  // ST01-002 Usopp
  // "[DON!! x2] [When Attacking] Your opponent cannot activate a [Blocker]
  //  Character that has 5000 or more power during this battle."
  // "[Trigger] Play this card."
  //
  // The same ban with a predicate on the candidate, and the predicate is the
  // interesting half: `powerMin` is read through the effective lens, so the
  // question is asked of the power the Blocker has **at the moment it tries to
  // block**. A 4000-power Blocker standing under somebody else's continuous
  // +1000 is a 5000-power Blocker and falls under the ban; take the continuous
  // away and it blocks. That is CR 2-6-3 read the only way this engine has ever
  // read it, and PR #9's semantics applied one building over.
  //
  // `keyword: 'blocker'` is in the predicate because the card prints it — "a
  // [Blocker] Character" is an adjective on the candidate here, where
  // ST01-012's "[Blocker]" names the effect being activated. Redundant against
  // the question, exact against the text, and correct either way.
  //
  // The `[Trigger]` waited four batches on put-into-play (PR #29) and this ban
  // on batch 8. Neither half was ever written alone.
  'ST01-002': [
    {
      id: 'ST01-002-whenAttacking',
      trigger: 'whenAttacking',
      condition: { kind: 'donAttached', min: 2 },
      script: [
        {
          op: 'setLegality',
          effect: 'forbid',
          subject: { player: 'opponent', match: { keyword: 'blocker', powerMin: 5000 } },
          clause: { question: 'activateBlocker' },
          duration: 'endOfBattle',
        },
      ],
    },
    {
      id: 'ST01-002-trigger',
      trigger: 'trigger',
      script: [{ op: 'play', target: { self: true } }],
    },
  ],

  // OP01-120 Shanks
  // "[Rush]"
  // "[When Attacking] Your opponent cannot activate a [Blocker] Character that
  //  has 2000 or less power during this battle."
  //
  // ST01-002's shape with the inequality turned over and no `[DON!! xN]` gate.
  // `docs/op01-inventory.md` listed it as also blocked by a printed-keyword
  // filter; re-checked before this batch, that was a misreading of its own row.
  // The keyword is a property of the candidate, `CardPredicate` carries it, and
  // it was never a second gap.
  'OP01-120': [
    {
      id: 'OP01-120-whenAttacking',
      trigger: 'whenAttacking',
      script: [
        {
          op: 'setLegality',
          effect: 'forbid',
          subject: { player: 'opponent', match: { keyword: 'blocker', powerMax: 2000 } },
          clause: { question: 'activateBlocker' },
          duration: 'endOfBattle',
        },
      ],
    },
  ],

  // ST01-016 Diable Jambe
  // "[Main] Select up to 1 of your {Straw Hat Crew} type Leader or Character
  //  cards. Your opponent cannot activate [Blocker] if that Leader or Character
  //  attacks during this turn."
  // "[Trigger] K.O. up to 1 of your opponent's [Blocker] Characters with a cost
  //  of 3 or less."
  //
  // **The card the design had to be cut for.** Its ban is written during the
  // Main Phase, when there is no battle at all; it must sit inert through every
  // other card's attack; it must apply to an attack the chosen card declares
  // minutes later; and it must expire with the turn whether that attack ever
  // came or not. A prohibition modelled as a property of a battle could not do
  // any of that, which is why `whileAttacker` is a field on the rule and the
  // rule lives in the state.
  //
  // "Up to 1" answered with nothing writes no rule: a ban waiting on a card
  // nobody chose can never apply, and rule 1 of the interpreter makes that a
  // no-op rather than a failure. If the chosen card later leaves the field the
  // rule goes with it — CR 3-1-6 makes the card that comes back a different
  // card, and CR 10-2-13-4 applies exactly that reading to a card that returns.
  //
  // The `[Trigger]` is the printed-keyword filter, and it arrived as one field
  // on `CardPredicate` rather than as a mechanism: `keyword` is asked of
  // `hasKeyword`, so a Character that *gained* [Blocker] is a [Blocker]
  // Character here, which is the doctrine that function has enforced since it
  // was written.
  'ST01-016': [
    {
      id: 'ST01-016-main',
      trigger: 'mainEvent',
      script: [
        {
          op: 'select',
          as: 'chosen',
          from: {
            zone: 'field',
            owner: 'you',
            category: ['leader', 'character'],
            types: ['Straw Hat Crew'],
          },
          min: 0,
          max: 1,
          prompt: 'Select up to 1 of your {Straw Hat Crew} Leader or Character cards',
        },
        {
          op: 'setLegality',
          effect: 'forbid',
          subject: { player: 'opponent' },
          clause: { question: 'activateBlocker' },
          duration: 'endOfTurn',
          whileAttacker: { var: 'chosen' },
        },
      ],
    },
    {
      id: 'ST01-016-trigger',
      trigger: 'trigger',
      script: [
        {
          op: 'select',
          as: 'victim',
          from: {
            zone: 'field',
            owner: 'opponent',
            category: ['character'],
            keyword: 'blocker',
            costMax: 3,
          },
          min: 0,
          max: 1,
          prompt: "K.O. up to 1 of your opponent's [Blocker] Characters with a cost of 3 or less",
        },
        { op: 'ko', target: { var: 'victim' } },
      ],
    },
  ],

  // OP01-021 Franky
  // "[DON!! x1] This Character can also attack your opponent's active
  //  Characters."
  //
  // The reframing, printed. This is not a prohibition and it is not a second
  // mechanism: it is the same rule pointed the other way, widening CR 7-1-1-2's
  // "the opponent's Leader card or 1 of their **rested** Character cards" for
  // one card and no other.
  //
  // A `static`, because `[DON!! x1]` is a condition re-read every time the
  // question is asked and not a duration (CR 8-1-3-3 against 8-1-4-2). Take the
  // DON!! off and the permission is gone the same instant, with nothing to
  // clean up — the whole reason continuous effects write nothing to the state.
  //
  // Attacking an active Character changes nothing else about the battle: the
  // target is not rested by being attacked (no rule in CR 7-1 does that), the
  // Block Step still happens, and the Damage Step still K.O.s a loser
  // (CR 7-1-4-1-2). Only the target set moved.
  'OP01-021': [
    {
      id: 'OP01-021-static',
      trigger: 'static',
      condition: { kind: 'donAttached', min: 1 },
      script: [],
      affects: { self: true },
      grants: {
        legality: {
          effect: 'allow',
          clause: { question: 'attack', target: { orientation: 'active' } },
        },
      },
    },
  ],

  // OP01-112 Page One
  // "[Activate: Main] [Once Per Turn] DON!! −1: This Character can also attack
  //  your opponent's active Characters during this turn."
  //
  // Franky's permission bought rather than owned, and the pair is what proves
  // the mechanism has one shape and not two: the same clause, written by a
  // script with a duration instead of read off a static. `DON!! −1` is
  // `returnDon`, which has existed since PR #11, and the `[Once Per Turn]` is
  // printed so it is written.
  //
  // The subject is `{ cards: { self: true } }` rather than a side: the
  // permission is this Character's, and a rule naming a card by identity dies
  // with it if it leaves the field (CR 3-1-6).
  'OP01-112': [
    {
      id: 'OP01-112-main',
      trigger: 'activateMain',
      oncePerTurn: true,
      cost: [{ kind: 'returnDon', count: 1 }],
      script: [
        {
          op: 'setLegality',
          effect: 'allow',
          subject: { cards: { self: true } },
          clause: { question: 'attack', target: { orientation: 'active' } },
          duration: 'endOfTurn',
        },
      ],
    },
  ],

  /* ------------------------------------------------------------------------
   * The starter-completion batch.
   *
   * Two cards, and between them they close the last two capability rows either
   * inventory carried: a duration that outlives the turn it was written in, and
   * a condition about the source's own orientation. The third card of the batch,
   * `ST02-010` Basil Hawkins, is **not here** — see the ruling in
   * `docs/starter-card-inventory.md`.
   * ---------------------------------------------------------------------- */

  // OP01-085 Mr.3(Galdino)
  // "[On Play] If your Leader has the {Baroque Works} type, select up to 1 of
  //  your opponent's Characters with a cost of 4 or less. The selected
  //  Character cannot attack until the end of your opponent's next turn."
  //
  // The card PR #31 could write every part of except the clock. Its prohibition
  // is `setLegality` with the `attack` question and no `target` predicate — the
  // subject cannot attack at all, rather than cannot attack some particular
  // card — and that half has existed since that PR. What did not exist was a
  // duration that survives the turn it is written in.
  //
  // **The gap was structural, not cosmetic.** An `endOfTurn` rule aimed at an
  // opponent's Character expires in the End Phase of *this* turn (CR 6-6-1-2),
  // which is before that Character has had a turn in which to attack. Written
  // with the old duration the card would have been legal, silent and useless;
  // `endOfOpponentNextTurn` is what makes the printed sentence mean anything.
  //
  // `subject: { cards: { var: 'pinned' } }` names the card by identity, so the
  // rule dies with it if it leaves the field (CR 3-1-6) — the same reading
  // `OP01-112` uses, and the reason the "up to 1" answered with nothing writes
  // no rule at all.
  'OP01-085': [
    {
      id: 'OP01-085-onPlay',
      trigger: 'onPlay',
      condition: leaderHasType('Baroque Works'),
      script: [
        {
          op: 'select',
          as: 'pinned',
          from: { zone: 'field', owner: 'opponent', category: ['character'], costMax: 4 },
          min: 0,
          max: 1,
          prompt: "Select up to 1 of your opponent's Characters with a cost of 4 or less",
        },
        {
          op: 'setLegality',
          effect: 'forbid',
          subject: { cards: { var: 'pinned' } },
          clause: { question: 'attack' },
          duration: 'endOfOpponentNextTurn',
        },
      ],
    },
  ],

  // ST02-014 X.Drake
  // "[DON!! x1] [Your Turn] If this Character is rested, your {Supernovas} or
  //  {Navy} type Leaders and Characters gain +1000 power."
  //
  // **A permanent effect, not a trigger, and that is the whole of the timing
  // question.** CR 8-1-3-3-1 puts in this category every effect that "based on
  // the card text, cannot be classified as auto, activate, or replacement
  // effects", and this card carries no activation-timing marker at all — no
  // `[On Play]`, no `[When Attacking]`, nothing from CR 8-1-3-1-1's list. So it
  // is read continuously by `getPower`, and its three conditions are re-asked
  // every time the question is put (CR 8-1-3-3-2: "Some permanent effects
  // require the fulfillment of conditions for their effect to be valid").
  //
  // That is why the orientation condition is not trivially constant. Had this
  // been `[When Attacking]`, CR 7-1-1-1 rests the attacker *as part of*
  // declaring and CR 7-1-1-3 activates the trigger after — so an attacking
  // X.Drake would always have been rested and the clause would have said
  // nothing. As a permanent effect the same fact reads the other way round: the
  // attack is what *switches the buff on*, mid-battle, for every Supernovas or
  // Navy card including the one that is attacking.
  //
  // Three conditions and all three are printed: `[DON!! x1]`, `[Your Turn]` and
  // the orientation clause. `[Your Turn]` is a condition rather than a timing
  // (CR 8-3-2-4, CR 10-2-11-1: "a condition that is satisfied during your
  // turn"), so it belongs here beside the other two and not in a trigger name.
  //
  // `affects` includes the Leader, because the text says "Leaders and
  // Characters", and does not use `excludeSelf`: X.Drake is a {Supernovas} card
  // and buffs itself when the clause is open.
  'ST02-014': [
    {
      id: 'ST02-014-static',
      trigger: 'static',
      condition: {
        kind: 'and',
        of: [
          { kind: 'donAttached', min: 1 },
          { kind: 'isYourTurn' },
          { kind: 'selfOrientation', orientation: 'rested' },
        ],
      },
      script: [],
      affects: {
        selector: {
          zone: 'field',
          owner: 'you',
          category: ['leader', 'character'],
          types: ['Supernovas', 'Navy'],
        },
      },
      grants: { power: 1000 },
    },
  ],
});

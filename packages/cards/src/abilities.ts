import type { Ability, CardId, Condition, Instruction } from '@optcg/engine';

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
 * Scope of this file today: **50 cards** — the 15 starter cards whose printed
 * abilities the DSL can express, plus **all 35** of OP-01 pile A. It
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
 * - `ST02-005` and `ST02-017` — one printed half each fits the DSL today and
 *   the other needs a card *put into play*. A card whose printed text is half
 *   implemented is worse than one that is honestly missing.
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
});

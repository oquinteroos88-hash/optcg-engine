import type { Ability, CardId, Instruction } from '@optcg/engine';

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
 * Scope of this file today: **24 cards** — the 15 starter cards whose printed
 * abilities the DSL can express, plus the first batch of 9 from OP-01. It
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
    ...SET_ONE_DON_ACTIVE,
  ];
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
});

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
 * Scope of this file today: the seven cards `docs/starter-card-inventory.md`
 * put in pile A — the ones the DSL expresses as it stands. Two of the seven
 * (`ST01-006`, `ST02-004`) are absent on purpose: their whole printed text is
 * the `[Blocker]` reminder, and a printed keyword is already a rule the engine
 * applies from `CardDefinition.keywords`. Writing an ability for them would be
 * writing the same rule twice.
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

export const STARTER_ABILITIES: Readonly<Record<CardId, readonly Ability[]>> = Object.freeze({
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
});

import type { Ability } from '../abilities/dsl.js';
import type { CardDefinition } from '../registry.js';
import { registerCardSet } from '../registry.js';

/**
 * The ABIL set: synthetic cards whose only purpose is to exercise the effect
 * system.
 *
 * Between them these cards cover every `op`, every `Trigger`, every `Cost`,
 * every `Condition` kind and all four keywords, plus the shapes most likely to
 * be implemented wrong: an `if` nested inside a `forEach`, a `oncePerTurn`, an
 * `optional`, a continuous effect, and a KO that wakes an `[On K.O.]` on the
 * card it just killed.
 *
 * Registered through the public registry exactly like the TEST set. The default
 * decks do **not** include it, so a browser game still never opens a choice.
 */

function character(
  cardId: string,
  name: string,
  cost: number,
  power: number,
  counter: number | null,
  extra: Partial<CardDefinition> = {},
): CardDefinition {
  return {
    cardId,
    name,
    category: 'character',
    color: 'blue',
    cost,
    power,
    counter,
    life: 0,
    keywords: [],
    types: ['Crew'],
    ...extra,
  };
}

export const ABIL_CARDS: CardDefinition[] = [
  {
    cardId: 'ABIL-L01',
    name: 'Ability Leader',
    category: 'leader',
    color: 'blue',
    cost: 0,
    power: 5000,
    counter: null,
    life: 5,
    keywords: [],
    types: ['Crew'],
  },

  // --- select / ko / optional -------------------------------------------
  character('ABIL-001', 'Optional Assassin', 1, 2000, 1000, {
    abilities: [
      {
        id: 'ABIL-001-onPlay',
        trigger: 'onPlay',
        optional: true,
        script: [
          {
            op: 'select',
            as: 'victim',
            from: { zone: 'field', owner: 'opponent', category: ['character'] },
            min: 1,
            max: 1,
            prompt: 'K.O. one of your opponent characters',
          },
          { op: 'ko', target: { var: 'victim' } },
        ],
      },
    ],
  }),

  // --- draw / discard ----------------------------------------------------
  character('ABIL-002', 'Scavenger', 2, 2000, 1000, {
    abilities: [
      {
        id: 'ABIL-002-onPlay',
        trigger: 'onPlay',
        script: [
          { op: 'draw', player: 'you', count: 1 },
          { op: 'discard', player: 'you', count: 1 },
        ],
      },
    ],
  }),

  // --- continuous power --------------------------------------------------
  character('ABIL-003', 'Standard Bearer', 2, 3000, 1000, {
    abilities: [
      {
        id: 'ABIL-003-static',
        trigger: 'static',
        script: [],
        affects: { zone: 'field', owner: 'you', category: ['character'], excludeSelf: true },
        grants: { power: 1000 },
      },
    ],
  }),

  // --- continuous keyword ------------------------------------------------
  character('ABIL-004', 'Shield Caller', 2, 2000, 2000, {
    abilities: [
      {
        id: 'ABIL-004-static',
        trigger: 'static',
        script: [],
        affects: { zone: 'field', owner: 'you', category: ['character'], costMax: 2, excludeSelf: true },
        grants: { keyword: 'blocker' },
      },
    ],
  }),

  // --- printed keywords --------------------------------------------------
  character('ABIL-005', 'Rusher', 3, 4000, 1000, { keywords: ['Rush'] }),
  character('ABIL-006', 'Twin Striker', 4, 5000, null, { keywords: ['Double Attack'] }),
  character('ABIL-007', 'Banisher', 5, 6000, null, { keywords: ['Banish'] }),
  character('ABIL-008', 'Wall', 2, 2000, 1000, { keywords: ['Blocker'] }),

  // --- activateMain / oncePerTurn / restDon / donAttached / addPower ------
  character('ABIL-009', 'Focused Duelist', 3, 3000, 1000, {
    abilities: [
      {
        id: 'ABIL-009-main',
        trigger: 'activateMain',
        oncePerTurn: true,
        condition: { kind: 'donAttached', min: 1 },
        cost: [{ kind: 'restDon', count: 1 }],
        script: [{ op: 'addPower', target: { self: true }, value: 2000, duration: 'endOfTurn' }],
      },
    ],
  }),

  // --- returnDon / isYourTurn / rest / setActive --------------------------
  character('ABIL-010', 'Tactician', 3, 3000, 1000, {
    abilities: [
      {
        id: 'ABIL-010-main',
        trigger: 'activateMain',
        condition: { kind: 'isYourTurn' },
        cost: [{ kind: 'returnDon', count: 1 }],
        script: [
          {
            op: 'select',
            as: 'foe',
            from: { zone: 'field', owner: 'opponent', category: ['character'], orientation: 'active' },
            min: 1,
            max: 1,
            prompt: 'Rest one opponent character',
          },
          { op: 'rest', target: { var: 'foe' } },
          { op: 'setActive', target: { self: true } },
        ],
      },
    ],
  }),

  // --- onKO -------------------------------------------------------------
  character('ABIL-011', 'Vengeful Scout', 2, 2000, 1000, {
    abilities: [
      {
        id: 'ABIL-011-onKO',
        trigger: 'onKO',
        script: [{ op: 'draw', player: 'you', count: 1 }],
      },
    ],
  }),

  // --- selector ref + trigger chain (this KO wakes ABIL-011's [On K.O.]) --
  character('ABIL-012', 'Purge', 3, 4000, null, {
    abilities: [
      {
        id: 'ABIL-012-onPlay',
        trigger: 'onPlay',
        script: [
          {
            op: 'ko',
            target: {
              selector: { zone: 'field', owner: 'opponent', category: ['character'], costMax: 2 },
            },
          },
        ],
      },
    ],
  }),

  // --- whenAttacking: if nested inside forEach ---------------------------
  character('ABIL-013', 'Rallying Cry', 2, 2000, 1000, {
    abilities: [
      {
        id: 'ABIL-013-whenAttacking',
        trigger: 'whenAttacking',
        script: [
          {
            op: 'forEach',
            in: { selector: { zone: 'field', owner: 'you', category: ['character'] } },
            do: [
              {
                op: 'if',
                cond: { kind: 'countCards', selector: { zone: 'field', owner: 'you', category: ['character'] }, min: 2 },
                then: [{ op: 'addPower', target: { var: 'it' }, value: 1000, duration: 'endOfBattle' }],
                else: [{ op: 'addPower', target: { var: 'it' }, value: 2000, duration: 'endOfBattle' }],
              },
            ],
          },
        ],
      },
    ],
  }),

  // --- whenOpponentAttacks / confirm / varTrue ---------------------------
  character('ABIL-014', 'Hesitant Guard', 2, 2000, 1000, {
    abilities: [
      {
        id: 'ABIL-014-whenOpponentAttacks',
        trigger: 'whenOpponentAttacks',
        script: [
          { op: 'confirm', as: 'brace', prompt: 'Brace for the attack?' },
          {
            op: 'if',
            cond: { kind: 'varTrue', name: 'brace' },
            then: [{ op: 'addPower', target: { self: true }, value: 2000, duration: 'endOfBattle' }],
          },
        ],
      },
    ],
  }),

  // --- endOfTurn ---------------------------------------------------------
  character('ABIL-015', 'Night Watch', 3, 3000, 1000, {
    abilities: [
      {
        id: 'ABIL-015-endOfTurn',
        trigger: 'endOfTurn',
        script: [
          {
            op: 'setActive',
            target: {
              selector: { zone: 'field', owner: 'you', category: ['character'], orientation: 'rested' },
            },
          },
        ],
      },
    ],
  }),

  // --- counterEvent / battle ref -----------------------------------------
  {
    cardId: 'ABIL-016',
    name: 'Desperate Parry',
    category: 'event',
    color: 'blue',
    cost: 1,
    power: 0,
    counter: 1000,
    life: 0,
    keywords: [],
    types: ['Tactic'],
    abilities: [
      {
        id: 'ABIL-016-counter',
        trigger: 'counterEvent',
        script: [
          { op: 'addPower', target: { battle: 'target' }, value: 2000, duration: 'endOfBattle' },
        ],
      },
    ],
  },

  // --- mainEvent / reveal / moveCard -------------------------------------
  {
    cardId: 'ABIL-017',
    name: 'Survey',
    category: 'event',
    color: 'blue',
    cost: 2,
    power: 0,
    counter: null,
    life: 0,
    keywords: [],
    types: ['Tactic'],
    abilities: [
      {
        id: 'ABIL-017-main',
        trigger: 'mainEvent',
        script: [
          { op: 'reveal', as: 'top', from: { zone: 'deckTop', owner: 'you', count: 3 } },
          { op: 'moveCard', target: { var: 'top' }, to: { zone: 'deck' }, position: 'bottom' },
        ],
      },
    ],
  },

  // --- giveDon -----------------------------------------------------------
  character('ABIL-018', 'Quartermaster', 2, 2000, 1000, {
    abilities: [
      {
        id: 'ABIL-018-onPlay',
        trigger: 'onPlay',
        script: [{ op: 'giveDon', target: { self: true }, count: 1 }],
      },
    ],
  }),

  // --- trashSelf cost ----------------------------------------------------
  character('ABIL-019', 'Martyr', 3, 3000, 1000, {
    abilities: [
      {
        id: 'ABIL-019-main',
        trigger: 'activateMain',
        cost: [{ kind: 'trashSelf' }],
        script: [{ op: 'draw', player: 'you', count: 1 }],
      },
    ],
  }),

  // --- discardHand cost / and / or / lifeAtMost / countCards -------------
  character('ABIL-020', 'Gambler', 4, 4000, null, {
    abilities: [
      {
        id: 'ABIL-020-onPlay',
        trigger: 'onPlay',
        cost: [{ kind: 'discardHand', count: 1 }],
        condition: {
          kind: 'and',
          of: [
            { kind: 'isYourTurn' },
            {
              kind: 'or',
              of: [
                { kind: 'lifeAtMost', player: 'opponent', value: 5 },
                {
                  kind: 'countCards',
                  selector: { zone: 'field', owner: 'you', category: ['character'] },
                  min: 1,
                },
              ],
            },
          ],
        },
        script: [{ op: 'draw', player: 'you', count: 1 }],
      },
    ],
  }),

  // --- [Trigger] on a life card ------------------------------------------
  character('ABIL-021', 'Last Gasp', 3, 3000, 1000, {
    abilities: [
      {
        id: 'ABIL-021-trigger',
        trigger: 'trigger',
        script: [{ op: 'draw', player: 'you', count: 1 }],
      },
    ],
  }),

  // --- onBlock -----------------------------------------------------------
  character('ABIL-022', 'Bulwark', 2, 2000, 1000, {
    keywords: ['Blocker'],
    abilities: [
      {
        id: 'ABIL-022-onBlock',
        trigger: 'onBlock',
        script: [{ op: 'addPower', target: { self: true }, value: 2000, duration: 'endOfBattle' }],
      },
    ],
  }),

  // --- grantKeyword (a granted Rush has to actually attack) --------------
  character('ABIL-023', 'Warhorn', 3, 3000, 1000, {
    abilities: [
      {
        id: 'ABIL-023-onPlay',
        trigger: 'onPlay',
        script: [
          { op: 'grantKeyword', target: { self: true }, keyword: 'rush', duration: 'endOfTurn' },
        ],
      },
    ],
  }),

  // --- types filter + a second continuous source (a Stage) ---------------
  {
    cardId: 'ABIL-024',
    name: 'Crew Quarters',
    category: 'stage',
    color: 'blue',
    cost: 2,
    power: 0,
    counter: null,
    life: 0,
    keywords: [],
    types: ['Base'],
    abilities: [
      {
        id: 'ABIL-024-static',
        trigger: 'static',
        script: [],
        affects: { zone: 'field', owner: 'you', category: ['character'], types: ['Crew'] },
        grants: { power: 1000 },
      },
    ],
  },
];

registerCardSet(ABIL_CARDS);

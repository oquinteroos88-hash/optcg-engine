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
 * `optional`, a continuous effect, a power-gated condition standing next to a
 * continuous buff, and a KO that wakes an `[On K.O.]` on the card it just
 * killed.
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

  /* --- draw / discard, and all three printed shapes of the chosen discard ---
   *
   * Three abilities on one card rather than three cards, and that is the
   * standing rule: a new `ABIL-` id changes `abilityDecks.ts`'s deck list and
   * reshuffles every seeded scenario in the package, so coverage goes onto an
   * existing card wherever it can.
   *
   * Between them they hold every combination the two `PlayerRef`s can take that
   * a printed card uses. The fourth — `chooser: 'you', owner: 'opponent'`, "you
   * choose a card from your opponent's hand and trash it" — is expressible and
   * **no card in the game prints it**; it is left unwritten rather than given a
   * synthetic card, because the set exists to exercise the engine against shapes
   * the game actually has.
   */
  character('ABIL-002', 'Scavenger', 2, 2000, 1000, {
    abilities: [
      {
        /** "Draw 1 card and trash 1 card from your hand" — the controller both
         *  owns the hand and picks. 142 cards in the set print this shape. */
        id: 'ABIL-002-onPlay',
        trigger: 'onPlay',
        script: [
          { op: 'draw', player: 'you', count: 1 },
          { op: 'discard', chooser: 'you', owner: 'you', count: 1 },
        ],
      },
      {
        /** "Your opponent trashes 1 card from their hand" — `OP01-102` Jack and
         *  `OP01-114` X.Drake, and 21 cards in the set. The chooser and the
         *  owner move together, which is what makes it look like one field.
         *
         *  `activateMain` rather than the `whenAttacking` the printed pair use,
         *  and the reason is this card and not this shape: `ABIL-002` is a plain
         *  2-cost body that staged positions all over the package use as a
         *  attacker, so a `whenAttacking` here would open a choice in a dozen
         *  tests that are about something else. An activated ability fires only
         *  when something asks for it. `oncePerTurn` for `ABIL-029`'s reason. */
        id: 'ABIL-002-main',
        trigger: 'activateMain',
        oncePerTurn: true,
        script: [{ op: 'discard', chooser: 'opponent', owner: 'opponent', count: 1 }],
      },
      {
        /** "Your opponent chooses 1 card from your hand; trash that card" —
         *  `OP01-038` Kanjuro's shape, and the reason the two fields are two.
         *  The only card in the game that separates them, so the engine keeps
         *  its own copy rather than depending on the card package for it. */
        id: 'ABIL-002-onKO',
        trigger: 'onKO',
        script: [{ op: 'discard', chooser: 'opponent', owner: 'you', count: 1 }],
      },
    ],
  }),

  // --- continuous power, to others and to itself -------------------------
  character('ABIL-003', 'Standard Bearer', 2, 3000, 1000, {
    abilities: [
      {
        id: 'ABIL-003-static',
        trigger: 'static',
        script: [],
        affects: { selector: { zone: 'field', owner: 'you', category: ['character'], excludeSelf: true } },
        grants: { power: 1000 },
      },
      // The self-targeting counterpart of the same shape: a static that names
      // its own source with `{self: true}`, gated so the other tests — none of
      // which attach a DON!! to the bearer — never see it.
      {
        id: 'ABIL-003-self',
        trigger: 'static',
        condition: { kind: 'donAttached', min: 1 },
        script: [],
        affects: { self: true },
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
        affects: {
          selector: { zone: 'field', owner: 'you', category: ['character'], costMax: 2, excludeSelf: true },
        },
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
      /**
       * "[On K.O.] **When this Character is K.O.'d by your opponent's effect**,
       * draw 1 card."
       *
       * The same trigger as the ability above it with `koCause` attached, and
       * that is the whole finding: the family is not a new trigger, it is
       * `onKO` finally able to say what killed it. Two abilities on one card
       * because the pair is the test — a battle K.O. must wake the first and
       * not the second, and only a card carrying both can show it in one game.
       *
       * `by: 'opponent'` is relative to this card's controller, so the ability
       * sleeps when its own controller's script does the K.O. too. Six cards in
       * the full set print this shape and every one of them is worded from the
       * victim's side.
       */
      {
        id: 'ABIL-011-onKOByEnemyEffect',
        trigger: 'onKO',
        condition: { kind: 'koCause', by: 'opponent' },
        script: [{ op: 'draw', player: 'you', count: 1 }],
      },
      /**
       * "[Activate: Main] [Once Per Turn] K.O. this Character."
       *
       * The only way in the set to have a Character K.O.'d **by its own
       * controller's effect**, and without it the `by: 'opponent'` above is a
       * relative reading with only one of its two sides ever exercised: every
       * other K.O. an ABIL script can cause points at the opponent's board,
       * because `ABIL-012`'s selector says `owner: 'opponent'`.
       *
       * A card that kills itself is not a shape this game prints, and it is
       * here as an instrument rather than as a transcription — which is what the
       * rest of the file already does for `ABIL-012` Purge.
       *
       * **The `[DON!! x3]` condition is the instrument's calibration, and it was
       * measured rather than chosen.** Written without one, the ability was free
       * and always legal, and random play took it every time: over 300 games
       * `ABIL-011` was K.O.'d 175 times and **all 175** were its own doing, so
       * the guarded `[On K.O.]` above went from rare to unreachable. An
       * instrument that changes the population it measures is worse than no
       * instrument. Three attached DON!! on one 2-cost body is uncommon enough
       * that the card mostly dies the way it used to — to `ABIL-012` Purge,
       * which is the opponent's effect and the case that matters.
       */
      {
        id: 'ABIL-011-selfKo',
        trigger: 'activateMain',
        oncePerTurn: true,
        condition: { kind: 'donAttached', min: 3 },
        script: [{ op: 'ko', target: { self: true } }],
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
      // The three triggers that watch somebody else's board. Hung on this card
      // rather than on new ones: a new ABIL id changes the deck list and
      // reshuffles every seeded scenario in the package.
      //
      // Each draws, which is the cheapest observable effect there is — what
      // these abilities are for is proving the *firing site* reaches them, and a
      // body with its own targeting would only add ways for the case to fail
      // for an unrelated reason.
      {
        id: 'ABIL-013-onOwnEvent',
        trigger: 'whenActivatingEvent',
        script: [{ op: 'draw', player: 'you', count: 1 }],
      },
      {
        id: 'ABIL-013-onEnemyEvent',
        trigger: 'whenOpponentActivatesEvent',
        script: [{ op: 'draw', player: 'you', count: 1 }],
      },
      {
        id: 'ABIL-013-onEnemyKO',
        trigger: 'whenOpponentCharacterKOd',
        script: [{ op: 'draw', player: 'you', count: 1 }],
      },
      /**
       * The four prose families that turned out to be triggers, on the card
       * that already carries the other three watchers — for the reason stated
       * above, and because it makes the ordering cases writable: this one
       * Character can hold two abilities whose timing the same act fulfils.
       *
       * `ABIL-013-onRested` is the clearest of the four. This card rests when it
       * attacks, so `whenAttacking` and `whenBecomingRested` both wake from one
       * declaration — and CR 7-1-1-1 rests before CR 7-1-1-3 activates, which is
       * an order a single card can be made to show.
       */
      {
        id: 'ABIL-013-onDonReturned',
        trigger: 'whenDonReturnedToDeck',
        script: [{ op: 'draw', player: 'you', count: 1 }],
      },
      {
        id: 'ABIL-013-onRested',
        trigger: 'whenBecomingRested',
        script: [{ op: 'draw', player: 'you', count: 1 }],
      },
      {
        id: 'ABIL-013-onEnemyBlocker',
        trigger: 'whenOpponentActivatesBlocker',
        script: [{ op: 'draw', player: 'you', count: 1 }],
      },
      {
        id: 'ABIL-013-onEnemyPlay',
        trigger: 'whenOpponentPlaysCharacter',
        script: [{ op: 'draw', player: 'you', count: 1 }],
      },
      /**
       * The `restSelf` route into "becomes rested", on the card that watches for
       * it — the fourth of the five ways a card can be rested and the only one a
       * staged position cannot reach through some other card.
       *
       * The body grants power rather than drawing, so the observer's draw and
       * the ability's own output are told apart in one game. No `oncePerTurn`:
       * `restSelf` is its own limiter, because the source only comes back active
       * in its controller's Refresh Phase (CR 6-2-4) — the argument `ABIL-024`
       * already makes for the same cost.
       */
      {
        id: 'ABIL-013-restSelf',
        trigger: 'activateMain',
        cost: [{ kind: 'restSelf' }],
        script: [{ op: 'addPower', target: { self: true }, value: 1000, duration: 'endOfTurn' }],
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
  // A [Counter] Event in the shape the game actually prints: no printed Counter
  // value (`counter: null`), its whole text a [Counter] ability. It is played
  // with PLAY_COUNTER_EVENT — paid by its printed cost and trashed for its
  // effect — never with PLAY_COUNTER, which is for a printed Counter value.
  //
  // It used to carry `counter: 1000` as well, a combination no real card has
  // (no printed Event has a Counter value). That invented shape made the
  // `counterEvent` trigger look reachable through PLAY_COUNTER and hid the
  // missing play; `abilCardShapes.test.ts` now guards against it returning.
  {
    cardId: 'ABIL-016',
    name: 'Desperate Parry',
    category: 'event',
    color: 'blue',
    cost: 1,
    power: 0,
    counter: null,
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
      // A cost-free activated giveDon, so a test can reach the op with a cost
      // area the caller controls — an [On Play] always rests its own cost first,
      // which hides the all-active case the rested-only rule turns on. Once per
      // turn so the random sweep, which plays until a game ends, cannot loop on
      // it forever once the rested DON!! run out and it turns into a no-op.
      {
        id: 'ABIL-018-main',
        trigger: 'activateMain',
        oncePerTurn: true,
        script: [{ op: 'giveDon', target: { self: true }, count: 1 }],
      },
      // --- orientDon, both directions -------------------------------------
      // Hung off the DON!! card rather than given a card of their own: a new
      // ABIL id changes the deck list, which reshuffles every seeded scenario in
      // the package. Once per turn for the same reason the giveDon above is —
      // orientDon no-ops when nothing can turn, and an always-legal no-op is
      // exactly the shape the sweep's action cap exists to catch.
      {
        id: 'ABIL-018-restFoe',
        trigger: 'activateMain',
        oncePerTurn: true,
        script: [{ op: 'orientDon', player: 'opponent', orientation: 'rested', count: 2 }],
      },
      {
        id: 'ABIL-018-refresh',
        trigger: 'activateMain',
        oncePerTurn: true,
        script: [{ op: 'orientDon', player: 'you', orientation: 'active', count: 2 }],
      },
      // Two ways to put a card on the field, hung on this card rather than on new
      // ones: a new ABIL id changes the deck list and reshuffles every seeded
      // scenario in the package.
      //
      // The shape every printed card in this set has — select up to 1 from hand,
      // then play it. [Once Per Turn] because a free body every turn with no
      // limiter is the kind of thing a 200-game sweep rides until the hand runs
      // out, and the interesting branch is the full board, not the loop.
      {
        id: 'ABIL-018-summon',
        trigger: 'activateMain',
        oncePerTurn: true,
        script: [
          {
            op: 'select',
            as: 'recruit',
            from: { zone: 'hand', owner: 'you', category: ['character'], costMax: 2 },
            min: 0,
            max: 1,
            prompt: 'Play up to 1 Character card with a cost of 2 or less from your hand',
          },
          { op: 'play', target: { var: 'recruit' } },
        ],
      },
      // The same, rested. CR 3-7-5 places cards active "unless otherwise
      // specified", and `OP01-060` is the printed card that specifies otherwise;
      // this is the engine-side witness for that branch.
      {
        id: 'ABIL-018-summonRested',
        trigger: 'activateMain',
        oncePerTurn: true,
        script: [
          {
            op: 'select',
            as: 'recruit',
            from: { zone: 'hand', owner: 'you', category: ['character'], costMax: 2 },
            min: 0,
            max: 1,
            prompt: 'Play up to 1 Character card with a cost of 2 or less, rested',
          },
          { op: 'play', target: { var: 'recruit' }, rested: true },
        ],
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
      // The three shapes a chosen payment has, all hung on this card rather than
      // on new ones: a new ABIL id changes the deck list and reshuffles every
      // seeded scenario in the package, and none of these needs its own body.
      //
      // Two costs, in printed order. CR 8-3-1-1 carries the actions of one
      // activation cost out "in order starting from the text closest to the
      // top", so the DON!! rest first and the discard second — and the player
      // does not get to reorder them. This is ST02-001's shape exactly.
      {
        id: 'ABIL-020-main',
        trigger: 'activateMain',
        oncePerTurn: true,
        cost: [
          { kind: 'restDon', count: 2 },
          { kind: 'discardHand', count: 1 },
        ],
        script: [{ op: 'draw', player: 'you', count: 1 }],
      },
      // A *filtered* payment: only cheap cards can pay. costMax rather than a
      // type, because every ABIL card shares one type and a filter that matches
      // everything proves nothing; the printed cards that filter by type live in
      // the cards package and take the same path through resolveSelector.
      //
      // [Once Per Turn] is load-bearing here, not decoration: discard 1 to draw
      // 1 is card-neutral, and without a limiter the random sweep rides it
      // forever.
      {
        id: 'ABIL-020-cheap',
        trigger: 'activateMain',
        oncePerTurn: true,
        cost: [{ kind: 'discardHand', count: 1, filter: { costMax: 2 } }],
        script: [{ op: 'draw', player: 'you', count: 1 }],
      },
      // A condition the payment itself breaks: it asks for two cards in hand and
      // then spends both, so by the time the script runs the condition it fired
      // on is false. CR 8-4-1 checks conditions at 8-4-1-1 and pays at 8-4-1-3,
      // and nothing re-checks in between — the effect resolves.
      {
        id: 'ABIL-020-brink',
        trigger: 'activateMain',
        oncePerTurn: true,
        condition: { kind: 'countCards', selector: { zone: 'hand', owner: 'you' }, min: 2 },
        cost: [{ kind: 'discardHand', count: 2 }],
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
        affects: { selector: { zone: 'field', owner: 'you', category: ['character'], types: ['Crew'] } },
        grants: { power: 1000 },
      },
      // --- restSelf cost, on a Stage ---------------------------------------
      // Hung on the Stage rather than given a card of its own for two reasons.
      // A new ABIL id changes the deck list and reshuffles every seeded scenario
      // in the package, which is why ABIL-018 already carries four abilities.
      // And a Stage is the shape the real card has (ST01-017 Thousand Sunny),
      // so the two continuous/activated abilities sit on one source and a test
      // can rest it and still read the static — which is the rules question the
      // cost raises.
      //
      // No `oncePerTurn`: the cost is the limiter. The Stage returns to active
      // only in its controller's Refresh Phase (CR 6-2-4), so this cannot loop,
      // which is exactly the property the sweep's action cap watches for.
      //
      // The draw is deliberately behind a condition that asks whether this
      // Stage is *already rested*. CR 8-4-1 pays the activation cost (8-4-1-3)
      // before activating (8-4-1-4) and resolving (8-4-1-5) the effect, so the
      // condition holds and the card is drawn. A payment that leaked past the
      // start of the script would show up as no draw — an ordering rule with a
      // behavioural witness rather than an event-order proxy.
      {
        id: 'ABIL-024-main',
        trigger: 'activateMain',
        cost: [{ kind: 'restSelf' }],
        script: [
          {
            op: 'if',
            cond: {
              kind: 'countCards',
              selector: { zone: 'field', owner: 'you', category: ['stage'], orientation: 'rested' },
              min: 1,
            },
            then: [{ op: 'draw', player: 'you', count: 1 }],
          },
        ],
      },
    ],
  },

  // --- power-gated condition (current power, per conditionPower.test.ts) --
  character('ABIL-025', 'Gatekeeper', 2, 2000, 1000, {
    abilities: [
      {
        id: 'ABIL-025-main',
        trigger: 'activateMain',
        oncePerTurn: true,
        condition: {
          kind: 'countCards',
          selector: { zone: 'field', owner: 'you', category: ['character'], powerMin: 4000 },
          min: 1,
        },
        script: [
          {
            op: 'select',
            as: 'champion',
            from: { zone: 'field', owner: 'you', category: ['character'], powerMin: 4000 },
            min: 1,
            max: 1,
            prompt: 'Choose one of your characters with 4000 power or more',
          },
          { op: 'addPower', target: { var: 'champion' }, value: 1000, duration: 'endOfTurn' },
        ],
      },
      {
        id: 'ABIL-025-onPlay',
        trigger: 'onPlay',
        condition: {
          kind: 'countCards',
          selector: { zone: 'field', owner: 'you', category: ['character'], powerMin: 4000 },
          min: 1,
        },
        script: [{ op: 'draw', player: 'you', count: 1 }],
      },
    ],
  }),
  // --- modifiable legality: the two shapes no printed card can reach yet ----

  /**
   * "This Character cannot be K.O.'d in battle."
   *
   * The third building, and **the one form of the mechanism with no printed
   * card behind it** — which is why it is here and why it is said out loud.
   * OP-01 prints the shape twice, `OP01-024` and `OP01-099`, and both want a
   * second thing the DSL still cannot say: an ＜Strike＞ attribute filter, and
   * "{Kurozumi Clan} Characters **other than** your [Kurozumi Semimaru]". Take
   * either qualifier away and what is left is exactly this card.
   *
   * That is the `counterEvent` lesson applied on purpose. `ABIL-016` was
   * invented in a shape no printed card had, and the invention hid a missing
   * engine move for a year; the fix was not to stop writing synthetic cards but
   * to write them as **a real card minus a named gap**, and to name the gap.
   * When the attribute filter lands, `OP01-024` is this card with one more
   * clause and this comment gets shorter.
   *
   * Power 2000 so it loses battles it is put into: an immunity that never gets
   * hit tests nothing.
   */
  character('ABIL-026', 'Unbreakable', 2, 2000, 1000, {
    abilities: [
      {
        id: 'ABIL-026-static',
        trigger: 'static',
        script: [],
        affects: { self: true },
        grants: { legality: { effect: 'forbid', clause: { question: 'koInBattle' } } },
      },
    ],
  }),

  /**
   * "[Activate: Main] Select up to 1 of your opponent's Characters. The selected
   * Character cannot attack during this turn."
   *
   * The **forbid** direction of the attack question, which the six cards this
   * batch shipped never point at: `OP01-021` and `OP01-112` widen the target
   * set, and the two OP-01 cards that narrow attack legality are blocked on
   * other gaps — `OP01-051` on negation, source orientation and put-into-play;
   * `OP01-085` on a duration that outlives the turn (43 cards in the full set
   * want one). This is `OP01-085` with the one duration the engine can name.
   *
   * It exists so the direction is *reached* rather than merely reachable. An
   * `allow`/`forbid` pair where only one side is ever exercised is a pair where
   * the other side is a claim nobody checked.
   *
   * Two deliberate departures from the printed card, both named rather than
   * quietly absorbed:
   *
   * - **`owner: 'any'`.** `OP01-085` says "your opponent's Characters". This
   *   card can pin either side, and it has to: an `[Activate: Main]` runs on
   *   its controller's turn and an `endOfTurn` rule dies at the end of that
   *   turn, so a rule written against an opponent's Character would expire
   *   before that Character could ever have attacked. Which is not a defect in
   *   the mechanism — it is exactly *why* `OP01-085` prints "until the end of
   *   your opponent's next turn", and exactly the gap that keeps it out of this
   *   batch.
   * - **`endOfTurn`.** The longest lifetime the engine can name. Gap 18.
   */
  character('ABIL-027', 'Pinned Down', 2, 2000, 1000, {
    abilities: [
      {
        id: 'ABIL-027-main',
        trigger: 'activateMain',
        oncePerTurn: true,
        script: [
          {
            op: 'select',
            as: 'pinned',
            from: { zone: 'field', owner: 'any', category: ['character'] },
            min: 0,
            max: 1,
            prompt: 'Select up to 1 Character to pin down',
          },
          {
            op: 'setLegality',
            effect: 'forbid',
            subject: { cards: { var: 'pinned' } },
            clause: { question: 'attack' },
            duration: 'endOfTurn',
          },
        ],
      },
    ],
  }),

  /**
   * "[DON!! x1] This Character can also attack your opponent's active
   * Characters."
   *
   * `OP01-021` Franky, transcribed — the one card in this file that is a
   * printed card with **nothing** taken away, and it is here for a reason the
   * other two are not: the `allow` direction has to be reachable by the
   * simulation sweep, not only by a staged position.
   *
   * The mark report is what caught it. Six of the seven marks this batch added
   * were hit by the bots inside a few hundred games and `legality.allowed` was
   * not, because every synthetic card in the set narrows legality and none
   * widens it. A direction the sweep can never walk is a direction whose only
   * evidence is a test someone wrote for it, which is exactly what the marks
   * exist to expose.
   */
  character('ABIL-028', 'Flanker', 3, 4000, 1000, {
    abilities: [
      {
        id: 'ABIL-028-static',
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
  }),

  /**
   * "[Activate: Main] Look at 3 cards from the top of your deck; reveal up to 1
   * {Crew} type card and add it to your hand. Then, place the rest at the
   * bottom of your deck in any order."
   *
   * `ST02-007` Bonney with the count dropped from five to three and the costs
   * taken off. Three is not arbitrary: it makes the trivial case — one card
   * left to bury, which the engine must place without asking — reachable by
   * keeping one out of two, and it keeps a staged position small enough to
   * read.
   *
   * Every ABIL card in this set is a real printed card minus a named gap, and
   * the gap here is the cost list: Bonney pays `restDon 1` plus `restSelf`,
   * which are two costs this file already exercises on other cards and which
   * would only make every position in `orderCards.test.ts` need a DON!! layout.
   *
   * `[Once Per Turn]` stands in for what those costs were doing. Bonney's
   * `restSelf` is her own limiter — a rested Character cannot pay to rest again
   * — and dropping it made this card a free repeatable action the bot could
   * spend a whole game on: the sweep stopped finishing games inside its action
   * cap the moment the card was added without one. Measured, not guessed.
   */
  character('ABIL-029', 'Navigator', 2, 2000, 1000, {
    abilities: [
      {
        id: 'ABIL-029-main',
        trigger: 'activateMain',
        oncePerTurn: true,
        script: [
          { op: 'lookAt', as: 'looked', count: 3 },
          {
            op: 'select',
            as: 'kept',
            from: { zone: 'deckTop', owner: 'you', count: 3, types: ['Crew'] },
            min: 0,
            max: 1,
            prompt: 'Reveal up to 1 {Crew} type card',
          },
          { op: 'moveCard', target: { var: 'kept' }, to: { zone: 'hand' } },
          {
            op: 'orderToBottom',
            cards: { minus: { of: { var: 'looked' }, without: { var: 'kept' } } },
            prompt: 'Place the rest at the bottom of your deck, first card drawn first',
          },
        ],
      },
      /**
       * "[Activate: Main] [Once Per Turn] Look at 3 cards from the top of your
       * deck and place them at the top or bottom of the deck in any order."
       *
       * The partition, on the card that already carries the permutation — so
       * **one source can open either kind**, which is the shape the two-kinds
       * property is worth testing on. A card that could only ever ask one of
       * them would let the two drift apart without anything noticing.
       *
       * Three cards rather than five: the whole window is placed here, and a
       * partition of three has eight side assignments and six orders per side,
       * which is more than enough to catch a mapping read backwards while still
       * fitting in a test's head.
       *
       * `[Once Per Turn]` for the reason the ability above it has one — a free
       * repeatable action is what the sweep's action cap catches.
       */
      {
        id: 'ABIL-029-split',
        trigger: 'activateMain',
        oncePerTurn: true,
        script: [
          { op: 'lookAt', as: 'seen', count: 3 },
          {
            op: 'orderToDeckEnds',
            cards: { var: 'seen' },
            prompt: 'Place each card on the top or bottom of your deck, first card drawn first',
          },
        ],
      },
    ],
  }),

  /**
   * "[Activate: Main] [Once Per Turn] Add up to 2 DON!! cards from your DON!!
   * deck and rest them."
   *
   * `OP01-093` Ulti with the cost taken off and the count raised from one to
   * two, and both departures are the named gap. The count is two because every
   * printed card in OP-01 adds exactly one, so nothing there can exercise a
   * *partial* add — "up to 2 with 1 left in the deck" is the shortfall rule
   * (CR 1-3-2) and it needs a card that asks for more than one. Six cards in the
   * full set do; none of them is in this set's colour.
   *
   * `[Once Per Turn]` for the reason `ABIL-029` has one: an activated ability
   * with no cost is a free repeatable action, and the sweep stopped finishing
   * games inside its action cap the last time one went in without a limiter.
   */
  character('ABIL-030', 'Quartermaster’s Ledger', 2, 2000, 1000, {
    abilities: [
      {
        id: 'ABIL-030-main',
        trigger: 'activateMain',
        oncePerTurn: true,
        script: [{ op: 'addDon', count: 2, orientation: 'rested' }],
      },
    ],
  }),

  /**
   * "[Activate: Main] [Once Per Turn] Add up to 1 DON!! card from your DON!!
   * deck and set it as active."
   *
   * The active half of the same op, on its own card so a staged position can
   * ask for one orientation without getting the other. `OP01-115` and
   * `OP01-061` print this shape; both attach it to something else happening
   * first, which is what makes a bare one worth having here.
   */
  character('ABIL-031', 'Standard Bearer’s Call', 2, 2000, 1000, {
    abilities: [
      {
        id: 'ABIL-031-main',
        trigger: 'activateMain',
        oncePerTurn: true,
        script: [{ op: 'addDon', count: 1, orientation: 'active' }],
      },
    ],
  }),

  /* --- reference by name -------------------------------------------------
   *
   * Three cards and **two card numbers sharing one name**, which is the part
   * that cannot be faked with a single card: CR 2-1-2 makes a bracketed name
   * refer to "cards with the card name specified in the brackets", and CR 2-14-2
   * counts deck copies by *card number* instead — so name and number are
   * different keys and the set has to hold a case where they disagree. The real
   * corpus has plenty (`OP01-049` Bepo and `ST02-012` Bepo; nine names sit on
   * two numbers inside OP-01 alone), but the engine may not lean on the card
   * package to cover its own field.
   */

  /**
   * The second `Signal Flag`, and the whole reason it exists: a different card
   * number, a different cost, the same name. Vanilla on purpose — every claim
   * about it is a claim about the name, so it must have no behaviour of its own
   * to be confused with.
   */
  character('ABIL-032', 'Signal Flag', 1, 2000, 1000),

  /**
   * "[Activate: Main] [Once Per Turn] Rest up to 1 of your Characters **other
   * than [Signal Flag]**."
   *
   * The exclusion form, printed on a card that carries the excluded name itself
   * — `OP01-005` Uta's shape, and the one that separates a *name* from an
   * *instance*. `excludeSelf` would drop this card and offer `ABIL-032` and any
   * second copy of this one; `excludeNames` drops all three, which is what the
   * printed words say.
   *
   * `min: 0` because "up to 1" may take nothing (CR 8-4-4-1), and
   * `[Once Per Turn]` for the reason `ABIL-029` has one.
   */
  character('ABIL-033', 'Signal Flag', 3, 4000, 1000, {
    abilities: [
      {
        id: 'ABIL-033-muster',
        trigger: 'activateMain',
        oncePerTurn: true,
        script: [
          {
            op: 'select',
            as: 'mustered',
            from: {
              zone: 'field',
              owner: 'you',
              category: ['character'],
              excludeNames: ['Signal Flag'],
            },
            min: 0,
            max: 1,
            prompt: 'Rest up to 1 of your Characters other than [Signal Flag]',
          },
          { op: 'rest', target: { var: 'mustered' } },
        ],
      },
    ],
  }),

  /**
   * "[Activate: Main] [Once Per Turn] **If you don't have [Signal Flag]**, play
   * up to 1 **[Signal Flag]** from your hand."
   *
   * `OP01-044` Shachi's shape, and it carries the other three quarters of the
   * field in one sentence: the **inclusion** list in a selector, the same list
   * inside a `countCards`, and the negation that needed no negation — `max: 0`
   * has been "you don't have one" since Phase 2A.
   *
   * It is not itself a `Signal Flag`, which is the only reason its gate can be
   * open: a card that gated on its own name would close its own condition the
   * moment it hit the field.
   *
   * "Have" is the field (CR 3-1-2 collects the Leader, Character, Stage and cost
   * areas under that word), so the count looks at `zone: 'field'` and names no
   * category — the printed text names none either.
   */
  character('ABIL-034', 'Boatswain', 2, 3000, 1000, {
    abilities: [
      {
        id: 'ABIL-034-call',
        trigger: 'activateMain',
        oncePerTurn: true,
        condition: {
          kind: 'countCards',
          selector: { zone: 'field', owner: 'you', names: ['Signal Flag'] },
          max: 0,
        },
        script: [
          {
            op: 'select',
            as: 'called',
            from: { zone: 'hand', owner: 'you', names: ['Signal Flag'] },
            min: 0,
            max: 1,
            prompt: 'Play up to 1 [Signal Flag] from your hand',
          },
          { op: 'play', target: { var: 'called' } },
        ],
      },
    ],
  }),

  /**
   * The DON!! count condition and the four costs of the same batch, on **one**
   * card.
   *
   * Six abilities, which is more than any other card here carries, and the
   * reason is the standing rule rather than convenience: a new `ABIL-` id
   * reshuffles every seeded scenario in the package, so a batch that needs six
   * new shapes buys one id and not six. `ABIL-018` set the precedent at four.
   *
   * Five of the six are `[Activate: Main] [Once Per Turn]`, and that is
   * deliberate too: nothing fires them incidentally, so a staged position that
   * is about something else never trips over one. The sixth has to be a
   * `static`, because a continuous effect gated on a count is the only shape
   * that can be watched turning on and off without anything being played.
   */
  character('ABIL-035', 'Paymaster', 2, 2000, 1000, {
    abilities: [
      /**
       * `OP01-109` Who's.Who's shape: a continuous buff gated on the DON!!
       * count, read on every power lookup.
       *
       * The gate is `donOnField` alone rather than Who's.Who's three conditions,
       * because the other two — `[DON!! x1]` and `[Your Turn]` — already have
       * their own cards here and mixing them in would make a failing test say
       * "the static is off" without saying which clause turned it off.
       */
      {
        id: 'ABIL-035-static',
        trigger: 'static',
        condition: { kind: 'donOnField', min: 8 },
        script: [],
        affects: { self: true },
        grants: { power: 1000 },
      },
      /**
       * `OP01-095` Kyoshirou's shape: the same count as an ordinary activation
       * condition. The pair matters — the condition is evaluated in two very
       * different places, once inside `forEachStatic` and once in `legalActions`,
       * and one card holding both is where they can be watched agreeing.
       */
      {
        id: 'ABIL-035-count',
        trigger: 'activateMain',
        oncePerTurn: true,
        condition: { kind: 'donOnField', min: 8 },
        script: [{ op: 'draw', player: 'you', count: 1 }],
      },
      /** `OP01-011` Gordon: a hand card under the deck, not into the trash. */
      {
        id: 'ABIL-035-bottomDeck',
        trigger: 'activateMain',
        oncePerTurn: true,
        cost: [{ kind: 'bottomDeckHand', count: 1 }],
        script: [{ op: 'draw', player: 'you', count: 1 }],
      },
      /**
       * `OP01-047` Law: a Character back to hand, and **the source is a
       * candidate**. Paying with this card is the case
       * `rules.selfReturnResolvesEffect` decides, and it is reachable here
       * because `Paymaster` is a Character that can name itself.
       */
      {
        id: 'ABIL-035-return',
        trigger: 'activateMain',
        oncePerTurn: true,
        cost: [{ kind: 'returnCharacters', count: 1 }],
        script: [{ op: 'draw', player: 'you', count: 1 }],
      },
      /**
       * `OP01-055` You Can Be My Samurai!!: two of your Characters rested. Two
       * rather than one because the printed card says two, and because a cost
       * that takes more than one card is where a partial payment would show.
       */
      {
        id: 'ABIL-035-rest',
        trigger: 'activateMain',
        oncePerTurn: true,
        cost: [{ kind: 'restCharacters', count: 2 }],
        script: [{ op: 'draw', player: 'you', count: 2 }],
      },
      /**
       * `OP01-008` Cavendish and `OP01-013` Sanji: the top Life card into your
       * hand, with no choice and no `[Trigger]`. The only cost in this batch
       * that does not suspend.
       */
      {
        id: 'ABIL-035-life',
        trigger: 'activateMain',
        oncePerTurn: true,
        cost: [{ kind: 'lifeToHand', count: 1 }],
        script: [
          { op: 'addPower', target: { self: true }, value: 2000, duration: 'endOfTurn' },
        ],
      },
    ],
  }),

  /**
   * The five mechanisms of the closing batch, on one card.
   *
   * Its two power statics are gated on `isYourTurn` and `not(isYourTurn)`, which
   * makes them **mutually exclusive** — a card carrying two self-buffs that
   * could both be live would make every power assertion read as a sum and hide
   * which clause was on.
   */
  character('ABIL-036', 'Almanac', 2, 2000, 1000, {
    abilities: [
      /**
       * `OP01-019` Bartolomeo's shape: a buff that exists only on the other
       * player's turn. `[Opponent's Turn]` is `not(isYourTurn)` and nothing else
       * in `Condition` had to change for it.
       */
      {
        id: 'ABIL-036-opponentTurn',
        trigger: 'static',
        condition: { kind: 'not', of: { kind: 'isYourTurn' } },
        script: [],
        affects: { self: true },
        grants: { power: 3000 },
      },
      /**
       * `OP01-072` Smiley's shape: +1000 for every card in your hand, counted at
       * read time. `per` is left off, which is 1.
       */
      {
        id: 'ABIL-036-perCard',
        trigger: 'static',
        condition: { kind: 'isYourTurn' },
        script: [],
        affects: { self: true },
        grants: { powerPer: { of: { zone: 'hand', owner: 'you' }, value: 1000 } },
      },
      /**
       * `OP01-083` Mr.1's shape: the same arithmetic with a divisor. Gated on an
       * attached DON!! so a staged position can turn it off without emptying the
       * trash, and on the opponent's turn so it never sums with `perCard`.
       */
      {
        id: 'ABIL-036-perTwo',
        trigger: 'static',
        condition: {
          kind: 'and',
          of: [{ kind: 'donAttached', min: 1 }, { kind: 'not', of: { kind: 'isYourTurn' } }],
        },
        script: [],
        affects: { self: true },
        grants: {
          powerPer: {
            of: { zone: 'trash', owner: 'you', category: ['event'] },
            value: 1000,
            per: 2,
          },
        },
      },
      /**
       * `OP01-067` Crocodile's shape: a continuous **cost** reduction whose
       * audience is a selector over the **hand**. Nothing new was needed for
       * that zone — `resolveSelector` has reached it since Phase 2A.
       */
      {
        id: 'ABIL-036-cheaper',
        trigger: 'static',
        condition: { kind: 'donAttached', min: 1 },
        script: [],
        affects: { selector: { zone: 'hand', owner: 'you', category: ['event'] } },
        grants: { cost: -1 },
      },
      /**
       * `OP01-105` Bao Huang and the middle of `OP01-063` Arlong: choose out of
       * the opponent's hand, reveal **those** cards, and branch on what they
       * turned out to be.
       */
      {
        id: 'ABIL-036-peek',
        trigger: 'activateMain',
        oncePerTurn: true,
        script: [
          {
            op: 'select',
            as: 'seen',
            from: { zone: 'hand', owner: 'opponent' },
            min: 1,
            max: 1,
            prompt: "Choose 1 card from your opponent's hand",
          },
          { op: 'reveal', var: 'seen' },
          {
            op: 'if',
            cond: { kind: 'varMatches', name: 'seen', match: { category: ['event'] } },
            then: [{ op: 'draw', player: 'you', count: 1 }],
          },
        ],
      },
      /**
       * `OP01-002` Trafalgar Law's shape: return one of yours, then play
       * something **of a different colour than the card that left**.
       */
      {
        id: 'ABIL-036-swap',
        trigger: 'activateMain',
        oncePerTurn: true,
        script: [
          {
            op: 'select',
            as: 'sent',
            from: { zone: 'field', owner: 'you', category: ['character'] },
            min: 1,
            max: 1,
            prompt: 'Return 1 of your Characters to the owner’s hand',
          },
          { op: 'moveCard', target: { var: 'sent' }, to: { zone: 'hand' } },
          {
            op: 'select',
            as: 'recruit',
            from: {
              zone: 'hand',
              owner: 'you',
              category: ['character'],
              differentColorFrom: 'sent',
            },
            min: 0,
            max: 1,
            prompt: 'Play up to 1 Character of a different color than the returned one',
          },
          { op: 'play', target: { var: 'recruit' } },
        ],
      },
    ],
  }),

  /**
   * The set's one **two-colour** card, and the only way the colour comparison
   * can be watched deciding anything.
   *
   * Every two-colour card in the real game is a **Leader** — 68 of them, and not
   * one Character, Event or Stage — so `differentColorFrom`'s two readings can
   * never disagree on a printed card today. They disagree here: against a
   * mono-blue reference this card **shares** blue, so the default excludes it,
   * and the whole-set reading admits it.
   *
   * Vanilla on purpose, like `ABIL-032`: every claim about it is a claim about
   * its colours.
   */
  character('ABIL-037', 'Envoy', 1, 2000, 1000, { colors: ['blue', 'green'] }),
];

registerCardSet(ABIL_CARDS);

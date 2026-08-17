// **English is the authority.** This module defines the message key set; every
// other locale is typed as `typeof en`, so a key added here and not translated
// there is a compile error rather than a hole a player finds. That is the
// switch-without-a-`default` discipline applied to text: the compiler asks the
// question, and it asks it once per language.
//
// Values are plain strings when there is nothing to fill in, and functions when
// there is. Never concatenation at the call site: word order and plural rules
// are not the same in two languages, so the whole sentence lives in the
// dictionary and the parameters go into it.
import type { Keyword, ReasonCode } from '@optcg/engine';
import type { ServerErrorCode } from '@optcg/server/protocol';

/** Joins a list the way the language does. English: "a, b and c". */
function list(items: readonly string[]): string {
  if (items.length <= 1) {
    return items[0] ?? '';
  }
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

export const en = {
  language: {
    label: 'Language',
    en: 'English',
    es: 'Español',
  },

  playmat: {
    label: 'Playmat',
    forPlayer: (player: string): string => `Playmat — ${player}`,
    /** The one this repository draws itself; the only one always available. */
    neutral: 'Neutral',
  },

  common: {
    playerOne: 'Player 1',
    playerTwo: 'Player 2',
    /**
     * A card the viewer is not entitled to name, said the way the table shows
     * it: a back. Not a fallback — the redaction rendered.
     */
    hiddenCard: 'a card',
    hiddenCardLabel: 'Hidden card',
    cards: (count: number): string => (count === 1 ? '1 card' : `${count} cards`),
    cancel: 'Cancel',
    close: 'Close',
    confirm: 'Confirm',
    back: 'Back',
    yes: 'Yes',
    no: 'No',
    ready: 'Ready',
  },

  deck: {
    testRed: 'Red (TEST)',
    testGreen: 'Green (TEST)',
  },

  setup: {
    title: 'New game',
    seed: 'Seed',
    randomSeed: 'Random',
    deckP1: 'Player 1 deck',
    deckP2: 'Player 2 deck',
    firstPlayer: 'First player',
    play: 'Play',
    network: 'Play online',
  },

  lobby: {
    title: 'Play online',
    server: 'Server',
    resume: 'Return to the saved match',
    createSection: 'Create match',
    yourDeck: 'Your deck',
    opponentDeck: "Opponent's deck",
    seed: 'Seed',
    randomSeed: 'Random',
    create: 'Create match',
    creating: 'Creating…',
    matchWord: 'Match',
    shareCode: 'Give your opponent this code:',
    enterAsP1: 'Join as Player 1',
    joinSection: 'Join a match',
    joinTitle: 'Join',
    matchField: 'Match',
    seatCode: 'Seat code',
    join: 'Join',
    createFailed: (code: string): string => `The match could not be created: ${code}`,
    noConnection: 'The server did not answer.',
  },

  board: {
    logTitle: 'Log',
    turnShort: (turn: number): string => `T${turn}`,
    leader: 'Leader',
    stage: 'Stage',
    life: 'Life',
    /** The wide row against the centre line, where the battles happen. */
    characterArea: 'Character Area',
    /**
     * The wide zone on the near edge. The DON!! that sit in it keep their own
     * name — `DON!!` is a name, not a word, and is not translated anywhere.
     */
    costArea: 'Cost Area',
    deck: 'Deck',
    donDeck: 'DON!! deck',
    trash: 'Trash',
    hand: (count: number): string => `Hand (${count})`,
    handOf: (owner: string): string => `${owner}'s hand`,
    fieldOf: (owner: string): string => `${owner}'s field`,
    donArea: (active: number, rested: number): string =>
      `DON!! in the cost area: ${active} active, ${rested} rested`,
    donActive: (count: number): string => `Active: ${count}`,
    donRested: (count: number): string => `Rested: ${count}`,
    pile: (label: string, count: number): string =>
      `${label}: ${count} cards${count === 0 ? '' : ', open'}`,
    endTurn: 'End turn',
    veilOpponentHand: "Veil opponent's hand",
    concede: 'Concede',
    turnOf: (player: string): string => `${player}'s turn`,
    decidesEffect: (player: string): string => `${player} is deciding an effect`,
    responds: (player: string): string => `${player} responds`,
    wins: (player: string): string => `${player} wins`,
    phase: {
      mulligan: 'Mulligan',
      main: 'Main phase',
      blockStep: 'Block Step',
      counterStep: 'Counter Step',
      finished: 'Game over',
    },
    /**
     * The five boxes the mat prints, in turn order.
     *
     * Short forms on purpose, and deliberately not the same strings as
     * `phase` above: that one names the phase in a sentence at the top of the
     * screen ("Main phase"), this one labels a box on a mat ("Main"). The
     * glossary records both so the difference reads as a decision.
     */
    turnPhase: {
      refresh: 'Refresh',
      draw: 'Draw',
      don: 'DON!!',
      main: 'Main',
      end: 'End',
    },
    /**
     * The live moment, marked on the lit box of the track.
     *
     * Short forms of `phase` above, for the same reason `turnPhase` is: this
     * is a mark inside a box on a mat, and the Banner is already saying the
     * long form at the top of the screen. Two registers, one fact.
     */
    moment: {
      mulligan: 'Mulligan',
      blockStep: 'Block',
      counterStep: 'Counter',
    },
    phaseTrack: 'Phases',
    currentPhase: (name: string): string => `Current phase: ${name}`,
  },

  card: {
    /** The tile's accessible name, assembled in one place so it reads as a sentence. */
    tile: (parts: {
      name: string;
      cost: number | null;
      power: number;
      counter: number | null;
      rested: boolean;
      boosts: readonly string[];
    }): string => {
      const cost = parts.cost === null ? '' : `cost ${parts.cost}, `;
      const counter = parts.counter === null ? 'no Counter' : `Counter ${parts.counter}`;
      const rested = parts.rested ? ', rested' : '';
      const boost = parts.boosts.length > 0 ? `, ${parts.boosts.join(', ')}` : '';
      return `${parts.name}, ${cost}power ${parts.power}, ${counter}${rested}${boost}`;
    },
    tooltipPower: (printed: number, lines: readonly string[]): string =>
      `Power ${printed} base · ${lines.join(' · ')}`,
    triggerPrefix: '[Trigger]',
  },

  preview: {
    paneLabel: 'Card view',
    empty: 'Hover a card',
    cost: 'Cost',
    power: 'Power',
    /** Abbreviated on purpose: the stat column is fixed-width. See the glossary. */
    counter: 'Counter',
    printedPower: (value: number): string => `${value} printed`,
    fromEffect: 'Effect resolving',
    /**
     * The card text a Spanish reader is looking at is not Bandai's — there is no
     * official Spanish printing. Said once, quietly, where the text is.
     */
    unofficialTranslation: 'Unofficial fan translation',
  },

  power: {
    fromDon: (value: number): string => `+${value} from attached DON!!`,
    temporary: (value: number, sources: readonly string[]): string =>
      `${value > 0 ? '+' : ''}${value} temporary${sources.length > 0 ? ` (${list(sources)})` : ''}`,
    continuous: (value: number, sources: readonly string[]): string =>
      `${value > 0 ? '+' : ''}${value} continuous (${
        sources.length > 0 ? list(sources) : 'continuous effect'
      })`,
    granted: (keywords: readonly string[]): string => `Granted: ${list(keywords)}`,
  },

  menu: {
    play: 'Play',
    attack: 'Attack',
    block: 'Block',
    counter: 'Use as Counter',
    counterEvent: 'Play as a [Counter] Event',
    activate: 'Activate ability',
  },

  mulligan: {
    title: (player: string): string => `${player} — mulligan?`,
    hint: 'Look at your opening hand. Taking a mulligan returns these 5 cards and draws 5 new ones.',
    keep: 'Keep',
    mulligan: 'Mulligan',
  },

  handoff: {
    title: (player: string): string => `Hand the device to ${player}`,
    hint: 'Once you are holding it, tap “Ready” to see your position.',
  },

  trashChoice: {
    title: 'The field is full — choose a Character to trash',
    andPlay: (name: string): string => ` and play ${name}`,
  },

  pile: {
    label: (player: string): string => `${player}'s trash`,
    title: (player: string, count: number): string => `${player}'s trash (${count})`,
    hint: 'Most recent first. Hover a card to read it.',
  },

  battle: {
    step: {
      attack: 'Attack Step',
      block: 'Block Step',
      counter: 'Counter Step',
      damage: 'Damage Step',
    },
    attacks: (player: string): string => `Attacks · ${player}`,
    defends: (player: string): string => `Defends · ${player}`,
    blocked: ' (blocked)',
    dontBlock: "Don't block",
    dontCounter: "Don't Counter",
  },

  gameOver: {
    title: (player: string): string => `${player} wins`,
    reason: (loser: string, endReason: 'lifeOut' | 'deckOut' | 'concede'): string =>
      endReason === 'lifeOut'
        ? `${loser} ran out of Life`
        : endReason === 'deckOut'
          ? `${loser} ran out of deck`
          : `${loser} conceded`,
    rematch: 'Rematch (same seed)',
    newGame: 'New game',
  },

  choice: {
    dialogLabel: 'Choice',
    decides: (player: string): string => `${player} decides`,
    previewHint: 'The card is shown in the panel on the left',
    exactly: (count: number): string => `Choose exactly ${count}`,
    upTo: (max: number): string => `Choose up to ${max}`,
    upToNone: (max: number): string => `Choose up to ${max} (you may choose none)`,
    between: (min: number, max: number): string => `Choose between ${min} and ${max}`,
    blindExactly: (count: number): string => `Choose exactly ${count} without seeing them`,
    blindUpTo: (max: number): string => `Choose up to ${max} without seeing them`,
    orderHint: 'Tap the cards in the order you will draw them: the first one goes on top',
    partitionHint:
      'Tap the cards in the order you will draw them and choose the end for each one: within a side, the first is drawn first',
    progressSelected: (count: number): string => `${count} selected`,
    progressOrdered: (count: number, total: number): string => `${count} of ${total} ordered`,
    progressPartition: (count: number, total: number, top: number, bottom: number): string =>
      `${count} of ${total} ordered — ${top} to the top, ${bottom} to the bottom`,
    progressBlind: (count: number, total: number): string => `${count} of ${total} selected`,
    blindNote:
      "These are cards from your opponent's hand: you choose blind, by position, and there is nothing to enlarge.",
    blindCard: (index: number, total: number): string => `Hidden card ${index} of ${total}`,
    unordered: 'not ordered',
    position: (index: number): string => `position ${index}`,
    toTop: 'to the top of the deck',
    toBottom: 'to the bottom of the deck',
    top: 'Top',
    bottom: 'Bottom',
  },

  net: {
    connecting: 'Connecting…',
    lost: 'The connection dropped. Retrying… You lose nothing: everything that happened will be there when you come back.',
    serverErrorFallback: (code: string): string => `Server error: ${code}`,
    opponentDeciding: (player: string, kind: string): string => `${player} is deciding (${kind})`,
    rejected: (reason: string): string => `The server refused that move: ${reason}`,
    choiceKind: {
      selectCards: 'choose cards',
      yesNo: 'answer yes or no',
      selectOption: 'choose an option',
      orderCards: 'order cards',
      partitionCards: 'split cards between the ends of the deck',
    } as Record<string, string>,
  },

  keyword: {
    rush: 'Rush',
    blocker: 'Blocker',
    doubleAttack: 'Double Attack',
    banish: 'Banish',
  } satisfies Record<Keyword, string>,

  log: {
    zone: {
      hand: 'their hand',
      deck: 'their deck',
      trash: 'the trash',
      life: 'their Life area',
    },
    noEffect: ' — no effect',
    gameStarted: (first: string): string => `The game begins (${first} goes first)`,
    mulliganTaken: (accepted: boolean): string =>
      accepted ? 'takes a mulligan and draws a new hand' : 'keeps their opening hand',
    lifeSet: (count: number): string => `sets ${count} Life cards`,
    turnStarted: (turn: number): string => `begins turn ${turn}`,
    cardDrawnHidden: 'draws a card',
    cardDrawn: (name: string): string => `draws ${name}`,
    donGained: (count: number): string => `gains ${count} DON!!`,
    donAttached: (count: number, target: string): string =>
      `attaches ${count} DON!! to ${target}`,
    donPaid: (count: number): string => `pays ${count} DON!!`,
    donReturnedRested: (count: number): string =>
      `gets back ${count} rested DON!! (unusable this turn)`,
    donReturnedActive: (count: number): string => `gets back ${count} active DON!!`,
    donRested: (count: number): string => `rests ${count} DON!! in their cost area`,
    donSetActive: (count: number): string => `sets ${count} DON!! in their cost area as active`,
    cardPlayed: (name: string): string => `plays ${name}`,
    characterTrashedForRoom: (name: string): string => `trashes ${name} to make room`,
    stageReplaced: (oldStage: string, newStage: string): string =>
      `replaces ${oldStage} with ${newStage}`,
    attackDeclared: (attacker: string, target: string): string =>
      `attacks ${target} with ${attacker}`,
    blockDeclared: (blocker: string): string => `blocks with ${blocker}`,
    counterPlayed: (name: string, value: number, target: string): string =>
      `uses ${name} as a Counter (+${value}) on ${target}`,
    battleResolved: (outcome: string): string => `battle resolved: ${outcome}`,
    outcomeKo: (target: string): string => `${target} is K.O.'d`,
    outcomeLifeDamage: 'the attack hits the Life area',
    outcomeKoPrevented: (target: string): string => `${target} cannot be K.O.'d in battle`,
    outcomeNoEffect: 'the attack has no effect',
    battleEndedEarly: (who: string): string => `the battle breaks off: ${who} is no longer in play`,
    bothCombatants: 'both combatants',
    lifeTaken: (remaining: number): string => `loses a Life card (${remaining} left)`,
    koed: (name: string): string => `${name} is K.O.'d`,
    abilityTriggered: (source: string): string => `activates the ability of ${source}`,
    abilityDeclined: (source: string): string => `does not activate the ability of ${source}`,
    choiceOpenedBare: 'must choose',
    choiceOpened: (prompt: string): string => `must choose: ${prompt}`,
    choiceAnswered: 'answers the choice',
    powerGranted: (target: string, value: number): string => `${target} gains ${value} power`,
    keywordGranted: (target: string, keyword: string): string => `${target} gains ${keyword}`,
    legalitySet: (source: string, effect: 'forbid' | 'allow', question: string): string =>
      `${source} ${effect === 'forbid' ? 'restricts' : 'widens'}: ${question}`,
    legalityActivateBlocker: 'activating [Blocker]',
    legalityAttack: 'choosing what to attack',
    legalityKoInBattle: 'being K.O.’d in battle',
    becameRested: (name: string): string => `${name} becomes rested`,
    becameActive: (name: string): string => `${name} becomes active`,
    cardMoved: (name: string, zone: string): string => `moves ${name} to ${zone}`,
    cardDiscarded: (name: string): string => `trashes ${name}`,
    cardsRevealed: (what: string): string => `reveals ${what}`,
    cardsLookedAt: (what: string): string => `looks at ${what} from the top of their deck`,
    deckPartitioned: (top: number, bottom: number): string =>
      `puts ${top} cards on top and ${bottom} at the bottom of their deck`,
    deckOrdered: (what: string): string =>
      `puts ${what} at the bottom of their deck in the order they chose`,
    deckShuffled: (count: number): string => `shuffles their deck (${count} cards)`,
    donAddedActive: (count: number): string =>
      `adds ${count} active DON!! from their DON!! deck`,
    donAddedRested: (count: number): string =>
      `adds ${count} rested DON!! from their DON!! deck`,
    donReturnedToDeck: (count: number): string => `returns ${count} DON!! to their DON!! deck`,
    lifeBanished: (remaining: number): string =>
      `loses a Life card to the trash (${remaining} left)`,
    turnEnded: (turn: number): string => `ends turn ${turn}`,
    gameEnded: (reason: string): string => `wins the game (${reason})`,
    endReasonLifeOut: 'out of Life',
    endReasonDeckOut: 'out of deck',
    endReasonConcede: 'by concession',
  },

  /**
   * The refusal codes, said as sentences.
   *
   * **The code travels, the sentence does not.** `ReasonCode` is a stable part
   * of the engine's public contract and crosses the wire unchanged; what a
   * player reads is chosen here, on their own device, in their own language.
   */
  reason: {
    gameFinished: 'the game is already over',
    unknownPlayer: 'that player does not exist',
    malformedAction: 'that move was malformed',
    notYourPriority: 'it is not your turn to act',
    wrongStatus: 'that move does not belong to this stage of the game',
    battleInProgress: 'there is a battle in progress',
    noBattle: 'there is no battle open',
    wrongBattleStep: 'that move does not belong to this step of the battle',
    cardNotInHand: 'that card is not in your hand',
    unplayableCategory: 'that kind of card cannot be played like that',
    notEnoughDon: 'not enough DON!!',
    trashChoiceRequired: 'the field is full: choose a Character to trash',
    trashChoiceNotAllowed: 'there is no room to make here',
    invalidTrashChoice: 'that Character cannot be trashed to make room',
    invalidCount: 'that amount is not valid',
    invalidAttachTarget: 'DON!! cannot be attached to that card',
    notEnoughActiveDon: 'not enough active DON!!',
    invalidAttacker: 'that card cannot attack',
    attackerNotActive: 'that card is rested',
    cannotAttackYet: 'that card cannot attack yet',
    firstTurnAttackForbidden: 'no attacking on the first turn',
    invalidTarget: 'that target is not valid',
    targetNotRested: 'that target is not rested',
    invalidBlocker: 'that card cannot block',
    notABlocker: 'that card has no [Blocker]',
    blockerNotActive: 'that blocker is rested',
    blockForbidden: 'an effect forbids that block',
    attackForbidden: 'an effect forbids that attack',
    noCounterValue: 'that card has no Counter',
    invalidCounterTarget: 'that Counter target is not valid',
    notACounterEvent: 'that card is not a [Counter] Event',
    unknownAbility: 'that ability does not exist',
    abilityNotActivatable: 'that ability cannot be activated',
    abilitySourceNotOnField: 'the card of that ability is not on the field',
    abilityConditionUnmet: 'the condition of that ability is not met',
    abilityCostUnpayable: 'the cost of that ability cannot be paid',
    abilityAlreadyUsed: 'that ability was already used this turn',
    choicePending: 'there is a choice waiting to be answered',
    noPendingChoice: 'there is no choice open',
    missingAnswer: 'that answer is missing',
    wrongChoiceId: 'that answer belongs to another choice',
    notYourChoice: 'that choice is not yours',
    choiceKindMismatch: 'that is not the kind of answer this choice takes',
    choiceCardinality: 'that is not the number of cards this choice takes',
    choiceCandidateUnknown: 'that card is not one of the candidates',
    choiceDuplicateSelection: 'the same card was chosen twice',
    choiceOptionOutOfRange: 'that option does not exist',
    choiceNotBlind: 'this choice is answered by card, not blind',
    choiceHandleOutOfRange: 'that position does not exist',
  } satisfies Record<ReasonCode, string>,

  serverError: {
    protocolMismatch: 'The server speaks another version of the protocol. Update the client.',
    unknownMatch: 'That match does not exist on the server.',
    unknownDeck: 'The server does not know that deck.',
    badToken: 'That seat code is not valid for this match.',
    seatMismatch: 'That move belonged to the other seat.',
    notJoined: 'You have not joined the match yet.',
    malformedMessage: 'The server did not understand the message.',
  } satisfies Record<ServerErrorCode, string>,
};

/** The shape every locale has to fill. English defines it; nobody else may. */
export type Messages = typeof en;

// Neutral Latin-American Spanish: `tú`, never `vos`, never `vosotros`, and no
// regionalisms. The reader this is written for is a Spanish-speaking child, so
// the sentences are short and say what to do.
//
// Game terms come from `docs/i18n-glossary.md` and from nowhere else — the same
// word for the same mechanic here and across all 155 card texts. A `[Blocker]`
// that is "Bloqueador" on a card and "Defensor" on a button teaches nothing.
//
// This file is typed `Messages`, which is `typeof en`: a key English has and
// this file does not is a compile error, and so is a parameter list that drifts.
import type { Messages } from './en';

/** Joins a list the way the language does. Spanish: "a, b y c". */
function lista(items: readonly string[]): string {
  if (items.length <= 1) {
    return items[0] ?? '';
  }
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1] ?? ''}`;
}

export const es: Messages = {
  language: {
    label: 'Idioma',
    en: 'English',
    es: 'Español',
  },

  playmat: {
    label: 'Tapete',
    forPlayer: (player) => `Tapete — ${player}`,
    neutral: 'Neutro',
  },

  common: {
    playerOne: 'Jugador 1',
    playerTwo: 'Jugador 2',
    hiddenCard: 'una carta',
    hiddenCardLabel: 'Carta oculta',
    cards: (count) => (count === 1 ? '1 carta' : `${count} cartas`),
    cancel: 'Cancelar',
    close: 'Cerrar',
    confirm: 'Confirmar',
    back: 'Volver',
    yes: 'Sí',
    no: 'No',
    ready: 'Listo',
  },

  deck: {
    testRed: 'Rojo (TEST)',
    testGreen: 'Verde (TEST)',
  },

  setup: {
    title: 'Nueva partida',
    seed: 'Semilla',
    randomSeed: 'Aleatoria',
    deckP1: 'Mazo de Jugador 1',
    deckP2: 'Mazo de Jugador 2',
    firstPlayer: 'Primer jugador',
    play: 'Jugar',
    network: 'Jugar en red',
  },

  lobby: {
    title: 'Jugar en red',
    server: 'Servidor',
    resume: 'Volver a la partida guardada',
    createSection: 'Crear partida',
    yourDeck: 'Tu mazo',
    opponentDeck: 'Mazo del rival',
    seed: 'Semilla',
    randomSeed: 'Aleatoria',
    create: 'Crear partida',
    creating: 'Creando…',
    matchWord: 'Partida',
    shareCode: 'Dale a tu rival este código:',
    enterAsP1: 'Entrar como Jugador 1',
    joinSection: 'Unirse a una partida',
    joinTitle: 'Unirse',
    matchField: 'Partida',
    seatCode: 'Código de asiento',
    join: 'Unirse',
    createFailed: (code) => `No se pudo crear la partida: ${code}`,
    noConnection: 'El servidor no respondió.',
  },

  board: {
    logTitle: 'Registro',
    turnShort: (turn) => `T${turn}`,
    leader: 'Líder',
    stage: 'Escenario',
    life: 'Vida',
    characterArea: 'Área de Personajes',
    costArea: 'Área de Coste',
    deck: 'Mazo',
    donDeck: 'Mazo de DON!!',
    trash: 'Descarte',
    hand: (count) => `Mano (${count})`,
    handOf: (owner) => `Mano de ${owner}`,
    fieldOf: (owner) => `Campo de ${owner}`,
    donArea: (active, rested) =>
      `DON!! en el área de coste: ${active} activos, ${rested} agotados`,
    donActive: (count) => `Activos: ${count}`,
    donRested: (count) => `Agotados: ${count}`,
    pile: (label, count) => `${label}: ${count} cartas${count === 0 ? '' : ', ver'}`,
    endTurn: 'Terminar turno',
    veilOpponentHand: 'Velar mano del rival',
    concede: 'Rendirse',
    turnOf: (player) => `Turno de ${player}`,
    decidesEffect: (player) => `${player} decide un efecto`,
    responds: (player) => `${player} responde`,
    wins: (player) => `Gana ${player}`,
    phase: {
      mulligan: 'Mulligan',
      main: 'Fase principal',
      blockStep: 'Paso de Bloqueo',
      counterStep: 'Paso de Contraataque',
      finished: 'Partida terminada',
    },
    turnPhase: {
      refresh: 'Refresco',
      draw: 'Robo',
      don: 'DON!!',
      main: 'Principal',
      end: 'Fin',
    },
    moment: {
      mulligan: 'Mulligan',
      blockStep: 'Bloqueo',
      counterStep: 'Contraataque',
    },
    phaseTrack: 'Fases',
    currentPhase: (name) => `Fase actual: ${name}`,
  },

  card: {
    tile: (parts) => {
      const cost = parts.cost === null ? '' : `coste ${parts.cost}, `;
      const counter =
        parts.counter === null ? 'sin Contraataque' : `Contraataque ${parts.counter}`;
      const rested = parts.rested ? ', agotada' : '';
      const boost = parts.boosts.length > 0 ? `, ${parts.boosts.join(', ')}` : '';
      return `${parts.name}, ${cost}poder ${parts.power}, ${counter}${rested}${boost}`;
    },
    tooltipPower: (printed, lines) => `Poder ${printed} base · ${lines.join(' · ')}`,
    triggerPrefix: '[Disparador]',
  },

  preview: {
    paneLabel: 'Vista de carta',
    empty: 'Pasa el cursor por una carta',
    cost: 'Coste',
    power: 'Poder',
    counter: 'Contra.',
    printedPower: (value) => `${value} impreso`,
    fromEffect: 'Efecto en resolución',
    unofficialTranslation: 'Traducción no oficial hecha por fans',
  },

  power: {
    fromDon: (value) => `+${value} por DON!! adjuntados`,
    temporary: (value, sources) =>
      `${value > 0 ? '+' : ''}${value} temporal${sources.length > 0 ? ` (${lista(sources)})` : ''}`,
    continuous: (value, sources) =>
      `${value > 0 ? '+' : ''}${value} continuo (${
        sources.length > 0 ? lista(sources) : 'efecto continuo'
      })`,
    granted: (keywords) => `Otorgado: ${lista(keywords)}`,
  },

  menu: {
    play: 'Jugar',
    attack: 'Atacar',
    block: 'Bloquear',
    counter: 'Usar de Contraataque',
    counterEvent: 'Jugar como Evento [Contraataque]',
    activate: 'Activar habilidad',
  },

  mulligan: {
    title: (player) => `${player} — ¿mulligan?`,
    hint: 'Mira tu mano inicial. Si tomas mulligan, devuelves estas 5 cartas y robas 5 nuevas.',
    keep: 'Conservar',
    mulligan: 'Mulligan',
  },

  handoff: {
    title: (player) => `Pasa el dispositivo a ${player}`,
    hint: 'Cuando lo tengas en la mano, toca “Listo” para ver tu posición.',
  },

  trashChoice: {
    title: 'El campo está lleno — elige un Personaje para descartar',
    andPlay: (name) => ` y jugar ${name}`,
  },

  pile: {
    label: (player) => `Descarte de ${player}`,
    title: (player, count) => `Descarte de ${player} (${count})`,
    hint: 'Más reciente primero. Pasa el cursor por una carta para verla.',
  },

  battle: {
    step: {
      attack: 'Paso de Ataque',
      block: 'Paso de Bloqueo',
      counter: 'Paso de Contraataque',
      damage: 'Paso de Daño',
    },
    attacks: (player) => `Ataca · ${player}`,
    defends: (player) => `Defiende · ${player}`,
    blocked: ' (bloqueado)',
    dontBlock: 'No bloquear',
    dontCounter: 'No usar Contraataque',
  },

  gameOver: {
    title: (player) => `Gana ${player}`,
    reason: (loser, endReason) =>
      endReason === 'lifeOut'
        ? `${loser} se quedó sin Vida`
        : endReason === 'deckOut'
          ? `${loser} se quedó sin mazo`
          : `${loser} se rindió`,
    rematch: 'Revancha (misma semilla)',
    newGame: 'Nueva partida',
  },

  choice: {
    dialogLabel: 'Elección',
    decides: (player) => `${player} decide`,
    previewHint: 'La carta está en la vista de la izquierda',
    exactly: (count) => `Elige exactamente ${count}`,
    upTo: (max) => `Elige hasta ${max}`,
    upToNone: (max) => `Elige hasta ${max} (puedes no elegir ninguna)`,
    between: (min, max) => `Elige entre ${min} y ${max}`,
    blindExactly: (count) => `Elige exactamente ${count} sin verlas`,
    blindUpTo: (max) => `Elige hasta ${max} sin verlas`,
    orderHint:
      'Toca las cartas en el orden en que las vas a robar: la primera queda en el tope',
    partitionHint:
      'Toca las cartas en el orden en que las vas a robar y elige el extremo de cada una: dentro de cada lado, la primera se roba antes',
    progressSelected: (count) => `${count} seleccionadas`,
    progressOrdered: (count, total) => `${count} de ${total} ordenadas`,
    progressPartition: (count, total, top, bottom) =>
      `${count} de ${total} ordenadas — ${top} al tope, ${bottom} al fondo`,
    progressBlind: (count, total) => `${count} de ${total} seleccionadas`,
    blindNote:
      'Son cartas de la mano de tu rival: eliges a ciegas, por posición, y no hay nada que ampliar.',
    blindCard: (index, total) => `Carta oculta ${index} de ${total}`,
    unordered: 'sin ordenar',
    position: (index) => `posición ${index}`,
    toTop: 'al tope del mazo',
    toBottom: 'al fondo del mazo',
    top: 'Tope',
    bottom: 'Fondo',
  },

  net: {
    connecting: 'Conectando…',
    lost: 'Se cortó la conexión. Reintentando… No pierdes nada: al volver verás todo lo que pasó.',
    serverErrorFallback: (code) => `Error del servidor: ${code}`,
    opponentDeciding: (player, kind) => `${player} está decidiendo (${kind})`,
    rejected: (reason) => `El servidor rechazó esa jugada: ${reason}`,
    choiceKind: {
      selectCards: 'elegir cartas',
      yesNo: 'responder sí o no',
      selectOption: 'elegir una opción',
      orderCards: 'ordenar cartas',
      partitionCards: 'repartir cartas entre los extremos del mazo',
    },
  },

  // Two translated, two kept. The criterion and the reasoning are in
  // docs/i18n-glossary.md; the short version is that `Rush` and `Banish` are the
  // two the cards always explain in the reminder text right after them.
  keyword: {
    rush: 'Rush',
    blocker: 'Bloqueador',
    doubleAttack: 'Doble Ataque',
    banish: 'Banish',
  },

  log: {
    zone: {
      hand: 'su mano',
      deck: 'su mazo',
      trash: 'el descarte',
      life: 'su área de Vida',
    },
    noEffect: ' — sin efecto',
    gameStarted: (first) => `Comienza la partida (empieza ${first})`,
    mulliganTaken: (accepted) =>
      accepted ? 'toma mulligan y roba una mano nueva' : 'conserva su mano inicial',
    lifeSet: (count) => `coloca ${count} cartas de Vida`,
    turnStarted: (turn) => `comienza el turno ${turn}`,
    cardDrawnHidden: 'roba una carta',
    cardDrawn: (name) => `roba ${name}`,
    donGained: (count) => `gana ${count} DON!!`,
    donAttached: (count, target) => `adjunta ${count} DON!! a ${target}`,
    donPaid: (count) => `paga ${count} DON!!`,
    donReturnedRested: (count) => `recupera ${count} DON!! agotados (no usables este turno)`,
    donReturnedActive: (count) => `recupera ${count} DON!! activos`,
    donRested: (count) => `agota ${count} DON!! de su área de coste`,
    donSetActive: (count) => `pone activos ${count} DON!! de su área de coste`,
    cardPlayed: (name) => `juega ${name}`,
    characterTrashedForRoom: (name) => `descarta ${name} para hacer sitio`,
    stageReplaced: (oldStage, newStage) => `reemplaza ${oldStage} por ${newStage}`,
    attackDeclared: (attacker, target) => `ataca con ${attacker} a ${target}`,
    blockDeclared: (blocker) => `bloquea con ${blocker}`,
    counterPlayed: (name, value, target) =>
      `usa ${name} como Contraataque (+${value}) sobre ${target}`,
    battleResolved: (outcome) => `combate resuelto: ${outcome}`,
    outcomeKo: (target) => `${target} queda K.O.`,
    outcomeLifeDamage: 'el ataque impacta en el área de Vida',
    outcomeKoPrevented: (target) => `${target} no puede quedar K.O. en combate`,
    outcomeNoEffect: 'el ataque no tiene efecto',
    battleEndedEarly: (who) => `el combate se disipa: ${who} ya no está en juego`,
    bothCombatants: 'ambos combatientes',
    lifeTaken: (remaining) => `pierde una carta de Vida (quedan ${remaining})`,
    koed: (name) => `${name} queda K.O.`,
    abilityTriggered: (source) => `activa la habilidad de ${source}`,
    abilityDeclined: (source) => `no activa la habilidad de ${source}`,
    choiceOpenedBare: 'debe elegir',
    choiceOpened: (prompt) => `debe elegir: ${prompt}`,
    choiceAnswered: 'responde la elección',
    powerGranted: (target, value) => `${target} gana ${value} de poder`,
    keywordGranted: (target, keyword) => `${target} gana ${keyword}`,
    legalitySet: (source, effect, question) =>
      `${source} ${effect === 'forbid' ? 'restringe' : 'amplía'}: ${question}`,
    legalityActivateBlocker: 'activar [Bloqueador]',
    legalityAttack: 'elegir a quién atacar',
    legalityKoInBattle: 'quedar K.O. en combate',
    becameRested: (name) => `${name} queda agotada`,
    becameActive: (name) => `${name} queda activa`,
    cardMoved: (name, zone) => `mueve ${name} a ${zone}`,
    cardDiscarded: (name) => `descarta ${name}`,
    cardsRevealed: (what) => `revela ${what}`,
    cardsLookedAt: (what) => `mira ${what} del tope de su mazo`,
    deckPartitioned: (top, bottom) =>
      `pone ${top} cartas al tope y ${bottom} al fondo de su mazo`,
    deckOrdered: (what) => `pone ${what} al fondo de su mazo en el orden que eligió`,
    deckShuffled: (count) => `baraja su mazo (${count} cartas)`,
    donAddedActive: (count) => `agrega ${count} DON!! activo de su mazo de DON!!`,
    donAddedRested: (count) => `agrega ${count} DON!! agotado de su mazo de DON!!`,
    donReturnedToDeck: (count) => `devuelve ${count} DON!! a su mazo de DON!!`,
    lifeBanished: (remaining) => `pierde una carta de Vida al descarte (quedan ${remaining})`,
    turnEnded: (turn) => `termina el turno ${turn}`,
    gameEnded: (reason) => `gana la partida (${reason})`,
    endReasonLifeOut: 'sin Vida',
    endReasonDeckOut: 'sin mazo',
    endReasonConcede: 'por concesión',
  },

  reason: {
    gameFinished: 'la partida ya terminó',
    unknownPlayer: 'ese jugador no existe',
    malformedAction: 'esa jugada estaba mal formada',
    notYourPriority: 'no es tu turno de actuar',
    wrongStatus: 'esa jugada no corresponde a esta etapa de la partida',
    battleInProgress: 'hay un combate en curso',
    noBattle: 'no hay ningún combate abierto',
    wrongBattleStep: 'esa jugada no corresponde a este paso del combate',
    cardNotInHand: 'esa carta no está en tu mano',
    unplayableCategory: 'ese tipo de carta no se juega así',
    notEnoughDon: 'no te alcanzan los DON!!',
    trashChoiceRequired: 'el campo está lleno: elige un Personaje para descartar',
    trashChoiceNotAllowed: 'aquí no hay que hacer sitio',
    invalidTrashChoice: 'ese Personaje no se puede descartar para hacer sitio',
    invalidCount: 'esa cantidad no es válida',
    invalidAttachTarget: 'no se pueden adjuntar DON!! a esa carta',
    notEnoughActiveDon: 'no te alcanzan los DON!! activos',
    invalidAttacker: 'esa carta no puede atacar',
    attackerNotActive: 'esa carta está agotada',
    cannotAttackYet: 'esa carta todavía no puede atacar',
    firstTurnAttackForbidden: 'en el primer turno no se puede atacar',
    invalidTarget: 'ese objetivo no es válido',
    targetNotRested: 'ese objetivo no está agotado',
    invalidBlocker: 'esa carta no puede bloquear',
    notABlocker: 'esa carta no tiene [Bloqueador]',
    blockerNotActive: 'ese bloqueador está agotado',
    blockForbidden: 'un efecto prohíbe ese bloqueo',
    attackForbidden: 'un efecto prohíbe ese ataque',
    noCounterValue: 'esa carta no tiene Contraataque',
    invalidCounterTarget: 'ese objetivo de Contraataque no es válido',
    notACounterEvent: 'esa carta no es un Evento con [Contraataque]',
    unknownAbility: 'esa habilidad no existe',
    abilityNotActivatable: 'esa habilidad no se puede activar',
    abilitySourceNotOnField: 'la carta de esa habilidad no está en el campo',
    abilityConditionUnmet: 'no se cumple la condición de esa habilidad',
    abilityCostUnpayable: 'no se puede pagar el coste de esa habilidad',
    abilityAlreadyUsed: 'esa habilidad ya se usó este turno',
    choicePending: 'hay una elección esperando respuesta',
    noPendingChoice: 'no hay ninguna elección abierta',
    missingAnswer: 'falta la respuesta',
    wrongChoiceId: 'esa respuesta es de otra elección',
    notYourChoice: 'esa elección no es tuya',
    choiceKindMismatch: 'esa no es la clase de respuesta que pide esta elección',
    choiceCardinality: 'esa no es la cantidad de cartas que pide esta elección',
    choiceCandidateUnknown: 'esa carta no es una de las candidatas',
    choiceDuplicateSelection: 'elegiste la misma carta dos veces',
    choiceOptionOutOfRange: 'esa opción no existe',
    choiceNotBlind: 'esta elección se responde por carta, no a ciegas',
    choiceHandleOutOfRange: 'esa posición no existe',
  },

  serverError: {
    protocolMismatch: 'El servidor habla otra versión del protocolo. Actualiza el cliente.',
    unknownMatch: 'Esa partida no existe en el servidor.',
    unknownDeck: 'El servidor no conoce ese mazo.',
    badToken: 'Ese código de asiento no es válido para esta partida.',
    seatMismatch: 'Ese movimiento era del otro asiento.',
    notJoined: 'Todavía no entraste a la partida.',
    malformedMessage: 'El servidor no entendió el mensaje.',
  },
};

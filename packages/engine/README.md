# @optcg/engine — One Piece Card Game rules engine (Phase 0)

A pure, deterministic, fully serializable rules core for an OPTCG simulator.
No card effects, no UI, no server. `SPEC.md` in this package is the binding
contract; this README explains the model, what is implemented, what is not, and
the judgement calls made where the rules are ambiguous.

## Quick start

```bash
pnpm install
```

```bash
pnpm --filter @optcg/engine test
```

```bash
pnpm --filter @optcg/engine sim -- --games 1000
```

The simulation accepts `--games N`, `--seed-base N`, and `--fast`. A bare `--`
separator is tolerated, so `pnpm sim --games 50` works too.

## Public API

```ts
createGame({ seed, decks, firstPlayer }): GameState
applyAction(state, action): { ok: true; state; events } | { ok: false; reason }
legalActions(state, player): Action[]
getPower(state, instanceId): number
```

- `applyAction` is a pure reducer. It never mutates its input, never performs
  I/O, and never throws for an illegal action — it returns `{ ok: false, reason }`
  with a stable reason code.
- `applyAction` always revalidates. It never assumes the action came from
  `legalActions`, so an untrusted client action is safe to pass straight in.
- `legalActions` is pure and exhaustive: every legal action appears, and every
  action it emits validates successfully. A unit test pins that property in both
  directions, which is what keeps the two functions from drifting apart.

Exceptions are reserved for programming errors, not game moves: `createGame`
throws on a malformed decklist, and the reducer throws if it reaches a state
validation should have excluded. Engine bugs must be loud; illegal player input
must not be.

## State model

The state is normalized. A single `cards: Record<InstanceId, CardInstance>`
registry holds every physical copy, and zones store only ordered arrays of ids.

```
GameState
├── status / winner / endReason / turn / phase
├── activePlayer · firstPlayer · priority
├── players: { p1, p2 }
│   └── leader · characters[] · stage · hand · deck · trash · life · don[] · hasMulliganed
├── cards: Record<InstanceId, CardInstance>
├── battle: Battle | null
├── modifiers: Modifier[]
├── rng: { seed, cursor }
├── log: GameEvent[]
└── rules: { firstPlayerCannotAttackTurnOne }
```

Ordering conventions, all load-bearing for replay compatibility:

| Array   | `[0]` means                                  |
| ------- | -------------------------------------------- |
| `deck`  | top of the deck (next card drawn)            |
| `trash` | most recently trashed card                   |
| `life`  | top life card (the next one damage takes)    |

**Power is never stored.** It is derived on every read:

```
getPower(state, id) = printed power
                    + attachedDon.length * 1000
                    + sum of power modifiers targeting the card
```

`CardDefinition` (name, cost, power, counter, life, color, category, keywords)
lives in a module-level registry and never enters `GameState`; the state stores
only `cardId`. This is what keeps the state serializable and small.

### Serializability

`GameState` contains no classes, functions, `Map`/`Set`, `Date`, or
`Math.random`. `JSON.parse(JSON.stringify(state))` is deep-equal to the original
at every step. Two rules make that hold in practice:

- The state never stores an explicit `undefined`, because a JSON round-trip
  drops those keys and `assert.deepStrictEqual` would then report a difference.
  `exactOptionalPropertyTypes` in the compiler config enforces it statically.
- Off-field cards are always normalized: `orientation: 'active'`,
  `attachedDon: []`, `playedOnTurn: null`. Two states that a player cannot
  distinguish are therefore also structurally identical.

The engine uses immer with auto-freezing on, and `createGame` freezes its
result, so accidental mutation of an engine-returned state throws immediately
rather than corrupting a later comparison.

## Determinism and RNG

The generator is a counter-based mulberry32 whose entire state is the
serializable pair `{ seed, cursor }`. The value at cursor `c` equals the
`(c+1)`-th output of the classic sequential generator, so the stream is
random-access and no hidden generator object exists. `Math.imul` keeps the
multiplication in 32-bit space; a plain `*` would silently lose low bits once
the cursor grows large.

Shuffling is Fisher–Yates and consumes exactly one value per swap. Same seed
plus same action sequence produces a byte-identical state — verified by unit
test and, in the simulation, by replaying every finished game's whole action log
from scratch and comparing the final states.

## Turn structure

Refresh, Draw, and DON!! are automatic. They run inside the turn transition, not
as player actions. A consequence worth knowing when reading state dumps: **every
resting state during play has `phase === 'main'`**. The other phase values
describe steps that happen inside a single `applyAction` call and show up in the
event log rather than as a state you can observe between actions.

1. **Refresh** — your rested cards become active; your attached DON!! return to
   your cost area **active**; your rested cost DON!! become active.
2. **Draw** — draw 1. The first player skips this on turn 1. If the deck is
   empty at this moment, the game ends in `deckOut`.
3. **DON!!** — gain `min(2, donDeckRemaining, 10 - costAreaCount)`; the first
   player gains 1 instead of 2 on turn 1.
4. **Main** — the player acts.
5. **End** — `endOfTurn` modifiers expire, once-per-turn flags clear, the turn
   passes. There is no hand size limit and no end-of-turn discard.

`turn` is a single global counter: the first player takes turns 1, 3, 5, …

## DON!! lifecycle

A DON!! is in exactly one of three places: `donDeck`, `cost` (active or rested),
or `attached` to a card. Two timing details drive most of the subtlety:

- Attached DON!! return to the cost area during **their owner's Refresh**, not
  at the end of their turn. The +1000 therefore persists through the opponent's
  entire turn, which is what makes attaching DON!! defensively worthwhile and
  legal.
- When a carrier card leaves the field, its attached DON!! return to the cost
  area **rested**, not active — so they are unavailable until that player's next
  Refresh.

DON!! are fungible, so paying a cost rests the first N active cost-area DON!! in
array order. Which physical DON!! pays is unobservable; picking deterministically
keeps replays stable.

## Combat

Four steps, no backtracking. `priority` moves to the defender for the block and
counter steps and returns to the attacker afterwards.

```
DECLARE_ATTACK ──> [block] ──PASS──> [counter] ──PASS──> (damage) ──> battle = null
                      │                  │
                 DECLARE_BLOCK      PLAY_COUNTER (repeatable)
                      │                  │
                      └──> [counter] <───┘
```

- **Attack** — rest an active own Leader or Character and declare a target.
  Valid targets: the enemy Leader, or an enemy Character that is **rested**.
  Never an active Character. A Character cannot attack on the turn it was played.
- **Block** — the defender may rest a Character with Blocker to redirect the
  attack. No Phase 0 card has Blocker, so in practice the defender always passes,
  but the step is a real resting state and the validation is real. It is **not**
  auto-skipped: skipping it would change every recorded action log the moment a
  Blocker card is added in Phase 1.
- **Counter** — the defender discards cards from hand for their printed Counter
  value, adding that power to any own Leader or Character, including one not
  involved in the battle. Repeatable. Counters cannot come from the field.
- **Damage** — powers are compared and **the attacker wins ties** (`>=`). Beating
  a Character KOs it; beating the Leader moves the top life card to the
  defender's **hand**; losing does nothing. Damage is never bidirectional.

The damage step is transient: it resolves inside the defender's final `PASS`, so
`battle.step === 'damage'` is never observable between actions. The only resting
battle steps are `block` and `counter`.

All `endOfBattle` modifiers expire when the battle resolves — including on a
`noEffect` outcome and including counters parked on cards that never fought.

## Field limits and leaving the field

Maximum 5 Characters and 1 Stage. Playing a 6th Character requires naming which
of your Characters goes to the trash; that discard is **not** a KO and emits no
`koed` event, which matters for Phase 1 on-KO triggers.

Every exit from the field — KO, discard for room, Stage replacement — goes
through one shared helper, so the DON!!-return-rested rule, modifier cleanup,
and instance normalization cannot drift apart between the three paths.

## Win conditions

| `endReason` | Trigger                                                        |
| ----------- | -------------------------------------------------------------- |
| `lifeOut`   | The Leader takes damage while its controller has 0 life cards.   |
| `deckOut`   | A player must draw and their deck is empty (checked at the draw).|
| `concede`   | `CONCEDE`, legal for either player at any time.                  |

`CONCEDE` is the only action exempt from the priority gate.

## Priority

`priority` names who acts right now. It is the defender during the block and
counter steps and the active player otherwise; during the mulligan it names
whoever still has to decide, first player first.

This yields one universal property, checked after every action in the
simulation: **the player who does not hold priority has exactly `[CONCEDE]`
available**, and once the game is finished both players have none. That is the
acceptance criterion about turn leakage, generalized to cover the battle steps
and the mulligan as well.

## Errors

`applyAction` returns one of these stable codes. They are part of the public
contract and are never renamed.

| Group        | Codes |
| ------------ | ----- |
| Generic      | `gameFinished`, `unknownPlayer`, `malformedAction`, `notYourPriority`, `wrongStatus`, `battleInProgress`, `noBattle`, `wrongBattleStep` |
| `PLAY_CARD`  | `cardNotInHand`, `unplayableCategory`, `notEnoughDon`, `trashChoiceRequired`, `trashChoiceNotAllowed`, `invalidTrashChoice` |
| `ATTACH_DON` | `invalidCount`, `invalidAttachTarget`, `notEnoughActiveDon` |
| `DECLARE_ATTACK` | `invalidAttacker`, `attackerNotActive`, `cannotAttackYet`, `firstTurnAttackForbidden`, `invalidTarget`, `targetNotRested` |
| `DECLARE_BLOCK`  | `invalidBlocker`, `notABlocker`, `blockerNotActive` |
| `PLAY_COUNTER`   | `cardNotInHand`, `noCounterValue`, `invalidCounterTarget` |

There is deliberately no `wrongPhase` code: because the automatic phases run
inside the turn transition, a player holding priority with no battle open is
always in the Main phase.

## Test data

Synthetic vanilla cards only, in `src/testdata/`. The green half mirrors the red
stat lines exactly so equal-power matchups are guaranteed, and both Leaders have
power 5000 so Leader-versus-Leader ties exist.

| Card | Category | Cost | Power | Counter |
| ---- | -------- | ---- | ----- | ------- |
| `TEST-L01` / `TEST-L02` | leader | — | 5000 | — (Life 5 / Life 4) |
| `TEST-001` / `TEST-101` | character | 1 | 2000 | 1000 |
| `TEST-002` / `TEST-102` | character | 1 | 0 | 2000 |
| `TEST-003` / `TEST-103` | character | 2 | 3000 | 1000 |
| `TEST-004` / `TEST-104` | character | 2 | 2000 | 2000 |
| `TEST-005` / `TEST-105` | character | 3 | 4000 | 2000 |
| `TEST-006` / `TEST-106` | character | 4 | 5000 | 1000 |
| `TEST-007` / `TEST-107` | character | 5 | 6000 | 1000 |
| `TEST-008` / `TEST-108` | character | 6 | 7000 | 0 |
| `TEST-009` / `TEST-109` | character | 8 | 9000 | 0 |
| `TEST-010` / `TEST-110` | character | 10 | 12000 | 0 |
| `TEST-011` / `TEST-111` | event | 1 | — | — |
| `TEST-012` / `TEST-112` | event | 3 | — | — |
| `TEST-013` / `TEST-113` | stage | 2 | — | — |

Each 50-card deck is 4 copies of each of the 10 Characters, 4 of each Event, and
2 of the Stage. There are no 0-cost cards, which is part of why bot games are
guaranteed to make progress.

## Bot and simulation

The bot picks uniformly from `legalActions` with two deliberate biases:

- `CONCEDE` is excluded. Left in a uniform pool, essentially every game ends by
  random concession within a few turns, and the resulting statistics validate
  nothing. This is a documented deviation from a strictly uniform bot.
- `END_TURN` is only taken when nothing else remains, so turns actually spend
  resources and games progress toward a real ending.

The bot draws from its own RNG stream and never touches `state.rng`, so the
engine's stream stays a pure function of the action log.

`runGame` asserts after **every** action: the action was accepted, all state
invariants hold, the non-priority player has only `[CONCEDE]`, the state survives
a JSON round-trip, and re-applying the same action to the same input produces an
identical result. Each finished game is then replayed from its full action log
and compared to the live final state. Failures are returned as data — seed,
error, action index, and the complete action log — never thrown, so one bad seed
does not abort the run.

Measured on this machine, 1000 games in full mode: **1000 completed, 0 failures,
19.4 turns on average, longest game 38 turns**, roughly 160 seconds. `--fast`
samples the JSON round-trip instead of doing it every action; it is a dev-loop
convenience and is **not** the spec-compliant mode.

Note that bot games end in `lifeOut` essentially always: at ~19 turns they
finish long before a 41-card post-setup deck could run out. `deckOut` coverage
therefore rests on unit tests, not on the simulation.

## Test suite

112 tests across 15 files. The nine explicitly mandated cases live in:

| Mandated case | File |
| ------------- | ---- |
| Battle tie — attacker wins | `combat.test.ts` |
| Illegal attack on an active Character | `combat.test.ts` |
| First player turn 1 — no draw, 1 DON!! | `turnFlow.test.ts` |
| 10-DON!! cap | `don.test.ts` |
| Attached DON!! return rested when the carrier dies | `combat.test.ts` |
| Counter from hand adding power | `counters.test.ts` |
| 6th character discard without KO | `fieldLimits.test.ts` |
| Loss by life 0 | `winConditions.test.ts` |
| Loss by deck out | `winConditions.test.ts` |

The `invariants` module is shared by the tests and the simulation, and
`invariants.test.ts` corrupts states on purpose to prove each checker actually
fires rather than passing vacuously.

`blocker.test.ts` deserves a note. Because no Phase 0 card has the Blocker
keyword, the redirect branch of the battle FSM is unreachable from the shipped
card set — neither the unit tests nor the simulation could ever enter it, so a
regression there would pass the entire suite unnoticed. That file registers a
Blocker card of its own and drives the branch directly: redirect, blocker
resting, `originalTarget` preservation, damage landing on the blocker instead of
the declared target, and countering a blocker. Vitest isolates the module graph
per file, so the extra card cannot leak into any other test.

## Documented ambiguities and judgement calls

**`rules.firstPlayerCannotAttackTurnOne` (default `true`).** Public sources
contradict each other about whether the "cannot attack on your first turn"
restriction binds only the starting player or both players' first turns. The
flag defaults to binding **only the first player, on global turn 1**. The second
player may attack on turn 2. If you need the other reading, set the flag to
`false` and apply your own restriction, or extend the rule object in Phase 1 —
the check is a single condition in the attack validator.

**Life card ordering.** Life is taken from the top of the deck with `life[0]`
being the former top card, and damage takes `life[0]`. The physical game stacks
life cards in a way that makes the correspondence to deck order a matter of
table convention. Nothing in Phase 0 can observe the difference, but the choice
is a replay-compatibility commitment: changing it later invalidates recorded
games.

**`PLAY_CARD.trashCharacter`.** The action union gained one optional field so
that playing a 6th Character can name the Character being trashed. It is
required exactly when the board is full and forbidden otherwise. The alternative
— having the engine pick — would delete a real player decision, and Phase 1's
effect targeting will need a general pending-choice mechanism into which this
migrates cleanly.

**`CardDefinition.keywords`.** Added (empty on every Phase 0 card) so that
Blocker validation checks something real instead of being hardcoded to reject.

**Perfect information.** The log and state are fully visible; `cardDrawn` carries
the drawn instance id. Per-player hidden-information views are out of scope.

## Out of scope for Phase 0

- Card effects, triggers, and abilities of any kind — every card is vanilla.
- Keywords in play: no card has Blocker (the step and validation exist), and
  Rush, Double Attack, and Banish are absent.
- Trigger effects on life cards: a damaged life card goes straight to hand.
- Counter **events** played from hand for an effect; only printed Counter values
  are used.
- Real card data, deck-construction legality (4-copy limits, color matching),
  and the "don't include the Leader in the deck" style checks beyond basic
  decklist shape validation.
- Hidden-information views, networking, persistence, UI, and AI beyond the
  random bot.

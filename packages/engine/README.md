# @optcg/engine — One Piece Card Game rules engine (Phase 0 + Phase 2A)

A pure, deterministic, fully serializable rules core for an OPTCG simulator.
No UI, no server. `SPEC.md` in this package is the binding contract; this README
explains the model, what is implemented, what is not, and the judgement calls
made where the rules are ambiguous.

Phase 0 built the rules core with every card vanilla. **Phase 2A adds the card
effect system**: a declarative DSL, a resumable interpreter, player choices,
continuous effects, and the four keywords. Real card data (2B), UI for answering
choices (2C), networking and hidden information are still out of scope.

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

The simulation accepts `--games N`, `--seed-base N`, `--fast`, `--marks`, and
`--abilities`. A bare `--` separator is tolerated, so `pnpm sim --games 50`
works too. **`--abilities` is the one that exercises the effect system**: the
default decks are vanilla and can never open a choice.

## Public API

```ts
createGame({ seed, decks, firstPlayer }): GameState
applyAction(state, action): { ok: true; state; events } | { ok: false; reason }
legalActions(state, player): Action[]
getPower(state, instanceId): number
hasKeyword(state, instanceId, keyword): boolean
```

- `applyAction` is a pure reducer. It never mutates its input, never performs
  I/O, and never throws for an illegal action — it returns `{ ok: false, reason }`
  with a stable reason code.
- `applyAction` always revalidates. It never assumes the action came from
  `legalActions`, so an untrusted client action is safe to pass straight in.
- `legalActions` is pure and exhaustive: every legal action appears, and every
  action it emits validates successfully. A unit test pins that property in both
  directions, which is what keeps the two functions from drifting apart.
  **`ANSWER_CHOICE` is the single documented exception** — see
  "Choices are data, not enumeration" below.

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
├── stack: StackItem[]          ← effects resolving, LIFO
├── pending: PendingChoice | null ← the question the engine is waiting on
├── resume: ResumeStep[]        ← rules paused mid-way, LIFO
├── rng: { seed, cursor }
├── log: GameEvent[]
└── rules: { firstPlayerCannotAttackTurnOne, doubleAttackCanWinFromOneLife }
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
                    + sum of applicable continuous ('static') abilities
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

## Card effects (Phase 2A)

An ability is data. It lives in the card registry next to the printed stat line
and never enters `GameState`; what enters the state is only *where in a script
the engine stopped*.

```ts
interface Ability {
  id: string;
  trigger: Trigger;          // onPlay, whenAttacking, onKO, static, ...
  condition?: Condition;     // checked, never paid
  cost?: Cost[];             // paid, can fail
  optional?: boolean;        // "you may" rather than "you must"
  oncePerTurn?: boolean;
  script: Instruction[];     // empty for trigger: 'static'
  affects?: Audience;        // static only: {self: true} or {selector}
  grants?: { power?: number; keyword?: Keyword };  // static only
}
```

### Three distinctions that are types, not fields

**A script runs once; a continuous effect is simply true.** "When this is
played, K.O. a character" mutates the state through instructions. "Your
characters have +1000" mutates nothing at all — it is evaluated at lookup time
inside `getPower` and `hasKeyword`. Continuous abilities never touch the stack
and never create a `Modifier`. That is the whole point: implemented as a script
that writes a modifier when the card enters play, the engine would then owe a
removal when it leaves, a recalculation on every board change, and a
reconciliation for every path in between. Evaluating on read has no such debt,
and `continuous.test.ts` asserts the buff is visible *while* `state.modifiers`
stays empty.

**`[DON!! ×N]` is a condition; `DON!! −N` is a cost.** The first asks how many
DON!! are attached and is never paid. The second returns DON!! from the cost
area to the DON!! deck and can fail. They are `Condition.donAttached` and
`Cost.returnDon`, and they share no field anywhere.

**A condition that fails means the ability does not fire. A cost that cannot be
paid means the same thing.** Costs are checked before the ability triggers at
all, re-checked at the moment of payment, and never paid halfway. An
`activateMain` ability whose cost cannot be met does not appear in
`legalActions`.

`Cost` has five members: `restDon`, `returnDon`, `trashSelf`, `restSelf` and
`discardHand`. Four of them spend a pool — DON!!, or the hand — and
`trashSelf`/`restSelf` spend the source itself. `restSelf` is the only one whose
payability turns on the source's **orientation**: a rested card has no resting
left to do, so it cannot pay (CR 8-3-1-3, the same rule that stops a rested card
attacking under 7-1-1-1), and the ability disappears from `legalActions` until
the controller's Refresh Phase sets the source active again (CR 6-2-4). That
makes such an ability once per turn without printing `[Once Per Turn]`.

Costs are paid before the script starts — CR 8-4-1 pays (8-4-1-3), then
activates (8-4-1-4), then resolves (8-4-1-5) — so a script that reads its own
source sees the paid state.

### The interpreter is a program counter

An effect that needs an answer has to stop *without the engine holding a live
function*. So a script is a list of instructions and the state records the
position:

```ts
interface StackItem {
  abilityId: string;
  source: InstanceId;
  controller: PlayerId;
  status: 'optIn' | 'ready' | 'running';
  cursor: Frame[];                          // innermost frame last
  vars: Record<string, string | number | boolean | InstanceId[]>;
}

interface Frame {
  path: { i: number; branch: 'then' | 'else' | 'do' }[];
  index: number;                            // next instruction in that block
  loop: { items: InstanceId[]; at: number } | null;
}
```

`if` and `forEach` nest, so a single integer program counter is not enough.
`cursor` is a **stack of frames**: `path` locates an instruction list inside the
ability's script (`[]` is the root), `index` is the next instruction in it, and
a `forEach` body frame carries its own iteration state. Entering a nested block
pushes a frame; running off the end of one pops it. Everything is numbers and
strings, which is exactly what makes a suspended effect survive
`JSON.parse(JSON.stringify(state))`.

When a `select` or `confirm` is reached, the interpreter writes a
`PendingChoice`, **does not advance the cursor**, and returns. When the answer
arrives it is written into `vars` and *then* the cursor advances — so "resume at
pc + 1" holds identically whether the state stayed in memory or came back from
JSON. `interpreter.test.ts` pins both: the round trip with a choice open and a
non-empty stack, and answering a rehydrated state producing a byte-identical
result to answering the live one.

`vars` holds instance ids and scalars only. Never a `CardInstance`, never an
object — a rich value there would round-trip into a stale copy.

`forEach` binds the reserved variable **`it`** on each iteration. Nested loops
shadow it, and it keeps the last item after the loop ends; the DSL's `forEach`
has no `as` field to bind anything else.

### Resolution order

The stack is LIFO, but a trigger raised *by* a running script does not cut in
front of it. New items are inserted directly **underneath** the running one, so
the current script finishes, pops, and the newly triggered effect is next. A
`ko` that wakes an `[On K.O.]` therefore completes the KO — and the rest of its
own script — before the woken ability starts.

Simultaneous triggers resolve in a fixed order: the **turn player's** cards
first, then by board position (leader, characters in board order, stage).

> `TODO phase 2B: player-chosen trigger order.` The official rules let the turn
> player order simultaneous triggers. A fixed order is used here so replays stay
> stable until there is a way to ask.

### Targets are ignored, not revalidated

If the character a script meant to K.O. has already left the field, that
instruction is a silent no-op and **the next instruction still runs**. No
instruction can abort its script. The same rule covers a mandatory "K.O. 2
characters" with one character on the board: the requirement shrinks to what
exists rather than cancelling — `min` is clamped to the number of candidates.

`staleTargets.test.ts` builds that position directly, because the random sweep
essentially never produces it and "abort the whole effect" is the natural wrong
implementation.

### Choices are data, not enumeration

When `pending !== null`, `legalActions` returns exactly **one** `ANSWER_CHOICE`
marker carrying the `choiceId` and no answer payload, plus `CONCEDE`.

It does not enumerate the valid answers, and that is deliberate: a "select 2 of
7" has 21 valid subsets before ordering, and the space explodes from there. A
list nobody can render or search is worse than no list. So the shape of a legal
answer is **data in `state.pending`** — `candidates`, `min`, `max`, `kind` — and
whoever answers reads it from there. The random bot does exactly this, and so
would a UI.

The consequence is the **single exception** to `legalActions` being exhaustive:
the marker it emits does not itself validate. `applyAction` checks the answer
against `pending` and returns a distinct reason for each way of getting it
wrong — `wrongChoiceId`, `notYourChoice`, `missingAnswer`, `choiceKindMismatch`,
`choiceCardinality`, `choiceCandidateUnknown`, `choiceDuplicateSelection`,
`choiceOptionOutOfRange` — because a caller that guesses is entitled to know
which rule it broke. `choiceValidation.test.ts` checks both directions over
every choice a few hundred bot games actually open.

**Priority follows `pending.player`** for as long as the choice is open, and
goes back to being derived the moment it is answered. Outside a suspended
effect, priority is not remembered at all: it is the defender while a battle is
open and the active player otherwise, so there is nothing to save and nothing to
restore incorrectly. The Phase 1 invariant survives untouched — the player who
does not hold priority sees exactly `[CONCEDE]`, including mid-choice.

### `resume`: rules that pause, not just scripts

`stack` and `pending` were the two fields the Phase 2A brief called for.
`resume` is a third, and it is there because an effect can suspend in the middle
of a **rule** rather than in the middle of a script. A life card's `[Trigger]`
question opens between the two damage instances of a Double Attack; an
`endOfTurn` ability can suspend before the next turn has started. The rest of
that rule has to survive the pause.

It is stored the same way a script position is — a LIFO of tagged, serializable
records (`damage`, `startTurn`), resolved by a switch. Never a closure. Card
effects on the `stack` drain before engine continuations on `resume`, which is
what puts a life card's `[Trigger]` ahead of the damage instance that follows
it.

Between actions the interpreter has always run to completion, so:

- `pending === null` ⟹ `stack` and `resume` are both empty, and
- a finished game has nothing queued at all.

Both are checked by `checkInvariants` after every action in the sweep.

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
                 DECLARE_BLOCK      PLAY_COUNTER / PLAY_COUNTER_EVENT (repeatable)
                      │                  │
                      └──> [counter] <───┘
```

- **Attack** — rest an active own Leader or Character and declare a target.
  Valid targets: the enemy Leader, or an enemy Character that is **rested**.
  Never an active Character. A Character cannot attack on the turn it was played
  **unless it has Rush**.
- **Block** — the defender may rest a Character with Blocker to redirect the
  attack. Blocker is asked of `hasKeyword`, so a Blocker granted by a continuous
  effect or a modifier blocks exactly like a printed one. The step is never
  auto-skipped.
- **Counter** — the defender has two moves here, both repeatable, neither from
  the field. `PLAY_COUNTER` discards a card from hand for its printed Counter
  value, adding that power to any own Leader or Character, including one not
  involved in the battle. A card whose printed Counter is the dash — modelled as
  `counter: null`, not `0` — cannot be played this way at all; the absence of a
  value is not a value worth zero, and encoding it as `0` invites exactly that
  misreading. `PLAY_COUNTER_EVENT` (CR 7-1-3-2-2) activates a [Counter] Event —
  an Event whose text is a `counterEvent` ability, printed with no Counter
  value: the defender pays its printed cost with active cost-area DON!!, trashes
  it, and its effect resolves from the trash, choosing its own targets. It
  carries no target of its own for that reason.
- **Damage** — powers are compared and **the attacker wins ties** (`>=`). Beating
  a Character KOs it; beating the Leader takes life cards; losing does nothing.
  Damage is never bidirectional.

The damage step is transient: it resolves inside the defender's final `PASS`, so
`battle.step === 'damage'` is never observable between actions. The only resting
battle steps are `block` and `counter`.

**The battle closes before its outcome is applied.** Powers are compared, the
`battleResolved` event is emitted, `endOfBattle` modifiers expire and
`battle` becomes `null` — and only then does the K.O. or the life damage happen.
This changed in Phase 2A because an outcome can now suspend: an `[On K.O.]` or a
life card's `[Trigger]` opens a choice, and a battle left half-open across that
pause would be a resting state describing a fight nobody is having. Nothing
observable moved — closing emits no events, and nothing between the comparison
and the outcome can change a power.

All `endOfBattle` modifiers expire when the battle resolves — including on a
`noEffect` outcome and including counters parked on cards that never fought. A
script that tries to create an `endOfBattle` modifier with no battle open does
not create one; its lifetime would be zero either way.

### Keywords

| Keyword | Effect |
| ------- | ------ |
| **Rush** | Exempt from summoning sickness: may attack the turn it was played. |
| **Blocker** | May be rested during the Block Step to redirect the attack to itself. |
| **Double Attack** | Deals 2 damage to a Leader instead of 1. |
| **Banish** | Life cards it takes go straight to the trash, and their `[Trigger]` is never offered. |

Every keyword check in the engine goes through `hasKeyword(state, id, keyword)`,
which is printed keywords ∪ continuous grants ∪ live modifiers. Nothing reads
`CardDefinition.keywords` directly, because a granted Blocker has to block and a
granted Rush has to attack.

`CardDefinition.keywords` stores the *printed* spelling (`'Blocker'`,
`'Double Attack'`) that Phase 0 shipped and `blocker.test.ts` depends on; the
DSL speaks in lowercase identifiers (`'blocker'`, `'doubleAttack'`).
`PRINTED_KEYWORD` in `abilities/dsl.ts` is the only bridge between the two
spellings, and `hasKeyword` is the only thing allowed to cross it.

### Double Attack against a player on 1 life — resolved against the source

The brief flagged this as uncertain and suspected that taking the last life card
and then landing a second damage on an empty life area should be a loss. **It is
not.** The official Q&A is direct about it:

> **Q36.** *If my opponent has 1 Life card, can I win the game by using a
> [Double Attack] to deal 2 damage?* — "No, you cannot."

and about the ordering:

> **Q51.** *…If the card from the first damage has a [Trigger], do I activate
> this [Trigger] effect before the second damage is dealt?* — "Yes, the
> [Trigger] is activated before the second damage is dealt. If you still have 1
> or more Life cards left after you have activated the [Trigger] effect from the
> first damage, check a Life card according to the second damage."

Read together, the second damage instance only checks a life card **if one is
left**; finding an empty life area it does nothing. A lone damage instance
against an empty life area is still a loss, which is how a player on 0 life dies
to an ordinary attack.

So the implemented rule is: the **first** damage instance of an attack behaves
as it always did (empty life area ⟹ `lifeOut`), and every subsequent instance of
the same attack is absorbed silently. Against a player already on 0 life a
Double Attack still wins on the first instance.

The Comprehensive Rules state the defeat condition ("a Leader takes damage while
its controller has no Life cards") without spelling out why the second instance
escapes it, so the *mechanism* is genuinely under-specified even though the
*outcome* is not. `rules.doubleAttackCanWinFromOneLife` exists for anyone who
reads it the other way; it defaults to **`false`**, following the Q&A. Both
readings are pinned by tests in `keywords.test.ts`.

### `[Trigger]` on life cards

When damage turns a life card over and that card has an ability with
`trigger: 'trigger'`, the damaged player is offered a `yesNo` choice: activating
it is always optional, whether or not the ability is written as "you may". With
Double Attack that is two life cards and therefore **two sequential choices**,
the first fully resolved before the second damage lands. With Banish no choice
is offered at all, because the card never reaches the hand.

## Field limits and leaving the field

Maximum 5 Characters and 1 Stage. Playing a 6th Character requires naming which
of your Characters goes to the trash; that discard is **not** a KO and emits no
`koed` event, which matters for Phase 1 on-KO triggers.

**Who chooses the discarded Character.** The engine does not pick — the player
does, by naming it in `PLAY_CARD.trashCharacter`. The field is required exactly
when the board is full and rejected otherwise, and `legalActions` enumerates one
variant per Character that could leave, so the choice is visible to any caller
rather than buried in engine policy. There is no oldest-first or index-0
fallback: an action that omits the choice on a full board is rejected with
`trashChoiceRequired`.

`TODO phase 2B: convert into a PendingChoice.` The general targeting machinery
now exists — `PendingChoice` plus the `select` instruction — so this field is
finally the sugar over it that it was always meant to become. It is left as it
is in this PR because converting it changes `PLAY_CARD`'s shape and every
recorded action log with a full board in it, which is a migration rather than a
feature, and the client's affordance layer already collapses the variants
correctly.

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
| `PLAY_COUNTER_EVENT` | `cardNotInHand`, `notACounterEvent`, `notEnoughDon` |
| `ACTIVATE_ABILITY` | `unknownAbility`, `abilityNotActivatable`, `abilitySourceNotOnField`, `abilityConditionUnmet`, `abilityCostUnpayable`, `abilityAlreadyUsed` |
| `ANSWER_CHOICE`  | `choicePending`, `noPendingChoice`, `missingAnswer`, `wrongChoiceId`, `notYourChoice`, `choiceKindMismatch`, `choiceCardinality`, `choiceCandidateUnknown`, `choiceDuplicateSelection`, `choiceOptionOutOfRange` |

`choicePending` is returned for *any other* action attempted while a choice is
open: a suspended effect blocks the whole game, not only its own player.

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
| `TEST-008` / `TEST-108` | character | 6 | 7000 | — (`null`) |
| `TEST-009` / `TEST-109` | character | 8 | 9000 | — (`null`) |
| `TEST-010` / `TEST-110` | character | 10 | 12000 | — (`null`) |
| `TEST-011` / `TEST-111` | event | 1 | — | — (`null`) |
| `TEST-012` / `TEST-112` | event | 3 | — | — (`null`) |
| `TEST-013` / `TEST-113` | stage | 2 | — | — (`null`) |

Each 50-card deck is 4 copies of each of the 10 Characters, 4 of each Event, and
2 of the Stage. There are no 0-cost cards, which is part of why bot games are
guaranteed to make progress.

### The ABIL set

`src/testdata/abilities.ts` adds a second synthetic set whose only purpose is to
exercise the effect system. Between its 26 cards it covers **every `op`, every
`Trigger`, every `Cost`, every `Condition` kind and all four keywords**, plus an
`if` nested inside a `forEach`, a `oncePerTurn`, an `optional`, two continuous
sources, and a K.O. that wakes an `[On K.O.]` on the card it just killed.

New coverage is added to an existing card wherever it can be. A new `ABIL-` id
changes `abilityDecks.ts`'s deck list and reshuffles every seeded scenario in the
package, so `ABIL-018` carries four abilities and the `ABIL-024` Stage two — the
`restSelf` cost sits on the Stage because that is the shape the real card has
(`ST01-017`), and because it lets one test rest the source and still read its
continuous effect.

It registers through the public registry exactly like the TEST set, and lives in
`testdata/abilityDecks.ts` so that **`testdata/decks.ts` has no import path to
it**. That is not a stylistic preference: it is what guarantees a browser game
on the default decks never opens a choice, which is what lets the Phase 1 client
ship unchanged. The vanilla sweep confirms it — 200 games, 0 choices opened.

`buildScenario` takes `decks`, `stage`, `lifeCards`, and a `then` list of
actions with `expectPending`, so a test can build a position that rests on an
open choice directly rather than playing toward one.

## Bot and simulation

The bot is a thin adapter over the one policy every test driver in this repo
shares, `src/testing/policy.ts`, published as `@optcg/engine/testing`. When a
choice is open it reads `state.pending` and builds a valid answer from it — not
a special case for the bot's convenience, but the same thing any client has to
do, since the answers are deliberately not enumerated.

### Stable keys, not indices

The policy scores each option by a hash of `(seed, decision, key)` and takes the
best, where the **key comes from the option's content** — the action's type plus
the ids it carries — and never from its position in the list. Ties break on the
key, so a decision is a pure function of the *set* of options.

That buys one property, and the property is the reason the module exists:

> **Local perturbation.** If a state gains a new legal action and the driver does
> not pick it, the decision is identical to the one it would have made without
> it.

Every driver used to choose by index into `legalActions`, which violates that by
construction — a new action displaces every action after it, so adding one
ability moved every later decision of every game. It cost the repo seed 107
(killed when `ST01-017` gained an activatable ability), then seed 224, then the
first phase-2C driver's whole trajectory set. `tests/stableKeys.test.ts` asserts
the property over 13,608 injected decisions on real games and, in the same file,
asserts that the index-based policy it replaced fails it.

### The two biases, and the exploration rate

The biases are expressed as **tiers over content**, never as filters over
position, so they cannot reintroduce the ordering dependence:

- `CONCEDE` is excluded. Left in a uniform pool, essentially every game ends by
  random concession within a few turns, and the resulting statistics validate
  nothing. This is a documented deviation from a strictly uniform bot.
- `END_TURN` is the last tier, so turns actually spend resources and games
  progress toward a real ending.

Answers take the **strong line by default** — the full selection, yes to an
optional ability — and explore the rest of the range on 1 decision in 8. That
rate is measured rather than chosen: answering uniformly took `ST02-016` Repel
from 5 reachable seeds in 500 to 0, because half-strength answers stop the board
reaching the positions where a [Counter] Event is holdable and payable at all.
1 in 8 costs ~15% of that reach and buys the empty selection and the declined
opt-in inside a single pass — which is what retired the client corpus's second,
minimum-answer playout. The table is in `cardinalityFor`.

The policy needs no RNG stream. A hash of the decision number replaces the
cursor, which is also what makes it shareable: a stream is order-dependent, so
two drivers that consume a different number of draws diverge from the same seed.
Nothing here touches `state.rng`, so the engine's stream stays a pure function of
the action log.

`runGame` asserts after **every** action: the action was accepted, all state
invariants hold, the non-priority player has only `[CONCEDE]`, the state survives
a JSON round-trip, and re-applying the same action to the same input produces an
identical result. Each finished game is then replayed from its full action log
and compared to the live final state. Failures are returned as data — seed,
error, action index, and the complete action log — never thrown, so one bad seed
does not abort the run.

Phase 2A adds one assertion to that list: **a finished game may not leave an
effect queued** — empty `stack`, empty `resume`, `pending === null`.

Measured on this machine, 200 games in full mode:

| Sweep | Completed | Failures | Turns (avg / max) | Choices/game |
| ----- | --------- | -------- | ----------------- | ------------ |
| vanilla (`pnpm sim`) | 200 | 0 | 18.9 / 35 | **0** |
| abilities (`--abilities`) | 200 | 0 | 23.3 / 39 | 3.1 |

The vanilla row's zero is the load-bearing one: it is the measurement behind
"the client's runtime behaviour does not change".

`--fast` samples the JSON round-trip instead of doing it every action; it is a
dev-loop convenience and is **not** the spec-compliant mode.

Note that bot games end in `lifeOut` essentially always: at ~19 turns they
finish long before a 41-card post-setup deck could run out. `deckOut` coverage
therefore rests on unit tests, not on the simulation.

## Test suite

217 tests across 28 files. The Phase 2A acceptance cases live in:

| Mandated case | File |
| ------------- | ---- |
| Serialization with a choice open and a non-empty stack | `interpreter.test.ts` |
| Answering a rehydrated state matches answering the live one | `interpreter.test.ts` |
| No game ends with a queued effect | `sim/runGame.ts` + `choiceValidation.test.ts` |
| Every valid answer accepted, every invalid one rejected by reason | `choiceValidation.test.ts` |
| Non-answering player sees exactly `[CONCEDE]` | `interpreter.test.ts`, `choiceValidation.test.ts` |
| One case per ABIL card | `abilityTable.test.ts` |
| Continuous buffs visible with `modifiers` empty | `continuous.test.ts` |

Plus `keywords.test.ts` for the four keywords, the Double Attack rulings and
life-card `[Trigger]`s, and `staleTargets.test.ts` for the two branches the
random sweep cannot reach.

The nine originally mandated Phase 0 cases live in:

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

## What the random simulation covers, and what it cannot

A green 1000-game run means no crash, no illegal action, and no broken
invariant. It does **not** mean the rules are covered. Two separate measurements
say why.

### Line coverage of the simulation

`pnpm coverage:sim` runs the sweep under the v8 provider using
`vitest.coverage.config.ts`, deliberately separate from the unit-test config: a
combined report would blend what the bots reach with what the tests reach and
hide exactly the gap being measured. The engine sits around 73% of lines, and
most of what is uncovered falls into two groups that are uncovered **by design**:

- **Validation rejections.** Every `return REASONS.*` is unreached, because the
  bot only submits actions it got from `legalActions`. Those branches being dead
  is the acceptance criterion working, not a hole. The unit tests cover them.
- **Engine-bug throws.** `mustGetCard`, the payment shortfall, "not on the
  field". If one of these ever executes, there is a bug; they should stay at
  zero forever.

### Semantic branch marks

Line coverage cannot answer the question that matters here. `attackPower >=
defensePower` is one line covering two different rules — winning by margin and
winning a tie — and calling that line "covered" hides the case most likely to be
implemented wrong.

So `src/instrument.ts` declares named rule branches and the decision points call
`mark()`. Run `pnpm sim --games 1000 --marks`. The flag sets `OPTCG_MARKS=1`
before the engine loads, since the instrument reads it once at module load; a
half-instrumented run would be worse than no data. Counts live in a module-level
map, never in `GameState`, and without the env var `mark()` is a single boolean
check.

Read the counts as reached / not reached, not as frequencies: the harness
applies every action twice for the purity check and replays each finished game
once, so counts are inflated by exactly 3.

Phase 2A adds marks for the effect system — every `op`, the suspend/resume
cycle, the cost kinds, the keywords, and the damage branches.

Measured over 200 games with `--abilities --marks`, **five of the 61 declared
marks are never reached**:

| Dead mark | Why |
| --------- | --- |
| `deckOut` | Games end by life-out around turn 23, long before a 41-card deck runs out. Pinned by `winConditions.test.ts`. |
| `concede` | The bot excludes it on purpose; left in a uniform pool it ends nearly every game at random. Pinned by `winConditions.test.ts`. |
| `op.targetGone` | Needs something to remove a target *between* choosing it and acting on it. Random play essentially never builds that chain, and "abort the whole script" is the natural wrong implementation, so `staleTargets.test.ts` builds the position directly. |
| `ability.costLostBeforeResolution` | The defensive re-check when an earlier effect in a chain spends the resources a queued ability needed. Pinned by `staleTargets.test.ts` with a hand-queued stack item. |
| `battle.endedEarly` | Needs an effect that removes a battle participant *during* the battle, and no ABIL card does — the set was cut before any card could. `battleVanished.test.ts` registers its own cards for it, and it fires in ordinary play elsewhere: `packages/cards` reaches it in 2 of 300 OP-01 games, on `OP01-017` Nico Robin K.O.ing the Character she is attacking. Dead in *this* sweep, not in the repo. |

`battle.blocked` was dead in Phase 0 and is now reached 294 times: the ABIL set
has real Blockers, so the redirect branch is exercised by ordinary play for the
first time. `damage.absorbedByEmptyLife` — the Double Attack Q36 case — fires 33
times in 200 games, so the ruling above is not just unit-tested but actually
occurs in the sweep.

And one mark is technically alive but statistically absent:

- **`field.sixthCharacter` fired 3 times across 1000 games — one real
  occurrence.** Bots attach DON!! far more often than they play Characters
  (`don.attached` outnumbers `play.character` roughly six to one), so the board
  rarely fills. A branch reached once in a thousand games is not tested by the
  simulation in any meaningful sense; `sixthCharacter.test.ts` covers it
  directly.

One more thing the marks exposed: `don.gainCappedByCostArea` and
`don.gainCappedByDonDeck` have **identical** counts. After refresh,
`costAreaCount === 10 - donDeckRemaining` always holds, so the 10-DON!! cap
never binds independently of the DON!! deck term. That branch is only nominally
covered — the cap has never been the thing doing the limiting.

`TODO phase 2: targeted test for the 10-DON!! cap.` The cap only starts to
matter in long games, and specifically where it meets Refresh: attached DON!!
returning to a cost area that is already full. That interaction cannot arise
from the current card set and game lengths, so it needs a built position rather
than a simulated one.

### Which branches need targeted tests

Anything in the table above, plus anything whose *inputs* the bots cannot be
steered toward: specific power totals, exact ties, a counter that lands on a
non-battling card, a full board. Those tests build the position directly with
the helpers in `src/testdata/scenarios.ts` instead of playing toward it. The
builders move instances between zones of the same player, so conservation holds
and the engine's own invariant checks stay meaningful while the position is
staged.

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

**`PLAY_CARD.trashCharacter` is an extension, not part of the original spec.**
The specified action union had `PLAY_CARD` carrying only `player` and
`instanceId`, leaving the 6th-Character discard for a later phase. The field was
added because the alternatives were worse: having the engine pick deletes a real
player decision, and building a general targeting system was out of scope. It is
required exactly when the board is full and rejected otherwise. Recorded here as
a deliberate divergence so nobody mistakes it for something the spec asked for.

*Consequence for the affordance layer, worth knowing before building UI:* on a
full board `legalActions` returns **up to five variants of the same play**, one
per Character that could be sacrificed. A layer that maps actions to buttons
one-to-one will render five identical buttons on the same card. The correct
treatment is to collapse them into a single "play this card" affordance that,
once activated, opens a selector for which Character to sacrifice.

**`CardDefinition.keywords`.** Added (empty on every Phase 0 card) so that
Blocker validation checks something real instead of being hardcoded to reject.
Phase 2A populates it and routes every read through `hasKeyword`.

## Phase 2A divergences from the brief

Recorded here so nobody mistakes them for something that was asked for. Each is
an addition the brief's own requirements turned out to need.

**`ACTIVATE_ABILITY` is a new action.** The brief lists `ANSWER_CHOICE` as the
only new action, but it also requires `activateMain` abilities to be gated by
cost in `legalActions` — which presupposes an action that carries one. Without
it the `activateMain` trigger is unreachable from any input and the DSL's own
`Trigger` union has a dead member. It is blocked during battle, like every other
Main-phase action.

**`GameState.resume`.** A third effect field beside `stack` and `pending`,
because an effect can suspend inside a *rule* and not only inside a script. See
"`resume`: rules that pause" above. It is tagged serializable data, never a
closure, which is the property the brief actually cares about.

**`StackItem.status` and `PendingChoice.sink`.** `status` (`optIn` / `ready` /
`running`) keeps an optional ability's accept/decline question *on the stack*, so
it holds its place in the resolution order — a side queue would let a later
mandatory trigger overtake an earlier optional one. `sink` says where an answer
goes; without it the reducer would have to infer whether an answer belongs to a
script variable or to a rule, and that inference is exactly the kind of implicit
continuation this design forbids.

**`Condition.varTrue`.** The brief's `Instruction` list has `confirm`, which
writes a boolean into `vars`, but its `Condition` list has nothing that can read
one — so a "you may do X, otherwise Y" card could be written and would never
branch. `optional: true` covers "may I activate this at all"; `varTrue` covers a
branch *inside* a script. Without it, `confirm` is decorative.

**`ZoneRef`, `Duration`, `PlayerRef`, `Color` were not defined in the brief.**
`ZoneRef` is `{ zone: 'hand' | 'deck' | 'trash' | 'life' }` with no owner field,
because cards always move to the zones of their **owner** — that is the physical
rule, and an owner field would only allow states the game cannot reach. `Color`
is a `string` alias, since `CardDefinition.color` is a plain string in the
registry; the brief's `Color[]` implied an enum that does not exist. `types` and
`abilities` were added to `CardDefinition` as optional fields so every Phase 0
definition still compiles untouched.

**Deterministic discards.** The `discardHand` cost and the `discard` instruction
take cards from the front of the hand rather than asking. A choice there would
be a `PendingChoice` before the script starts, and the brief is explicit that
costs are settled before the script runs. Payability is fully honoured — an
ability whose discard cannot be paid does not fire — but *which* cards go is
engine policy for now. `TODO phase 2B: player-chosen discard.` This is the one
divergence that deletes a real player decision, and it is the same criticism
Phase 0 levelled at letting the engine pick the 6th-character discard.

**Simultaneous trigger order is fixed, not chosen.** Turn player first, then
board position. `TODO phase 2B: player-chosen order`, as the brief requested.

**One client file changed, for compilation and nothing else.** The brief allows
touching the client only as far as its tests demand; its tests passed untouched,
but `packages/client/src/store/selectors.ts` stopped *compiling*, which is
worse. Its event-log formatter is an exhaustive switch over `GameEvent` with no
`default` — deliberately, so a new event cannot be silently dropped — and Phase
2A adds twelve event types. The fix is twelve log lines and a zone label. No
component changed, no affordance changed, no `mustAnswerChoice` flag was needed,
and none of those events can occur in a browser game because the default decks
have no abilities.

**Perfect information.** The log and state are fully visible; `cardDrawn` carries
the drawn instance id. Per-player hidden-information views are out of scope.

## Out of scope for Phase 2A

- **Real card data.** Phase 2B. Everything here is the synthetic ABIL set.
- **UI for answering choices.** Phase 2C. The engine opens choices and the bot
  answers them; the client has no control for it and never sees one, because the
  default decks have no abilities. Two things the event log does not say — an
  ability that resolves to nothing emits no event, and continuous abilities emit
  none at all — are written up for 2C in
  `docs/trigger-reachability.md`, under "Notes for phase 2C".
- **Player-chosen trigger order** and **player-chosen discards** — both fixed
  deterministic policies today, both flagged `TODO phase 2B` above.
- **`PLAY_CARD.trashCharacter` as a `PendingChoice`** — the machinery now exists
  but converting it is a migration of recorded action logs, not a feature.
- Deck-construction legality (4-copy limits, color matching) beyond basic
  decklist shape validation.
- Hidden-information views, networking, persistence, and AI beyond the random
  bot.

Still true from Phase 0, and now a real move rather than a synthetic-only one: a
Counter **Event** is played from hand for its cost (`PLAY_COUNTER_EVENT`), its
`counterEvent` effect resolving from the trash, and a life card's `[Trigger]`
fires.

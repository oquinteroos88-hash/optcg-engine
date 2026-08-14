# @optcg/engine — One Piece Card Game rules engine (Phase 0 + Phase 2A)

A pure, deterministic, fully serializable rules core for an OPTCG simulator.
No UI, no server. `SPEC.md` in this package is the binding contract; this README
explains the model, what is implemented, what is not, and the judgement calls
made where the rules are ambiguous.

Phase 0 built the rules core with every card vanilla. **Phase 2A adds the card
effect system**: a declarative DSL, a resumable interpreter, player choices,
continuous effects, and the four keywords. Real card data (2B), UI for answering
choices (2C), networking and hidden information are still out of scope.

**The starter decks are done: 33 of the 34 cards in ST-01 and ST-02 have a
script, a printed keyword the engine applies, or no text at all.** The
thirty-fourth, `ST02-010` Basil Hawkins, is *declared* rather than deferred —
the ruling was made and the card needs two capabilities that exist for no other
card in the 2665-card set, so it stays unwritten on purpose.
`packages/cards/tests/startersComplete.test.ts` is the guard; the reasoning is
in `docs/starter-card-inventory.md`. OP-01 stands at 82 of 121 and is the slower
half of the same campaign.

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
└── rules: { firstPlayerCannotAttackTurnOne, doubleAttackCanWinFromOneLife,
              playFromEffectPaysCost, effectPlayIsPlayingACharacter,
              placedRestedBecomesRested, nextTurnExcludesTurnInProgress,
              selfReturnResolvesEffect }
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

`Cost` has nine members, and they sort into three groups by what they spend:

| Spends | Members |
| --- | --- |
| a pool | `restDon`, `returnDon`, `discardHand`, `bottomDeckHand`, `lifeToHand` |
| the source itself | `trashSelf`, `restSelf` |
| other cards you choose | `returnCharacters`, `restCharacters` |

Four of them open a choice during the payment — `discardHand`, `bottomDeckHand`,
`returnCharacters`, `restCharacters` — and the machinery is PR #28's unchanged:
the entry that suspends does not advance `costsPaid`, the answer does, and the
answer handler learns *which* price it is paying by reading the cost list at that
cursor. The sink never had to grow a field for it.

`lifeToHand` is the one member that names cards and still asks nothing, because
CR 3-10-2 already chose: "a player must select the card at the top of their Life
cards unless otherwise specified". It also fires no `[Trigger]` — CR 2-11-1 binds
that to adding a Life card to hand *on taking damage*.

The last two are the third group's whole point: `restSelf` rests **the source**
and can only be printed on a card that is on the field, while `OP01-055` is an
Event that CR 8-4-2 has already trashed by the time its cost is paid. `restSelf`
is the only one whose
payability turns on the source's **orientation**: a rested card has no resting
left to do, so it cannot pay (CR 8-3-1-3, the same rule that stops a rested card
attacking under 7-1-1-1), and the ability disappears from `legalActions` until
the controller's Refresh Phase sets the source active again (CR 6-2-4). That
makes such an ability once per turn without printing `[Once Per Turn]`.

Costs are paid before the script starts — CR 8-4-1 pays (8-4-1-3), then
activates (8-4-1-4), then resolves (8-4-1-5) — so a script that reads its own
source sees the paid state.

**A cost can stop and ask.** `discardHand` is a price whose card the *player*
picks, and CR 8-4-1-3 is where that pick belongs: the step reads "determine the
activation costs and pay all activation costs", while 8-4-1-2 only specifies
*which effect* is being activated. So the payment is walked one entry at a time
and a `discardHand` entry opens a `PendingChoice` whose `sink` is `{kind:
'cost'}`. `StackItem.costsPaid` records how far the payment got, and the same
invariant the script cursor lives by holds over it: **the entry that suspends
does not advance the cursor — the answer does.** A serialized state is never
halfway through paying one cost; it is stopped before a cost that has not
started.

Four consequences worth stating, each read off the rules rather than chosen:

- **Order is the card's, not the player's.** CR 8-3-1-1 carries out the actions
  of one activation cost "in order starting from the text closest to the top",
  so `Cost[]` is walked front to back and nobody is asked to reorder it.
  `ST02-001` prints `③` before its discard and pays in that order.
- **There is no cancelling.** CR 8-3-1-4 puts the decline *before* payment — the
  player may choose not to pay, and then the effect is not activated — and CR
  8-3-1-3-1 covers the only mid-payment case the rules admit, becoming *unable*
  to pay, by paying as much as possible and not resolving. Regret is not in the
  rules, so `ANSWER_CHOICE` needs no cancel form and does not have one.
- **`[Once Per Turn]` is spent when payment starts.** CR 10-2-13-5: a use whose
  payment breaks down partway may not be taken again that turn, "even if the
  effect following that activation cost did not resolve as a result".
- **The condition is not re-checked afterwards.** CR 8-4-1-1 checks, 8-4-1-3
  pays, 8-4-1-4 activates. An ability whose own payment falsifies the condition
  it fired on still resolves.

`discardHand` also carries an optional `CardFilter` — "trash 1 {Land of Wano}
type card from your hand" is a different price from "trash 1 card" — and
`canPayCosts` counts *matching* cards, so an ability nothing in hand can pay
never appears in `legalActions`.

### Reference by name: one field, five printed shapes

`CardFilter` carries `names` and `excludeNames`, and every predicate in the DSL
inherits them — a script's `Selector`, a `static`'s `Audience`, a `countCards`
condition, a `discardHand` cost's filter, and `LegalityClause.attack.target`.
That is not a convenience; it is the finding
`docs/op01-closing-census.md` was written to test. Six printed shapes reference a
card by name, and **five of them differ only in where the predicate is read**:

| Printed | Where the predicate lives | Field |
| --- | --- | --- |
| "…other than [X]" | a script `Selector` | `excludeNames` |
| "play / add [X]" | a script `Selector` | `names` |
| "if your Leader is [X]" | `Condition.countCards` over the Leader slot | `names` |
| "if you don't have [X]" | the same, with `max: 0` | `names` |
| a static's "other than your [X]" | `Audience`'s selector | `excludeNames` |

The alternative — a named variant per operation (`PLAY_NAMED_CARD_FROM_HAND`,
`REST_NAMED_CARD`, …) — multiplies the op list by every mechanic that can carry
a name. Five shapes entering through one field is the measurement that says the
name is a property of a *card*, not a mode of an *action*.

**A name is not an instance.** `Selector.excludeSelf` drops the one card whose
ability is running; `excludeNames` drops every card with the name. Both exist
because neither can be written in terms of the other: `OP01-005` Uta reaches into
a trash where the other copies of [Uta] are different instances, and `OP01-099`
Kurozumi Semimaru needs each of two copies on the field to exempt **both**.

**A name is not a card number.** CR 2-1-2 makes a bracketed name refer to "cards
with the card name specified in the brackets"; CR 2-14-2 caps deck copies by
*card number*. Nine names in OP-01 alone sit on two numbers, and three of the
twelve cards this field was built for reach across sets — `ST01-006` is a second
`Tony Tony.Chopper`, `ST01-007` a second `Nami`, `ST02-012` a second `Bepo`.

**Nothing reads `CardDefinition.name` except `hasName`.** It is a question, not a
getter, and the shape is `hasKeyword`'s for `hasKeyword`'s reason: CR 2-1-3 lets
a card gain a name from its own text — "Also treat this card's name as [X]" —
and the word is *also*. Eight cards in the game print it and `EB04-038` adds two
names at once, so a card can answer to three names simultaneously. A
`cardName(state, id): string` could not hold that, and every comparison against
it would have to be found and changed the day the alias is built. With the
question there is one place to hook it and no caller moves. The alias itself is
not built — OP-01 cannot make it observable (`OP01-121` Yamato is a Character and
the set's three Leader-name gates ask about the Leader), and the census filed it
as its own row.

The match is **exact**. CR 2-1-2-1 defines a substring form — "part of a card
name in " " quotation marks" — and exactly one card in the game prints it
(`OP16-015`). One asker and no second is a declared row here, not a capability.

CR 2-1-3's sentence appears verbatim twice more, for types (CR 2-4-4) and
attributes (CR 2-5-7), so `types` in `matchesPredicate` carries the same latent
hole. Recorded rather than closed: no card in scope prints a granted type.

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

**`orderCards` needed no new code among those.** Its answer is a permutation of
`candidates`, and three properties force exactly that: the right length, every
id drawn from the candidates, and no id twice. That is the pigeonhole — n
distinct members of an n-element set are that set — so "a card is missing" is
unreachable without one of the three firing first, and a reason code that can
never be returned is a code that lies about the contract. The length premise is
`min === max === candidates.length`, which the op opens and `checkEffectShape`
asserts rather than leaving the validator to hope for.

### The four choice kinds, and the two that came back

`PendingChoice['kind']` has five members and the engine produces four.

Phase 2A shipped with `orderCards` in the type and no op able to open one; it
was deleted from the instruction set with a note saying it would return "with
its op and its tests". `ST02-007` Jewelry Bonney is what brought it back —
"look at 5 cards from the top of your deck; reveal up to 1 {Supernovas} type
card and add it to your hand. Then, place the rest at the bottom of your deck in
any order."

Two problems, and only the first is the choice:

- **The order.** The answer is `{ kind: 'order' }`, its own `ChoiceAnswer`
  member rather than a re-use of `cards` with `min === max`. `cards` says
  *which*, and `selectCards` ignores its order; this says *in what order*, and
  nothing is being selected. Sharing the member would let a `selectCards` answer
  through for an ordering, and `choiceKindMismatch` would stop meaning anything.
- **Naming "the rest".** The cards not taken cannot be re-derived from a
  selector, because how many are left depends on how many the player took and
  the DSL has no arithmetic. `lookAt` records the window in `vars` and the fifth
  `Ref` member, `minus`, is the difference. It *could* have been re-derived —
  after the take, the untaken cards really are the top of the deck — and that
  would be quietly wrong the first time a script touched the deck in between.

**And `partitionCards` is the second one that came back**, for the same reason
and by the same argument. `orderCards` shipped as a type with no op; the
top-or-bottom split shipped as a *note* saying the phrase "place them back in
any order" covered two mechanisms and only one was a permutation. PR #36 built
the other: `orderToDeckEnds` opens `partitionCards`, and the answer is
`{ kind: 'partition', top, bottom }` — a fifth `ChoiceAnswer` member rather than
`order` with a destination flag, because a shared member would let a permutation
answer a partition and back.

Its validation is the ordering's three properties run over **both sides at
once**, and the concatenation is the argument rather than a shortcut: a card in
both sides is a duplicate, a card in neither makes the total short, a foreign id
is unknown, and a missing card is the pigeonhole again. No fourth reason code.

One clause of its invariant differs from the ordering's, and it is the whole
difference between the two questions: **an ordering of one card is placed
without asking, a partition of one must ask.** One permutation, two ends.

`selectOption` remains unproduced: no op writes one, no printed card asks for
one, and `packages/client/tests/choiceShapes.test.ts` measures the claim rather
than asserting it in a comment.

### Looking at a deck, and where the order goes

| Question | Answer | Rule |
| --- | --- | --- |
| Does looking move the cards? | No. `lookAt` writes a variable and nothing else. | CR 11-3-2 |
| Who sees them? | Only the player of the effect. | CR 11-3-1 |
| Does the deck get shuffled after? | No — cards go back as they were unless the card says otherwise. | CR 11-3-3 |
| May the player take nothing? | Yes, and may decline even when a card qualifies. | CR 8-4-4-1, 8-4-4-2 |
| Shorter deck than the window? | Look at what is there; an empty deck is a no-op. | CR 8-4-4-1 |
| Which end of the answer is deepest? | The last. `order[0]` is drawn first. | CR 3-2-3 |
| And with **two** ends to fill? | Both lists read as draw order: `top[0]` is the very next card drawn, `bottom.at(-1)` the deepest in the game. | CR 3-2-3, applied to the other end |

The last row is the one two implementers would resolve opposite ways, so it is
derived rather than picked: CR 3-2-3 moves multiple deck cards "one by one", and
one by one onto the bottom leaves the last card placed deepest. It is **not**
behind a `rules` flag, and the reason is that it is not a rules question at all —
the player chooses the order, so either mapping is reachable by a player who
knows which it is. What a flag would protect is a client that guessed, and the
fix for that is saying so: the overlay's own line is "tap them in the order you
will draw them".

The two-ended row is the same question asked once more, and it is sharper: a
literal reading of "one by one" onto the **top** would leave the last card placed
on top, which inverts the top list relative to the bottom one. Reading both
sides the same way is a decision, and it is made here rather than in each
client — `placeAtDeckEnds` states the mapping in one loop so the two cannot
drift, and `partitionCards.test.ts` pins it by **drawing afterwards** rather than
by reading deck indices, which would have passed against either reading.

**Looking is private and this engine does not model that.** CR 11-3-1 makes the
looked-at cards knowledge of the looker alone; `cardsLookedAt` carries the ids
because this log is perfect-information by design (see `events.ts`), and the
client shows only the count. That is a hot-seat compromise, not hidden
information — filed with the rest of the per-player-view debt.

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

### Adding DON!! from the DON!! deck, and the ten that is not a cap

`addDon` is `orientDon`'s sibling and takes a **count and an orientation**,
never a selection: DON!! are fungible, and CR 3-3-2 lets both players see and
reorder that deck freely, which is exactly why which card moves cannot matter.
141 cards in the full set add DON!! this way across fifteen phrasings and every
one reduces to those two numbers.

Two bounds, and neither is a guard the op checks:

- **A short DON!! deck yields what there is.** CR 1-3-2 performs "as many of the
  actions as possible" and CR 8-4-4-1 says the same of a specified number. The
  DON!! Phase already reads that way in the rules themselves — CR 6-4-2 places 1
  from a 1-card deck, CR 6-4-3 places none from an empty one.
- **The cost area cannot hold eleven, and no rule says so.** This is worth
  stating carefully because it looked like it might change a phase-0 invariant
  and does not. There is no rule capping the cost area. CR 5-1-2 gives each
  player "a 10-card DON!! deck", those ten cards are the entire supply, and the
  only places one can be are the DON!! deck, the cost area and attached to a
  card. So an eleventh in the cost area would need an eleventh card to exist.

  `checkFieldLimits`' cost-area clause is therefore a **derived check, not an
  independent rule** — `checkDonConservation` makes it unreachable rather than
  merely unviolated. It is kept, on the same grounds as the other unreachable
  paths in this repo: an absence nobody can see is worse than a guarded one.
  What it must not become is the place `addDon` gets clamped. The bound is the
  deck running out, and it lives in the op.

The orientation is required rather than defaulted. CR 3-9-3 does supply a
default — "when placing DON!! cards in the cost area, they should be set as
active unless otherwise specified" — and every printed card says, so an optional
field carrying it would be a field nothing sets.

**It adds; it never returns.** Sixteen cards in the full set read "when a DON!!
card on your field is returned to your DON!! deck", which is the inverse
movement. That trigger is not built, `returnDon` has emitted
`donReturnedToDeck` for it since PR #11, and `addDon` emits `donAdded` — a third
event, distinct from `donGained`, which is the DON!! Phase's own step. The day
the trigger is written it cannot wake on an add.

### What injecting DON!! did to the driver's bias

`HOLD_DON_EVERY` — the driver's 1-in-3 refusal to attach DON!! before ending a
turn — was calibrated in PR #27 against the economy as it stood. An op that
*injects* DON!! changes that economy, so it was measured rather than assumed.
300 blue/purple games, same seeds, same policy, cards the only difference:

| | before batch 10 | after |
| --- | --- | --- |
| Counter Steps reached | 14958 | 14903 |
| average active cost-area DON!! at a Counter Step | 0.249 | 0.253 |
| `PLAY_COUNTER_EVENT` **offered** | 14 | 25 |
| `PLAY_COUNTER_EVENT` **taken** | 7 | 9 |
| DON!! added by effect | 0 | 145, across 122 of 300 games |
| `OP01-086-counter` reached | 3/300 | 4/300 |
| `OP01-087-counter` reached | 1/300 | 2/300 |
| `OP01-089-counter` reached | 3/300 | 3/300 |

The bias needed no recalibration and did not get one. The average barely moved —
six of the eight cards **rest** what they add, so the pool a defender can spend
at a Counter Step grows much less than the raw count does — while the *offers*
went up by 79%, because the DON!! that do arrive active arrive at the moments a
Counter Event is affordable. Nothing came off the reachable list; every
`[Counter]` half reached before is reached at least as often now.

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

### A battle whose attacker or target leaves the field ends there

CR **7-1-1-4**, **7-1-2-3** and the same sentence at the end of the Counter Step
all say it: if, at the end of a step, the attacking card *or* the target card has
**moved areas**, the game goes not to the next step but to **End of the Battle**
(CR 7-1-5). No damage, nothing K.O.'d by the battle.

Four readings of that sentence are load-bearing, and `battleVanished.test.ts`
pins each one:

- **Both sides.** A defender's `[On Block]` or `[On Your Opponent's Attack]` that
  removes the attacker ends the battle exactly as an attacker's
  `[When Attacking]` that removes the target does. Both are printed: `ST03-003`
  Crocodile bottom-decks a Character on block, `EB01-037` and `OP04-072` K.O. on
  the opponent's attack.
- **"Moved areas", not "K.O.'d."** A bounce to hand or to the deck counts, so the
  check is `isOnField` and the destination is irrelevant.
- **The current target.** A [Blocker] makes itself the target, which the engine
  models by reassigning `battle.target`; that field is what is checked, not
  `originalTarget`.
- **"At the end of the step."** A step is not over while an effect it started is
  still resolving, so the check runs only when the game is **quiescent** — no
  pending choice, no stack, no engine continuation.

`endBattleIfParticipantLeft` runs once, from `applyAction` after `settle`, which
is the single point where the engine hands back an observable state. Putting it
there rather than in each step handler is what makes the bad state *unreachable*
rather than *tolerated*. The attacker **stays rested**: CR 7-1-1-1 spends it to
declare and nothing in 7-1-5 gives it back.

The event is `battleEndedEarly`, deliberately not a fourth `battleResolved`
outcome. `battleResolved` reports a comparison of powers that happened; this
reports one that never did, and a UI that said "the attack had no effect" for
both would describe a Character that survived a hit and one that was never hit in
the same words.

`checkBattleShape` asserts the same property from the outside, scoped to
quiescent states. It used to assert it unconditionally, which was not stronger —
it was false, and it fired on the legal mid-effect position that led to this
rule.

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
| `DECLARE_ATTACK` | `invalidAttacker`, `attackerNotActive`, `cannotAttackYet`, `firstTurnAttackForbidden`, `invalidTarget`, `targetNotRested`, `attackForbidden` |
| `DECLARE_BLOCK`  | `invalidBlocker`, `notABlocker`, `blockerNotActive`, `blockForbidden` |
| `PLAY_COUNTER`   | `cardNotInHand`, `noCounterValue`, `invalidCounterTarget` |
| `PLAY_COUNTER_EVENT` | `cardNotInHand`, `notACounterEvent`, `notEnoughDon` |
| `ACTIVATE_ABILITY` | `unknownAbility`, `abilityNotActivatable`, `abilitySourceNotOnField`, `abilityConditionUnmet`, `abilityCostUnpayable`, `abilityAlreadyUsed` |
| `ANSWER_CHOICE`  | `choicePending`, `noPendingChoice`, `missingAnswer`, `wrongChoiceId`, `notYourChoice`, `choiceKindMismatch`, `choiceCardinality`, `choiceCandidateUnknown`, `choiceDuplicateSelection`, `choiceOptionOutOfRange` |

`blockForbidden` and `attackForbidden` are separate codes on purpose. A caller
told `notABlocker` or `targetNotRested` is being told about a card or a board —
something it could have worked out itself. These two say a move the rules allow
was taken away by a card, which is a different thing to render and a different
thing to debug. Neither should be seen in normal play: `legalActions` withholds
the offer, so reaching one means the action came from a replayed log, a stale
client, or a bot that kept an old list.

`choicePending` is returned for *any other* action attempted while a choice is
open: a suspended effect blocks the whole game, not only its own player.

There is deliberately no `wrongPhase` code: because the automatic phases run
inside the turn transition, a player holding priority with no battle open is
always in the Main phase.

## Modifiable legality

`Modifier` could say two things about a card, `power` and `grantKeyword`, and
**everything that changes what a player may do fell outside it, in either
direction**. `ST01-012`'s "your opponent cannot activate [Blocker]" and
`OP01-021`'s "this Character can also attack your opponent's active Characters"
are the same hole seen from its two sides, so this is one mechanism and not two
kept in a mirror.

### The registry is `modifiers`' sibling, not its fourth member

`GameState.legality` holds `LegalityRule`s, which share everything that makes a
grant a grant — an id, a source, one of the two durations the engine can expire
— and differ in what a reader has to ask them. Every `Modifier` answers "what
value does this **card** have", which is why each has a `target` and why
`getPower` walks the list card-first. A legality rule answers "may this
**action** happen": it is scoped by a question, one of its two subject forms
names no card at all, and it is read at three unrelated sites. A fourth
`Modifier` member would have meant a nullable `target` for the sake of entries
`getPower` could only ever skip.

The predicate is **data**, never a function — `CardPredicate`, which is
`Selector` minus the zone. That is not style: a game suspended mid-effect has to
survive `JSON.parse(JSON.stringify(state))` and come back the same game, and a
closure is the one thing in the state that could not.

### Three questions, because the Comprehensive Rules ask them in three places

| Clause | Where the answer is visible | Rules |
| --- | --- | --- |
| `activateBlocker` | the Block Step, via `legalActions` and `validateDeclareBlock` | CR 10-1-4-1, 7-1-2-1 |
| `attack` | the attack target set, asked per attacker | CR 7-1, 7-1-1-2 |
| `koInBattle` | where the Damage Step *decides* the K.O. | CR 7-1-4-1-2, 10-2-1-3 |

What "cannot activate [Blocker]" forbids is the **activation** and nothing
wider. CR 10-1-4-1 defines the keyword as one "allowing you to activate it by
resting this card during the Block Step", so what a card bans is the block
declaration — not the keyword, and not resting as such. The game words the wider
restriction differently: the official Q&A for "cannot be rested" stops both the
actions that require resting *and* the card being rested by another effect. Two
phrasings, two restrictions, and this is the narrow one.

K.O. immunity is asked where the K.O. is decided, before `closeBattle` ends the
"during this battle" effects, and it changes only that: CR 7-1-4-1-2 continues
"Then, proceed to End of the Battle", and it proceeds there either way. The
Damage Step emits `battleResolved` with a fourth outcome, `koPrevented`, rather
than borrowing `noEffect` — a Character that shrugged off a hit and a Character
that lost the comparison are not the same event, which is the distinction
`battleEndedEarly` already exists to keep.

CR 10-2-1-3 is why the clause says "in battle" at all: effects reading "cannot
be K.O.'d" are valid when the card is K.O.'d "by an effect **or** due to the
result of a battle", and every printed card in scope narrows it to the second.
An unqualified immunity is a wider clause, not a second call site.

### Two faces, one clause

A card either says this continuously or buys it for a while, and the rules keep
those apart: CR 8-1-3-3's permanent effects "constantly affect gameplay while
they are valid" against CR 8-1-4-2's continuous effects that last "for a
specified duration". So does the engine. `Ability.grants.legality` is the
continuous face, read through `forEachStatic` — which already answers exactly
the question each aggregator needs, so there is no second walk — and the
`setLegality` instruction is the written one. `OP01-021` Franky and `OP01-112`
Page One are the same clause on the two faces.

A static grant carries no subject, for the same reason `power` and `keyword`
grants carry none: `affects` already said who.

### The decision, and who wins

`canActivateBlocker`, `canAttack` and `canBeKOdInBattle` are three thin
questions over one walk, and all three run the same procedure: start from the
base rule, let permissions widen it, then let prohibitions take it away.
Prohibitions win, which is **CR 1-3-3** — "if a card's effect requires a player
to carry out an action while a currently active effect prohibits that action,
the prohibiting effect always takes precedence". Not section 4-9, which earlier
notes in this repo guessed at: 4-9 is "Base", and says nothing about conflicting
effects.

A permission is only consulted where the base rule says no, which is what "can
**also** attack your opponent's active Characters" means.

### The attacker-scoped rule, and why it lives in the state

`ST01-016` is the shape that decides whether the design is cut right: "your
opponent cannot activate [Blocker] if that Leader or Character attacks during
this turn". It is written in the Main Phase, when there is no battle at all; it
must sit inert through every other card's attack; it must apply to an attack the
named card declares much later; and it must expire with the turn whether that
attack ever came or not. A prohibition modelled as a property of a battle could
do none of that, so `whileAttacker` is a field on the rule and the rule lives in
`GameState`.

### The affordance contract

**A forbidden move is not offered.** `legalActions` is what a client builds its
buttons from, so a prohibition has to be invisible rather than rejected — a UI
that shows a block button and then refuses the click is describing a rule it
does not have. `applyAction` revalidates anyway, as it does for everything.

One consequence worth knowing: the attack target list is now built **per
attacker** rather than once, because a permission is attacker-scoped. There is
no single "the targets" any more.

### Lifetimes

`endOfBattle` rules die in `closeBattle`, on the line the power modifiers die on
— CR 7-1-5-3 and 7-1-5-4 say "effects that last during this battle", not "power
modifiers" — and so on both exits, the ordinary one and the vanished-participant
one. `endOfTurn` rules die in `finishTurn`. And a rule that names a card **by
identity** dies when that card leaves the field, in `detachFromField`, one line
below the modifier purge: CR 3-1-6 makes the card that comes back a new card,
and CR 10-2-13-4 applies exactly that reading to a card that leaves and returns.
A rule whose subject is a *side* survives — no card leaving can carry away a ban
that was never about it — and so does one whose **source** left, which is what
lets `ST01-016` work from an Event sitting in the trash.

### Two judgement calls, neither behind a flag

**When the power predicate is read.** `ST01-002` bans "a [Blocker] Character
that has 5000 or more power during this battle", and the engine tests that at
the moment the block is attempted, against `getPower`. The alternative — fixing
the set of banned cards when the effect resolved — has no textual support:
CR 8-1-4-1 makes a one-shot effect one that "completes its processing
immediately", and a ban lasting a battle is not that, while CR 8-1-4-2's
continuous effect "continues to affect the game for a specified duration", which
is a condition tested while it lasts. So a Blocker pushed to 5000 by somebody
else's effect falls under the ban, and one pushed to 4000 blocks. No `rules`
flag, because there is no second reading to switch to.

**Attacking an active Character changes nothing else.** Nothing in CR 7-1 rests
the card being attacked, and 7-1-4-1-2 gives the Damage Step one outcome against
a Character. `OP01-021` widens the target set of 7-1-1-2 and touches nothing
else — the Block Step still happens, the comparison still happens, the loser is
still K.O.'d. Verified against the Comprehensive Rules text; the official
card-level Q&A is rendered client-side and could not be read mechanically, so
this is a reading of the rules rather than a quoted ruling.

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
exercise the effect system. Between its 36 cards it covers **every `op`, every
`Trigger`, every `Cost`, every `Condition` kind and all four keywords**, plus an
`if` nested inside a `forEach`, a `oncePerTurn`, an `optional`, two continuous
sources, and a K.O. that wakes an `[On K.O.]` on the card it just killed.

New coverage is added to an existing card wherever it can be. A new `ABIL-` id
changes `abilityDecks.ts`'s deck list and reshuffles every seeded scenario in the
package, so `ABIL-018` carries four abilities and the `ABIL-024` Stage two — the
`restSelf` cost sits on the Stage because that is the shape the real card has
(`ST01-017`), and because it lets one test rest the source and still read its
continuous effect.

**`ABIL-032` and `ABIL-033` are the exception, and the exception is the point.**
They are two card numbers printing one name, `Signal Flag`, which is the single
thing reference-by-name cannot be tested without: CR 2-1-2 matches names and CR
2-14-2 counts numbers, so the set has to hold a case where the two disagree.
`ABIL-032` is deliberately vanilla — every claim about it is a claim about its
name, so it must have no behaviour to be mistaken for one. `ABIL-034` Boatswain
carries the inclusion half and the `max: 0` gate, and is *not* a Signal Flag,
because a card gating on its own name closes its own condition the moment it
lands.

Three new ids took the set from 31 playable to 34 and the deck's free second
copies from 19 to 16, which starved `ABIL-009` and `ABIL-011` of pairs that list
order had been supplying by accident. Both are now named in `PAIRED` — the list
that exists so a needed pair is a stated requirement rather than a coincidence of
ordering.

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

The driver also **declines to attach DON!! on 1 decision in 3**, and that is not
flavour. `ATTACH_DON` is legal while one active DON!! remains — the Leader is
always a legal recipient — and `END_TURN` is the last tier, so the bot used to
empty its cost area every turn. DON!! return to active only in their own
Refresh Phase (CR 6-2), so a defender arrived at every Counter Step with nothing
to spend and `PLAY_COUNTER_EVENT` (CR 7-1-3-2-2) was offered **zero times in
7,921 Counter Steps**. A whole family of printed cards was unreachable because
the bot played a style no human plays.

The decline is a coin on `(seed, decision)` only — never on which actions are on
offer — which is what keeps local perturbation intact. A per-decision coin is
enough because of the tier interaction: once a turn has nothing left but
attaches and `END_TURN`, a declining decision leaves only `END_TURN`, and the
turn ends holding DON!!. The rate was swept against ability coverage, not
against realism; the table is in `HOLD_DON_EVERY`. Every `[Counter]` half in the
repo now fires in ordinary play, including `ST01-014`'s, which had never been
reached by a real game since PR #10 wrote it.

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
cycle, the cost kinds, the keywords, and the damage branches. Modifiable
legality adds seven more, and the two directions are counted apart on purpose:
`legality.forbidden` and `legality.allowed` are the two halves of the hole the
mechanism closed, and a sweep that reaches only one of them has half-tested it.

That split earned its keep immediately. Six of the seven were hit within a few
hundred games and `legality.allowed` was not, because every synthetic card in
the ABIL set narrowed legality and none widened it — a direction whose only
evidence would have been the test written for it. `ABIL-028` exists to close
that, and it is `OP01-021` Franky transcribed with nothing taken away.

Measured over 200 games with `--abilities --marks`, **eight of the 82 declared
marks are never reached**:

| Dead mark | Why |
| --------- | --- |
| `deckOut` | Games end by life-out around turn 23, long before a 41-card deck runs out. Pinned by `winConditions.test.ts`. |
| `concede` | The bot excludes it on purpose; left in a uniform pool it ends nearly every game at random. Pinned by `winConditions.test.ts`. |
| `op.targetGone` | Needs something to remove a target *between* choosing it and acting on it. Random play essentially never builds that chain, and "abort the whole script" is the natural wrong implementation, so `staleTargets.test.ts` builds the position directly. |
| `ability.costLostBeforeResolution` | The defensive re-check when an earlier effect in a chain spends the resources a queued ability needed. Pinned by `staleTargets.test.ts` with a hand-queued stack item. |
| `battle.endedEarly` | Needs an effect that removes a battle participant *during* the battle, and no ABIL card does — the set was cut before any card could. `battleVanished.test.ts` registers its own cards for it, and it fires in ordinary play elsewhere: `packages/cards` reaches it in 2 of 300 OP-01 games, on `OP01-017` Nico Robin K.O.ing the Character she is attacking. Dead in *this* sweep, not in the repo. |
| `choice.orderTrivial` | An ordering with one card or none, which needs a deck down to its last two cards while the card that looks at it is still on the board. Games end on deck-out before that. `orderCards.test.ts` builds both positions directly. |
| `choice.partitionTrivial` | The same position one card narrower — a partition with **nothing** to place, since one card still gets asked. 3 hits in 1500 ability games, against the ordering shortcut's 12. Both are built directly in their own suites. |
| `op.lookAtNothing` | Looking at an empty deck. Same reason, one step further: a player with no deck has already lost at the next rule processing (CR 9-2-1-2). |

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

**`rules.selfReturnResolvesEffect` (default `true`).** Whether an ability still
resolves when its **own activation cost removed its source from the field**.
`OP01-047` Trafalgar Law is the one printed route: its `[On Play]` costs "return
1 Character to your hand", nothing excludes Law itself, and a card that means to
exclude itself says so (`OP08-047` prints "other than this Character").

The Comprehensive Rules point both ways, which is what makes it a flag rather
than a comment. CR 8-1-3-1-3 says an auto effect "will not activate and cannot be
resolved ... if the card that fulfilled the activation timing of that auto effect
moves to another area **before that effect is activated**", and CR 8-4-1 orders
payment (8-4-1-3) ahead of activation (8-4-1-4) — together, a self-payment
fizzles. But CR 8-3-1-3-1 describes the same sequence as "you have fulfilled the
conditions to pay the activation cost, **activated the effect**, and become
unable to pay the activation cost while in the process of paying", which puts
activation before the payment finishes and leaves 8-1-3-1-3 describing a card
removed by something *else* in between.

True is the reading that matches everything this engine already does — a script
whose source has left keeps running, and `OP01-007` Caribou's `[On K.O.]`
resolves from the trash — and the only one under which the printed cost is a cost
a player can take. `false` drops the effect after the payment; the cost is still
paid, and the selector still offers the source either way.

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

The union has seven members and three of them carry data for one reason: the
answer is an **action**, not a value, and re-reading the instruction after the
answer could name something else. `play` carries the entering card, and
`discard` carries the **owner** — the hand the chosen cards leave, which is a
second fact from the cards themselves and the only one that cannot be recovered
from `candidates`. That matters more here than anywhere else, because the player
answering may not be the player losing the cards.

**`Condition.varTrue`.** The brief's `Instruction` list has `confirm`, which
writes a boolean into `vars`, but its `Condition` list has nothing that can read
one — so a "you may do X, otherwise Y" card could be written and would never
branch. `optional: true` covers "may I activate this at all"; `varTrue` covers a
branch *inside* a script. Without it, `confirm` is decorative.

**Three triggers watch somebody else's board.** `whenActivatingEvent` and
`whenOpponentActivatesEvent` fire from the two places CR 8-5-2 calls card
activation — "using an Event card from your hand", which is both the `[Main]`
and the `[Counter]` route — and `whenOpponentCharacterKOd` fires from the one
`cause === 'ko'` branch of `leaveField`, so a Character trashed to make room for
a sixth (CR 3-7-6-1-1) never reaches it. The side is in the trigger name rather
than in a condition, following `whenOpponentAttacks`: the firing site decides
who is notified, so an ability that watches the wrong side is unspellable.

Both Event sites fire the Event's own trigger **first** and the watchers second,
because `enqueue` puts new items underneath what is already on the stack and
CR 8-6-3 wants the watcher "after the resolution of the effect of the previously
activated card". The order of the two calls is the whole implementation of that
rule, and reversing them would be silently wrong.

**Seven triggers now, and one door.** The prose sweep found four more families
printed with no bracket tag — `whenDonReturnedToDeck` (16 cards),
`whenBecomingRested` (8), `whenOpponentActivatesBlocker` (4) and
`whenOpponentPlaysCharacter` (2) — and every one of them fires at the *site the
fact happens* rather than at each caller that can cause it. Three of the four
are sided facts like the two Event triggers, so all four sided facts now go
through `fireSidedTriggers`, which is the only place the actor-first ordering
above is written down. Where CR 8-6-1's turn-player ordering and that convention
could disagree — an acting side that is not the turn player — the convention
wins and the disagreement is documented at the function, because changing it is
a rules change with an effect on every replay rather than a refactor.

`whenBecomingRested` is the one that needed a routine rather than a line:
attacking, blocking, a `restSelf` cost and a `rest` instruction all rest a card,
so `setOrientation` owns the transition and the four callers stopped assigning
the field. The Refresh Phase goes through the same routine and can never fire
the trigger, because it moves cards the other way (CR 6-2-4).

**The fifth prose family is not a trigger.** "When this Character is K.O.'d **by
your opponent's effect**" (6 cards) is `onKO` with a question attached, so
`leaveField` takes a `LeaveFieldCause` whose K.O. member *requires* a causer and
seeds it into the trigger's context as `koCause`. A `PlayerId` is the controller
of the effect (CR 8-1-1); `'battle'` is the Damage Step, which CR 10-2-1-3 puts
on the far side of an `or` from "by an effect" and which therefore answers
neither player. A second trigger would have meant a second firing site for a
fact that has one.

**`rules.effectPlayIsPlayingACharacter` (default `true`).** CR 3-7-3 calls the
bare placing of a card in the Character area "playing" it, so a Character an
effect put down wakes "when your opponent plays a Character". PR #29 separated
that sense of the word from CR 6-5-3-1's paid Main Phase action **for cost**
(`playFromEffectPaysCost`), and nothing in that separation says the card was not
played. `OP12-081` is the printed evidence: it names "plays a Character using a
Character's effect" as a timing it has to *narrow*, not one it has to add.

**`rules.nextTurnExcludesTurnInProgress` (default `true`).** `Duration`'s third
member, `endOfOpponentNextTurn`, is the only one that outlives the turn it was
written in, and CR 6-6-1-2 says exactly where it expires — the End Phase's
expiry step runs the turn player's timed effects and then the non-turn player's,
and an effect measured against the opponent's turn is always in the second
clause when it dies. What the rules never say is how "next" is **counted** when
the effect is written *during* the opponent's turn, which `OP08-112`'s
`[Trigger]` really can do from the Life area. The default reads it off the
English: a turn that is happening is not a turn that is next, and 459 cards say
"during this turn" when they mean the current one.

Both `Modifier` and `LegalityRule` gained a `controller` and a `writtenOnTurn`
for this member alone, and both fields are required rather than optional —
`exactOptionalPropertyTypes` plus the no-explicit-undefined rule make an
always-present field the only encoding that round-trips exactly. An invariant
bounds the lifetime at two turns, which is arithmetic and not caution: a record
that outlives it has stopped being expired by anything.

**`rules.placedRestedBecomesRested` (default `false`).** A Character placed
rested did not *become* rested: CR 3-7-5 words that act as **placing**, and the
card was not on the field a moment earlier to change from. The other reading is
arguable — the card is rested and was not before — which is why it is a flag. No
printed card in OP-01 or either starter can reach the case, so the choice costs
nothing today and is written down before it can.

**Putting a card on the field is a routine, not a zone.** `ZoneRef` still has
no `field` member and `moveCard` still cannot reach the Character area, and
that is deliberate: a card arriving on the field owes four things a move does
not. It is stamped `playedOnTurn`, so CR 3-7-4's "played cards cannot attack on
the turn in which they are played" applies to it; it arrives active unless the
instruction says rested (CR 3-7-5); a full board asks its controller which
Character makes room, and that trash is not a K.O. (CR 3-7-6-1 and 3-7-6-1-1,
plus the Q&A: "the trashed Character is not K.O.'d, but directly moved to your
trash"); and its `[On Play]` fires (Q&A: "you must activate the [On Play] effect
whenever possible"). All four live in `enterCharacterArea`, which `PLAY_CARD` and
the `play` instruction both call — two code paths onto the field is how one of
them gets fixed and the other does not.

The sacrifice question is the third use of the `PendingChoice.sink` pattern,
after the script variable and the chosen cost, and the first whose record has to
*carry* something: which card is entering, since re-resolving the instruction's
`Ref` after the answer could name a different one.

**`ZoneRef`, `Duration`, `PlayerRef`, `Color` were not defined in the brief.**
`ZoneRef` is `{ zone: 'hand' | 'deck' | 'trash' | 'life' }` with no owner field,
because cards always move to the zones of their **owner** — that is the physical
rule, and an owner field would only allow states the game cannot reach. `Color`
is a `string` alias, since `CardDefinition.color` is a plain string in the
registry; the brief's `Color[]` implied an enum that does not exist. `types` and
`abilities` were added to `CardDefinition` as optional fields so every Phase 0
definition still compiles untouched.

**Deterministic discards — half closed.** This read, in Phase 2A: "The
`discardHand` cost and the `discard` instruction take cards from the front of
the hand rather than asking... This is the one divergence that deletes a real
player decision, and it is the same criticism Phase 0 levelled at letting the
engine pick the 6th-character discard."

The **cost** half is closed. The reasoning that kept it open — "a choice there
would be a `PendingChoice` before the script starts, and the brief is explicit
that costs are settled before the script runs" — was reading the brief's
ordering as a ban on suspending inside the payment. The rules do not: CR 8-4-1-3
is "determine the activation costs **and** pay all activation costs", and
determining is the choosing. Costs are still settled before the script runs; the
settling is simply not atomic. See **Costs are checked, never paid halfway**
above.

The **instruction** half is closed too, and with it the whole divergence. There
is no deterministic discard left in the DSL: `op: 'discard'` now takes a
`chooser` and an `owner` and opens a choice. The front-of-hand form was not kept
beside it, because **no printed card in the game means "trash the leftmost card
in your hand"** — it was correct for zero cards and available to every author.

The note this paragraph replaces got the cards wrong in two ways, and both
mattered to the design. It listed three and there are four (`OP01-088` prints
the controller-chooses form), and it said all of them read "your opponent trashes
1 card from their hand" — `OP01-038` Kanjuro does not. Kanjuro reads "your
opponent **chooses** 1 card from **your** hand", which is a different sentence:

| Printed | `chooser` | `owner` | Set |
| --- | --- | --- | --- |
| "trash N cards from your hand" | `you` | `you` | 142 |
| "your opponent trashes N cards from their hand" | `opponent` | `opponent` | 21 |
| "your opponent **chooses** N cards from **your** hand" | `opponent` | `you` | **1** |

One "whose hand" field says the first two and makes the third unspellable. Two
independent `PlayerRef`s say all three and the fourth combination nothing prints
yet. Kanjuro is the only card in the game in that last row, which would normally
be a declared row here — but that standard prices a *mechanism* built for one
asker, and this is one field on an instruction being built anyway for the other
163.

**It is the first script in the engine that asks the other player anything.**
Every other `openChoice` call site passes `item.controller`, and the
`discardHand` cost resolves its candidates with `owner: 'you'` hardcoded, so the
cost half never crossed the table either. Choices have gone to the *non-turn*
player since Phase 2A — a life card's `[Trigger]` belongs to the damaged player —
but never to the ability's opponent. Nothing underneath had to change:
`openChoice` already moves priority to whoever is asked, `checkEffectShape`
already asserts `priority === pending.player`, and `validateAnswerChoice` already
refuses everyone else. The consequence is new all the same — a player's own card
can now leave them holding exactly `[CONCEDE]` while the opponent decides.

**The chooser is shown a hand they should not see.** The hand is a secret area
(CR 3-1-5), CR 11-3-1 confines looking to "the player of that effect" unless the
card says otherwise, and CR 8-4-4-2 states the consequence for choosing out of
one: "players cannot guarantee that the chosen card meets the required
conditions". So Kanjuro's opponent points at a face-down card. This engine is
perfect-information by declared design, so `PendingChoice.candidates` carries
real ids to the chooser — which makes this the first card that turns that debt
from theoretical into reachable. Filed with the per-player-view debt in
`docs/op01-inventory.md`; deliberately **not** modelled as a random pick, because
the rules say the opponent chooses and a die roll is a different game.

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

**One event in the log is public in *shape* and private in *contents*, which is
a case the debt did not have before.** `deckPartitioned` reports how many cards
went to each end of the deck and which ones. At a real table the opponent sees
the counts and not the faces — a player putting three cards on top and two on the
bottom leaks the split by doing it. So a per-player view has to **redact this
event down to its two lengths** rather than drop it, where every other private
event (`cardsLookedAt`, `cardDrawn`) can simply be withheld. The client already
renders it that way — counts only — which is the same trade `cardsLookedAt`
makes, and it is the shape a real hidden-information layer should inherit.

## Out of scope for Phase 2A

- **Real card data.** Phase 2B. Everything here is the synthetic ABIL set.
- **UI for answering choices.** Phase 2C. The engine opens choices and the bot
  answers them; the client has no control for it and never sees one, because the
  default decks have no abilities. Two things the event log does not say — an
  ability that resolves to nothing emits no event, and continuous abilities emit
  none at all — are written up for 2C in
  `docs/trigger-reachability.md`, under "Notes for phase 2C".
- **Player-chosen trigger order** — still a fixed deterministic policy, flagged
  `TODO phase 2B` above, and now the **only** half of that line still open.
  Player-chosen discards were the other half: the `discardHand` **cost** asks
  (PR #28) and the `discard` **instruction** asks, so nothing about a discard is
  deterministic any more.
- **`PLAY_CARD.trashCharacter` as a `PendingChoice`** — the machinery now exists
  and the `play` instruction uses it, so the *effect* path asks and the *action*
  path still takes the answer in the action. Converting the action remains a
  migration of recorded action logs rather than a feature, and both paths share
  one routine, so they cannot disagree about what the sacrifice means.
- Deck-construction legality (4-copy limits, color matching) beyond basic
  decklist shape validation.
- Hidden-information views, networking, persistence, and AI beyond the random
  bot.

Still true from Phase 0, and now a real move rather than a synthetic-only one: a
Counter **Event** is played from hand for its cost (`PLAY_COUNTER_EVENT`), its
`counterEvent` effect resolving from the trash, and a life card's `[Trigger]`
fires.

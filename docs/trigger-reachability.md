# Trigger reachability sweep

**All eleven triggers are now reachable by a real card.** The sweep found one
hole — `counterEvent` — and it has since been closed: the engine can activate a
[Counter] Event from hand (`PLAY_COUNTER_EVENT`, CR 7-1-3-2-2), so `ST01-014`
Guard Point's `[Counter]` half is a real, reachable play. The record below is
kept as the evidence, with the `counterEvent` row updated and the "one hole"
section rewritten to how it was closed.

The rest of this document is that evidence, plus three secondary findings the
sweep turned up on the way.

**Current as of the phase 2C client work.** Three things have changed since the sweep and are
worth having up front:

- **Backlog A holds no actionable item.** Both of its entries are settled — one
  built (PR #10), one priced and declined. See
  [Backlog A is empty of actionable work](#backlog-a-is-empty-of-actionable-work--say-it-plainly),
  because the sections above it are written in the voice of a live queue and
  read as though work were outstanding.
- **Backlog B lost its top four and gained three more.** PRs #11, #12 and #13
  closed self-targeting statics, rested-DON!! giving and DON!! orientation, and
  PR #15 closed resting the source as a cost; PR #11 also uncovered three DON!!
  mechanics no starter card prints, sized in `docs/starter-card-inventory.md`.
- **`counterEvent` fires from two sites and one of them is dead.** The trigger
  is reachable — that has not changed — but only through `PLAY_COUNTER_EVENT`.
  No printed card can reach the `PLAY_COUNTER` site, which PR #15 measured,
  documented and pinned rather than deleted. See
  [one of the trigger's two firing sites is dead](#one-of-the-triggers-two-firing-sites-is-dead--measured-documented-pinned).

Phase 2C notes live at the end of this document, under
[what the event log does not say](#notes-for-phase-2c--what-the-event-log-does-not-say).

## Why this sweep exists

`docs/starter-card-inventory.md` classified 34 cards against the DSL's
*vocabulary* and never asked whether the engine has an **action that reaches the
trigger**. `counterEvent` fell through that gap: the script was expressible, the
trigger unreachable. The two questions are independent, and only the first had
been asked. This asks the second, for all eleven.

## Method, and what the numbers mean

Firing sites were read out of the engine. Reachability was checked against the
*preconditions* of the action that fires each one, not merely against the
action's existence — that was the exact shape of the `counterEvent` miss.
Card counts are text probes over the 2665 cards in `cards.en.json`.

**A probe counts mentions, not possession.** "[On Play]" appears on two Leaders,
but both are *talking about* On Play effects ("Your [On Play] effects are
negated"); neither has one. Every category that looked impossible was read by
hand — the two Leaders, the five Leaders matching "[Trigger]", and the one
Character matching "[Main]" are all references, not abilities. No false hole
survived that check.

### The probes overcount, and the inventory's table has the same bias

That caveat is not local to this sweep. The ranked gap table in
`docs/starter-card-inventory.md` was built with the same kind of probe, so every
"full set" number in it is an **upper bound**: a card that mentions a mechanic
is counted as a card that needs it.

Nothing is recounted here, and nothing needs to be. The numbers were only ever
meant to separate a family from a one-off, and inflation of this size does not
turn a one-off into a family. The rule to carry forward is narrower:

> When a decision turns on a **close comparison between two gaps** — which of
> two similar counts to build first — those two get counted by hand before the
> decision, not by probe. Everywhere else the probe is good enough for what it
> is used for.

The direction of the error is always the same, which is what makes it safe to
live with: probes overcount, never undercount, so a gap that looks small really
is small.

Three claims were verified by running the engine rather than by reading it: the
two damage instances of a Double Attack, Banish suppression, and all three
origins of `onKO`.

## The eleven

Line numbers are as of PR #13; PRs #9–#13 moved several of them, and the ones
below were re-read rather than carried over.

| Trigger | Fired by | Reachable | What proves it | Cards | Gap |
| --- | --- | --- | --- | --- | --- |
| `onPlay` | `applyPlayCard`, `reducer/main.ts:83` (character) and `:108` (stage) | **yes** | `ST02-009` Law, in an unstaged game (`game.test.ts`); ABIL table | 868 | — |
| `whenAttacking` | `applyDeclareAttack`, `reducer/battle.ts:107` | **yes** | `ST01-005` Jinbe, unstaged game | 250 | — |
| `onBlock` | `applyDeclareBlock`, `reducer/battle.ts:141` | **yes** | ABIL-022 only (`abilityTable.test.ts`) | 14 | no real-card coverage |
| `onKO` | `leaveField(cause: 'ko')`, `reducer/helpers.ts:127` | **yes** | ABIL-011 from battle and from a script `ko` | 157 | no real-card coverage |
| `whenOpponentAttacks` | `applyDeclareAttack`, `reducer/battle.ts:108` | **yes** | ABIL-014 only | 49 | no real-card coverage |
| `activateMain` | `ACTIVATE_ABILITY` → `reducer/activate.ts:38`, gated in `legalActions.ts:101` | **yes** | ABIL-009/010 only | 365 | no real-card coverage |
| `trigger` | life-card damage step, `abilities/interpreter.ts:811` | **yes** | `ST01-014`, `ST01-015` from life, unstaged games | 501 | see coverage note |
| `counterEvent` | two sites, one of them dead: `applyPlayCounterEvent` (`PLAY_COUNTER_EVENT`), gated in `legalActions.ts`; and `applyPlayCounter`, which **no printed card can reach** — see below | **yes**, through the first site | `ST01-014` Guard Point from hand (`counterEvent.test.ts`, `counterEventPlay.test.ts`); ABIL-016 | 184 | **was missing rule — closed by PR #10** |
| `mainEvent` | `applyPlayCard`, `reducer/main.ts:124` | **yes** | `ST01-015` Jet Pistol, unstaged game | 272 | — |
| `endOfTurn` | `applyEndTurn`, `reducer/turn.ts:24` | **yes** | `ST02-013` Kid, unstaged game | 50 | — |
| `static` | not fired — read in `getPower` / `hasKeyword` via `forEachStatic`, `selectors.ts:54` | **yes** | ABIL-003/004/024 (`continuous.test.ts`); `ST01-013`, `ST01-004`, `ST02-003` since PR #12 | — | see the read-path audit |

Precondition notes, since that is what this sweep is actually about:

- **`onBlock`** needs the card to be able to block at all. All 14 `[On Block]`
  cards also print `[Blocker]`, so all 14 can reach it.
- **`onKO`** needs a card that can be KO'd. All 157 `[On K.O.]` cards are
  Characters; Leaders cannot be KO'd, and no Event or Stage carries the marker.
- **`activateMain`** needs the source on the field. All 365 marker cards are
  Leaders, Characters or Stages, and `legalActions` scans all three.
- **`whenOpponentAttacks`** fires on the defender's whole field. All 49 cards
  carrying `[On Your Opponent's Attack]` are field residents (40 Characters, 8
  Leaders, 1 Stage) — none of them needs to be played from hand mid-attack,
  which is what would have put them behind the same wall as `counterEvent`.
- **`trigger`** needs the card to be in the life area, which means in the deck.
  Every category that carries the marker can be.

## The one hole, now closed: `counterEvent`

Was: **missing rule**. The engine was incomplete, not merely limited.

`legalActions` offered `PLAY_COUNTER` only for a card whose printed `counter`
was not null, and `applyPlayCounter` threw without one. Playing a Counter Event
from hand for its cost was a different move, and the engine did not have it. All
184 `[Counter]` cards in the game are Events, and all 184 are printed with no
Counter value.

The move exists now. `PLAY_COUNTER_EVENT` (CR 7-1-3-2-2): the attacked player
pays the Event's printed cost with active cost-area DON!!, trashes it, then its
`[Counter]` effect resolves — offered only to the defender, only at the Counter
Step. `packages/cards/tests/counterEvent.test.ts` inverted with it: Karoo
(printed Counter 1000) is still offered as a discard for its value, and Guard
Point (a `[Counter]` ability, no printed value) is now offered beside it as a
Counter Event, each move naming only its own card.

### Why the ABIL set hid it — and the guard that now stops a repeat

Worth recording, because it is the reusable lesson.

`ABIL-016 "Desperate Parry"` was an Event with **`counter: 1000` and a
`counterEvent` ability**. That combination made `abilityTable.test.ts` reach the
trigger through `PLAY_COUNTER` — and it **does not exist on any printed card**.
The synthetic set did not merely fail to catch the hole: it invented a card
shape the game never prints, and that shape was exactly the one that made the
trigger look reachable.

A synthetic set built to cover the *DSL* will do this by construction. It is
free to give a card any combination of fields, including combinations no printer
ever produced. That makes it a good test of the interpreter and a bad witness
for reachability.

ABIL-016 is now the shape the game prints: `counter: null`, its whole text a
`[Counter]` ability, activated with `PLAY_COUNTER_EVENT`.
`packages/cards/tests/abilCardShapes.test.ts` pins the reachability-relevant
printed fields (category and whether a Counter value is printed) and asserts
every ABIL card's shape has a counterpart in `cards.en.json` — so no synthetic
card can fake a printed shape, and stand in for reachability, unnoticed again.

### One of the trigger's two firing sites is dead — measured, documented, pinned

The table above named two sites for `counterEvent` and left it there. Counted
since: **zero cards of the 2665 can reach the second one.**

`applyPlayCounter` fires the trigger after a card is discarded for its printed
Counter value, on the rule that a Counter card carrying an effect resolves it.
Taking that path needs `counter !== null` *and* a `[Counter]` ability, and the
two sets do not intersect: 184 cards carry the `[Counter]` marker, **all 184 are
Events, and none of them prints a Counter value**. It is the same fact that made
`PLAY_COUNTER_EVENT` necessary in PR #10, asked the other way round.

**The line stays.** Deleting it would be encoding "no such card exists" as an
absence — precisely the failure mode ABIL-016 demonstrated, where a shape nobody
had written down was assumed and hid a missing move for a year. Instead the fact
is now a test: `abilCardShapes.test.ts` asserts the empty intersection from the
printed text, from the engine's own `getAbilities` predicate, and across the ABIL
set. The day a card prints both, the guard fails and the path is announced
rather than discovered.

The engine keeps the rule because the rule is right. What was missing was a
statement of *why* it never runs, in a place that fails when that stops being
true.

## Secondary findings

None of these is a reachability hole, so none gets a pinning test. They are
recorded because the sweep is where they surfaced.

### `[Opponent's Turn]` cannot be said at all — 77 cards

There is no `Trigger` member for it, which the inventory already noted. What it
missed is that there is no way around it either: these are continuous effects
that apply on the opponent's turn, so the natural encoding is a `static` with a
condition meaning "not your turn" — and `Condition` has `and` and `or` but **no
negation**. `isYourTurn` cannot be inverted. Classification: **missing
vocabulary**, 77 cards, and larger than the inventory's count of the same
marker suggested.

Also unsayable, in the same family: `[Unblockable]`, 8 cards. `Keyword` has
exactly four members and this is a fifth.

### Power-gated conditions: answered — current power, with one declared divergence

`getPower` and `hasKeyword` are the only readers of printed power and printed
keywords — the audit for that is clean. Nothing outside `selectors.ts` touches
`def.power` or `def.keywords`; combat compares with `getPower`
(`battle.ts:280-281`); Rush, Blocker, Double Attack and Banish are all asked of
`hasKeyword` in both `legalActions` and `battle.ts`. A granted keyword counts
exactly like a printed one everywhere it matters.

At the time of the sweep, an **ability's `condition`** was evaluated with the
without-statics reading in all three places one is checked (`triggers.ts`,
`legalActions.ts`, `activate.ts`), while an `if` *inside* a script read
`getPower` — the same `Condition` saw different power depending on where it
sat. The sweep could not tell whether that was deliberate, and left it
unclassified. **PR #9** (`fix/conditions-read-current-power`) answered it:
accidental. The
recursion guard that static evaluation needs was applied wider than necessary;
for a non-static ability there is no re-entry, because `getPower` drops to the
without-statics reading one level down, inside `forEachStatic`. The three sites
now pass `getPower`, which is what the Comprehensive Rules describe: one power
value per card, made higher or lower than printed by effects (2-6-3),
activation conditions met against the state as it is (8-4-1-1), and the Damage
Step comparing "the power" of the same card (7-1-4-1).

The same PR renamed the guarded reading from `getBasePower` to
**`getPowerWithoutStatics`**, which is worth recording because the old name was
a rules term for something else: the Comprehensive Rules use *base power* for a
value an effect **sets** (4-9-2-1), and the engine will need that name the day a
card says "this Character's base power becomes X". The function is a recursion
anchor, not a rules concept.

What remains, now declared rather than accidental: a `static` whose **own**
condition asks about power still reads the without-statics value, because there
the guard is load-bearing. OP06-002 — "[DON!! x1] If this Character has 7000
power or more, this Character gains [Banish]" — is the printed card behind it:
its Banish never switches on when the 7000 threshold is only reached through
another card's continuous effect. The faithful fix is a layered effect system
that evaluates continuous effects in passes; known, and priced at far more than
one card justifies. Moved to backlog A — where, as the backlog section below
records, it is the only remaining entry and was **rejected on cost**, not
scheduled.

### Two coverage gaps

Both verified working by running the engine; neither has a test.

1. **A `[Trigger]` on the second damage instance of a Double Attack.** It does
   fire — a Double Attack into two `[Trigger]` life cards offers both, in order.
   The existing Double Attack tests use life cards with no `[Trigger]`, so
   nothing covers the interaction.
2. **`[On K.O.]` not firing when a Character is trashed to make room for a
   sixth.** Correct today: trashing for room passes `'trashedForRoom'` and the
   trigger sits under `cause === 'ko'`. `sixthCharacter.test.ts` B3 asserts the
   absence of the `koed` *event* using a vanilla TEST card — a proxy, and its
   own comment says the distinction "decides whether [On K.O.] triggers fire in
   phase 2", which is now. No test trashes a real `[On K.O.]` card for room.

## Correction to the inventory

**No card changes pile beyond the three already corrected** (`ST01-014`,
`ST02-015`, `ST02-016`). The sweep asked the reachability question of the other
ten triggers and every one of them answered yes, so no pile-A or pile-B card is
sitting behind a wall nobody noticed.

Two smaller corrections:

- The inventory listed `[Opponent's Turn]` as a marker with no `Trigger` member.
  It is worse than that: with no negation in `Condition`, those 77 cards cannot
  be expressed as `static` either. It belongs in the gap table, not in a footnote.
- The inventory recommended keeping `onBlock`, `onKO` and `whenOpponentAttacks`
  on the grounds that real cards exist behind them. This sweep upgrades that
  from "cards exist" to "cards can reach them": 14, 157 and 49 respectively, all
  clearing their preconditions. The recommendation stands on firmer ground.

## There are two backlogs, not one

The inventory's ranked table is a list of things **the DSL cannot say**.
`counterEvent` never appeared on it — not because it was overlooked, but
because it is not that kind of problem. It belongs to a second list nobody had
opened yet.

**Backlog A — missing rules.** The game has a move the engine does not offer,
or a behavior it does not reproduce. It opened with two items.

| Missing rule | Cards behind it | Status |
| --- | --- | --- |
| Playing a Counter Event from hand during the Counter Step, paying its cost | 184 | **done — PR #10** (`PLAY_COUNTER_EVENT`) |
| Layered evaluation of continuous effects: a `static` whose own condition asks about power reads the without-statics value (the recursion guard), so OP06-002's [Banish] cannot switch on through another card's continuous buff | 1 | open, **rejected on cost** |

### Backlog A is no longer empty — three items, all found by reading OP-01

**Superseding the section below.** It was written when A held one declined item,
and it was right then. Reading a real expansion set put three more in it, and
none of them is declined:

| Missing rule | Cards behind it | Found by |
| --- | --- | --- |
| Nothing fires when an Event is activated — `applyPlayCard` fires `mainEvent` on the Event itself and tells no other card | 8 | `docs/op01-inventory.md` |
| Nothing on the field can watch a K.O. — `leaveField` fires `onKO` on the K.O.'d card alone | 3 | `docs/op01-inventory.md` |
| ~~**The Damage Step cannot lose its target**~~ — an attack participant removed mid-battle left `state.battle.target` stale, and `resolveBattle` threw on it | 1 today | **OP-01 batch 1**, by writing `OP01-017` and running it — **done**, CR 7-1-1-4 |

The third is the one worth noticing, because of *how* it was found. The first two
came from reading text. This one came from **writing a card and playing it**: the
script passed every hand-built case and broke on contact with a real game, which
is exactly the `counterEvent` story with the discovery order reversed.

It is also the first A item to be **built rather than declined**, and it was
cheap: one guard at the single point where `applyAction` returns an observable
state, plus the `battleEndedEarly` event the log needs. The Comprehensive Rules
had the whole answer already — CR 7-1-1-4 and its two repeats route an
interrupted battle to End of the Battle (7-1-5), which the engine already knew
how to do. What was missing was the *route*, not the destination.

Two items remain in A, both about triggers nothing can reach.

It also answers the qualifier this document ends on — "A is empty *of what has
been looked for*". Three more questions got asked, and A stopped being empty
three times.

### The section as written, when A held one declined item

One item was built. The other was **priced and declined**: a layered effect
system evaluating continuous effects in passes, to serve exactly one printed
card. That is not a queued item waiting for its turn — it is a decision already
taken, recorded as a **declared divergence** rather than a defect. Nothing in
backlog A is waiting for anyone.

This is worth stating outright because the sections above are written in the
voice of a live queue, and a reader skimming them would reasonably conclude
there is A-ranked work outstanding. There is not. **An empty backlog A is a
result, not an absence of one**: it means the engine no longer has a move the
game has, and the games it simulates resemble the game. That was the entire
point of separating the two lists, and A reaching zero is the first time the
separation has paid out.

The one qualifier: A is empty *of what has been looked for*. `counterEvent` was
found by asking a question nobody had asked, and the three DON!! mechanics in
the inventory's [new-gaps
section](starter-card-inventory.md#gaps-the-34-cards-could-not-show) were found
by reading past the 34-card sample. A missing rule is invisible until someone
asks the right question of the right cards. Empty means nothing is known to be
missing — not that nothing is.

**Backlog B — missing expressiveness.** The trigger is reachable and the move
exists, but the DSL cannot say what the card does. This is the inventory's
ranked table, and four of its items have since been built:

| Missing expressiveness | Cards | Status |
| --- | --- | --- |
| Self-targeting continuous abilities | 268 | **done — PR #12** (`affects: {self: true}`) |
| Rested-DON!! giving | 105 | **done — PR #11** |
| DON!! orientation changes | 71 | **done — PR #13** (`orientDon`) |
| Putting cards into play | 375 | **done — the `play` instruction** |
| `[Blocker]` prohibitions | 146 | open — structural |
| `orderCards`, and naming "the cards not taken" | 254 | open |
| Suspendable costs | 197 | **done — the `discardHand` cost asks** |
| Resting the source as a cost | 90 | **done — PR #15** (`restSelf`) |
| Negation in `Condition` — `[Opponent's Turn]` | 77 | open — *added by this sweep* |
| A fifth `Keyword` for `[Unblockable]` | 8 | open — *added by this sweep* |
| Give **active** DON!! as a cost | 5 | open — *added by PR #11* |
| Add DON!! from the DON!! deck | 140 | open — *added by PR #11* |
| Move the opponent's DON!! | 2 | open — *added by PR #11* |

The last three are the ones neither this sweep nor the inventory could have
found: they are printed on no card in either starter deck. They are sized and
argued in the inventory. Note that the largest of them, 140 cards, would sit
third in this table — a family the 34-card sample was structurally unable to
see.

Backlog B, unlike A, is emphatically **not** empty, and that is the expected
state. B is where a young DSL is supposed to have a queue.

**The two are not interchangeable, and A is worse.**

A gap in backlog B limits *which cards can be written*. Every card already
written still behaves correctly; the deck is smaller than the real one, and
that is all. A gap in backlog A is different in kind: the cards can be written,
they sit in the deck, and the **games do not resemble the game**. That was the
`counterEvent` hole: a player holding Guard Point during the Counter Step held a
card the engine would never let them use, and the simulation quietly reported a
loss that would not have happened at a table. With `PLAY_COUNTER_EVENT` that
player can now defend, and the sweep exercises the play in every ability game.

That is why an item in A outranks a same-sized item in B, and why the sizes are
not even comparable: 184 cards is what `counterEvent` *blocked from being
played*, not what it blocked from being written.

## Does this change the order of work?

Not within backlog B. The inventory's order was driven by how many cards each
gap unlocks, and nothing here moves those numbers.

What changes is that backlog B is no longer the only queue. `counterEvent`
headed backlog A — it blocked all three `[Counter]` Events of the two starter
decks — and it has now been built, ahead of anything in B, exactly because an A
item outranks a same-sized B item. The layered-evaluation item, one printed card
against 184, is what remains at the head of A.

**Since answered, by PRs #11 through #13, and #15.** The inventory's order was
followed as written: the three-way tie at the top of B was built in the
recommended order, then the rest-the-source cost that stood next. With A holding
no actionable item, backlog B is once again the only queue — and its head is now
the pair of 3-card gaps that were tied for second, of which the `[Blocker]`
prohibitions are structural and the put-into-play family is the largest in the
inventory at 375 cards.

PR #15 left one methodological mark on this list. `restSelf` is the first entry
in B whose implementation had to reach `legalActions` and not only the
interpreter — a cost that cannot be paid has to be *invisible*, not merely
refused, or the affordance contract breaks. Nothing in the ranking changes; it is
a reminder that a B item's cost is not always confined to the DSL, and that
"missing expressiveness" and "missing rule" are labels for where a gap *starts*,
not for everything it touches.

The ranking rule did not change; what changed is that the A column ran out. The
next time an A item appears it will still outrank everything in B, which is
precisely why the two lists stay separate even while one of them is empty.

The methodological correction is worth more than the ordering: **for every card
from here on, ask both questions.** Can the DSL say it, and can a real card get
there. The second question is cheap — it is a read of one reducer — and it is
the one that was never asked.

PR #11 added a third question, from the other direction: **is this gap the whole
family, or only the part the sample happened to print?** Fixing `giveDon` for
three starter cards meant reading how all 2665 talk about DON!!, and that turned
up three mechanics no starter card carries — one of them 140 cards wide. The
first two questions interrogate a card. This one interrogates the sample.

## Notes for phase 2C — what the event log does not say

**Both findings below are now answered, in the client rather than the engine.**
Nothing in the engine changed; the record of the problems is kept because the
reasoning is what justifies the client's answers, and because a future engine
change would have to revisit them.

- *Resolved to nothing*: derived, which is the option this document says the
  engine currently supports. `store/selectors.ts` marks an `abilityTriggered`
  with no effect event before the next window boundary as "sin efecto" — and
  only once the engine has nothing left in flight, so an ability that is
  mid-choice is not labelled before the player has answered it.
- *Continuous abilities*: derived from the board, as suggested, but by
  subtraction rather than by re-walking the field. `getPower -
  getPowerWithoutStatics` is the engine's own definition of the continuous
  contribution, so the amount is exact without the client reimplementing
  `forEachStatic`. Attribution is the weaker half: `{self: true}` statics name
  their own card, selector-based ones would need the engine's internal
  `resolveSelector` and are left unnamed. Every static in ST-01/ST-02 is
  self-targeting, which `packages/client/tests/continuousBadge.test.ts` pins so
  the fallback becomes visible the day one is not.

The original notes follow.

Phase 2C owns the UI for choices. Two findings belong to it rather than to
either backlog, because neither is a missing rule or a missing word: the engine
behaves correctly and simply does not *say* so. Both surfaced while writing real
cards, and both are recorded here so 2C does not have to rediscover them from a
bug report.

### 1. An ability that resolves to nothing emits no event

The engine emits `abilityTriggered` when an ability fires, and then each `op`
emits its own event only when it actually did something. `giveDon` emits
`donAttached` **only if `given > 0`**; `orientDon` emits
`donOrientationChanged` only for DON!! that actually turned, and its own type
comment says the event "is not emitted at all when nothing moved"; a stale
target records the `op.targetGone` *mark*, which is instrumentation and never
reaches the log.

So an ability that legitimately resolves to nothing produces exactly one log
entry — `abilityTriggered` — and then silence.

This is correct engine behaviour and a genuine UI problem. From the client, the
player sees something fire and nothing happen, **and cannot distinguish that
from a bug**. The states are real and reachable: activate `ST01-001` Luffy with
no rested DON!! in the cost area, or `ST02-008` Apoo against an opponent whose
cost area is already fully rested. Both are legal plays that correctly do
nothing.

Worth being precise about what is *not* wrong here. "Up to N" resolving to zero
is a rule, not a failure — the DSL's most common quantifier, on 15 of the 26
starter cards with text. The UI needs to render "this resolved to nothing" as an
outcome, not treat the absence of a follow-up event as an error. Whether that
needs a new event (an explicit "resolved with no effect") or is better derived
by the client from `abilityTriggered` with no subsequent effect event before the
next entry, is 2C's call — the engine currently supports only the second.

### 2. Continuous abilities emit no event at all

Stronger than the first, and structural rather than incidental. `static`
abilities are not fired: they are **read** through `forEachStatic` inside
`getPower` and `hasKeyword`, and nothing is ever written to the state when a
card with a static enters or leaves the field. That is deliberate and it is the
design's best property — there is nothing to clean up, recalculate, or keep in
sync. `selectors.ts` contains no `emit` call at all.

The consequence for the UI: **the log will never explain why a Character has
+1000.** There is no event to show, and there never will be under this design;
`static.powerApplied` and `static.keywordApplied` exist, but they are marks for
instrumentation, not events. This is not a gap to be closed — emitting on read
would mean emitting on every power query.

So 2C has to derive it from state rather than from the log: given a card, walk
the field for `static` abilities whose condition holds and whose `affects`
names it, and show *which continuous effects are currently live on this card*.
That is the same walk `forEachStatic` already does, and the display it feeds is
a hover or an inspector, not a log line.

PR #12 raised the stakes on this. Before it, a static could only buff *other*
cards, so a player could at least guess at the source. Now that
`affects: {self: true}` exists — `ST01-013` Zoro and `ST01-004` Sanji buff
themselves under a `[DON!! xN]` condition — a card's power changes with no
visible cause anywhere on the board, including on the card itself. The printed
number, the attached DON!!, and the effective power are three different values
and the UI shows one.

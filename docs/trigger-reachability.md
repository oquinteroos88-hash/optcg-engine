# Trigger reachability sweep

**All eleven triggers are now reachable by a real card.** The sweep found one
hole — `counterEvent` — and it has since been closed: the engine can activate a
[Counter] Event from hand (`PLAY_COUNTER_EVENT`, CR 7-1-3-2-2), so `ST01-014`
Guard Point's `[Counter]` half is a real, reachable play. The record below is
kept as the evidence, with the `counterEvent` row updated and the "one hole"
section rewritten to how it was closed.

The rest of this document is that evidence, plus three secondary findings the
sweep turned up on the way.

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

| Trigger | Fired by | Reachable | What proves it | Cards | Gap |
| --- | --- | --- | --- | --- | --- |
| `onPlay` | `applyPlayCard`, `reducer/main.ts:83` (character) and `:108` (stage) | **yes** | `ST02-009` Law, in an unstaged game (`game.test.ts`); ABIL table | 868 | — |
| `whenAttacking` | `applyDeclareAttack`, `reducer/battle.ts:96` | **yes** | `ST01-005` Jinbe, unstaged game | 250 | — |
| `onBlock` | `applyDeclareBlock`, `reducer/battle.ts:130` | **yes** | ABIL-022 only (`abilityTable.test.ts`) | 14 | no real-card coverage |
| `onKO` | `leaveField(cause: 'ko')`, `reducer/helpers.ts:127` | **yes** | ABIL-011 from battle and from a script `ko` | 157 | no real-card coverage |
| `whenOpponentAttacks` | `applyDeclareAttack`, `reducer/battle.ts:97` | **yes** | ABIL-014 only | 49 | no real-card coverage |
| `activateMain` | `ACTIVATE_ABILITY` → `reducer/activate.ts:38`, gated in `legalActions.ts:101` | **yes** | ABIL-009/010 only | 365 | no real-card coverage |
| `trigger` | `stepResume` damage step, `abilities/interpreter.ts:747` | **yes** | `ST01-014`, `ST01-015` from life, unstaged games | 501 | see coverage note |
| `counterEvent` | `applyPlayCounterEvent` (`PLAY_COUNTER_EVENT`), `reducer/battle.ts`, gated in `legalActions.ts` | **yes** | `ST01-014` Guard Point from hand (`counterEvent.test.ts`); ABIL-016 | 184 | **was missing rule — now closed** |
| `mainEvent` | `applyPlayCard`, `reducer/main.ts:124` | **yes** | `ST01-015` Jet Pistol, unstaged game | 272 | — |
| `endOfTurn` | `applyEndTurn`, `reducer/turn.ts:24` | **yes** | `ST02-013` Kid, unstaged game | 50 | — |
| `static` | not fired — read in `getPower` / `hasKeyword` via `forEachStatic`, `selectors.ts:45` | **yes** | ABIL-003/004/024 (`continuous.test.ts`) | — | see the read-path audit |

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
(`battle.ts:218-219`); Rush, Blocker, Double Attack and Banish are all asked of
`hasKeyword` in both `legalActions` and `battle.ts`. A granted keyword counts
exactly like a printed one everywhere it matters.

At the time of the sweep, an **ability's `condition`** was evaluated with the
without-statics reading in all three places one is checked (`triggers.ts`,
`legalActions.ts`, `activate.ts`), while an `if` *inside* a script read
`getPower` — the same `Condition` saw different power depending on where it
sat. The sweep could not tell whether that was deliberate, and left it
unclassified. `fix/conditions-read-current-power` answered it: accidental. The
recursion guard that static evaluation needs was applied wider than necessary;
for a non-static ability there is no re-entry, because `getPower` drops to the
without-statics reading one level down, inside `forEachStatic`. The three sites
now pass `getPower`, which is what the Comprehensive Rules describe: one power
value per card, made higher or lower than printed by effects (2-6-3),
activation conditions met against the state as it is (8-4-1-1), and the Damage
Step comparing "the power" of the same card (7-1-4-1).

What remains, now declared rather than accidental: a `static` whose **own**
condition asks about power still reads the without-statics value, because there
the guard is load-bearing. OP06-002 — "[DON!! x1] If this Character has 7000
power or more, this Character gains [Banish]" — is the printed card behind it:
its Banish never switches on when the 7000 threshold is only reached through
another card's continuous effect. The faithful fix is a layered effect system
that evaluates continuous effects in passes; known, and priced at far more than
one card justifies. Moved to backlog A.

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
or a behavior it does not reproduce. It opened with two items; the first is now
built.

| Missing rule | Cards behind it | Status |
| --- | --- | --- |
| Playing a Counter Event from hand during the Counter Step, paying its cost | 184 | **done** — `PLAY_COUNTER_EVENT` |
| Layered evaluation of continuous effects: a `static` whose own condition asks about power reads the without-statics value (the recursion guard), so OP06-002's [Banish] cannot switch on through another card's continuous buff | 1 | open |

**Backlog B — missing expressiveness.** The trigger is reachable and the move
exists, but the DSL cannot say what the card does. This is the inventory's
ranked table: self-targeting statics, rested-DON!! giving, DON!! orientation,
putting cards into play, `[Blocker]` prohibitions, `orderCards`, suspendable
costs, and the two this sweep adds — negation in `Condition` (77 cards) and a
fifth keyword for `[Unblockable]` (8 cards).

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

The methodological correction is worth more than the ordering: **for every card
from here on, ask both questions.** Can the DSL say it, and can a real card get
there. The second question is cheap — it is a read of one reducer — and it is
the one that was never asked.

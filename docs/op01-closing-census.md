# OP-01 closing census — every unwritten card, re-read against today's engine

A census, not a plan and not an implementation. No `Ability` is written here, no
op is designed, no engine file is touched. The question it answers is narrow and
was overdue: **which OP-01 cards are still unwritten, and what exactly is
stopping each one — checked today, not inherited from a row.**

It exists because the rows it replaces were written across nine PRs of closed
gaps, and this project has now watched them age in both directions five times: a
card left freed and unwritten (`OP01-120`, PR #31), a summary that overstated
(the "frees 6" of batch 5), a *touched* column right and a *freed* column three
PRs stale (batch 10), a phrase covering two mechanisms (PR #32) and then three
(PR #36). A number that has been wrong that often is not a number to close a set
on.

## Two corrections before anything else

**The brief that commissioned this census said "starters 34/34 and OP-01
~97/121, ~24 remaining". Both numbers are optimistic and the second is wrong by
eleven cards.** Counted card by card against `packages/cards/src/abilities.ts`
on the day of writing:

| | Count |
| --- | --- |
| OP-01 base cards | **121** |
| with a script | 66 |
| keyword-only, nothing to write | 2 |
| no printed text at all | 16 |
| **playable today** | **86** (the three above, plus `OP01-075` and `OP01-121` — see below) |
| **unwritten** | **35** |

The starters are **33 of 34**, not 34: `ST02-010` Basil Hawkins is a declared row
under PR #35's ruling and has not moved.

The gap between "~24" and 35 is not a miscount in the earlier docs — it is the
difference between *cards blocked by a ranked gap* and *cards not written*. The
ranked table only ever tracked the first. This census counts the second, which is
the number that decides when the set is done.

## Method

For each of the 35, three questions, asked against the engine as it stands after
PR #36 and not against the row that used to describe it:

1. Does the DSL **say** it — vocabulary, ops, conditions, costs, selectors?
2. Does a real card **reach** the trigger?
3. Does the effect, or its condition, **survive the moment it fires**?

Everything the campaign built counts as available: modifiable legality (#31),
put-into-play (#29), chosen payments (batch 5), `orderCards` (#32) and the
top-or-bottom partition (#36), the DON!! deck (#33), the five prose trigger
families (#34), `endOfOpponentNextTurn` and `selfOrientation` (#35).

Each card lands in exactly one of three classes: **FREED** (writable today with
no engine change), **BLOCKED** (with the exact wall named, and both if there are
two), **AMBIGUOUS** (the text does not settle what it means).

Counts here are hand-counted, card by card — 35 is small enough that a regex is
not worth its own error bars, and this document already knows regexes lie about
prose. Full-set figures are probes and therefore upper bounds; reminder text in
parentheses is stripped before probing, as the standing rule requires.

## The census

Row numbers are the ranked-gap table's in `op01-inventory.md`. A **†** marks a
wall with no row of its own — see [the findings](#three-walls-with-no-row).

| Card | Name | Class | Wall(s) | Note |
| --- | --- | --- | --- | --- |
| `OP01-002` | Trafalgar Law (L) | BLOCKED | row 16 | Everything else is there: `restDon 2`, `countCards ≥ 5`, `moveCard` to hand, `play`. Only "a **different color than** the returned Character" is unsayable — a predicate about a card in a variable. |
| `OP01-005` | Uta | BLOCKED | **row 5** | `select` from trash by colour and cost exists; "other than [Uta]" does not. `excludeSelf` is the wrong tool — it excludes the *source instance*, and the copies in the trash are different instances. |
| `OP01-008` | Cavendish | BLOCKED | row 11 | The Life card is a **cost** (it precedes the colon), and `Cost` has no member that pays with one. |
| `OP01-011` | Gordon | BLOCKED | row 15 | A cost that puts a hand card at the **bottom of the deck**. `discardHand` trashes; this moves. |
| `OP01-013` | Sanji | BLOCKED | row 11 | Same Life-card cost as `OP01-008`. The body — `addPower` then `giveDon` rested — is expressible. |
| `OP01-015` | Tony Tony.Chopper | BLOCKED | **row 5** | `[DON!! x1]`, `whenAttacking`, `discardHand` cost, trash-to-hand by type and cost: all built. "other than [Tony Tony.Chopper]" is not. |
| `OP01-016` | Nami | BLOCKED | **row 5** | The **whole script already exists** as `lookKeepBury`, the helper `OP01-030`, `OP01-041`, `OP01-084` and `ST02-007` share. This one differs by four words: "other than [Nami]". |
| `OP01-019` | Bartolomeo | BLOCKED | row 13 | A `static` granting itself +3000 under `[DON!! x2]`. `[Opponent's Turn]` is the only wall — `isYourTurn` cannot be inverted. |
| `OP01-024` | Monkey.D.Luffy | BLOCKED | row 20 **+ †** | Two walls, and the second has no row: even with an attribute filter, `LegalityClause`'s `koInBattle` member carries **no `target`**, so "cannot be K.O.'d in battle **by ＜Strike＞ Characters**" has nowhere to put the other card. |
| `OP01-038` | Kanjuro | BLOCKED | row 2 (open half) | First half fully expressible. "Your opponent **chooses** 1 card from **your** hand" — chooser and hand-owner are opposite players. |
| `OP01-040` | Kin'emon | BLOCKED | **row 5** | Both halves otherwise built. "If your Leader is [Kouzuki Oden]" is a `countCards` over the Leader once names can be filtered. |
| `OP01-042` | Komurasaki | BLOCKED | **row 5** | `restDon 3` cost, `select` by type and cost, `setActive`: all built. The Leader-name gate is not. |
| `OP01-044` | Shachi | BLOCKED | **row 5** | "If you **don't have** [Penguin]" needs no negation — `countCards` takes a `max`, so `max: 0` says it. Only the name does not exist. |
| `OP01-046` | Denjiro | BLOCKED | **row 5** | "set up to 2 of your DON!! cards as active" is `orientDon`, built in PR #13. The Leader-name gate is the whole wall. |
| `OP01-047` | Trafalgar Law | BLOCKED | row 15 | A cost that **returns a Character to hand**. The body (`play` from hand, cost ≤ 3) is built. |
| `OP01-049` | Bepo | BLOCKED | **row 5** | `play` by type and cost from hand is built. "other than [Bepo]" is not. |
| `OP01-050` | Penguin | BLOCKED | **row 5** | `OP01-044`'s mirror, same single wall. |
| `OP01-051` | Eustass"Captain"Kid | BLOCKED | row 13 **+ row 5** | **Down from three walls to two.** `selfOrientation` shipped in PR #35 and put-into-play in #29; what remains is `[Opponent's Turn]` and naming the exempt Character in the legality target. Its second ability is fully expressible on its own. |
| `OP01-055` | You Can Be My Samurai!! | BLOCKED | row 15 | "You may rest 2 of **your Characters**" — `restSelf` rests the source only. |
| `OP01-063` | Arlong | BLOCKED | row 14 **+ row 16** | `restSelf` and the Life-to-deck-bottom move are built. Revealing a card the player just chose needs `reveal` to take a `Ref`; "if the revealed card is an Event" needs a predicate over a variable. |
| `OP01-067` | Crocodile | BLOCKED | row 12 | `Modifier` has `power` and `grantKeyword`. Cost is not a thing an effect can change. |
| `OP01-069` | Caesar Clown | BLOCKED | **row 5** + row 17 | "[Smiley]" is a name; "from your **deck**" is the whole deck, and `Selector` reaches only `deckTop`. |
| `OP01-072` | Smiley | BLOCKED | row 10 | `grants.power` is a fixed `number`. "+1000 for every card in your hand" is a count. |
| `OP01-074` | Bartholomew Kuma | BLOCKED | **row 5** | `[Blocker]` is printed and applied; the `[On K.O.]` is `play` from hand with a cost cap. Only "[Pacifista]" is unsayable. |
| `OP01-075` | Pacifista | **AMBIGUOUS** | **†** | Its only non-keyword line is a **deck-construction** rule — "you may have any number of this card in your deck" — and `validateDecklist` enforces a flat `MAX_COPIES = 4` with no exception. Counted playable in game, and wrong in the deck builder. See the findings. |
| `OP01-083` | Mr.1(Daz.Bonez) | BLOCKED | row 10 | "+1000 for every 2 Events in your trash" — the same scaling grant, with a divisor. |
| `OP01-088` | Desert Spada | BLOCKED | row 2 (open half) | **Down from two walls to one.** PR #36 built the partition its `[Counter]` half wanted; the `[Trigger]`'s "trash 1 card from your hand" is the controller choosing, which `op: 'discard'` cannot do. |
| `OP01-090` | Baroque Works | BLOCKED | **row 5** | `SABAODY` again, blocked by "other than [Baroque Works]" and nothing else. |
| `OP01-091` | King (L) | BLOCKED | row 6 | A `static` over the opponent's Characters is built. DON!! are not in any `Selector` zone, so "if you have 10 DON!! cards on your field" cannot be asked. |
| `OP01-095` | Kyoshirou | BLOCKED | row 6 | `draw` behind a DON!!-count condition. |
| `OP01-098` | Kurozumi Orochi | BLOCKED | **row 5** + row 17 | A named card, searched out of the whole deck, then a shuffle. |
| `OP01-099` | Kurozumi Semimaru | BLOCKED | **row 5** | `grants.legality` with an `affects` selector is built (PR #31). "other than your [Kurozumi Semimaru]" is the wall — and `excludeSelf` is genuinely not enough here: with two copies out, each one's static must exempt **both**. |
| `OP01-102` | Jack | BLOCKED | row 2 (open half) | `returnDon` cost and `whenAttacking` are built. "Your opponent trashes 1 card from their hand" is the opponent choosing from their own hand. |
| `OP01-105` | Bao Huang | BLOCKED | row 14 | `select` from the opponent's hand is built. `reveal` takes a `Selector`, so it cannot reveal the cards just chosen. |
| `OP01-109` | Who's.Who | BLOCKED | row 6 | A `static` +1000 behind a DON!!-count condition. |
| `OP01-114` | X.Drake | BLOCKED | row 2 (open half) | `OP01-102`'s twin at a different cost. |
| `OP01-121` | Yamato | **AMBIGUOUS** | **†** | Printed `[Double Attack]`/`[Banish]` work. "Also treat this card's name as [Kouzuki Oden]" is a **name alias**, which is not the filter field row 5 describes — and which OP-01 cannot make observable. See the findings. |

## The counts

**FREED: zero.** Not one of them is writable today. That is the census's first
result and it is a good one: it says the campaign's claim that the queue is empty
is *true* — there is no `OP01-120` sitting freed-and-unnoticed this time.

**BLOCKED: 35. AMBIGUOUS: 2** (`OP01-075`, `OP01-121`). Thirty-seven rows, and
the two counts do not add to the same thing on purpose: the 35 blocked are the
cards missing from the playable total, while the 2 ambiguous **are** counted
playable — each is fully functional at the table and carries one printed line the
engine does not model. 84 + 2 playable, 35 blocked, 121 in the set.

Grouped by wall, freed-alone first — **and this grouping is the order of the
remaining PRs**, because each group is one capability and the group sizes are the
only ranking that has ever survived contact with the work:

| Wall | Freed **alone** | Also needed by | Set-wide (upper bound) |
| --- | --- | --- | --- |
| **Row 5 — reference a card by name** | **12** | `OP01-051`, `OP01-069`, `OP01-098` | 396 * |
| Row 2 (open half) — a player-chosen **discard instruction** | **4** | — | 111 * across its three forms |
| Row 6 — a condition on your **DON!! count** | **3** | — | 31 * |
| Row 15 — a cost paid with **other cards you choose** | **3** | — | 4 * |
| Row 11 — a cost paid with a **Life card** | **2** | — | 37 * |
| Row 10 — **scaling grants** | **2** | — | 10 * |
| Row 13 — **negation** in `Condition` | **1** | `OP01-051` | 77 |
| Row 12 — **cost modification** | **1** | — | 79 * |
| Row 14 — `reveal` taking a `Ref` | **1** | `OP01-063` | 2 |
| Row 16 — a predicate about a card in a **variable** | **1** | `OP01-063` | — |
| Row 17 — search the **whole deck** and shuffle | 0 | `OP01-069`, `OP01-098` | 8 |
| Row 20 — filter by **attribute** | 0 | `OP01-024` | 6 * |
| † `koInBattle` with a target predicate | 0 | `OP01-024` | — |
| † deck-construction exception | — | `OP01-075` | — |
| † name **alias** | — | `OP01-121` | 8 |

## Row 5 is four times what its row says, and that is the headline

The ranked table has carried **"Reference a card by name — touched 14, freed
alone 3"** since the original inventory. Re-counted today: **touched 16, freed
alone 12.**

The *touched* column aged well, as the counting rule predicts — it is a fact
about printed text and it moved by two, both of them cards the original count
simply missed (`OP01-051`'s legality target and `OP01-121`'s alias). The *freed*
column quadrupled, and every card that moved into it did so because some **other**
gap closed underneath it:

- `OP01-040`, `OP01-042`, `OP01-046` were waiting on put-into-play and `orientDon`
  as well. Both shipped.
- `OP01-044`, `OP01-050`, `OP01-049`, `OP01-074` were waiting on put-into-play.
- `OP01-016` and `OP01-090` were waiting on `orderCards`, built in PR #32.
- `OP01-099` was waiting on modifiable legality, built in PR #31.
- `OP01-005` and `OP01-015` were waiting on nothing but were never re-read.

This is the counting rule's second clause in its purest form: *a row's freed
column is a claim about every other gap, and every closed gap since it was
written can falsify it.* Nine gaps closed; the claim was falsified by nine.

### The forms, before anyone designs it

Six printed shapes, and **five of them are one field**:

| Form | OP-01 | Set | Shape |
| --- | --- | --- | --- |
| "…**other than** [X]" | 6 | 124 | a `name` exclusion on `CardPredicate` |
| "If your **Leader is** [X]" | 3 | 87 | `countCards` over `{zone:'field', category:['leader'], name:[X]}` |
| "play / add / reveal **[X]**" | 6 | 93 | a `name` filter on the same predicate |
| "If you **don't have** [X]" | 2 | 23 | the same filter with `countCards`' existing `max: 0` |
| legality target "other than the Character [X]" | 1 | 1 | the same field on `LegalityClause.attack.target` |
| "**Also treat this card's name as** [X]" | 1 | 8 | **not that field** — see below |

**On the starred figures.** They were **re-probed for this census**, and several
disagree with what the ranked table carries — always downward, because these
probes are narrower. Row
12 reads 79 here against the table's 127 (this one counts "−N cost" grants, not
every mention of the word), row 10 reads 10 against 23, row 6 reads 31 against
36, row 5 reads 396 against 399. Nothing is recounted in the table itself: these
numbers are only ever used to tell a family from a one-off, and both readings
agree on every such call. The direction of the disagreement is worth noting
though — the older probes were **wider**, so the table's upper bounds are looser
upper bounds, not wrong ones.

So the answer to "is a name another field of the `Selector`, or something else?"
is: **for five of the six forms, one optional `name?: string[]` on `CardFilter`
is the whole of it**, sitting beside `types` and reading exactly the same way.
The negation those cards seem to need is already there — `countCards` has taken a
`max` since Phase 2A, and `max: 0` is "you don't have one".

That is unusually cheap for twelve cards, and it is the strongest single
recommendation this census produces.

## Three walls with no row

The most valuable thing a census can find is a wall nobody has written down. It
found three.

### 1. `koInBattle` cannot name the other card

`LegalityClause` has three members:

```
| { question: 'activateBlocker' }
| { question: 'attack'; target?: CardPredicate }   ← has one
| { question: 'koInBattle' }                        ← has none
```

`OP01-024` prints "This Character cannot be K.O.'d in battle **by ＜Strike＞
attribute Characters**". The subject is the source; the restriction is qualified
by the *other* card in the battle — which is exactly the pair-shape `attack`
already models with its `target`. Row 20 says this card wants an attribute
filter, and it does, **and an attribute filter alone would not let it be
written.**

PR #31 argued the point in reverse and got it right for the card it had: the
unqualified "cannot be K.O.'d in battle" is a wider clause and `OP01-099` prints
it. Nobody noticed the qualified form needs a second field. Filed as a row.

### 2. A name **alias** is not a name filter

Eight cards in the set print "Also treat this card's name as [X]" — `OP01-121`
Yamato is OP-01's one. Row 5 describes a *filter*; this is a property of the card
that every name comparison must respect, and building the filter without it
produces a specific, silent wrongness: Yamato's only printed line stops meaning
anything, and no test fails.

**OP-01 cannot make it observable**, which is why `OP01-121` is AMBIGUOUS rather
than BLOCKED. Its three Leader-name gates (`OP01-040`, `-042`, `-046`) ask about
the *Leader*, and Yamato is a Character; nothing else in the set's first 121
cards names Kouzuki Oden. The alias becomes real in OP-02, where `OP02-042` is
the same Yamato with an ability. Filed as a row, and flagged as a thing to build
**with** row 5 rather than after it — the day the filter ships without it is the
day the wrongness starts.

### 3. The deck builder has no "any number" exception

`OP01-075` Pacifista prints "Under the rules of this game, you may have any
number of this card in your deck." `packages/cards/src/decklists.ts` enforces a
flat `MAX_COPIES = 4` with no exception, so a legal Pacifista deck is currently
rejected.

This is the only wall in the census that is **not in the DSL at all** — it lives
in the deck validator, it needs no `Ability`, and it is the smallest item on this
page. It is also the one that would make a real player's real decklist bounce,
which is a different kind of wrong from a card that cannot be written.

## Two rows that moved, and one form-split

**Row 2's open half is bigger than the row says, and it is three forms.** The
row reads "a payment whose card the player picks", cost half bought, instruction
half open. The instruction half is:

| Form | OP-01 | Set |
| --- | --- | --- |
| "**your opponent trashes** N cards from their hand" — chooser owns the hand | `OP01-102`, `OP01-114` | 21 |
| "**your opponent chooses** N cards from **your** hand" — chooser and owner are opposite | `OP01-038` | 2 |
| "**trash N cards from your hand**" as an instruction — the controller chooses | `OP01-088` | 88 |

`PendingChoice` already carries a `player`, so all three are one mechanism *if*
the instruction can name the chooser and the hand separately — which is a design
note rather than a finding, and is exactly what the README's `TODO:
player-chosen discard instruction` should say and does not.

**Row 15's set count is 4, not "—".** "A cost paid with other cards you choose"
covers three distinct payments in OP-01 — rest 2 Characters, return a Character,
put a hand card at the bottom of the deck — and each is printed on **one or two
cards in the entire game**. Row 11's Life-card cost, by contrast, is 37 cards.
If the two rows are ever merged into "a cost that moves a chosen set of cards",
the merged row is worth 39; kept apart, row 15 is a three-card curiosity and row
11 is a family.

## The closing recommendation

**Four PRs take OP-01 from 86 to 110 of 121.** The order is the group sizes and
nothing else:

| PR | Wall | Cards | Why here |
| --- | --- | --- | --- |
| 1 | **Name reference** (+ the alias, together) | **12** | Four times the next group. One field on `CardFilter`, and 396 cards in the set. Build the alias in the same PR or the filter ships subtly wrong. |
| 2 | **Player-chosen discard instruction** | **4** | Row 2's last open half; 111 cards across its three forms; closes the divergence the README has carried since Phase 2A. |
| 3 | **DON!! count condition** | **3** | One `Condition` member reading the cost area, which `costs.ts` already computes. |
| 4 | **Costs that move chosen cards** (rows 11 + 15) | **5** | 41 cards in the set if merged. The Life-card half alone is 37; row 15's three payments are one or two cards each. |

After those four, **11 cards remain**, and the honest answer for most of them is
the Hawkins standard: *a mechanism with one card asking and no second asker is a
declared row, not a build.*

| Remaining | Cards | Verdict |
| --- | --- | --- |
| Negation in `Condition` | `OP01-019`, and `OP01-051` with row 5 | **Build.** 77 cards in the set, and it finishes `OP01-051`. |
| Scaling grants | `OP01-072`, `OP01-083` | **Build.** Two cards here, 10 in the set, one `grants` shape. |
| Cost modification | `OP01-067` | **Declare for now.** One card here; 79 in the set says it arrives eventually, not next. |
| Whole-deck search + shuffle | `OP01-069`, `OP01-098` (both also row 5) | **Borderline.** 8 in the set; two cards that would otherwise be finished by PR 1. |
| `reveal` taking a `Ref` | `OP01-105`, `OP01-063` | **Declare.** **2 cards in the entire game.** Textbook Hawkins. |
| Predicate about a variable | `OP01-002`, `OP01-063` | **Declare.** No second asker found. |
| Attribute filter **+** `koInBattle` target | `OP01-024` | **Declare.** Two capabilities for one card — the exact shape PR #35 declined for Hawkins. |
| Deck-construction exception | `OP01-075` | **Build, cheaply.** Not the DSL; a decklist validator that currently rejects a legal deck. |

Written as arithmetic, so the stopping point is a choice and not a feeling:

| After | OP-01 | Still blocked |
| --- | --- | --- |
| today | 86 | 35 |
| PRs 1–4 | **110** | 11 — `OP01-002`, `-019`, `-024`, `-051`, `-063`, `-067`, `-069`, `-072`, `-083`, `-098`, `-105` |
| + negation (PR 5) | **112** | 9 — it finishes `OP01-019` and, with PR 1's name field, `OP01-051` |
| + scaling grants (PR 6) | **114** | 7 |
| + whole-deck search (PR 7, optional) | **116** | **5** |

The deck-validator fix for `OP01-075` moves no count — the card is already
counted playable — and should ride along with whichever PR is convenient. It is
the only item here that makes a real decklist bounce today.

**Stopping at PR 6 leaves seven declared-not-built; going to PR 7 leaves five**:
`OP01-024` (two capabilities, one card), `OP01-063` and `OP01-105` (`reveal`
taking a `Ref` — **2 cards in the entire game**), `OP01-002` (a predicate over a
variable, no second asker), `OP01-067` (cost modification, one card here against
79 in the set — the one row whose set count argues for building it later).

That is the same shape the starters closed in at 33 of 34: a small set of rows
with names, sizes and stated reasons, rather than a queue.

The seventh PR is the one call this census does not make for you. Whole-deck
search frees nothing on its own, it finishes two cards PR 1 would otherwise leave
one wall short, and 8 cards in the set is neither a family nor a one-off.

## What the old rows no longer said well

Five things, in the order they matter:

1. **Row 5's freed column was 3 and is 12.** Nine closed gaps falsified it, one
   card at a time, and nothing re-read it until now.
2. **`OP01-024` has two walls, not one**, and the second has never been written
   down.
3. **`OP01-121`'s name alias is not row 5's filter**, and OP-01 is structurally
   unable to show the difference — so it would have shipped wrong and silent.
4. **`OP01-075` is rejected by our own deck validator**, which no card row could
   have caught because it is not a card-text gap at all.
5. **`OP01-088` and `OP01-051` each lost a wall** to PRs #36 and #35 without any
   row noticing — the same drift that left `OP01-120` unwritten after #31, caught
   this time before it cost anything.

None of the three DON!! forms deslindadas by PR #33 — active DON!! as a cost, the
opponent's DON!!, the opponent's DON!! deck — appears on any OP-01 card, so that
row stays declared and stays out of this set's arithmetic. And nothing among the
35 makes the Phase 2A `TODO` on **chosen order for simultaneous triggers**
observable: none of them fires two abilities whose order changes an outcome, so
that TODO's status is unchanged by this census.

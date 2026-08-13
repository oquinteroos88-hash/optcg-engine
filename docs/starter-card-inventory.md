# Starter card inventory — the DSL against 34 real cards

An inventory, not an implementation. No `Ability` is written here, no engine or
data file is touched. The question it answers: **how much of the real card text
can the Phase 2A DSL already say?**

The project bet was "if the DSL holds these ~40, it holds 400". This measures
that before the effort is spent.

## Status, as of PR #15

The inventory was written against a DSL that could express 15 of the 34 cards.
Six gaps have been closed since, each by its own PR, and the count is now
**25 of 34 playable, 9 still blocked**. The card-by-card table and the gap
table below both carry the PR that closed each row, because in six months the
question will be *when and why* a gap was resolved, not merely whether it was.

| Gap | Closed by | Cards it unlocked |
| --- | --- | --- |
| Conditions read the *current* power, not the without-statics value | **PR #9** | none directly — a correctness fix; `getBasePower` became `getPowerWithoutStatics` |
| `counterEvent` reachable — `PLAY_COUNTER_EVENT` | **PR #10** | `ST01-014` (with #12/#13 for the others' halves) |
| `giveDon` takes **only** rested DON!! | **PR #11** | `ST01-001`, `ST01-007`, `ST01-011` |
| A `static` may name its own source — `affects: {self: true}` | **PR #12** | `ST01-013`, `ST01-004`, `ST02-003` |
| `orientDon` — change DON!! orientation by quantity | **PR #13** | `ST02-008`, `ST02-015`, `ST02-016` |
| `restSelf` — rest the source as the price of its own ability | **PR #15** | `ST01-017` (`ST02-007` still needs `orderCards`) |

PR #11 also uncovered **three DON!! mechanics the DSL does not model** that this
inventory never saw, because it only ever looked at 34 cards. They are sized in
[Gaps the 34 cards could not show](#gaps-the-34-cards-could-not-show).

## Scope and method

Every base card (no `_` suffix) of packs `569001` (ST-01) and `569002` (ST-02),
both Leaders included: **34 cards**. Text taken from `effectText` and
`triggerText` in `packages/cards`.

Each card is read against the DSL as it stands in
`packages/engine/src/abilities/` — `dsl.ts` for the vocabulary, `query.ts` for
what a `Selector` and a `Condition` can actually filter on, `interpreter.ts` for
what each op does, `costs.ts` for what a `Cost` can be, and `triggers.ts` for
when things fire — plus `packages/engine/src/selectors.ts` for how `static`
abilities are evaluated. (`selectors.ts` sits beside the abilities folder, not
inside it; the original text of this sentence put it in the wrong place.)

Where a number is quoted for "the whole set", it comes from a text probe over
all 2665 cards in `packages/cards/data/cards.en.json`. Those numbers are
regex counts, not classifications: they size a gap, they do not prove one.

> **The probes overcount.** Added after `docs/trigger-reachability.md` measured
> the same way and found the flaw: a probe counts cards that **mention** a
> mechanic, not cards that **have** it. Two Leaders match "[On Play]" while
> saying "Your [On Play] effects are negated"; five Leaders match "[Trigger]"
> while referring to *other* cards' triggers. Every "full set" figure below is
> therefore an upper bound.
>
> Nothing here is recounted, because the figures are only used to tell a family
> from a one-off and an upper bound still does that. The rule going forward is
> narrow: **when a decision turns on a close comparison between two gaps, count
> those two by hand first.** The error only ever inflates, so a gap that looks
> small really is small.

> **Data note.** A card with no printed effect carries `effectText: "-"`, not
> `null` — 317 cards across the full set. Only `triggerText` uses `null` for
> absence. Anything that filters for "has an effect" has to handle both.

## The piles

The piles are the classification as first made, against the DSL as it stood.
They are not re-cut here — the right-hand column tracks what has since been
built against them.

| Pile | Meaning | Cards | Playable today |
| --- | --- | --- | --- |
| **vanilla** | No effect text and no trigger text. No `Ability` at all. | 8 | 8 |
| **A** | The DSL expresses it as it stands. | 7 | 7 |
| **B** | Needs something bounded: one capability the DSL does not have. | 13 | 10 |
| **C** | Hits a structural hole. | 5 | 0 |
| **D** | Honestly ambiguous — the text does not settle what it means. | 1 | 0 |

Two of the seven in pile A (`ST01-006`, `ST02-004`) need **no `Ability` at
all**: their entire text is the `[Blocker]` reminder, and printed keywords are
already a rule in the engine, carried on `CardDefinition.keywords`. So 10 of 34
cards need nothing written, 5 more were expressible as they stood, and 19 of 34
needed something the DSL could not say.

That was the headline when this was written. **Ten of those 19 have since been
written** — the three-way tie of bounded gaps (PRs #11, #12, #13) and the
rest-the-source cost (PR #15).

**Where the 34 stand today.** Counted from `packages/cards/src/abilities.ts`,
which holds 15 scripted cards, not estimated:

- **25 playable** — 8 vanilla, 2 keyword-only (`ST01-006`, `ST02-004`), and 15
  with every printed ability written.
- **9 still blocked**, and the shape of what is left has changed. Everything
  cheap is done; what remains is the structural holes and the two gaps that
  unlock one card each.

| Card | Pile | What still blocks it |
| --- | --- | --- |
| `ST02-005` Killer | B | `[On Play]` fits; the `[Trigger]` needs put-into-play (gap 4) |
| `ST02-014` X.Drake | B | a condition about the source's own orientation (gap 9) |
| `ST02-017` Straw Sword | B | `[Main]` fits; the `[Trigger]` needs put-into-play (gap 4) |
| `ST01-002` Usopp | C | `[Blocker]` prohibition + put-into-play |
| `ST01-012` Monkey.D.Luffy | C | `[Blocker]` prohibition |
| `ST01-016` Diable Jambe | C | `[Blocker]` prohibition + filter by printed keyword |
| `ST02-001` Eustass"Captain"Kid (Leader) | C | a cost that requires a decision |
| `ST02-007` Jewelry Bonney | ~~C~~ ✅ | **written — PR #32.** The last card either inventory carried as honestly missing: three walls, `restSelf` in PR #15 and the other two here |
| `ST02-010` Basil Hawkins | D | needs a ruling before it needs a trigger |

Two of the three remaining pile-B cards are **half-written cards, not unwritten
ones**: `ST02-005` and `ST02-017` each have a half the DSL expresses today and a
`[Trigger]` half behind gap 4. Neither is scripted, because a card whose printed
text is half-implemented is worse than one that is honestly absent.

`ST02-007` Bonney is the one card that lost a blocker without being unblocked.
It needed three things and now needs two, which is worth stating plainly: a gap
closing is not the same as a card shipping, and a table that only counts cards
would have recorded no movement at all here.

The ST-02 Leader is still in pile C, which is the sharpest thing left on this
list: `ST02-001`'s ability is the deck's whole identity and it has never fired.

## Card by card

Vanilla cards are listed for completeness and excluded from the analysis.

`Pile` is the original classification and is **not** re-cut. **✅ written**
marks a card whose printed abilities are scripted in
`packages/cards/src/abilities.ts` today, with the PR that made it possible.

| Card | Name | Cat | Pile | Trigger(s) | Note |
| --- | --- | --- | --- | --- | --- |
| ST01-001 | Monkey.D.Luffy | leader | **B** | `activateMain` + `oncePerTurn` | Select 1 own leader/character, give it DON!!. Everything fitted except that the DON!! given must be a **rested** one; the op preferred rested and silently fell back to active. **✅ written — PR #11** made `giveDon` rested-only. |
| ST01-002 | Usopp | char | **C** | `whenAttacking`, `trigger` | Effect is a prohibition ("opponent cannot activate a [Blocker] with 5000+ power"). Trigger needs to **put this card into play** from hand. Two gaps, one structural. |
| ST01-003 | Karoo | char | vanilla | — | |
| ST01-004 | Sanji | char | **B** | `static` | `[DON!! x2]` → gains Rush. Condition and grant both existed; there was no way for a continuous ability to say it **applies to its own source only**. **✅ written — PR #12** added `affects: {self: true}`. |
| ST01-005 | Jinbe | char | **A** | `whenAttacking` | cond `donAttached 1` → select 0–1 from own field, leader+character, `excludeSelf` → `addPower +1000 endOfTurn`. Fits exactly. **✅ written** (pile-A pass). |
| ST01-006 | Tony Tony.Chopper | char | **A** | — | Text is only the `[Blocker]` reminder. No `Ability` needed. |
| ST01-007 | Nami | char | **B** | `activateMain` + `oncePerTurn` | Same shape and same single gap as ST01-001: the DON!! has to be a rested one. **✅ written — PR #11**; shares one script with ST01-001, whose text it repeats word for word. |
| ST01-008 | Nico Robin | char | vanilla | — | |
| ST01-009 | Nefeltari Vivi | char | vanilla | — | |
| ST01-010 | Franky | char | vanilla | — | |
| ST01-011 | Brook | char | **B** | `onPlay` | "Up to 2" is expressible as two opt-in steps. The gap was again the **rested** DON!! constraint. **✅ written — PR #11**. |
| ST01-012 | Monkey.D.Luffy | char | **C** | `static` (printed Rush) + `whenAttacking` | Rush is a printed keyword, already handled. The ability is a prohibition: "opponent cannot activate [Blocker] during this battle". |
| ST01-013 | Roronoa Zoro | char | **B** | `static` | `[DON!! x1]` → +1000 to itself. Same gap as ST01-004: a continuous ability could not name its own source. **✅ written — PR #12**. |
| ST01-014 | Guard Point | event | **A** | `counterEvent`, `trigger` | Select 0–1 own leader/character → `addPower`, `endOfBattle` for the Counter, `endOfTurn` for the Trigger. **✅ written**; the `[Counter]` half became reachable once `PLAY_COUNTER_EVENT` shipped in **PR #10** — see the correction below. |
| ST01-015 | Gum-Gum Jet Pistol | event | **A** | `mainEvent`, `trigger` | Select 0–1 opponent character with `powerMax: 6000` → `ko`. The Trigger says "activate this card's [Main] effect", which is the same instruction list written twice — a data choice, not a DSL gap. **✅ written** (pile-A pass); the two abilities share one list rather than repeating it. |
| ST01-016 | Diable Jambe | event | **C** | `mainEvent`, `trigger` | Main is a prohibition, and the hardest kind: it attaches to a **chosen card** and lasts the turn, conditioned on that card attacking. The Trigger separately needs to filter a selector **by printed keyword** ("[Blocker] Characters"). |
| ST01-017 | Thousand Sunny | stage | **B** | `activateMain` | Body fits (select 0–1 own {Straw Hat Crew} → `addPower endOfTurn`). The cost is "rest this Stage", and resting the source was not one of the four costs. **✅ written — PR #15** added `restSelf`, a fifth `Cost` member. The card prints no `[Once Per Turn]` and needs none: a rested Stage cannot pay, and it returns to active only at its controller's Refresh Phase. |
| ST02-001 | Eustass"Captain"Kid | leader | **C** | `activateMain` + `oncePerTurn` | Cost is `restDon 3` **plus a hand card the player picks**. `discardHand` exists but takes the front of the hand; the interpreter cannot suspend during payment. Structural hole #1, on a Leader. |
| ST02-002 | Vito | char | vanilla | — | |
| ST02-003 | Urouge | char | **B** | `static` | Condition is expressible (`donAttached 1` and `countCards ≥ 3`). Same self-reference gap as ST01-004 and ST01-013. **✅ written — PR #12**. |
| ST02-004 | Capone"Gang"Bege | char | **A** | — | `[Blocker]` reminder only. No `Ability` needed. |
| ST02-005 | Killer | char | **B** | `onPlay`, `trigger` | The `[On Play]` fits exactly (`orientation: 'rested'`, `costMax: 3` → `ko`). The Trigger needs to **put this card into play**. |
| ST02-006 | Koby | char | vanilla | — | |
| ST02-007 | Jewelry Bonney | char | **C** | `activateMain` | Look at 5, take 1 by type, **"place the rest at the bottom in any order"** — the deleted `orderCards` — plus a way to name "the cards I did *not* take". Its third blocker, the rest-the-source cost, is gone since **PR #15**; the other two are not, so the card is still unwritten. |
| ST02-008 | Scratchmen Apoo | char | **B** | `whenAttacking` | "Rest up to 1 of your opponent's DON!! cards." DON!! are not cards a selector can reach and no op changed their orientation. **✅ written — PR #13** added `orientDon`, which works by quantity; DON!! still are not selectable entities, and did not need to be. |
| ST02-009 | Trafalgar Law | char | **A** | `onPlay` | Select 0–1 own rested character, `types: ['Supernovas','Heart Pirates']`, `costMax: 5` → `setActive`. Fits exactly. **✅ written** (pile-A pass). |
| ST02-010 | Basil Hawkins | char | **D** | ? | "If this Character battles your opponent's Character, set this card as active." See the ambiguity note below. |
| ST02-011 | Heat | char | vanilla | — | |
| ST02-012 | Bepo | char | vanilla | — | |
| ST02-013 | Eustass"Captain"Kid | char | **A** | `static` (printed Blocker) + `endOfTurn` | Blocker is printed. `endOfTurn` fires for both players' field cards, so "End of **Your** Turn" is `isYourTurn` — which exists. `setActive` on `{self: true}`. Fits. **✅ written** (pile-A pass). |
| ST02-014 | X.Drake | char | **B** | `static` | Grant and audience both expressible. The condition "if this Character is rested" is not: a condition cannot ask about the **source's own orientation**. |
| ST02-015 | Scalpel | event | **B** | `counterEvent`, `trigger` | The power half fits. Both halves then "set up to N of your DON!! cards as active" — same DON!! gap as ST02-008. **✅ written** — it took two PRs: **#10** made the `counterEvent` trigger reachable (`PLAY_COUNTER_EVENT`), **#13** supplied `orientDon`. See the correction below. |
| ST02-016 | Repel | event | **B** | `counterEvent` | As ST02-015: power fits, the DON!! half did not. **✅ written — PRs #10 and #13**; the same card as ST02-015 with a different number, so both share one script shape. |
| ST02-017 | Straw Sword | event | **B** | `mainEvent`, `trigger` | Main fits (`rest` an opponent character). The Trigger needs to **put a card into play from hand**, filtered by type and cost. |

## Correction — `counterEvent` was unreachable (found while writing pile A; since resolved)

Added after the seven pile-A cards were actually written. One of the seven did
not survive contact. **Resolved in PR #10:** the engine now has the move
(`PLAY_COUNTER_EVENT`), so `ST01-014` Guard Point's `[Counter]` half is written
and reachable. The rest of this section is the diagnosis as it was found.

**`ST01-014` Guard Point's `[Counter]` half was not pile A when written.** The
script was expressible — that part of the reading was right — but no real card
could reach the `counterEvent` trigger at all. `legalActions` offered
PLAY_COUNTER only for a card with a printed Counter value, and `applyPlayCounter`
threw without one. Every `[Counter]` ability in the game is on an Event, and
**all 184 of them are printed with no Counter value**. Playing a Counter Event
from hand for its cost was a move the engine did not have — until
`PLAY_COUNTER_EVENT` added it (CR 7-1-3-2-2), at which point the `[Counter]` half
became pile A after all.

The `[Trigger]` half was unaffected throughout, and is written and tested.

What the inventory got wrong is a method error worth naming: it read every card
against the DSL's *vocabulary* and never asked whether the engine has an
**action that reaches the trigger**. The two questions are independent, and only
the first was asked. `ST02-015` Scalpel and `ST02-016` Repel (pile B) were behind
the same wall. With the wall gone, their `counterEvent` trigger became reachable
too, and their DON!! halves — gap 3 below, a genuine DSL gap and not the
reachability one — were closed by PR #13. Both cards are written.

`docs/trigger-reachability.md` later asked the reachability question of all
eleven triggers. `counterEvent` was the only one that answered no, and it has
since been built, so no card in this table is behind a reachability wall now.

### It belongs to a different backlog than everything below

The table that follows lists what the **DSL cannot say**. `counterEvent` is not
on it and never could be: the trigger is unreachable because the *engine* has no
move that gets there, not because the DSL is short a word. Those are two
separate queues, and the sweep document sets them out — **missing rules** versus
**missing expressiveness**.

The distinction matters for ranking. A gap below limits which cards can be
written; every card already written still plays correctly. A missing rule does
not limit what can be written at all — the cards sit in the deck and the games
simply stop resembling the game. `counterEvent` was the only item on that list,
and because it outranked anything on this one, it was built first.

## Gaps, ranked by how many cards need them

This is the central metric. A capability that serves one card is a sign the DSL
is cut wrong; one that serves a family is earned. The right-hand column sizes
the same gap against all 2665 cards, so a starter-set count of 1 can still be
recognised as a family — or confirmed as a genuine one-off.

The `Status` column is the only thing added to this table; no count in it has
been recomputed.

| # | What the cards need | Cards here | Text probe, full set | Status |
| --- | --- | --- | --- | --- |
| 1 | **Give DON!! that is specifically rested** — and not quietly hand over an active one when no rested DON!! exists | 3 — ST01-001, ST01-007, ST01-011 | 105 | **closed — PR #11** |
| 2 | **A continuous ability that applies to its own source** ("this Character gains +1000") | 3 — ST01-004, ST01-013, ST02-003 | 268 (35 of them under a `[DON!! xN]`) | **closed — PR #12** |
| 3 | **Change the orientation of DON!! cards**, own or opponent's, by quantity | 3 — ST02-008, ST02-015, ST02-016 | 71 | **closed — PR #13** |
| 4 | **Put a card into play** from hand or from a life card | 3 — ST01-002, ST02-005, ST02-017 | 375 | open |
| 5 | ~~**Stop the opponent from using [Blocker]** — a restriction, not a grant~~ | 3 — ST01-002, ST01-012, ST01-016 | 146 | **closed — PR #31**, and it was never "a restriction, not a grant": see the correction below |
| 6 | **Rest the source as the price of an ability** | 2 — ST01-017, ST02-007 | 90 | **closed — PR #15** |
| 7 | ~~**Order cards you are putting back** ("the rest to the bottom in any order")~~ | 1 — ST02-007 | 254 | **closed — PR #32**, together with naming "the rest" |
| 8 | **Let the player choose which card a cost discards** | 1 — ST02-001 | 197 | open |
| 9 | **A condition about the source's own orientation** ("if this Character is rested") | 1 — ST02-014 | 7 | open |
| 10 | ~~**Filter a selection by printed keyword** ("[Blocker] Characters")~~ | 1 — ST01-016 | 6 | **closed — PR #31**, as one field on the shared card predicate; asked of `hasKeyword`, so a *granted* [Blocker] counts |
| 11 | **Fire on "this card is in a battle", and ask what it is battling** | 1 — ST02-010 | 1 | open |

Read the two columns together, because they disagree in useful ways.

Gaps **7** and **8** look like one-card curiosities in a starter deck and are
nothing of the kind: 254 and 197 cards in the full set. They are families that
the starter decks happen to sample once each.

Gaps **9**, **10** and **11** are the opposite. Seven cards, six cards, and —
for "if this Character battles" — **one card in the entire game**, which is the
one in front of us. Building a general mechanism for gap 11 off this single
card is exactly how a DSL grows an operator nobody uses twice.

Gap **4** is the largest family in the whole table and only shows up here in
`[Trigger]` text, which is the one place a starter deck reliably samples it.

## Gaps the 34 cards could not show

Added after PR #11. Fixing `giveDon` meant reading how the full set actually
talks about DON!!, and that turned up **three mechanics the DSL does not model
at all**. None appears in the table above, and the reason is not an oversight:
none of them is printed on any of the 34 cards. A two-deck sample sizes the gaps
it contains and is silent about the ones it does not — which is a limit of the
method, not a fault in the reading.

These are sized the same way as the table above, and carry the same warning:
**the probes overcount**, so every figure is an upper bound.

| Mechanic | Probe | Full set | Cards named |
| --- | --- | --- | --- |
| **Give DON!! that is specifically *active*, as a cost** | `give (up to )?N (of your )?active DON!! card` | **5** | `EB04-009`, `OP12-016`, `OP12-017`, `OP12-019`, `OP13-007` |
| **Add DON!! from the DON!! deck** | `from your DON!! deck` | **140** | `OP09-022`, `OP16-073`, `OP16-075`, … |
| **Move the opponent's DON!!** | `from your opponent's cost area` | **2** | `OP15-025`, `OP15-028` |

Two of the three counts are stronger than a probe, because they were small
enough to check by hand:

- **Active DON!! as a cost — 5, hand-verified.** The probe for the loose string
  `active DON!! card` matches 13; all 13 were read. Eight are a different
  mechanic (a *condition* on how many active DON!! you have, resting them, or
  returning them to the DON!! deck). Five actually give active DON!! away, and
  the fifth — `OP13-007` — the initial list missed, because it says "give 1 of
  your active DON!! cards" rather than "give 1 active DON!! card".
- **Opponent's cost area — 2, hand-verified.** Both were read; both really have
  it. This is a genuine one-off pair, on the same wording, in the same set.
- **DON!! deck — 140, probe only.** Not hand-checked, but the risk of
  overcounting is unusually low here: the narrow probe (`add … DON!! card … from
  your DON!! deck`) and the loose one (`from your DON!! deck`) return the *same
  140 cards*, and the 146 cards that return DON!! **to** the deck do not
  contaminate it — 29 cards do both, and they genuinely do both.

### Why each one is a gap, and what shape it has

**1. Give active DON!! as a cost — 5 cards.** Two separate problems, and the
first is a direct consequence of PR #11.

`giveDon` now takes rested DON!! *only*, because that is what the three starter
cards say and the printed game agrees. These five cards say the exact opposite:
"You may give 1 **active** DON!! card to 1 of your [Silvers Rayleigh]". The op
has no orientation parameter, so the rule PR #11 made correct for ST-01 is now
the rule that makes these five unsayable. That is not a regression — the engine
was wrong for both families before and is right for one now — but it does mean
the fix and the gap are the same seam, and whoever opens it should open it once.

The second problem is that this is a **cost**, not an effect: the clause ends in
a colon. `Cost` has five members since PR #15, none of them "give DON!!". So the
mechanic needs the op to take an orientation *and* the cost union to grow a
member that calls it — which PR #15 showed is a small change, so the op is the
expensive half. It also targets a card by name (`[Silvers Rayleigh]`), which is
`Selector` work rather than a new gap.

**2. Add DON!! from the DON!! deck — 140 cards.** The largest of the three by
two orders of magnitude, and it would rank second in the main table if it were
in it. The DON!! deck is a zone the engine only ever draws from in one place:
the DON!! Phase, at a fixed rate. There is no op for it, `ZoneRef` has no member
for it, and the cards want a granular version — "add up to 1 DON!! card from
your DON!! deck **and set it as active**, and add up to 1 additional DON!! card
**and rest it**" (`OP16-073`) — so the op needs a count and an orientation,
which is `orientDon`'s signature. Worth noting that PR #13 already built the
half of this that turns DON!! over; what is missing is the half that produces
them.

**3. Move the opponent's DON!! — 2 cards.** "Give up to 2 DON!! cards from your
opponent's cost area to 1 of your opponent's Characters" (`OP15-025`). `giveDon`
is doubly closed against this: it walks `draft.players[item.controller].don`, so
it cannot see the opponent's cost area, and it returns early unless
`card.controller === item.controller`, so it cannot attach to an opponent's
Character. Both guards are deliberate — they are what the DON!! conservation
invariant checks — which makes this the one of the three that cannot be done by
widening a parameter.

**Two cards is the whole family**, and by this document's own standard that is
the argument for *not* building it: gap 11 is one card and the note there says
building a general mechanism off it "is exactly how a DSL grows an operator
nobody uses twice". Two cards, printed in one set, on one wording, is the same
warning with one more card. Recorded so the next reader does not have to
rediscover it; not recommended.

## The structural holes

Three were known going in. All three are present in these 34 cards, which is
itself a result: a two-deck sample hits every one of them.

### 1. A cost that requires a decision — **present, on a Leader**

`ST02-001`, the ST-02 Leader: rest 3 DON!! **and trash 1 card from your hand**,
the player's pick. `Cost` already has `discardHand`, but payment
(`payCosts` in `interpreter.ts`) is synchronous and takes `hand[0]`; the code
says as much in a `TODO phase 2B`. Costs are paid in one step between
`status: 'ready'` and `status: 'running'`, and nothing in that step can open a
`PendingChoice`.

Which card leaves your hand is not a detail. This blocks the ST-02 Leader
outright — the deck's whole identity ability.

### 2. Player-chosen order among simultaneous triggers — **not observable here**

`orderedFieldSources` fixes the order (turn player first, then board position)
with a `TODO phase 2B` for letting the turn player choose.

In these 34 cards the order is never observable. The only trigger that can fire
from two sources at once is `ST02-013`'s `[End of Your Turn]`, and two copies of
Kid each set *themselves* active — no interaction, no observable order. A life
card's `[Trigger]` fires one card at a time by construction, and
`whenAttacking` fires only on the attacker.

**This one can wait.** Nothing in either starter deck can tell the difference.

### 3. `orderCards` — **present, exactly once**

`ST02-007` Bonney: "place the rest at the bottom of your deck in any order".
The `orderCards` choice kind still exists in `PendingChoice` and is validated in
`reducer/choice.ts`, but no instruction produces one — it was deleted from
`Instruction`.

Bonney needs a second thing in the same breath: a way to name **"the rest"** —
the cards looked at but not taken. A re-resolved `deckTop` selector cannot do
it, because how many cards remain depends on how many the player took, and the
DSL has no arithmetic.

### 4. The DSL can only add, never forbid — **new** *(built, PR #31 — and the framing was wrong)*

This is the finding of the inventory, and OP-01 later corrected its own statement
of it. `OP01-021` Franky prints "[DON!! x1] This Character can also attack your
opponent's active Characters" — a **permission**, not a prohibition, and one the
DSL could not say either. The hole was never directionality. It was that
`Modifier` could say two things about a card, and everything that changes what a
player may *do* fell outside it in either direction.

What was built is one piece rather than two kept in a mirror: a timed rule in the
state carrying a serializable predicate, a continuous face read off
`Ability.grants` the way `power` and `keyword` already are, and three aggregators
— the block, the attack, the K.O. All three starter cards below are written,
`ST01-002` whole. The reframing is set out in `docs/op01-inventory.md`; the
mechanism is in `packages/engine/README.md`.

Every instruction the DSL has is additive or destructive: add power, grant a
keyword, move, KO, rest, draw, give DON!!. `Modifier` is a closed union of
exactly two things, `power` and `grantKeyword`, both grants. There is no way to
express a **restriction on what the opponent is allowed to do**:

- `ST01-002` — opponent cannot activate a `[Blocker]` with 5000 or more power,
  this battle.
- `ST01-012` — opponent cannot activate `[Blocker]` at all, this battle.
- `ST01-016` — opponent cannot activate `[Blocker]` if the card you chose
  attacks, at any point this turn.

146 cards in the full set contain "cannot".

This is structural rather than a missing op because of **where the answer has to
be visible**. Blocking legality is computed in `legalActions` from
`hasKeyword`; a restriction has to reach that computation, not just the
interpreter. And the three cards above are not one restriction but three
shapes of one: unconditional, predicated on the blocker's power, and scoped to
a specific attacker for a whole turn. The last one has to survive the attack
being declared later, which means it has to live in the state.

Two of these three cards are in ST-01. A player opening that deck meets the
hole twice.

### Runner-up: putting a card into play (gap 4)

Not filed as structural, but it grazes hole #1 and is worth flagging before
anyone estimates it as "one more op".

"Play this card" has to reuse the play routine, not just move a card to a zone:
the played card's own `[On Play]` has to fire, and **if the field is already
full at five characters, the player has to choose one to trash**. That decision
happens inside a single step, and the interpreter can only suspend at a
`select` or `confirm` instruction boundary. Same wall as the cost decision,
different room. `ZoneRef` has no `field` member, which is the visible tip of it.

## The seven questions, answered

**1. Does any of these cards have a cost with a player decision?**
Yes — one, and it is a Leader. `ST02-001` Eustass"Captain"Kid: "You may trash
1 card from your hand". Suspendable costs cannot wait if ST-02 is to be
playable; they can wait if the first pass is ST-01 only. Nothing else in either
deck needs one.

**2. Does any need `orderCards`?**
Yes — one: `ST02-007` Jewelry Bonney, "look at 5, take up to 1, place the rest
at the bottom in any order". It is also the only card in either deck that looks
at the top of the deck at all. 254 cards in the full set use the pattern.

**3. Does any produce two simultaneous triggers whose order is observable?**
No. The only doubled trigger is `ST02-013`'s `[End of Your Turn]` and its
effect is self-contained. Ordering can stay deterministic without any starter
card noticing.

**4. Which capabilities are missing, and how many cards need each?**
The ranked table above. Three-way tie at the top with 3 cards each — rested
DON!!, self-targeting statics, DON!! orientation — followed by putting cards
into play and the `[Blocker]` prohibitions, also 3 each. The starter-set count
badly understates gaps 7 and 8, and badly overstates gap 11.

*Since answered:* **the entire three-way tie is closed** — PRs #11, #12 and #13
— and so is gap 6 (**PR #15**). What now heads the list is the other pair of
3-card gaps, putting cards into play and the `[Blocker]` prohibitions, and the
second of those is structural. The answer's real lesson survived the work: the
three gaps that tied at 3 cards each diverged sharply in the full set (105, 268,
71), and building the 268 first was the right call for reasons the starter-set
column could not see.

**5. Which `Trigger` members appear, and which do not?**

| Trigger | In these 34 | Printed marker, full set |
| --- | --- | --- |
| `activateMain` | 5 | `[Activate: Main]` — 365 |
| `trigger` | 7 | `[Trigger]` — 501 |
| `whenAttacking` | 4 | `[When Attacking]` — 250 |
| `onPlay` | 3 | `[On Play]` — 868 |
| `static` | 4 | — |
| `counterEvent` | 3 | `[Counter]` — 184 |
| `mainEvent` | 3 | `[Main]` — 272 |
| `endOfTurn` | 1 | `[End of Your Turn]` — 50 |
| `onBlock` | **0** | `[On Block]` — 14 |
| `onKO` | **0** | `[On K.O.]` — 157 |
| `whenOpponentAttacks` | **0** | `[On Your Opponent's Attack]` — 49 |

All three unused members are wired in the engine — `onBlock` fires on the
blocker, `onKO` on the KO'd card, `whenOpponentAttacks` on the defender's field.
None is dead code in the way `selectOption` and `orderCards` were, and all three
have real cards behind them in the full set, `onKO` with 157. **Recommendation:
keep all three.** The criterion that removed the other two was "no card can
ever reach it", and that does not hold here.

One printed marker has **no** member at all: `[Opponent's Turn]`, 77 cards. Not
needed by any starter card, noted because it is a hole in the union rather than
an unused member of it.

**6. Does `select` with `min: 0` work today?** — *the code check*

Yes. Verified along the whole path:

- `interpreter.ts` `suspend()` — `max = Math.min(instruction.max, candidates.length)`
  then `min = Math.min(instruction.min, max)`, so a `min: 0` stays 0. If there
  are no candidates at all it does not suspend: it writes `[]` into the variable
  and moves on.
- `reducer/choice.ts` `validateAnswerChoice` — rejects only
  `selected.length < pending.min`, so an empty selection passes when `min` is 0.
- `interpreter.ts` `applyAnswer` — writes `vars[name] = []` and advances the
  cursor, exactly as for a non-empty answer.
- Downstream, an empty variable resolves to no targets (`idsFromVar` returns
  `[]`), every op loops over nothing, and `forEach` pushes no frame. "Up to 1"
  resolving to nothing degrades cleanly to a no-op.

**With one caveat that matters: nothing exercises it.** No ability in the `ABIL`
test set uses `min: 0` — the only `min: 0` in the test tree is a hand-built
`yesNo` stub. The random bot draws its cardinality from `[min, max]`, so the
simulation sweep *would* cover the empty answer the moment one real ability
uses it, but today no path in the corpus does.

*Caveat since resolved.* `packages/cards/tests/minZero.test.ts` exists and covers
it against real cards — the recommendation two sections down ("put a `min: 0`
ability under test before anything else") was carried out. The reading above
still holds; it is no longer the only evidence.

*And the sentence about the bot is now out of date, in a way worth recording.*
The shared driver policy no longer draws its cardinality uniformly from
`[min, max]`: it takes `max` and explores the range on 1 decision in 8. That was
not a preference. Answering every selection uniformly was measured to take
`ST02-016` Repel from 5 reachable seeds in 500 to **zero** — half-strength
answers do not merely make effects smaller, they stop the board reaching the
positions the rarest abilities need. So the sweep still covers the empty answer,
just at one eighth the rate. See `cardinalityFor` in
`packages/engine/src/testing/policy.ts`.

This matters more than it looks: **"up to"** is the single most common
quantifier on these cards. It appears in `ST01-001`, `ST01-005`, `ST01-007`,
`ST01-011`, `ST01-014`, `ST01-015`, `ST01-016`, `ST01-017`, `ST02-005`,
`ST02-007`, `ST02-008`, `ST02-009`, `ST02-015`, `ST02-016`, `ST02-017` — 15 of
the 26 cards that carry any text at all. The first ability written will depend
on it.

**7. Does giving DON!! account for the rested state?** — *the code check*

**It does now — PR #11.** `giveDon` skips anything that is not
`{kind: 'cost', orientation: 'rested'}`, so with no rested DON!! in the cost
area it gives none and the ability resolves to nothing. The answer as first
found is kept below, because the diagnosis is what made the fix small.

No. `giveDon` in `interpreter.ts` walks the controller's cost area
`['rested', 'active']` in that order and takes whatever it finds until the count
is met. Rested-first is a **preference, not a constraint**: with no rested DON!!
in the cost area it will hand over active ones.

All three cards that give DON!! in these decks say "rested DON!! card"
(`ST01-001`, `ST01-007`, `ST01-011`), and in the printed game that is a
restriction — you cannot pay out active DON!!. As written, the engine would let
a player give away active DON!! and take a power boost they are not entitled
to.

Note also that a DON!! stops having an orientation once attached: `DonCard`'s
location union is `{kind: 'cost', orientation}` or `{kind: 'attached', to}`. The
question is therefore only about which DON!! may be **taken**, not about what
state it lands in.

That last paragraph is why the fix was a one-line filter rather than a model
change, and it is also what made `orientDon` (PR #13) exclude attached DON!!
without argument two PRs later: there is no orientation on that side of the
union to change. One reading, two gaps closed by it.

A guard was needed to keep it closed. Reverting `giveDon` to the old walk left
the engine suite **green**, because the ABIL case that exercised it always had
rested DON!! from paying its own play cost — the two behaviours agree in that
state. The rule now has a case that separates them: a cost-free `[Activate:
Main]` `giveDon` fired against an untouched, all-active cost area, where
rested-first hands over a DON!! and rested-only gives none.

## Ambiguous — pile D

**`ST02-010` Basil Hawkins.** "[DON!! x1] [Once Per Turn] [Your Turn] If this
Character battles your opponent's Character, set this card as active."

Three things are unsettled, and I would rather say so than pick:

1. **When.** "Battles" is not a moment the trigger union has. It is not attack
   declaration — the battle has to have happened — and there is no
   end-of-battle trigger.
2. **Who.** Does it fire when Hawkins blocks and so battles an attacking
   Character? The text says "battles", not "attacks", which suggests yes; the
   `[Your Turn]` clause suggests no, since blocking happens on the opponent's
   turn. The two readings disagree about whether the ability is ever live while
   blocking.
3. **What it can ask.** Even given the moment, "your opponent's **Character**"
   requires a condition that inspects the battle's target, and conditions
   cannot see the battle at all — `Condition` reaches selectors, the source's
   attached DON!!, life totals and variables, none of which name the attacker or
   the target.

It is also the only card in all 2665 whose text matches "if this Character
battles". Whatever is built for it will be built for it alone, which is the
strongest possible argument for settling the ruling first and building last.

## Recommended order of work

Derived from the table above, not from prior assumptions. The ordering
principle is: **most cards unlocked per capability, cheapest first, and
structural holes only when a card actually blocks on them.**

The first three items are done. The order below is the original one with those
struck off — it is not re-derived, because nothing that has happened since
changes the counts it was derived from.

### Done

- ~~**Write the seven pile-A cards.**~~ `ST01-005`, `ST01-014`, `ST01-015`,
  `ST02-009`, `ST02-013`, plus the two keyword-only cards that need nothing.
  Both Events did what they were picked for: `counterEvent` and `mainEvent` have
  now run against real cards — and `counterEvent` failed on contact, which is
  the whole reason `docs/trigger-reachability.md` exists.
- ~~**Put a `min: 0` ability under test.**~~ `packages/cards/tests/minZero.test.ts`.
- ~~**The three-way tie of bounded gaps**~~, built in the order recommended:
  self-targeting statics (**PR #12**), rested-DON!! giving (**PR #11**), DON!!
  orientation (**PR #13**).
- ~~**Resting the source as a cost**~~ (**PR #15**), which was the first item
  under *What remains* below. It unlocked `ST01-017` and left `ST02-007` where
  it was, exactly as predicted there.

The prediction attached to the third item held exactly: 24 of 34 cards were done
— the 15 that needed nothing new plus those 9 — both decks meaningfully
playable, and nothing structural touched. Gap 6 has since taken it to **25 of
34**, still without touching anything structural.

So did the warning inside it. DON!! did **not** need to become addressable
targets: `orientDon` takes a player, an orientation and a count, and never asks
which DON!! — because any DON!! of the right orientation is interchangeable.
The over-building the note warned against was avoided by taking the note.

### What remains

~~**First — resting the source as a cost**~~ (2 cards, 90). **Done — PR #15.**
Small, as predicted, and one seam: a fifth `Cost` member whose payability asks
the source's orientation. `ST01-017` is written; Bonney still will not work, and
the note above said so.

The prediction that did *not* survive is worth recording, because it is about
this document's method rather than about the card. The gap was ranked at 2 cards
and it delivered 1. A gap's card count is an upper bound on what closing it
unlocks, for the same reason the full-set probes are upper bounds: a card can be
behind two gaps at once, and the table has no column for that. `ST02-007` was
counted under gaps 6 **and** 7 and is only ever unlocked by the second. The
ranking is still the right ranking — it just measures *cards touched*, not
*cards freed*.

**Second — decide the `[Blocker]` prohibitions.** *(Done — PR #31, and the
warning below earned its keep: the design was cut against **five** shapes, not
three. OP-01 added K.O. immunity in battle and Franky's permission, and those two
are what forced three aggregators instead of one hook in `legalActions`. All
three starter cards are written, `ST01-016` included — its `[Trigger]`'s
printed-keyword filter turned out to be one field on the predicate the
prohibitions already needed.)* Structural hole #4, 3 cards, 2
of them in ST-01, 146 in the full set. This is the first thing on the list that
needs a design conversation rather than an implementation, and the inventory
now has enough shape to have it: three cards spanning unconditional, predicated,
and attacker-scoped-for-a-turn. Do not design it from `ST01-012` alone — that
is the easy one, and building for it would leave `ST01-016` stranded.

**Third — putting cards into play** (3 cards, 375 in the full set). The largest
family in the whole inventory, and the one whose cost is most likely to be
underestimated, because it drags in the full-field decision and therefore the
suspension limit.

**Fourth — suspendable costs** (structural hole #1), driven by `ST02-001`. It
blocks exactly one card here, but that card is a Leader, and a Leader whose
ability never fires is not a deck. Anyone who wants ST-02 whole has to pay this.

**Last — `orderCards` (`ST02-007`) and the Hawkins ruling (`ST02-010`).** One
card each, and both need decisions before code: `orderCards` needs a producing
instruction *and* a way to name "the cards not taken", and Hawkins needs a
ruling before it needs a trigger. 254 cards in the full set want `orderCards`,
so it will be built eventually — but not for Bonney alone, and not before the
things above it that unlock three cards apiece.

*(`orderCards` was built in PR #32, last as this list placed it and for the
reason it gave: it came when four OP-01 cards had queued up behind it. The two
decisions it names were the two the work turned on. The producing instruction is
`orderToBottom`; "the cards not taken" is a `Ref` difference over ids `lookAt`
recorded, and the alternative — re-deriving them from the deck — would have been
correct today and wrong the first time a script touched the deck in between.
`ST02-010` Hawkins still waits on a ruling.)*

Two gaps in the ranked table are named by no item here and never were: gap 9
(`ST02-014`, a condition about the source's own orientation, 7 cards) and gap 10
(`ST01-016`'s printed-keyword filter, 6 cards, which arrives with the `[Blocker]`
prohibitions anyway). That is not an omission introduced by this update — the
order was built around capabilities unlocking three cards apiece, and these
unlock one each. Noted because `ST02-014` is now one of only three pile-B cards
left, so its gap is more visible than its rank.

## What this says about the bet

"If the DSL holds these ~40, it holds 400" — it holds about half.

The encouraging half: every one of the 11 gaps is legible. Nothing in either
deck needed a concept the DSL has no room for; the trigger union covers every
printed marker these cards use, `Selector` covers almost every filter, and the
three known structural holes were all correctly identified before this
inventory existed. The suspension model — cursor as data, choices as
`PendingChoice` — absorbed every branching card without complaint.

The sobering half: the gaps cluster in one place. Six of the 11 are about
**DON!!** or about a card **talking about itself** — the two things every
single OPTCG card does constantly. And the fourth structural hole, that the DSL
can only add and never forbid, is not a gap in the vocabulary but in its shape.
"Cannot" appears on 146 cards. Nothing in the current design has a place to put
it.

### What six PRs of closing gaps actually taught

The encouraging half held up better than expected. Every one of the six gaps
closed since was closed roughly where this document said it would be, and none
of them turned out to be a disguised structural hole. Four of the six were
**one seam each**: a filter in `giveDon`, an `Audience` member for statics, one
new op, one new `Cost` member. The DSL was cut about right.

Gap 6 added a wrinkle the others did not have, and it is the one to remember.
Its seam was not only in the DSL: `restSelf` is the first cost whose payability
depends on a **state the source is in** rather than on a pool, so the check has
to be visible in `legalActions` as well as in `applyAction` — a UI reading the
enumeration must never be offered a move the engine will refuse. That it was
free (`legalActions` already asks `canPayCosts`) is a property of the earlier
design, not luck, and it is the strongest evidence so far that putting the cost
check in one pure function was the right call.

The sobering half got sharper, and in a way the sample could not show. This
document sized 11 gaps from 34 cards; PR #11 sized three more from the other
2631, and one of them (**140 cards, DON!! from the DON!! deck**) would rank
second in the whole table. The method's real limit is not that it overcounts —
that is declared, bounded, and always in the same direction. It is that **a
34-card sample is silent about what it does not contain**, and silence reads
exactly like absence. The upper-bound warning protects the numbers that are
here. Nothing protects the rows that are not.

Which is the same lesson `counterEvent` taught, one level up: the first miss was
a question never asked of the cards that *were* in the sample; the second is a
question never asked of the cards that were not.

## Notes for phase 2C

Two things the engine does not tell the UI, both found while writing these
cards, both recorded in
[`trigger-reachability.md`](trigger-reachability.md#notes-for-phase-2c--what-the-event-log-does-not-say):
an ability that resolves to nothing emits no event, and continuous abilities
emit no event at all.

# OP-01 inventory — the DSL against a real expansion set

An inventory, not an implementation. Nothing below designs a missing capability;
each card reports **what it needs**, never what the API for it would look like.

> **Status — batch 1 landed.** Eight pile-A cards are written, taking OP-01 from
> 19 playable to **27 of 121**. One more, `OP01-017` Nico Robin, was written and
> then withheld: the DSL says it, the engine cannot survive it. That is the most
> valuable thing the batch produced and it has its own section,
> [What batch 1 found](#what-batch-1-found--a-missing-rule-not-a-missing-word).
> The classification below is **not re-cut** — it is what was read before any of
> it was built, and the ✅ / ⚠️ marks in the card-by-card table are the only
> thing added to it.

`docs/starter-card-inventory.md` measured 34 cards from two preconstructed
decks. It predicted 24 playable and got 24, and then PR #11 showed what a
two-deck sample cannot do: the "add DON!! from your DON!! deck" family — 140
cards, second-largest in the whole backlog — was structurally invisible to it.

The gaps that remain are the expensive ones, and several of them share cards.
Before any of them is bought, this measures a real expansion set: **every base
card of OP-01 (no `_` suffix), 121 cards.**

The result is meant to decide the order of what comes next. It is not
documentation for its own sake.

## What "121" is made of

| | Leaders | Characters | Events | Stages |
| --- | --- | --- | --- | --- |
| OP-01 base cards | 8 | 93 | 20 | **0** |

OP-01 prints **no Stage cards at all**. `ST01-017` Thousand Sunny is still the
only Stage this project has ever read, which means `restSelf` (PR #15) and the
Stage-area refresh rule are exercised by exactly one card and get no second
witness here.

The starter inventory expected `_` suffixed reprints to need filtering. In this
data set OP-01 has none: 121 cards in `cards.en.json`, 121 base cards.

## The method, with the two corrections that were learned the hard way

### Two questions per card, not one

The starter inventory classified every card against the DSL's *vocabulary* and
never asked whether the engine has an **action that reaches the trigger**. That
is how `counterEvent` stayed invisible: the script was expressible, the trigger
unreachable. `docs/trigger-reachability.md` asked the second question of all
eleven triggers afterwards.

Here both questions are asked of every card, and the second one paid out
immediately. Three OP-01 cards want a trigger that **no engine site can ever
fire**, and they are not in the trigger union at all — see
[Two new missing rules](#two-new-missing-rules--backlog-a-is-no-longer-empty).
Asking only the first question would have filed all three as "missing
vocabulary" and mis-ranked them, because a missing rule outranks a same-sized
missing word.

### Cards touched ≠ cards freed

The starter inventory's ranked table counted cards that **need** a capability.
For prioritising, what matters is how many a capability **frees on its own**. A
card behind two gaps appears under both and is released by neither.

That table learned this after the fact — gap 6 was ranked at 2 cards and
delivered 1, because `ST02-007` Bonney was counted under gaps 6 and 7 and is
only ever unlocked by the second. Every table here carries **both columns from
the start**: *touched* and *freed by this gap alone*.

The difference is not cosmetic. Across OP-01, 66 cards need something the DSL
cannot say; 41 of them are freed by a single gap and **25 are behind two or
more**. A one-column table would overstate the whole queue by 60%.

### Counting

- The regex probes over the 2665 cards are **upper bounds**. A probe counts
  cards that *mention* a mechanic, not cards that *have* it, and the error only
  ever inflates. The warning is inherited verbatim from the starter inventory
  and applies to every "full set" figure below.
- **OP-01 itself is counted by hand**, card by card, all 121. At that size a
  regex is not worth its own error bars.
- Where an ordering decision turned on a close comparison between two gaps,
  those two were checked in the full set too — see
  [The one close comparison, checked](#the-one-close-comparison-checked).

### What the cards were read against

`packages/engine/src/abilities/` — `dsl.ts` for the vocabulary, `query.ts` for
what a `Selector` and a `Condition` can filter on, `interpreter.ts` for what
each op actually does, `costs.ts` for what a `Cost` can be, `triggers.ts` for
when things fire — plus `selectors.ts` for `static` evaluation,
`legalActions.ts` for what a player may be offered, `reducer/battle.ts` and
`reducer/helpers.ts` for where the rules live, and `packages/cards/src/decklists.ts`
for deck construction.

## The piles

| Pile | Meaning | Cards | Playable today |
| --- | --- | --- | --- |
| **vanilla** | No effect text and no trigger text. No `Ability` at all. | 16 | 16 |
| **A** | The DSL expresses it as it stands. | 38 | **11** |
| **B** | Needs something bounded: one capability the DSL does not have. | 6 | 0 |
| **C** | Hits a structural hole. | 60 | 0 |
| **D** | Honestly ambiguous — the text does not settle where it belongs. | 1 | 1 |

Three of the 38 in pile A need **no `Ability` at all**: `OP01-025` Zoro,
`OP01-075` Pacifista and `OP01-100` Kurozumi Higurashi print nothing but a
keyword reminder, and printed keywords are already a rule in the engine carried
on `CardDefinition.keywords`.

**Playable today — 27 of 121, up from 19.** The `Playable today` column moves as
batches land, and the first one has:

- **16 vanilla + 3 keyword-only = 19** needed nothing written, and that is the
  number this document opened with.
- **8 more are written** as of batch 1 — `OP01-006`, `-022`, `-033`, `-034`,
  `-035`, `-048`, `-052`, `-054`, the mechanical `[On Play]` and
  `[When Attacking]` cards. Nothing in the engine changed to accept them, which
  is what pile A claimed and this is the first batch to check.
- **27 more of pile A remain to write**, in later batches.
- **66 of 121 still need something the DSL cannot say.**

One card left pile A on contact, and it is the most useful thing batch 1 found:
`OP01-017` Nico Robin. See
[What batch 1 found](#what-batch-1-found--a-missing-rule-not-a-missing-word).

`OP01-121` Yamato is counted as playable because its printed
`[Double Attack]`/`[Banish]` already work and its one line of text has no
in-game effect today. That is a technicality and the pile-D note says why.

### The answer to question 5, up front

**54 of 121 cards would be playable if pile A were written, without touching the
engine.** That is the ceiling of an eventual "write OP-01 pile A" pass: from 19
to 54, at zero engine cost. 44.6% of a real expansion set, bought with card data
alone.

That number is the single most actionable thing in this document, and it is why
the recommendation at the end does not start with a gap.

*Since revised, slightly downward.* Batch 1 wrote 8 of the 35 and found that one
more, `OP01-017`, is not shippable without an engine change after all. So the
ceiling is **53 of 121**, not 54, until the battle rules can lose their target.
The estimate was 34 of 35 correct on its first contact with real cards, which is
about as well as a classification of this kind can be expected to do — and the
one it missed, it missed for a reason no reading of the DSL could have caught.

## What batch 1 found — a missing rule, not a missing word

`OP01-017` Nico Robin: *"[DON!! x1] [When Attacking] K.O. up to 1 of your
opponent's Characters with 3000 power or less."*

The DSL says this exactly. The script was written, and its hand-built table
cases passed. It is withheld because the **engine** cannot survive it.

An attack may target a rested Character (CR 7-1-1-2). Robin's own
`[When Attacking]` can K.O. that same Character before the Damage Step. At that
point `state.battle.target` names a card in the trash, and `resolveBattle` calls
`leaveField` on it unconditionally — `detachFromField` throws
`Engine bug: … is not on … field`. The engine's own `checkInvariants` agrees the
state is unsound: its `battleShape` rule says the target must be on the field.

Four actions reproduce it, with no randomness: attach a DON!! to Robin, declare
an attack on a rested Character, answer her choice with that Character, pass.

**Why the classification missed it.** The inventory asked two questions of every
card — *can the DSL say it*, and *can a real card reach the trigger*. Both answer
yes here. The question it did not ask is the third one:

> **Can the effect this card produces survive being applied at the moment its own
> trigger fires?**

`counterEvent` was a trigger nothing could reach. This is the mirror image: a
trigger anything can reach, whose *effect* invalidates the rule that fired it.
No starter card can reach it, because none of the fifteen written can remove a
card from the field during a battle it is part of — so a two-deck sample was
structurally unable to see this too.

**Where it belongs.** Backlog A, missing rules, alongside the two the inventory
already added. It is not in the gap table below and never could be: the DSL is
not short a word. Per this project's ranking rule an A item outranks a same-sized
B item, and this one is small — the Damage Step needs to notice a target that
left, and end the battle without damage.

## Gaps, with both columns

*Touched* = cards that need this capability. *Freed alone* = cards for which
this is the **only** thing missing. The full-set column is a probe and therefore
an upper bound.

| # | What the cards need | Touched | **Freed alone** | Full set (upper bound) |
| --- | --- | --- | --- | --- |
| 1 | **Put a card into play** — from hand or deck, sometimes rested | 19 | **8** | 379 |
| 2 | **A payment whose card the player picks** — including "your opponent chooses" | 12 | **6** | 292 |
| 3 | **`orderCards`, and naming "the rest"** — incl. top-*or*-bottom splits | 9 | **5** | 226 |
| 4 | **Add DON!! from the DON!! deck** | 8 | **5** | 140 |
| 5 | **Reference a card by name** — "other than [X]", "if your Leader is [X]", "play [X]" | 14 | **3** | 399 |
| 6 | **A condition on how many DON!! you have on the field** | 3 | **3** | 36 |
| 7 | **Prohibitions** — "cannot" | 5 | **0** | 146 |
| 8 | **Attack-legality modifiers** — widen or narrow who may be attacked | 3 | **2** | 49 |
| 9 | **A trigger for something another card did** — an Event was played, a Character was K.O.'d | 3 | **2** | 11 |
| 10 | **Scaling grants** — "+1000 for every card in your hand" | 2 | **2** | 23 |
| 11 | **A cost paid with a Life card** | 2 | **2** | — |
| 12 | **Cost modification** — "give blue Events in your hand −1 cost" | 1 | **1** | 127 |
| 13 | **Negation in `Condition`** — `[Opponent's Turn]` | 2 | **1** | 77 |
| 14 | **`reveal` taking a `Ref`** — reveal the cards you just chose | 2 | **1** | 2 |
| 15 | **A cost paid with other cards you choose** — rest 2 Characters, return a Character | 3 | **0** | — |
| 16 | **A predicate about a card held in a variable** | 2 | **0** | — |
| 17 | **Search the whole deck, and shuffle it** | 2 | **0** | 8 |
| 18 | **A duration longer than end of turn** | 1 | **0** | 43 |
| 19 | **Filter by printed keyword** — "[Blocker] Characters" | 1 | **0** | 6 |
| 20 | **Filter by attribute** — "＜Strike＞ attribute Characters" | 1 | **0** | — |
| 21 | **A condition about the source's own orientation** | 1 | **0** | 7 |

Read the two middle columns against each other, because they disagree loudly.

**Gap 5 is the sharpest disagreement in the table.** Referencing a card by name
touches 14 OP-01 cards and 399 in the full set — the largest family anywhere in
this project's records, larger than putting cards into play — and it frees
**three**. Eleven of its fourteen cards sit behind put-into-play, `orderCards`,
or a chosen payment as well. A ranking built on *touched* would put it first and
deliver almost nothing.

**Gap 7 is the mirror image, and it is the answer to question 2.** Prohibitions
touch five OP-01 cards and free **zero**. Every one of the five is behind a
second gap. That is set out in
[Prohibitions do not dominate OP-01](#prohibitions-do-not-dominate-op-01--they-fracture-instead).

**Gap 6 is the cheapest thing on the board.** Three cards touched, three cards
freed, one new `Condition` member that counts a player's cost-area DON!!. Every
other row in the table with a perfect touched-equals-freed score is worth two
cards or one.

### The one close comparison, checked

The ordering decision turns on which gap is second. Gap 2 frees 6 and gap 3
frees 5 in OP-01, which is close enough that the method requires a full-set hand
check rather than a probe.

Both were checked by **grouping every match by its distinct phrasing** and
judging each phrasing family once — 20 families for gap 2, 13 for gap 3, instead
of 518 individual cards. Every family in both is genuinely the mechanic:

- **Gap 2 — 292 cards, 20 phrasings.** 250 are the bare "trash N card(s) from
  your hand"; the rest add a type or category filter ("1 {Land of Wano} type
  card", "1 Event or Stage card", "1 black {Navy} type card"). Nothing in the
  match set is a false positive, and the filtered variants show that the
  mechanism has to be a *filtered* selection, not a count.
- **Gap 3 — 226 cards, 13 phrasings.** 174 are exactly the Bonney/Nami shape,
  "place the rest at the bottom of your deck in any order". The rest split
  between top-or-bottom destinations (27) and the **life area** (7), which is a
  third zone the same op has to reach.

So gap 2 leads gap 3 in both the measured set (6 to 5) and the full set (292 to
226), and the second place in the ranking is settled without either number
having to be trusted alone.

### The starters' remaining nine, folded in

The ordering recommendation is about the whole project, not about OP-01 in
isolation, so the nine starter cards still blocked are counted the same way.

| Gap | Frees, of the starters' remaining 9 |
| --- | --- |
| 1 — put into play | `ST02-005`, `ST02-017` |
| 2 — chosen payment | `ST02-001` (the ST-02 Leader) |
| 3 — `orderCards` and "the rest" | `ST02-007` |
| 7 — prohibitions | `ST01-012` |
| 21 — source's own orientation | `ST02-014` |

`ST01-002` and `ST01-016` are freed by nothing alone; `ST02-010` Hawkins is
pile D and needs a ruling first.

**Combined — starters remaining plus OP-01, freed alone:**

| Gap | Freed |
| --- | --- |
| **1 — put a card into play** | **10** |
| 2 — a payment the player picks | 7 |
| 3 — `orderCards` and "the rest" | 6 |
| 4 — add DON!! from the DON!! deck | 5 |
| 5 — reference a card by name | 3 |
| 6 — a condition on DON!! you have | 3 |
| 8 — attack legality | 2 |
| 9 — a trigger for another card's event | 2 |
| 10 — scaling grants | 2 |
| 11 — a cost paid with a Life card | 2 |
| 7, 12, 13, 14, 21 — one each | 1 |
| 15–20 | 0 |

Put-into-play wins by 43% over second place and is also the largest family in
the full set. That is not a close call and does not need a hand count.

## The six questions, answered

### 1. Which gap frees the most OP-01 cards on its own?

**Putting a card into play — 8 of 121 alone, 19 touched, 379 in the full set.**
It is first on both columns and first on the full-set probe, which no other row
manages.

The eight it frees are cheap in a specific way: `OP01-009` Carrot, `OP01-037`
Kawamatsu, `OP01-071` Jinbe, `OP01-082` Monet and `OP01-104` Speed are all
literally "[Trigger] Play this card", with no other text between them.
`OP01-014` Jinbe, `OP01-087` Officer Agents and `OP01-060` Doflamingo are one
selector and one op each.

The starter inventory already warned that this gap is the one most likely to be
under-priced, because "play this card" has to reuse the play routine — the
played card's own `[On Play]` fires, and a full field forces a trash decision
inside a single step. OP-01 adds two demands the starters never printed:

- **Play from the deck, not from hand.** `OP01-060` Doflamingo plays the
  revealed top card; `OP01-069` Caesar plays a named card out of the whole deck;
  `OP01-116` SMILE plays one of five looked at. `ZoneRef` has no `field` member
  *and* `Selector` cannot reach past `deckTop`.
- **Play it rested.** `OP01-060` again: "you may play that card rested". The
  op needs an orientation, which is `orientDon`'s lesson repeated one zone over.

### 2. Do prohibitions dominate OP-01?

**No — and the way they fail to is more useful than the count.**

Five cards, zero freed, against 146 "cannot" cards in the full set. In ST-01 a
player met the hole twice in one deck; in OP-01 it is 4% of the set and every
instance is behind a second wall.

But the count is the least interesting thing here. The five fracture into **five
distinct shapes across three different answer sites**, and only one of them is
the shape the starters showed:

| Card | The prohibition | Where the answer has to be visible | Also blocked by |
| --- | --- | --- | --- |
| `OP01-120` Shanks | opponent cannot activate a `[Blocker]` with 2000 power or less, this battle | `legalActions` — the blocker offer | printed-keyword filter (gap 19) |
| `OP01-024` Monkey.D.Luffy | cannot be K.O.'d in battle by ＜Strike＞ attribute Characters | `reducer/battle.ts` — damage resolution | attribute filter (gap 20) |
| `OP01-099` Kurozumi Semimaru | {Kurozumi Clan} Characters other than this one cannot be K.O.'d in battle | `reducer/battle.ts`, as a board-wide `static` with no duration | name reference (gap 5) |
| `OP01-051` Eustass"Captain"Kid | opponent cannot attack any card other than this Character | `legalActions` — the attack **target set** | negation, source orientation, put-into-play |
| `OP01-085` Mr.3(Galdino) | the chosen Character cannot attack until the end of your opponent's next turn | `legalActions` — the attacker set, across two turns | a duration the engine cannot name (gap 18) |

Only `OP01-120` repeats a starter shape — it is `ST01-002`'s predicated blocker
ban with a different threshold. The other four are new:

- **Two are K.O. immunity in battle**, which no starter card printed. That is
  not a `legalActions` problem at all; it is a rule inside damage resolution.
- **Two are about attacking**, one narrowing the *target* set and one banning a
  specific *attacker*, and they point in opposite directions from the same site.
- `OP01-085` needs a modifier that **survives into the opponent's next turn**.
  `Duration` has exactly two members, `endOfBattle` and `endOfTurn`, and 43
  cards in the full set want a third.

The starter inventory's advice was "do not design it from `ST01-012` alone —
that is the easy one". OP-01 sharpens it: designing from the two blocker
prohibitions the starters printed would leave **four of these five** stranded,
and would put the whole mechanism in `legalActions`, which is the wrong building
for two of them.

The honest summary is that "prohibitions" is not one capability. It is at least
three — blocker legality, attack legality, and K.O. immunity — that happen to
share an English word.

### 3. Does the "add DON!! from the DON!! deck" family appear, and how often?

**Yes — 8 cards, hand-counted, 5 of them freed by this gap alone.** It is fourth
on the freed column and fourth on the touched column.

| Card | What it wants | Freed alone |
| --- | --- | --- |
| `OP01-093` Ulti | add up to 1 and **rest** it | ✅ |
| `OP01-113` Holedem | add up to 1 and rest it, `[On K.O.]` | ✅ |
| `OP01-115` Elephant's Marchoo | K.O., then add up to 1 and **set it active** | ✅ |
| `OP01-118` Ulti-Mortar | `[Trigger]` — add up to 1 and set it active | ✅ |
| `OP01-119` Thunder Bagua | add and rest, add and set active | ✅ |
| `OP01-061` Kaido (Leader) | add up to 1 and set it active | ✗ — also needs a trigger that does not exist |
| `OP01-101` Sasaki | add up to 1 and rest it | ✗ — also needs a chosen discard |
| `OP01-106` Basil Hawkins | add up to 1 and rest it | ✗ — also needs put-into-play |

This is the family the 34-card sample could not see, and OP-01 confirms the
sizing was right rather than a probe artefact. Every one of the eight asks for
a **count and an orientation**, exactly as PR #11 predicted from `OP16-073`.
`orientDon` (PR #13) already built the half that turns DON!! over; what is
missing is the half that produces them, and no card here needs anything else
from the DON!! deck.

Worth noting what does **not** appear in OP-01: neither of the other two DON!!
mechanics PR #11 found. No card gives active DON!! as a cost, and no card moves
the opponent's DON!!. Both remain the small families they were measured to be.

### 4. Are there printed triggers or markers in OP-01 that the union does not have?

**Yes — three, and two of them are worse than missing vocabulary.**

Printed markers in the 121, counted by hand:

| Marker | OP-01 | Union member |
| --- | --- | --- |
| `[On Play]` | 27 | `onPlay` |
| `[Trigger]` | 19 | `trigger` |
| `[When Attacking]` | 17 | `whenAttacking` |
| `[Blocker]` | 14 | printed keyword |
| `[Once Per Turn]` | 12 | `oncePerTurn` |
| `[Counter]` | 11 | `counterEvent` |
| `[Activate: Main]` | 10 | `activateMain` |
| `[Main]` | 9 | `mainEvent` |
| `[Your Turn]` | 8 | `isYourTurn` |
| `[On K.O.]` | 8 | `onKO` |
| `[On Block]` | 4 | `onBlock` |
| `[Rush]` | 4 | printed keyword |
| `[Banish]` / `[Double Attack]` | 2 / 2 | printed keywords |
| **`[Opponent's Turn]`** | **2** | **none — needs `not` in `Condition`** |
| `[End of Your Turn]` | 0 | `endOfTurn`, unused here |
| `[On Your Opponent's Attack]` | 0 | `whenOpponentAttacks`, unused here |
| `[Unblockable]` | 0 | — |

`[DON!! xN]` appears on 30 cards and is a `Condition`, not a trigger.

`[Opponent's Turn]` is the known one: `OP01-019` Bartolomeo and `OP01-051` Kid.
`Condition` has `and` and `or` and no negation, so `isYourTurn` cannot be
inverted — 77 cards in the full set. Bartolomeo is freed by it alone.

The two new ones are not bracketed markers at all. They are written in plain
prose, which is why a marker-shaped search would never have found them:

- **"when your opponent activates an Event"** — `OP01-004` Usopp. And its
  mirror, **"When you activate an Event"** — `OP01-062` Crocodile (Leader).
- **"When your opponent's Character is K.O.'d"** — `OP01-061` Kaido (Leader).

All three are the same shape: *a card on the field reacting to something that
happened to a different card*. Every member of the current `Trigger` union
except `static` is "something happened to **me**" or "**I** was played". There
is no member for a spectator, and — this is the part the second question
catches — **there is no engine site that could fire one.**

### 5. How many OP-01 cards would be playable today?

**54 of 121**, if pile A were written and the engine were left alone.

- 16 vanilla — nothing to write.
- 3 keyword-only (`OP01-025`, `OP01-075`, `OP01-100`) — nothing to write.
- 35 pile-A cards — a script each, no new engine capability.

The 19 that need nothing at all is the number to compare against ST-01/ST-02's
10 of 34. Proportionally that is almost identical (15.7% against 29.4% —
lower, because a starter deck is deliberately padded with vanilla bodies).

The 54 is worth more attention. It means **an expansion set is roughly 45%
expressible by a DSL built against two starter decks**, which is a better result
than "it holds about half" suggested, and a considerably better one than the
66-card blocked pile makes it look.

### 6. Is there a new structural hole?

**Yes — four, and one of them reframes a hole this project already had.**

They are set out in the next two sections, because two are missing rules and two
are missing expressiveness, and the project keeps those in separate backlogs on
purpose.

## The reframing: `Modifier` is the hole, not "the DSL only adds"

The starter inventory's fourth structural hole was stated as *"the DSL can only
add, never forbid"*. OP-01 shows that framing is one card away from being wrong,
and the correct statement is both simpler and larger.

`OP01-021` Franky: **"[DON!! x1] This Character can also attack your opponent's
active Characters."** That is not a prohibition. It is a **grant** — it widens
what its controller may legally do — and the DSL cannot say it either.
`OP01-112` Page One is the same grant with a `returnDon` cost and an
end-of-turn duration.

Look at where the answer has to be visible and the two halves collapse into one
hole. `legalActions.ts` builds the attack target list as *the enemy Leader plus
enemy Characters that are rested*, from `orientation` alone. Franky needs that
list widened; `OP01-051` Kid needs it narrowed to a single card. Both are
changes to the **legality of an action**, and neither can be expressed because
`Modifier` is a closed union of exactly two members — `power` and
`grantKeyword` — and every op that writes one writes one of those two.

So the hole is not directionality. It is:

> **`Modifier` can only say two things about a card, and every card that
> changes what a player may *do* — in either direction — falls outside it.**

That reframing costs nothing and changes what the design conversation is about.
"Prohibitions" invites a `restrictions` list bolted onto the state; the real
question is what a third and fourth `Modifier` member look like, and whether
`hasKeyword`'s pattern — one function every reader goes through — generalises to
"may this card attack that one".

Three OP-01 cards, 2 freed, 49 in the full set on the "can also attack" and
"cannot attack" probes together. Not large. But it is the one finding here that
makes an existing backlog item *cheaper to think about*, and that is worth more
than its card count.

## Two new missing rules — backlog A is no longer empty

`docs/trigger-reachability.md` closed with backlog A empty of actionable work,
and with a careful qualifier: *"Empty means nothing is known to be missing — not
that nothing is."* OP-01 is the right question asked of the right cards, and it
puts two items back.

Both were found by the second question — *can a real card reach it* — and
neither is a DSL gap. The vocabulary is not short a word; the engine does not
have the event.

### 1. Nothing fires when an Event is activated

`OP01-004` Usopp: *"[DON!! x1] [Your Turn] [Once Per Turn] Draw 1 card when your
opponent activates an Event."*
`OP01-062` Crocodile (Leader): *"[DON!! x1] When you activate an Event, you may
draw 1 card if you have 4 or less cards in your hand and haven't drawn a card
using this Leader's effect during this turn."*

`applyPlayCard` fires `mainEvent` on `[action.instanceId]` — the Event itself,
and nothing else. `applyPlayCounterEvent` does the same for `counterEvent`.
There is no site that tells the rest of the field an Event was played, so no
ability written for either card could ever run.

Everything else about both cards fits. Crocodile's "haven't drawn a card using
this Leader's effect during this turn" is `oncePerTurn`; "4 or less cards in
your hand" is `countCards` on the hand zone with `max: 4`. Both are freed by the
trigger alone. **8 cards in the full set** match "when you/your opponent
activates an Event".

### 2. Nothing on the field can watch a K.O.

`OP01-061` Kaido (Leader): *"[DON!! x1] [Your Turn] [Once Per Turn] When your
opponent's Character is K.O.'d, add up to 1 DON!! card from your DON!! deck and
set it as active."*

`leaveField(cause: 'ko')` in `reducer/helpers.ts` emits `koed` and then calls
`fireTriggers(draft, 'onKO', [id])` — the KO'd card, alone. `onKO` is not "a
Character was K.O.'d", it is "**I** was K.O.'d". A Leader watching the
opponent's board has no way in.

Kaido is not freed by this alone — it also wants the DON!! deck — so the
sequencing is unusually clean: the DON!! deck gap is worth building first for
five other cards, and Kaido falls out of the trigger afterwards. **3 cards in
the full set.**

### Why these outrank their size

The distinction `trigger-reachability.md` drew still holds and is why these two
are recorded separately from the gap table. A gap in backlog B limits *which
cards can be written*; every card already written still plays correctly. A gap
in backlog A means the cards can be written, they sit in the deck, and **the
games do not resemble the game**.

Eleven cards is small. But an OP-01 Kaido or Crocodile deck built today would
run a Leader whose printed ability never fires, and the simulation would report
results from a game nobody was playing. That was exactly the `counterEvent`
failure, one level quieter.

Both are small to build — one `fireTriggers` call at an existing site, plus a
union member each. Neither needs a design conversation.

## A third finding: the engine has no hidden information

Not a gap in either backlog, and recorded because it will surface as a bug
report otherwise.

Two OP-01 cards look into the opponent's hand:

- `OP01-063` Arlong: *"Choose 1 card from your opponent's hand; your opponent
  reveals that card."*
- `OP01-105` Bao Huang: *"Choose 2 cards from your opponent's hand; your
  opponent reveals those cards."*

`resolveSelector` will resolve `{zone: 'hand', owner: 'opponent'}` and hand back
real `InstanceId`s, and `PendingChoice.candidates` will carry them to whoever
the choice is addressed to. There is nothing in the engine that says a card is
face-down to one player, because until now no card had to look. In the real game
the chooser picks a card **without seeing it** and only then is it revealed.

The engine's behaviour is not wrong so much as undefined: `GameState` has no
concept the client could use to blur those candidates, and a client that renders
`candidates` faithfully would leak the opponent's hand. This belongs with the
phase-2C notes in `trigger-reachability.md` rather than in a gap table — it is a
model gap, and the two cards that expose it are blocked on other things anyway.

## A fourth: two cards are illegal to model in deck construction

`packages/cards/src/decklists.ts` enforces `MAX_COPIES = 4` with no per-card
exception and has no concept of a card's *name* as distinct from its `cardId`.
Two OP-01 cards break both assumptions, and neither is an ability:

- `OP01-075` Pacifista: *"Under the rules of this game, you may have any number
  of this card in your deck."* `validateDecklist` will reject a fifth copy.
- `OP01-121` Yamato: *"Also treat this card's name as [Kouzuki Oden] according to
  the rules."* The 4-copy limit is per **name**, so Yamato and any
  `[Kouzuki Oden]` Character share one allowance — which the validator cannot
  express, because it counts `cardId`s.

Both are real rules and both are cheap. They are recorded here rather than in
the gap table because the ability system is not where they live.

## Card by card

`E` is the effect text, `T` the trigger text. **Signature** is the abbreviated
DSL shape for pile A, or the missing requirement otherwise. Vanilla cards are
listed for completeness and carry no analysis.

The `Pile` column is the original classification and is **not** re-cut. Two marks
have been added to it as batches land:

- **✅** — written and scripted in `packages/cards/src/abilities.ts` today.
- **⚠️** — read as pile A, and it was not. The signature stands; something
  outside the DSL blocks it, and the row's note says what.

| Card | Name | Cat | Pile | What it needs, or how it is said |
| --- | --- | --- | --- | --- |
| OP01-001 | Roronoa Zoro (L) | leader | **A** | `static`, cond `and(donAttached 1, isYourTurn)`, `affects` selector {field, you, character}, `grants.power +1000` |
| OP01-002 | Trafalgar Law (L) | leader | **C** | put-into-play, **and** a selector predicated on a card held in a var ("a different color than the returned Character") |
| OP01-003 | Monkey.D.Luffy (L) | leader | **A** | `activateMain`, `oncePerTurn`, cost `restDon 4`; select 0–1 {field, you, character, types, costMax 5} → `setActive` + `addPower +1000 endOfTurn` |
| OP01-004 | Usopp | char | **C** | a trigger for "your opponent activates an Event" — **missing rule**, no engine site fires it |
| OP01-005 | Uta | char | **B** | fits but for "other than [Uta]": `Selector` cannot exclude by card name |
| OP01-006 | Otama | char | **A** ✅ | `onPlay`; select 0–1 {field, opponent, character} → `addPower −2000 endOfTurn` |
| OP01-007 | Caribou | char | **A** | `onKO`; select 0–1 {field, opponent, character, powerMax 4000} → `ko` |
| OP01-008 | Cavendish | char | **B** | a `Cost` paid by moving a Life card to hand. Body is `grantKeyword self rush endOfTurn` |
| OP01-009 | Carrot | char | **C** | put-into-play, and nothing else. Note: the `[Trigger]` text sits in `effectText`, not `triggerText` |
| OP01-010 | Komachiyo | char | vanilla | — |
| OP01-011 | Gordon | char | **C** | a player-chosen payment, **and** a `Cost` that moves a hand card to the bottom of the deck |
| OP01-012 | Sai | char | vanilla | — |
| OP01-013 | Sanji | char | **B** | same Life-card `Cost` as `OP01-008`; body is `addPower self` then `giveDon self 2` |
| OP01-014 | Jinbe | char | **C** | put-into-play, and nothing else. `[Blocker]` is printed |
| OP01-015 | Tony Tony.Chopper | char | **C** | player-chosen discard, **and** "other than [Tony Tony.Chopper]" |
| OP01-016 | Nami | char | **C** | `orderCards` + "the rest", **and** "other than [Nami]" |
| OP01-017 | Nico Robin | char | **A** ⚠️ | `whenAttacking`, cond `donAttached 1`; select 0–1 {field, opponent, character, powerMax 3000} → `ko`. The DSL says it; the engine cannot survive it — K.O.ing the attack's own target throws in `resolveBattle`. **Missing rule**, backlog A. |
| OP01-018 | Hajrudin | char | vanilla | — |
| OP01-019 | Bartolomeo | char | **C** | `[Opponent's Turn]` — `Condition` has no negation. Freed by that alone; `[Blocker]` is printed |
| OP01-020 | Hyogoro | char | **A** | `activateMain`, cost `restSelf`; select 0–1 {field, you, leader+character} → `addPower +2000 endOfTurn` |
| OP01-021 | Franky | char | **C** | an attack-legality modifier — **new hole**, `Modifier` is `power`/`grantKeyword` only |
| OP01-022 | Brook | char | **A** ✅ | `whenAttacking`, cond `donAttached 1`; select 0–2 {field, opponent, character} → `addPower −2000 endOfTurn` |
| OP01-023 | Marco | char | vanilla | — |
| OP01-024 | Monkey.D.Luffy | char | **C** | a prohibition (K.O. immunity in battle) **and** an attribute filter. Its `activateMain` half is expressible |
| OP01-025 | Roronoa Zoro | char | **A** | `[Rush]` reminder only. No `Ability` needed |
| OP01-026 | Gum-Gum … Red Hawk | event | **A** | `counterEvent`: select 0–1 own → `addPower +4000 endOfBattle`, then select 0–1 {opponent, powerMax 4000} → `ko`. `trigger`: `addPower −10000 endOfTurn` |
| OP01-027 | Round Table | event | **A** | `mainEvent`; select 0–1 {field, opponent, character} → `addPower −10000 endOfTurn` |
| OP01-028 | Green Star Rafflesia | event | **A** | `counterEvent` + `trigger` sharing one instruction list, as `ST01-015` does |
| OP01-029 | Radical Beam!! | event | **A** | select as `x` → `addPower x +2000 endOfBattle`; `if lifeAtMost(you, 2)` → `addPower x +2000` again |
| OP01-030 | In Two Years!! … | event | **C** | `orderCards` + "the rest", and nothing else |
| OP01-031 | Kouzuki Oden (L) | leader | **C** | a player-chosen, **type-filtered** discard. Body is `orientDon you active 2` |
| OP01-032 | Ashura Doji | char | **A** | `static`, cond `and(donAttached 1, countCards {field, opponent, character, rested} min 2)`, `affects self` |
| OP01-033 | Izo | char | **A** ✅ | `onPlay`; select 0–1 {field, opponent, character, costMax 4} → `rest` |
| OP01-034 | Inuarashi | char | **A** ✅ | `whenAttacking`, cond `donAttached 2` → `orientDon you active 1` |
| OP01-035 | Okiku | char | **A** ✅ | `whenAttacking`, `oncePerTurn`, cond `donAttached 1`; select 0–1 {opponent, costMax 5} → `rest` |
| OP01-036 | Otsuru | char | vanilla | — |
| OP01-037 | Kawamatsu | char | **C** | put-into-play, and nothing else |
| OP01-038 | Kanjuro | char | **C** | a discard **the opponent chooses** from your hand. `PendingChoice` already carries a `player`, so the chooser is not the hard part — suspension during the effect is. Its `whenAttacking` half is expressible |
| OP01-039 | Killer | char | **A** | `onBlock`, cond `and(donAttached 1, countCards {field, you, character} min 3)` → `draw you 1` |
| OP01-040 | Kin'emon | char | **C** | put-into-play **and** "if your Leader is [Kouzuki Oden]". Its `whenAttacking` half is expressible |
| OP01-041 | Kouzuki Momonosuke | char | **C** | `orderCards` + "the rest". Both costs already exist: `restDon 1` and `restSelf` |
| OP01-042 | Komurasaki | char | **B** | fits but for "if your Leader is [Kouzuki Oden]" — a condition on a card's name |
| OP01-043 | Shinobu | char | vanilla | — |
| OP01-044 | Shachi | char | **C** | put-into-play **and** a name reference. "If you don't have [Penguin]" is `countCards … max: 0`, which exists |
| OP01-045 | Jean Bart | char | vanilla | — |
| OP01-046 | Denjiro | char | **B** | fits but for "if your Leader is [Kouzuki Oden]". Body is `orientDon you active 2` |
| OP01-047 | Trafalgar Law | char | **C** | put-into-play, **and** a `Cost` that returns a Character you choose |
| OP01-048 | Nekomamushi | char | **A** ✅ | `onPlay`; select 0–1 {field, opponent, character, costMax 3} → `rest` |
| OP01-049 | Bepo | char | **C** | put-into-play **and** "other than [Bepo]" |
| OP01-050 | Penguin | char | **C** | as `OP01-044` |
| OP01-051 | Eustass"Captain"Kid | char | **C** | four gaps: attack-target restriction, `[Opponent's Turn]` negation, the source's own orientation, and put-into-play on the second ability |
| OP01-052 | Raizo | char | **A** ✅ | `whenAttacking`, `oncePerTurn`, cond `countCards {field, you, character, rested} min 2` → `draw you 1` |
| OP01-053 | Wire | char | vanilla | — |
| OP01-054 | X.Drake | char | **A** ✅ | `onPlay`; select 0–1 {field, opponent, character, rested, costMax 4} → `ko` |
| OP01-055 | You Can Be My Samurai!! | event | **C** | a `Cost` that rests 2 Characters **you choose** — a chosen payment and a new cost member |
| OP01-056 | Demon Face | event | **A** | `mainEvent`; select 0–2 {field, opponent, character, rested, costMax 5} → `ko` |
| OP01-057 | Paradise Waterfall | event | **A** | `counterEvent`: `addPower +2000 endOfBattle` then `setActive`. `trigger`: `ko` a rested opponent Character |
| OP01-058 | Punk Gibson | event | **A** | as `OP01-057`, with `rest` instead of `setActive` |
| OP01-059 | BE-BENG!! | event | **C** | a player-chosen, type-filtered discard, and nothing else |
| OP01-060 | Donquixote Doflamingo (L) | leader | **C** | put-into-play, **from the deck and rested**. The condition on the revealed card is expressible: a re-resolved `deckTop` selector with `count: 1` names the same card |
| OP01-061 | Kaido (L) | leader | **C** | a trigger for "your opponent's Character is K.O.'d" (**missing rule**) **and** the DON!! deck |
| OP01-062 | Crocodile (L) | leader | **C** | a trigger for "you activate an Event" (**missing rule**), and nothing else — `oncePerTurn` and `countCards` cover the rest |
| OP01-063 | Arlong | char | **C** | a predicate about a card held in a var ("if the revealed card is an Event") **and** `reveal` taking a `Ref`. See the hidden-information note |
| OP01-064 | Alvida | char | **C** | a player-chosen discard, and nothing else |
| OP01-065 | Vergo | char | vanilla | — |
| OP01-066 | Krieg | char | vanilla | — |
| OP01-067 | Crocodile | char | **C** | cost modification — "give blue Events in your hand −1 cost". `[Banish]` is printed |
| OP01-068 | Gecko Moria | char | **A** | `static`, cond `and(isYourTurn, countCards {hand, you} min 5)`, `affects self`, `grants.keyword doubleAttack` |
| OP01-069 | Caesar Clown | char | **C** | put-into-play **from the whole deck**, a name reference, and a `shuffle` op |
| OP01-070 | Dracule Mihawk | char | **A** | `onPlay`; select 0–1 {field, any, character, costMax 7} → `moveCard {deck}, position 'bottom'` |
| OP01-071 | Jinbe | char | **C** | put-into-play for the `[Trigger]` half. The `[On Play]` half is expressible |
| OP01-072 | Smiley | char | **C** | a scaling grant — "+1000 for every card in your hand". `grants.power` is a constant |
| OP01-073 | Donquixote Doflamingo | char | **C** | `orderCards`, in its top-**or**-bottom form. `[Blocker]` is printed |
| OP01-074 | Bartholomew Kuma | char | **C** | put-into-play **and** a name reference |
| OP01-075 | Pacifista | char | **A** | `[Blocker]` reminder only. Its deckbuilding line belongs to `validateDecklist` — see the deck-construction note |
| OP01-076 | Bellamy | char | vanilla | — |
| OP01-077 | Perona | char | **C** | `orderCards`, top-or-bottom form, and nothing else |
| OP01-078 | Boa Hancock | char | **A** | two abilities (`whenAttacking`, `onBlock`) sharing one script; cond `and(donAttached 1, countCards {hand, you} max 5)` → `draw` |
| OP01-079 | Ms. All Sunday | char | **A** | `onKO`, cond `countCards {field, you, leader, types ['Baroque Works']} min 1`; select 0–1 {trash, you, event} → `moveCard {hand}` |
| OP01-080 | Miss Doublefinger(Zala) | char | **A** | `onKO` → `draw you 1` |
| OP01-081 | Mocha | char | vanilla | — |
| OP01-082 | Monet | char | **C** | put-into-play, and nothing else |
| OP01-083 | Mr.1(Daz.Bonez) | char | **C** | a scaling grant — "+1000 for every 2 Events in your trash". The Leader-type condition is expressible |
| OP01-084 | Mr.2.Bon.Kurei(Bentham) | char | **C** | `orderCards` + "the rest", and nothing else |
| OP01-085 | Mr.3(Galdino) | char | **C** | a prohibition (cannot attack) **and** a duration longer than end of turn |
| OP01-086 | Overheat | event | **A** | `counterEvent`: `addPower +4000 endOfBattle`, then select 0–1 {field, any, character, active, costMax 3} → `moveCard {hand}`. `trigger` likewise |
| OP01-087 | Officer Agents | event | **C** | put-into-play, and nothing else |
| OP01-088 | Desert Spada | event | **C** | `orderCards` on the `[Counter]` half **and** a player-chosen discard on the `[Trigger]` half |
| OP01-089 | Crescent Cutlass | event | **A** | `counterEvent`, cond `countCards {field, you, leader, types}` → select 0–1 {field, any, character, costMax 5} → `moveCard {hand}` |
| OP01-090 | Baroque Works | event | **C** | `orderCards` + "the rest" **and** "other than [Baroque Works]" |
| OP01-091 | King (L) | leader | **C** | a condition on how many DON!! you have on the field. Everything else is a `static` with a selector `affects` |
| OP01-092 | Urashima | char | vanilla | — |
| OP01-093 | Ulti | char | **C** | the DON!! deck, and nothing else. The `restDon 1` cost already exists |
| OP01-094 | Kaido | char | **A** | `onPlay`, `optional`, cost `returnDon 6`; `if countCards {leader, types}` → `ko {selector: {field, any, character, excludeSelf}}` |
| OP01-095 | Kyoshirou | char | **C** | a condition on how many DON!! you have on the field, and nothing else |
| OP01-096 | King | char | **A** | `onPlay`, `optional`, cost `returnDon 2`; two selects, two `ko` |
| OP01-097 | Queen | char | **A** | `onPlay`, `optional`, cost `returnDon 1`; `grantKeyword self rush endOfTurn`, then `addPower −2000 endOfTurn` |
| OP01-098 | Kurozumi Orochi | char | **C** | search the whole deck by name, and `shuffle` |
| OP01-099 | Kurozumi Semimaru | char | **C** | a prohibition (board-wide K.O. immunity) **and** a name reference |
| OP01-100 | Kurozumi Higurashi | char | **A** | `[Blocker]` reminder only. No `Ability` needed |
| OP01-101 | Sasaki | char | **C** | the DON!! deck **and** a player-chosen discard |
| OP01-102 | Jack | char | **C** | a discard the **opponent** chooses. The `returnDon 1` cost already exists |
| OP01-103 | Scratchmen Apoo | char | vanilla | — |
| OP01-104 | Speed | char | **C** | put-into-play, and nothing else |
| OP01-105 | Bao Huang | char | **B** | `reveal` takes a `Selector`; this needs it to take a `Ref` so it can reveal the cards just chosen. See the hidden-information note |
| OP01-106 | Basil Hawkins | char | **C** | the DON!! deck **and** put-into-play |
| OP01-107 | Babanuki | char | vanilla | — |
| OP01-108 | Hitokiri Kamazo | char | **A** | `onKO`, `optional`, cost `returnDon 1`; select 0–1 {field, opponent, character, costMax 5} → `ko` |
| OP01-109 | Who's.Who | char | **C** | a condition on how many DON!! you have on the field, and nothing else |
| OP01-110 | Fukurokuju | char | vanilla | — |
| OP01-111 | Black Maria | char | **A** | `onBlock`, `optional`, cost `returnDon 1` → `addPower self +1000 endOfTurn`. `[Blocker]` is printed |
| OP01-112 | Page One | char | **C** | an attack-legality modifier, with a duration — the same hole as `OP01-021` |
| OP01-113 | Holedem | char | **C** | the DON!! deck, and nothing else |
| OP01-114 | X.Drake | char | **C** | a discard the **opponent** chooses. The `returnDon 1` cost already exists |
| OP01-115 | Elephant's Marchoo | event | **C** | the DON!! deck, and nothing else. The `ko` half is expressible |
| OP01-116 | Artificial Devil Fruit SMILE | event | **C** | put-into-play **from the deck** **and** `orderCards` |
| OP01-117 | Sheep's Horn | event | **A** | `mainEvent`, `optional`, cost `returnDon 1`; select 0–1 {field, opponent, character, costMax 6} → `rest` |
| OP01-118 | Ulti-Mortar | event | **C** | the DON!! deck on the `[Trigger]` half. The `[Counter]` half is expressible |
| OP01-119 | Thunder Bagua | event | **C** | the DON!! deck on both halves. Everything else, `lifeAtMost` included, is expressible |
| OP01-120 | Shanks | char | **C** | a `[Blocker]` prohibition **and** a printed-keyword filter — `ST01-002`'s shape exactly. `[Rush]` is printed |
| OP01-121 | Yamato | char | **D** | name aliasing. See below |

## Ambiguous — pile D

**`OP01-121` Yamato.** *"Also treat this card's name as [Kouzuki Oden] according
to the rules."*

The meaning is not in doubt; where it belongs is. Three readings, and the card
is fully playable under all of them because its `[Double Attack]` and `[Banish]`
are printed keywords the engine already handles:

1. **A registry field.** A card has a set of names, and everything that matches
   on a name matches on the set. Nothing in the engine reads names today, so
   this is inert until gap 5 exists.
2. **A deck-construction rule.** The 4-copy limit is per name, so Yamato shares
   an allowance with `[Kouzuki Oden]` Characters. `validateDecklist` counts
   `cardId`s and cannot say this.
3. **An ability.** It is printed in the effect box, above the keyword reminders,
   which is where abilities go.

I would rather record the three than pick one. The practical consequence is that
Yamato is counted as playable today and will need revisiting the moment name
references are built — at which point the reading chosen changes whether
`OP01-040`, `OP01-042` and `OP01-046` can name it.

`OP01-075` Pacifista is deliberately **not** in this pile even though its text
is also a deckbuilding rule, because there the reading is unambiguous: it is a
construction rule, `validateDecklist` owns it, and it is not an ability under
any reading.

## What the 34 could not see

Six things, and they divide cleanly into three kinds.

**Families the starters sampled once or never.**

- The **DON!! deck** — 8 cards, 5 freed. The starters print zero. PR #11 found
  it by reading past the sample; OP-01 confirms the size was real.
- **Referencing a card by name** — 14 cards, 399 in the full set, the largest
  family in any of this project's tables. The starters print it twice
  (`ST01-014`-adjacent "other than" wordings) and it never rose above a
  footnote.
- **A condition on your own DON!!** — 3 cards, 3 freed, 36 in the full set.
  Absent from the starters entirely. Cheap, and free of dependencies.

**Shapes the starters showed only one face of.**

- **Prohibitions.** The starters printed two blocker bans and one attacker-scoped
  variant, all resolved in `legalActions`. OP-01 prints K.O. immunity in battle
  twice and attack-legality restrictions twice, in two other buildings. The
  starter reading would have designed a mechanism that solved 1 of these 5.
- **`Modifier`'s real shape.** `OP01-021` Franky is a **grant** the DSL cannot
  say, which is the counterexample to "the DSL can only add, never forbid". The
  hole is `Modifier`'s two members, not the direction of the effect.

**Rules, not vocabulary.**

- **Triggers that watch another card.** Three cards, two missing engine sites,
  and both invisible to a marker-shaped search because the text is prose. This
  is the second time the reachability question has paid for itself, and the
  first time it has found something the DSL had no *word* for either.

The starter inventory closed by saying its real limit was that "a 34-card sample
is silent about what it does not contain, and silence reads exactly like
absence". Six rows above are what that silence was hiding. The method's fix is
not a larger sample — it is that a sample sizes what it holds and nothing else,
and that has to be written down every time.

## Recommendation

Derived from the freed column, not from preference.

### First — write pile A. No engine work at all.

35 scripts, and OP-01 goes from **19 playable to 54**. No gap in this document
frees more than 10 cards. Nothing else on any list comes close to that ratio,
and it is the only item here that costs zero engine risk.

It also does what the starters' pile-A pass did: it puts real cards through
paths the ABIL set only simulates. `returnDon` has never run against a printed
card — `OP01-094`, `-096`, `-097`, `-108`, `-111`, `-117`, `-118` are seven
chances to find out whether "DON!! −N" behaves, and the `counterEvent` lesson is
that a path with no real card on it is a path nobody has tested.

Expect one of the 35 not to survive contact. That is the historical rate and it
is the point of writing them.

### Second — put a card into play. 10 cards freed, 379 in the full set.

First on every column, in both sets, with a 43% margin over second. Five of the
eight it frees in OP-01 are the whole text of their card ("[Trigger] Play this
card"), so the marginal cost per card after the first is close to zero.

Price it as the starter inventory said: the play routine, the `[On Play]` that
fires from it, and the full-field trash decision, which drags in the suspension
limit. OP-01 adds playing **from the deck** and playing **rested**, both of
which should be in the first design rather than bolted on.

### Third — a payment the player picks. 7 cards freed, 292 in the full set.

Structural hole #1, and it now blocks seven cards rather than one Leader. The
full-set hand check settles it ahead of `orderCards` on both measures.
`PendingChoice` already carries a `player`, so "your opponent chooses 1 card
from your hand" (`OP01-038`, `-102`, `-114`) is not a separate capability — the
hard part is suspending during payment, which is where `payCosts` says
`TODO phase 2B`.

### Then it flattens, and that is the finding

After those three the freed column reads 6, 5, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 1,
0, 0, 0, 0, 0, 0. There is no fourth item worth a plan.

Two exceptions worth taking out of order because they are nearly free:

- **The two missing rules** (11 cards). One `fireTriggers` call each at a site
  that already exists, plus a union member. They are backlog A, which by this
  project's own rule outranks a same-sized backlog B item — and unlike the
  layered-effects item that A was closed on, these are not expensive.
- **A condition on your own DON!!** (3 cards, 3 freed). One `Condition` member
  reading the cost area, which `costAreaCount` already computes in `costs.ts`.

### On gaps versus multiplayer

The numbers argue for stopping, and here is the argument.

The gap queue does not converge. Twenty-one gaps are listed above; three of them
account for 23 of the 41 freed cards and the remaining eighteen split 18 between
them, six of those freeing nothing at all. Working the queue in order has a
sharp knee after the third item, and past it each gap costs about as much as the
first three and buys one or two cards.

Meanwhile the thing the queue is *for* — a playable game — is already within
reach of the cheapest item on the list. Pile A plus put-into-play plus the two
missing rules puts OP-01 at roughly **75 of 121 cards**, from 19 today, and the
two starter decks at 27 of 34. That is enough card pool that "which cards are
missing" stops being the binding constraint on whether the project is a game.

So: **do pile A, put-into-play, chosen payments and the two missing rules, then
go to multiplayer.** Not because the remaining gaps do not matter, but because
after those four the evidence for *which* gap to build next stops coming from a
table and starts coming from a deck somebody actually wants to play. `OP01-091`
King's whole identity is a DON!!-count condition; `OP01-051` Kid's is four gaps
deep. A ranked list cannot tell you which of those two is worth a week. A player
can.

That is also the honest reading of what this document measured. It ranked 21
gaps and the ranking is only load-bearing for the top three. Building the fourth
through twenty-first in this order would be following a number past the point
where the number means anything.

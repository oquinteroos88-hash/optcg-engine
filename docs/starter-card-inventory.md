# Starter card inventory — the DSL against 34 real cards

An inventory, not an implementation. No `Ability` is written here, no engine or
data file is touched. The question it answers: **how much of the real card text
can the Phase 2A DSL already say?**

The project bet was "if the DSL holds these ~40, it holds 400". This measures
that before the effort is spent.

## Scope and method

Every base card (no `_` suffix) of packs `569001` (ST-01) and `569002` (ST-02),
both Leaders included: **34 cards**. Text taken from `effectText` and
`triggerText` in `packages/cards`.

Each card is read against the DSL as it stands in
`packages/engine/src/abilities/` — `dsl.ts` for the vocabulary, `query.ts` for
what a `Selector` and a `Condition` can actually filter on, `interpreter.ts` for
what each op does, `costs.ts` for what a `Cost` can be, `triggers.ts` for when
things fire, and `selectors.ts` for how `static` abilities are evaluated.

Where a number is quoted for "the whole set", it comes from a text probe over
all 2665 cards in `packages/cards/data/cards.en.json`. Those numbers are
regex counts, not classifications: they size a gap, they do not prove one.

> **Data note.** A card with no printed effect carries `effectText: "-"`, not
> `null` — 317 cards across the full set. Only `triggerText` uses `null` for
> absence. Anything that filters for "has an effect" has to handle both.

## The piles

| Pile | Meaning | Cards |
| --- | --- | --- |
| **vanilla** | No effect text and no trigger text. No `Ability` at all. | 8 |
| **A** | The DSL expresses it as it stands. | 7 |
| **B** | Needs something bounded: one capability the DSL does not have. | 13 |
| **C** | Hits a structural hole. | 5 |
| **D** | Honestly ambiguous — the text does not settle what it means. | 1 |

Two of the seven in pile A (`ST01-006`, `ST02-004`) need **no `Ability` at
all**: their entire text is the `[Blocker]` reminder, and printed keywords are
already a rule in the engine, carried on `CardDefinition.keywords`. So 10 of 34
cards need nothing written, 5 more are expressible as they stand, and **19 of 34
need something the DSL cannot say today**.

That is the headline. The bet does not pay off yet: a bit over half of a
starter deck is out of reach, and one Leader of the two is in pile C.

## Card by card

Vanilla cards are listed for completeness and excluded from the analysis.

| Card | Name | Cat | Pile | Trigger(s) | Note |
| --- | --- | --- | --- | --- | --- |
| ST01-001 | Monkey.D.Luffy | leader | **B** | `activateMain` + `oncePerTurn` | Select 1 own leader/character, give it DON!!. Everything fits except that the DON!! given must be a **rested** one; the op prefers rested and silently falls back to active. |
| ST01-002 | Usopp | char | **C** | `whenAttacking`, `trigger` | Effect is a prohibition ("opponent cannot activate a [Blocker] with 5000+ power"). Trigger needs to **put this card into play** from hand. Two gaps, one structural. |
| ST01-003 | Karoo | char | vanilla | — | |
| ST01-004 | Sanji | char | **B** | `static` | `[DON!! x2]` → gains Rush. Condition and grant both exist; there is no way for a continuous ability to say it **applies to its own source only**. |
| ST01-005 | Jinbe | char | **A** | `whenAttacking` | cond `donAttached 1` → select 0–1 from own field, leader+character, `excludeSelf` → `addPower +1000 endOfTurn`. Fits exactly. |
| ST01-006 | Tony Tony.Chopper | char | **A** | — | Text is only the `[Blocker]` reminder. No `Ability` needed. |
| ST01-007 | Nami | char | **B** | `activateMain` + `oncePerTurn` | Same shape and same single gap as ST01-001: the DON!! has to be a rested one. |
| ST01-008 | Nico Robin | char | vanilla | — | |
| ST01-009 | Nefeltari Vivi | char | vanilla | — | |
| ST01-010 | Franky | char | vanilla | — | |
| ST01-011 | Brook | char | **B** | `onPlay` | "Up to 2" is expressible as two opt-in steps. The gap is again the **rested** DON!! constraint. |
| ST01-012 | Monkey.D.Luffy | char | **C** | `static` (printed Rush) + `whenAttacking` | Rush is a printed keyword, already handled. The ability is a prohibition: "opponent cannot activate [Blocker] during this battle". |
| ST01-013 | Roronoa Zoro | char | **B** | `static` | `[DON!! x1]` → +1000 to itself. Same gap as ST01-004: a continuous ability cannot name its own source. |
| ST01-014 | Guard Point | event | **A** | `counterEvent`, `trigger` | Select 0–1 own leader/character → `addPower`, `endOfBattle` for the Counter, `endOfTurn` for the Trigger. Both fit. |
| ST01-015 | Gum-Gum Jet Pistol | event | **A** | `mainEvent`, `trigger` | Select 0–1 opponent character with `powerMax: 6000` → `ko`. The Trigger says "activate this card's [Main] effect", which is the same instruction list written twice — a data choice, not a DSL gap. |
| ST01-016 | Diable Jambe | event | **C** | `mainEvent`, `trigger` | Main is a prohibition, and the hardest kind: it attaches to a **chosen card** and lasts the turn, conditioned on that card attacking. The Trigger separately needs to filter a selector **by printed keyword** ("[Blocker] Characters"). |
| ST01-017 | Thousand Sunny | stage | **B** | `activateMain` | Body fits (select 0–1 own {Straw Hat Crew} → `addPower endOfTurn`). The cost is "rest this Stage", and **resting the source is not one of the four costs**. |
| ST02-001 | Eustass"Captain"Kid | leader | **C** | `activateMain` + `oncePerTurn` | Cost is `restDon 3` **plus a hand card the player picks**. `discardHand` exists but takes the front of the hand; the interpreter cannot suspend during payment. Structural hole #1, on a Leader. |
| ST02-002 | Vito | char | vanilla | — | |
| ST02-003 | Urouge | char | **B** | `static` | Condition is expressible (`donAttached 1` and `countCards ≥ 3`). Same self-reference gap as ST01-004 and ST01-013. |
| ST02-004 | Capone"Gang"Bege | char | **A** | — | `[Blocker]` reminder only. No `Ability` needed. |
| ST02-005 | Killer | char | **B** | `onPlay`, `trigger` | The `[On Play]` fits exactly (`orientation: 'rested'`, `costMax: 3` → `ko`). The Trigger needs to **put this card into play**. |
| ST02-006 | Koby | char | vanilla | — | |
| ST02-007 | Jewelry Bonney | char | **C** | `activateMain` | Look at 5, take 1 by type, **"place the rest at the bottom in any order"** — the deleted `orderCards`. Also needs the rest-the-source cost, and a way to name "the cards I did *not* take". |
| ST02-008 | Scratchmen Apoo | char | **B** | `whenAttacking` | "Rest up to 1 of your opponent's DON!! cards." DON!! are not cards a selector can reach and no op changes their orientation. |
| ST02-009 | Trafalgar Law | char | **A** | `onPlay` | Select 0–1 own rested character, `types: ['Supernovas','Heart Pirates']`, `costMax: 5` → `setActive`. Fits exactly. |
| ST02-010 | Basil Hawkins | char | **D** | ? | "If this Character battles your opponent's Character, set this card as active." See the ambiguity note below. |
| ST02-011 | Heat | char | vanilla | — | |
| ST02-012 | Bepo | char | vanilla | — | |
| ST02-013 | Eustass"Captain"Kid | char | **A** | `static` (printed Blocker) + `endOfTurn` | Blocker is printed. `endOfTurn` fires for both players' field cards, so "End of **Your** Turn" is `isYourTurn` — which exists. `setActive` on `{self: true}`. Fits. |
| ST02-014 | X.Drake | char | **B** | `static` | Grant and audience both expressible. The condition "if this Character is rested" is not: a condition cannot ask about the **source's own orientation**. |
| ST02-015 | Scalpel | event | **B** | `counterEvent`, `trigger` | The power half fits. Both halves then "set up to N of your DON!! cards as active" — same DON!! gap as ST02-008. |
| ST02-016 | Repel | event | **B** | `counterEvent` | As ST02-015: power fits, the DON!! half does not. |
| ST02-017 | Straw Sword | event | **B** | `mainEvent`, `trigger` | Main fits (`rest` an opponent character). The Trigger needs to **put a card into play from hand**, filtered by type and cost. |

## Gaps, ranked by how many cards need them

This is the central metric. A capability that serves one card is a sign the DSL
is cut wrong; one that serves a family is earned. The right-hand column sizes
the same gap against all 2665 cards, so a starter-set count of 1 can still be
recognised as a family — or confirmed as a genuine one-off.

| # | What the cards need | Cards here | Text probe, full set |
| --- | --- | --- | --- |
| 1 | **Give DON!! that is specifically rested** — and not quietly hand over an active one when no rested DON!! exists | 3 — ST01-001, ST01-007, ST01-011 | 105 |
| 2 | **A continuous ability that applies to its own source** ("this Character gains +1000") | 3 — ST01-004, ST01-013, ST02-003 | 268 (35 of them under a `[DON!! xN]`) |
| 3 | **Change the orientation of DON!! cards**, own or opponent's, by quantity | 3 — ST02-008, ST02-015, ST02-016 | 71 |
| 4 | **Put a card into play** from hand or from a life card | 3 — ST01-002, ST02-005, ST02-017 | 375 |
| 5 | **Stop the opponent from using [Blocker]** — a restriction, not a grant | 3 — ST01-002, ST01-012, ST01-016 | 146 |
| 6 | **Rest the source as the price of an ability** | 2 — ST01-017, ST02-007 | 90 |
| 7 | **Order cards you are putting back** ("the rest to the bottom in any order") | 1 — ST02-007 | 254 |
| 8 | **Let the player choose which card a cost discards** | 1 — ST02-001 | 197 |
| 9 | **A condition about the source's own orientation** ("if this Character is rested") | 1 — ST02-014 | 7 |
| 10 | **Filter a selection by printed keyword** ("[Blocker] Characters") | 1 — ST01-016 | 6 |
| 11 | **Fire on "this card is in a battle", and ask what it is battling** | 1 — ST02-010 | 1 |

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

### 4. The DSL can only add, never forbid — **new**

This is the finding of the inventory.

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

This matters more than it looks: **"up to"** is the single most common
quantifier on these cards. It appears in `ST01-001`, `ST01-005`, `ST01-007`,
`ST01-011`, `ST01-014`, `ST01-015`, `ST01-016`, `ST01-017`, `ST02-005`,
`ST02-007`, `ST02-008`, `ST02-009`, `ST02-015`, `ST02-016`, `ST02-017` — 15 of
the 26 cards that carry any text at all. The first ability written will depend
on it.

**7. Does giving DON!! account for the rested state?** — *the code check*

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

**First — write the seven pile-A cards.** `ST01-005`, `ST01-014`, `ST01-015`,
`ST02-009`, `ST02-013`, and the two keyword-only cards that need nothing. They
need no new capability and they are the proof that the existing machinery
survives contact with real text. Two of them are Events, which exercises
`counterEvent` and `mainEvent` — neither has ever run against a real card.

**Second — put a `min: 0` ability under test before anything else.** 15 of the
26 cards with text say "up to". The path is verified by reading and unexercised
in practice, and it is load-bearing for nearly everything that follows. This is
the cheapest de-risking available: `ST01-005` or `ST01-014` alone covers it.

**Third — the three-way tie of bounded gaps, in this order:**

1. **Self-targeting continuous abilities** (3 cards, 268 in the full set). The
   largest family of the three by a wide margin, and the only one whose fix
   touches an existing seam rather than adding surface: instructions can already
   name their own source, continuous abilities cannot. Fixing the asymmetry
   unlocks `ST01-004`, `ST01-013`, `ST02-003`.
2. **Rested-DON!! giving** (3 cards, 105). Small, and it is a *correctness*
   fix as much as a feature: the op is silently wrong on all three cards today.
   It unlocks both remaining ST-01 `activateMain` cards and Brook.
3. **DON!! orientation changes** (3 cards, 71). Unlocks both ST-02 Counter
   events and Apoo. Worth noting that these three cards do **not** need DON!!
   to become addressable targets — any DON!! of the right orientation is
   interchangeable, so the requirement is about quantities, not identities.
   Deciding that DON!! must become selectable entities on the strength of these
   three cards would be over-building.

At that point **24 of 34 cards are done** — the 15 that need nothing new plus
these 9 — both decks are meaningfully playable, and nothing structural has been
touched.

**Fourth — resting the source as a cost** (2 cards, 90). Small, and it is the
last thing standing between `ST01-017` and playability. Bonney still will not
work; that is a `orderCards` card.

**Fifth — decide the `[Blocker]` prohibitions.** Structural hole #4, 3 cards, 2
of them in ST-01, 146 in the full set. This is the first thing on the list that
needs a design conversation rather than an implementation, and the inventory
now has enough shape to have it: three cards spanning unconditional, predicated,
and attacker-scoped-for-a-turn. Do not design it from `ST01-012` alone — that
is the easy one, and building for it would leave `ST01-016` stranded.

**Sixth — putting cards into play** (3 cards, 375 in the full set). The largest
family in the whole inventory, and the one whose cost is most likely to be
underestimated, because it drags in the full-field decision and therefore the
suspension limit.

**Seventh — suspendable costs** (structural hole #1), driven by `ST02-001`. It
blocks exactly one card here, but that card is a Leader, and a Leader whose
ability never fires is not a deck. Anyone who wants ST-02 whole has to pay this.

**Last — `orderCards` (`ST02-007`) and the Hawkins ruling (`ST02-010`).** One
card each, and both need decisions before code: `orderCards` needs a producing
instruction *and* a way to name "the cards not taken", and Hawkins needs a
ruling before it needs a trigger. 254 cards in the full set want `orderCards`,
so it will be built eventually — but not for Bonney alone, and not before the
things above it that unlock three cards apiece.

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

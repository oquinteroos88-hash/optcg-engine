# @optcg/client

A local, hot-seat React client for `@optcg/engine`. Two players, one browser, no
server and no AI: the client renders the engine's state and submits actions to
it.

```bash
pnpm dev
```

Pick ST-01 against ST-02 on the setup screen and play a real game — mulligan to
game over, abilities included.

## The contract: affordances come from `legalActions`

The client never re-implements a rule. It does not ask whether it is the main
phase, whether a cost can be paid, or whether a Character is summoning-sick. It
asks the engine for the list of legal actions and **indexes it**:

```
legalActions(state, whoActs)  ->  computeAffordances  ->  Affordances
```

`Affordances` is a per-card record of booleans and target lists — `canPlay`,
`canAttack` with `attackTargets`, `canActivate` with `activatableAbilities`, and
so on — plus a handful of global flags. Components read those flags and nothing
else. `store/selectors.ts` and `game/` are the only places allowed to import
engine *values*; `tests/architecture.test.ts` enforces that components and
screens import only types.

The contract is checked in both directions, over a corpus of real games:

- **Forward** (`tests/affordances.forward.test.ts`): every true affordance
  builds an action the engine accepts.
- **Backward** (`tests/affordances.backward.test.ts`): every legal action is
  reachable through some affordance.
- **Coverage** (`tests/actionCoverage.test.ts`): every variant of the engine's
  `Action` union is actually observed in that corpus. Without this third one the
  backward test silently degrades into "every legal action the corpus happens to
  produce" — which is exactly what happened when the corpus was built only from
  the ability-less TEST decks and `PLAY_COUNTER_EVENT` went unnoticed for a
  release.

## The one exception, and why it exists

**`Affordances.pendingChoice` is read from `state.pending`, not from
`legalActions`.** It is the only place in the client that takes legality from
the state, and it is deliberate.

When the engine opens a choice, `legalActions` returns a single `ANSWER_CHOICE`
marker with no answer payload, plus `CONCEDE`. It does not enumerate the valid
answers, because a "select 2 of 7" has 21 valid subsets before ordering and the
space explodes from there — a list nobody can render or search is worse than no
list. So the engine publishes the *shape* of a legal answer as data:
`candidates`, `min`, `max`, `kind`, `prompt`. Every client reads it from there;
the engine's own random bot does the same.

This is the engine's single documented exception to `legalActions` being
exhaustive (engine README, "Choices are data, not enumeration"), and the client
mirrors it in exactly one field of one object so it stays checkable:

- `game/affordances.ts` copies `state.pending` into `ChoiceView`, and nothing
  else in the client opens `state.pending`.
- `global.mustAnswerChoice` — which *is* indexed from the marker — is the gate.
  While it is true, every other affordance is false by construction, because
  `legalActions` returned nothing else to index.
- `tests/choiceShapes.test.ts` measures which choice shapes the engine actually
  opens (`selectCards` and `yesNo`; never `selectOption` or `orderCards`), so
  the two branches the UI has are the two branches it needs.

If you read the contract above and think this file is broken: it is not. This is
the exception, it is one field wide, and it is here.

## UI modes

`game/uiMode.ts` is a pure reducer over clicks. Every non-idle mode carries the
player it was opened for, so a mode cannot survive a change of priority.

| Mode | Entered by | Notes |
| --- | --- | --- |
| `idle` | — | |
| `attacking` | clicking an attacker | then a target |
| `attachingDon` | clicking the DON!! area | then a recipient |
| `choosingTrash` | playing onto a full board | the sixth-Character sacrifice |
| `countering` | clicking a Counter card | then the ally to protect |
| `cardMenu` | clicking an ambiguous card | N options, see below |
| `answeringChoice` | **nothing** | imposed by an open choice |

`cardMenu` was absent in phase 1 for a good reason and is back for a better one.
It was unreachable: `canPlay` only ever described a card in hand and `canAttack`
only one on the field, so no card carried both. `ACTIVATE_ABILITY` broke that —
a Character can attack *and* activate — so the menu returned with a different
shape: N entries derived from affordances by `menuOptions`, not a fixed
Jugar/Atacar pair. A card with two activated abilities offers three entries. A
card that can do exactly one thing still does it on the first click.

`answeringChoice` is the only mode nothing clicks into. `ensureModeValid`
imposes it whenever the engine opens a choice for the player who acts, and it
cannot be dismissed: Escape and a click on the background are both no-ops, and
there is no cancel button, because an open choice has no legal alternative.
Cardinality is enforced in the reducer rather than only in a disabled attribute,
so a confirm outside `[min, max]` never becomes an action. `min: 0` confirms an
empty selection — "up to N" is printed on 15 of the 26 starter cards with text,
so that is the common case, not a corner one.

**The player answering is not always the player whose turn it is.** Priority
follows `pending.player`, so a life card's `[Trigger]` is answered by the damaged
player, mid-battle, on the opponent's turn. The overlay, the mode's ownership
stamp and the banner all follow `pending.player`.

## Animations and choices

Input is blocked while the animation queue drains, and the choice overlay stays
hidden until it is empty. The ordering is deliberate: the board finishes showing
what happened, *then* the player is asked to decide about it. Deciding on top of
a board that has not caught up means answering a question about a state you
cannot see.

This cannot bury a choice. `AnimationDriver` runs unconditionally, every group
has a finite duration, and `tests/fullGame.test.ts` fails outright if a queue
does not drain.

## What the log cannot tell you

Two things the engine correctly does not say, both derived on the client instead:

**Why a Character shows +1000.** Continuous (`static`) abilities emit no events
— the engine reads them at lookup time and writes nothing to the state — so no
log line will ever explain one. The client derives it: `getPower -
getPowerWithoutStatics` is exactly the continuous contribution, by the engine's
own definition, and the tile shows it as a badge with a breakdown in its
tooltip. Attribution is separate and weaker: a `static` whose `affects` is
`{self: true}` names its own card exactly; a selector-based one would need the
engine's internal `resolveSelector`, so it is left unnamed rather than guessed
at. Every static in ST-01/ST-02 is self-targeting today, which
`tests/continuousBadge.test.ts` pins.

**An ability that resolved into nothing.** An "up to 1" answered with nothing
emits `abilityTriggered` and then silence, which on the board is
indistinguishable from a bug. The log marks it — "sin efecto" — once the engine
has nothing left in flight.

## Card text

`EnglishCardDefinition` carries `effectText` and `triggerText`; the engine's own
`CardDefinition` does not, deliberately. The client reads them through
`@optcg/cards/starters`, a browser-safe entry: the package's main entry loads
1.5 MB of JSON with `node:fs`, which is right on Node and unavailable in a
bundle. The TEST decks print no text and show none.

## Card art

Optional, and a local cache: `pnpm --filter @optcg/cards run images` downloads
the 34 starter cards into `public/cards/`, which is gitignored. Nothing is ever
committed, and a clone without it is the normal case.

`CardTile` draws the art as a layer **underneath** everything else. That is the
whole design constraint, and the reason is that none of what the player has to
read is printed on the card: the power is effective rather than printed, and the
DON!! count, the rested rotation, the continuous badge and the affordance
highlight are all board state. So the art goes at `z-index: 0` with
`pointer-events: none`, `inset: 0` keeps it off the border and box-shadow that
carry the highlight, and the two rows with numbers get a scrim once a picture
really loaded.

The fallback is not an error path: `onError` drops back to the CSS tile this
component has always drawn, and `tests/cardArt.test.tsx` asserts that the tile
after a failed image is the tile from before there was ever an art layer.

The printed text stays in the tooltip. At 56-92 px there is no reading effect
text off a picture.

## Running the suites

```bash
pnpm --filter @optcg/client test
```

Most of it runs in `node`, because affordances, `reduceUiMode` and the store are
pure. Two suites opt into jsdom with a per-file pragma:
`tests/clickRouting.test.tsx` and `tests/choiceRouting.test.tsx`. They exist for
the things a pure test cannot see — which element fires which event, and whether
rendering is stable at all. The second one was written after a selector that
built a fresh object per store read sent React into an infinite re-render, with
every pure test in the repo still green.

`tests/fullGame.test.ts` plays a whole game using nothing the UI does not offer,
and fails if `dispatch` ever logs `UI bug: illegal action`.

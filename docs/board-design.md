# The board

How the official Bandai playsheet becomes a CSS grid, what the client does with
assets it is not allowed to redistribute, and what was decided where the printed
sheet has nothing to say.

Everything here is presentation over a `PlayerView`. The engine, the server and
the protocol know nothing about any of it — no layout decision below can change
what a player is allowed to see, because the view has already decided that.

## The sheet, as named areas

Nine zones, named the way the mat names them: `life`, `character`, `leader`,
`stage`, `deck`, `don`, `cost`, `trash`, `phases`. They live in
`packages/client/src/components/SideBoard.module.css`, and the file is the
authority — the templates below are copies of it, and
`packages/client/tests/boardLayout.test.tsx` reads the real thing.

### Your half, landscape

```
'life character character character character character'
'life phases    leader    stage     deck      deck'
'life don       cost      cost      cost      trash'
```

Life is the column against your left edge. The Character Area is the wide row
along the edge nearest the opponent, so it lands against the centre line. Then
Leader / Stage / Deck, then the DON!! deck / Cost Area / Trash row on the edge
nearest you. `phases` is the free space the printed sheet fills with the phase
track.

### The opponent's half, landscape

```
'trash     cost      cost      cost      don       life'
'deck      deck      stage     leader    phases    life'
'character character character character character life'
```

The same nine areas, placed for the seat across the table: rows reversed so
**that** half's Character Area also lands against the centre line, columns
reversed so its Life hugs the far edge — your right, which is their left.

**Nothing is rotated.** An earlier layout mirrored this half with
`transform: rotate(180deg)`, which bought the row order and made every label on
that half unreadable. The mirror is a second template: a placement, not a
transform. Every accessible name, and every test that walks one, is identical on
both halves.

### The table

Three grid rows — opponent, centre line, viewer — with the line as a **track**
rather than a margin, so the two Character Areas are placed against it instead
of ending up next to a divider drawn wherever the flow left room.

The two halves share the space equally (`1fr` each), floored at `min-content`.
An earlier `auto` / `1fr` split starved the bottom half, which is the half the
player is sitting at; the floor means a window too short for two mats scrolls
rather than letting the top one bleed across the line.

### Portrait

Two more templates over the same nine areas. No second component, same markup,
same accessible names.

The far half condenses:

```
'life      deck   don       cost      trash'
'leader    stage  character character character'
```

Its Character Area and Leader survive at a smaller scale — that is where the
game is read from — and its piles become counters. That loses nothing: the view
publishes a number for each of them and nothing else, so the picture was only
ever a picture of a number. `phases` is absent, because one phase track is
enough on a phone and the one to drop is the one no screen reader was being told
about.

Your half keeps the sheet:

```
'life   character character character'
'life   leader    stage     deck'
'life   don       cost      trash'
'phases phases    phases    phases'
```

The switch is `game/layout.ts`, which asks `matchMedia` for
`(orientation: portrait) and (max-width: 820px)`. The query is evaluated in JS
rather than in the stylesheet because condensing is not only a different
template — the piles stop being piles — so one place asks and the class and the
markup can never disagree about which sheet is on screen. It subscribes, so
rotating the device redraws.

Portrait also reshapes the **screen**, not just the mat: the two constant-width
rails cost 320 of a 375px phone and left the table sixty pixels of it. The board
takes the width, the log becomes a peek beneath it, and the preview rail goes
entirely — it exists to answer a hover, and a touch screen has no hover to
answer. The battle panel it shared a rail with stays, because a Block Step is
not a hover.

## Geometry

`--card-w` is the one dimension; `--card-h` derives from it by the printed
63:88 ratio. Two independent `clamp()`s used to set both, which meant that at
most viewport widths the tile was whatever the two curves happened to agree on.

`--slot` is the square a card sits in, with the card's **long edge** as its
side. Upright, the card leaves `(--card-h - --card-w) / 2` of slack left and
right; rotated 90° for rested, the same slack above and below. The footprint is
identical either way, which is what makes "rested is a rotation, not a badge"
free: resting a Character moves neither its neighbour nor the row.

Piles never rotate and keep `--pile-w`, so the mat does not pay for that slack
six times over.

**Attached DON!!** live in exactly that slack: absolutely positioned inside the
slot, behind the tile, fanned out from under its left edge and clipped by the
cell, so they can never reach the zone next door. Four are drawn at most — past
that the fan says less than the tile's own `DON ×n` badge, and thirty slivers
would say nothing. Leader and Characters only; a Stage cannot be given DON!!.

## Assets

**No official artwork is committed, ever.** The card art, the two card backs and
the themed playmats belong to Bandai and this repository redistributes none of
them. `.gitignore` refuses every raster format repository-wide and
`packages/cards/tests/noTrackedArt.test.ts` fails if one reaches the index.

### What ships

- **The card back**: `src/components/CardBackArt.tsx`, an inline SVG of our own
  design. A component rather than a file, because every raster extension is
  ignored and an imported `.svg` would need Vite's asset pipeline, which the
  client's vitest config does not load.
- **The neutral playmat**: a gradient wash and a faint grid in
  `SideBoard.module.css`. Drawn, not shipped. Zero bytes.

A clone with no local archive plays the whole game on these.

### What the local archive may add

Under the directory card art already uses — `OPTCG_CARD_ART_DIR`, then
`packages/cards/card-art.local.json`, then `packages/cards/card-art/`:

```
<archive>/Back/CardBackRegular.png
<archive>/Back/DonBack.png
<archive>/playmats/*.png
```

`pnpm --filter @optcg/cards run art` publishes them into
`packages/client/public/cards/` (gitignored), alongside the card images.

Mats are **discovered, not listed**: a `.png` in `playmats/` is a mat, its stem
is its id, and the stem made readable is its name. There is no allowlist to add
a name to — the same discipline as deriving a card's image path from its card
id.

### How the client finds out

It cannot list a directory: Vite serves `public/` verbatim with no index, and
probing filenames would put back exactly the hardcoded list the folder scan
avoids. So the script that publishes the files also writes
`public/cards/manifest.json` naming what it placed, and that is the only thing
the client reads.

```json
{
  "version": 1,
  "cardBack": "CardBackRegular.png",
  "donBack": "DonBack.png",
  "playmats": [{ "id": "east_blue", "file": "playmats/east_blue.png", "name": "East Blue" }]
}
```

`src/game/assets.ts` reads it once and **never rejects**: no `fetch`, a 404, a
body that is not JSON, a body that is JSON but not a manifest — all of them mean
this machine has no local assets, which is the state every clone starts in. The
read starts at `NO_ASSETS`, so the first paint is always the fallback and
official art is an upgrade rather than a hole waiting to be filled.

### How the two layer

The fallback is **structural, not conditional**. The SVG back is always in the
DOM; the official one is a `background-image` over it, declared once on the game
screen. A file that is not there is a declaration that does not paint — which is
why there is no error state, no `onError`, and no broken-image box. The DON!!
art already worked this way and this follows it.

The back appears wherever the game calls for a face-down card: the deck, the
DON!! deck, the Life column, a hand the view publishes as a count, and the blind
candidates of a choice (CR 8-4-4-2).

### Playmats are local and cosmetic

Per seat, stored under `optcg.playmat.p1` / `.p2`, and **never on the wire** —
not in the protocol, not in an `Action`, not in the state, not to the server.
The same rule the locale follows, for the same reason. Two seats can play on two
different mats and the game does not know.

The picker renders nothing when the manifest names no mats: one option is not a
choice. A stored id whose file has since left the archive falls back to the
neutral mat in silence, on the same grounds as a missing card image.

## Where the sheet does not answer

- **Screens under about 340px.** Five Character slots cannot fit at any size
  that is still a card, and the printed mat has nothing to say about a phone.
  The Character Area alone scrolls horizontally; never the mat, because a mat
  that scrolls has stopped being a mat. This is the one place the layout
  degrades instead of reflowing.
- **An empty Stage.** The mat prints the box whether or not a card is in it. The
  dashed placeholder is ours, not the sheet's, and it keeps the grid still.
- **The phase track in portrait.** The free centre-left space does not exist at
  375px, so it becomes a full-width strip under your Cost Area row. Folding it
  into the Banner was rejected: that would put a per-turn structure inside a
  per-moment one.
- **Two mats, one phase.** Both sheets print a track and both draw one. Only the
  viewer's is in the accessibility tree — the phase is a single global fact and
  a screen reader is told it once.
- **A phase indicator that cannot move.** `reducer/startTurn.ts` runs Refresh,
  Draw and DON!! inside one step and `invariants.ts` asserts that every resting
  playing state is in `main`, so the wire's phase is always Main while anyone is
  looking. The five boxes are the printed sheet, faithfully, with Main lit; the
  lit box also carries the moment the client *can* distinguish — Mulligan, Block
  Step, Counter Step. Signage plus the part that moves, without inventing a
  phase the engine does not have.

## A note on the test suite

The board's suites all live in `packages/client/tests/boardLayout.test.tsx`, and
that is deliberate. Every `.tsx` suite spins up its own jsdom worker, and those
workers share CPUs with `fullGame.test.ts`, whose budget is Vitest's default
five seconds and whose heaviest test spends about that on its own. Measured on a
sixteen-core machine: this package at 26 test files passes every run, at 27 it
fails about half of them — and the variable is the **file count**, not the test
count, since 26 files carrying thirty-one more tests than before stayed green
across every run.

The budget is not the thing to move. The file count is.

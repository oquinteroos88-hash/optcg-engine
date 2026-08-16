# @optcg/cards

The real One Piece Card Game cards, normalized for `@optcg/engine`, plus the two
starter decklists.

```ts
import { registerEnglishCards, ST01_DECK, ST02_DECK, toEngineDecklist } from '@optcg/cards';

registerEnglishCards(); // publishes the set through the engine's registry

createGame({
  seed: 1,
  decks: { p1: toEngineDecklist(ST01_DECK), p2: toEngineDecklist(ST02_DECK) },
  firstPlayer: 'p1',
});
```

## What is here, and what is not

This package ships **data**: id, name, category, colors, cost, Life, power,
Counter, attributes, types, printed keywords, and the effect and trigger text as
raw strings.

It also ships **abilities**, for the cards that have them. `effectText` is text,
not behaviour — nothing is derived from it. The scripts live in
`src/abilities.ts`, keyed by card id, written by hand in the engine's DSL and
attached to the matching definitions as they load. Every other card plays as
vanilla.

**15 of the 34 base cards of ST-01 and ST-02 are scripted today**, and two more
(`ST01-006`, `ST02-004`) need no script at all: their whole printed text is the
`[Blocker]` reminder, which the engine already applies from
`CardDefinition.keywords`. Together with the 8 vanilla cards, 25 of the 34 play
their printed text. `docs/starter-card-inventory.md` tracks the remaining 9 and
what blocks each.

## Two entries: Node and browser

The snippet above is the main entry, and it reads `data/cards.en.json` from disk
with `node:fs` — the right call for 1.5 MB of data, and unavailable in a browser
bundle. `@optcg/cards/starters` serves the ST-01 and ST-02 cards from a
generated module instead, with no Node builtin anywhere in its import graph:

```ts
import { registerStarterCards, starterDecklists, toEngineDecklist } from '@optcg/cards/starters';
```

`src/starters.generated.ts` is not a second source of truth.
`scripts/gen-starters.ts` cuts it from the same JSON, and
`tests/starters.test.ts` pins the card set, every printed field, both decklists
and the attached abilities against the main entry — so a stale regeneration is a
failing test, not a silent divergence. Regenerate with:

```bash
pnpm --filter @optcg/cards run build
pnpm --filter @optcg/cards run gen:starters
```

The same module carries `STARTER_TEXT_ES`, the Spanish text for those 34 cards,
for the same reason and cut from the same script.

## Spanish card text

`data/cards.es.json` holds a translated `effectText` and `triggerText` for each
of the **155 cards of OP-01, ST-01 and ST-02** — the two sets this project has
scripted end to end. Read it through the main entry:

```ts
import { findSpanishText, SPANISH_SOURCE } from '@optcg/cards';
```

**It is presentation and cannot be anything else.** No ability script, no
`CardFilter.names`, no `hasName` call and no test of the engine reads a word of
it: the scripts were derived from the English `effectText` and match English
strings, so translating a card cannot change what the card does. It is a
separate lookup rather than a field on `EnglishCardDefinition` for exactly that
reason — the engine reads that type, and a translated string that could reach a
rules decision is the thing this layout exists to prevent.

Names are **not** translated: not card names, not the `{Type}` names, not the
`＜Attribute＞` names. The art prints them in English and so does the client.

The file declares the punk-records commit its English was translated from — the
same pin `data/PROVENANCE.md` keeps for `cards.en.json`. Re-ingesting the
English at a newer commit is a change every entry has to be re-checked against,
and the recorded revision is what makes that checkable rather than remembered.

The term table is [`docs/i18n-glossary.md`](../../docs/i18n-glossary.md), and it
is binding: one Spanish term per mechanic, across all 155 cards and the client's
own copy. `tests/spanish.test.ts` fails on a missing card, on an entry naming a
card that does not exist, on a dropped `<br>` or `[Trigger]`, and on a `{Type}`
or `＜Attribute＞` the translation altered.

This translation is unofficial and fan-made; there is no Spanish printing of the
One Piece Card Game.

## Card art: copied from a local archive, never committed

This package ships no images and never will. What it has is a script that
publishes the 34 starter cards' art out of a **local archive** into the
directory the client serves:

```bash
pnpm --filter @optcg/cards run art
```

### Where the archive is

The archive is laid out by set, with two files per card:

```
<archive>/ST01/ST01-004.png          480x671, ~167 KB   -> preview panel
<archive>/ST01/ST01-004_small.jpg    120x167, ~6 KB     -> board tiles
<archive>/Don/Don.png                480x670            -> the DON!! zones
```

It is hundreds of megabytes of artwork that belongs to its owners, so its
location is a per-machine setting rather than a constant. Three ways to say
where it is, first one wins:

1. `OPTCG_CARD_ART_DIR` in the environment.
2. `packages/cards/card-art.local.json` — `{ "dir": "D:/wherever" }`. Gitignored.
3. `packages/cards/card-art/`, the default. Also gitignored.

**There is no mapping table.** The filename is the card id and the folder is the
id's own prefix, so `ST01-004` is `ST01/ST01-004.png`. Nothing in this
repository stores an image address, and `CardDefinition` gains no presentation
field.

### What the script does

Copies both sizes for the 34 cards, plus the DON!! art, into
`packages/client/public/cards/`, which Vite serves verbatim at `/cards/`. It is
idempotent — a file already there with the right size is skipped — and it
reports how many it placed, how many it skipped, and **which cards the archive
does not have**. That last list is the point: a missing card is a hole a player
finds mid-game, and it should be named here first.

It tries a symbolic link and falls back to copying. On Windows a symlink needs
Developer Mode or an elevated shell and fails with `EPERM` otherwise, which is a
setting of the machine and not a failure of this script; 69 files of 6 KB and
190 KB are not worth telling anyone to change their Windows settings over.

### None of it is committed

Source and destination are both gitignored, and `tests/noTrackedArt.test.ts`
fails if any image file anywhere reaches the git index — the root README's
promise not to redistribute artwork is checked, not assumed.

**A machine with no archive is a normal machine.** The script says so and exits
without failing, and the client falls back to the text tiles it has always
drawn. Deleting the destination is a supported thing to do.

## Nothing here touches the network

`data/cards.en.json` is committed and is the only thing read at runtime.
`scripts/ingest.ts` is the sole thing here that ever touches the network, it is
run by hand, and it is never part of build, test or CI (`scripts/card-art.ts`
reads a local directory and makes no requests at all):

```bash
pnpm --filter @optcg/cards ingest
```

It re-downloads the pinned upstream dataset, re-normalizes it, and rewrites
`data/cards.en.json`, `data/source-index.en.json` and `data/PROVENANCE.md`.
Read `data/PROVENANCE.md` for the source commit, the normalization rules, and
the list of places where the upstream scrape looks unreliable.

## Decklists

`data/decklists/*.json` hold the printed multiplicities (`4x ST01-002`), because
that is the form a human can check against the box. They are transcribed by
hand — the upstream dataset has the product catalogue but not the quantities —
and validated against the deckbuilding rules on import: exactly 50 cards, at
most 4 copies of an id, every id in the set, every card sharing a color with the
Leader. A list that does not validate throws; it is never padded or trimmed to
fit.

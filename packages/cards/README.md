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

## Card art: a local cache, never committed

This package ships no images and never will. It knows *where* the art of the 34
starter cards lives — `STARTER_IMAGE_URLS`, generated from the same pinned
upstream commit as the rest of the data — and it has a script that fetches it
into a gitignored directory the client serves:

```bash
pnpm --filter @optcg/cards run images
```

Destination: `packages/client/public/cards/`, which Vite serves verbatim at
`/cards/<id>.png`. It is in `.gitignore`, and
`tests/noTrackedArt.test.ts` fails if any image file anywhere enters the git
index — the root README's promise not to redistribute artwork was, until that
test, a claim nobody checked.

The script is idempotent: a file already on disk is skipped, not re-fetched. It
reports how many it downloaded, how many it skipped and which ones failed, and
a failure is reported rather than thrown, because a partial cache is a usable
cache. **A clone with no images at all is the normal case** — `CardTile` falls
back to the text tile it has always drawn, and nothing in the client treats that
as an error.

The 34 files come to about 6.5 MB, roughly 190 KB each at 600x838. They are
stored exactly as downloaded: no resizing, no WebP, no `sharp`. The tiles render
at 56-92 px and the browser downscales, which costs nothing worth a native
dependency and a `pnpm approve-builds` step to install it.

The addresses are regenerated, rarely, with:

```bash
pnpm --filter @optcg/cards run build
pnpm --filter @optcg/cards run gen:starter-images
```

They are read from the dataset rather than templated from the card id: the real
record carries a version query (`ST01-001.png?260731`) and nothing here knows
whether it is optional.

## Nothing here touches the network

`data/cards.en.json` is committed and is the only thing read at runtime. The
three scripts are the exceptions — `scripts/ingest.ts`,
`scripts/gen-starter-images.ts` and `scripts/download-card-images.ts`. All three
are run by hand and none is ever part of build, test or CI:

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

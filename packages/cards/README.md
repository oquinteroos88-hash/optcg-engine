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

## Nothing here touches the network

`data/cards.en.json` is committed and is the only thing read at runtime.
`scripts/ingest.ts` is the sole exception, it is run by hand, and it is never
part of build or test:

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

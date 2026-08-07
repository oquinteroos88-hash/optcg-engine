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

**14 of the 34 base cards of ST-01 and ST-02 are scripted today**, and two more
(`ST01-006`, `ST02-004`) need no script at all: their whole printed text is the
`[Blocker]` reminder, which the engine already applies from
`CardDefinition.keywords`. Together with the 8 vanilla cards, 24 of the 34 play
their printed text. `docs/starter-card-inventory.md` tracks the remaining 10 and
what blocks each.

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

# optcg-engine

A deterministic, fully serializable rules engine for the One Piece Card Game,
plus a card dataset and a local web client to play against it.

## Both sets are complete

**Every card in ST-01, ST-02 and OP-01 works — 34 of 34 and 121 of 121, 155
cards in all.** As of 14 August 2026 this is the first moment in the project
when the sentence "all the cards in both sets function" is literally true rather
than approximately so: not one of the 155 is a keyword the engine merely honours
by accident, and not one is a printed line it silently ignores. Every card either
carries a script, prints nothing but a keyword the engine applies from
`CardDefinition.keywords`, or prints no text at all — and the guards that say so
are `packages/cards/tests/schema.test.ts` and
`packages/cards/tests/startersComplete.test.ts`, which fail if the count ever
moves back down.

Both sets closed the same way and both left the same kind of record:
[`docs/starter-card-inventory.md`](docs/starter-card-inventory.md) and
[`docs/op01-inventory.md`](docs/op01-inventory.md) are the card-by-card maps,
and [`docs/op01-closing-census.md`](docs/op01-closing-census.md) is the census
that counted what was left and, in its last appendix, reversed the four rows it
had declared — with the date and the reason, rather than by editing the tables
that made them.

## Packages

| Package | What it is |
| --- | --- |
| [`@optcg/engine`](packages/engine/README.md) | The rules core: a pure reducer, no UI, no I/O. `packages/engine/SPEC.md` is the binding contract. |
| [`@optcg/cards`](packages/cards/README.md) | Normalized card data and the abilities that bind it to the engine. |
| [`@optcg/client`](packages/client/README.md) | A React client for playing a local hot-seat game, ST-01 against ST-02. |

## Quick start

```bash
pnpm install
```

```bash
pnpm test
```

`build`, `typecheck` and `test` are recursive: pnpm walks the workspace in
dependency order, so the engine is compiled before the packages that import its
`dist`. `test` runs with `--no-bail`, so all three packages report even when one
of them fails.

```bash
pnpm dev
```

## Scope and ownership

This is a non-commercial fan project, not affiliated with or endorsed by Bandai,
Shueisha, or Toei Animation.

The MIT license in [`LICENSE`](LICENSE) covers **the code in this repository**
and nothing else. The One Piece Card Game itself — its cards, its card text, and
its artwork — is the property of its respective owners and is not licensed here.

The card data under `packages/cards/data/` is derived from a public dataset
generated from the official card site; the source commit is pinned in
[`packages/cards/data/PROVENANCE.md`](packages/cards/data/PROVENANCE.md).

**No card images are redistributed.** This repository contains none, and
`packages/cards/tests/noTrackedArt.test.ts` fails if one is ever committed. The
client can show real card art, but only from a **local archive you supply
yourself**, copied into a gitignored directory:

```bash
pnpm --filter @optcg/cards run art
```

See [`packages/cards/README.md`](packages/cards/README.md) for where that
archive is expected and how to point at your own copy.

Without it the client draws its own tiles, which is what a fresh clone does and
what every screenshot of this project should be assumed to show.

# optcg-engine

A deterministic, fully serializable rules engine for the One Piece Card Game,
plus a card dataset and a local web client to play against it.

## Packages

| Package | What it is |
| --- | --- |
| [`@optcg/engine`](packages/engine/README.md) | The rules core: a pure reducer, no UI, no I/O. `packages/engine/SPEC.md` is the binding contract. |
| [`@optcg/cards`](packages/cards/README.md) | Normalized card data and the abilities that bind it to the engine. |
| `@optcg/client` | A React client for playing a local game against the engine. |

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
[`packages/cards/data/PROVENANCE.md`](packages/cards/data/PROVENANCE.md). No card
images are redistributed — the client draws its own placeholder tiles instead of
using card art.

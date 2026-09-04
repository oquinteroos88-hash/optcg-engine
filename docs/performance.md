# Performance

What the engine and the server cost per action, what a match weighs at rest
and on the wire, and what the client ships — measured, so that every number a
limit or a budget is set from has a table it came out of. The rule this
document lives by: **nothing is optimized that was not measured first, and
"it did not need it" is a valid result.**

The harness is `packages/server/bench/`: `measure.ts` holds the measurements
as functions, `run.ts` prints them as the tables below, and
`packages/server/tests/budgets.test.ts` asserts on the same functions, so the
number in this document and the number in the test come from one code path.
It lives outside `src/` because it takes the engine apart to time the pieces,
which is exactly what `tests/imports.test.ts` denies the server itself.

## Running it

```
pnpm run build                                  # the client bundle is weighed from dist/
pnpm --filter @optcg/server run bench           # everything, ~2 minutes
pnpm --filter @optcg/server run bench -- --no-heap --no-bundle   # the fast part
```

`--no-heap` skips holding 256 finished matches on the heap (the slow part),
`--no-bundle` skips the client, `--heap-n=<n>` holds a different number.
Every measurement is deterministic — fixed seeds, the shared test policy,
replayed action logs — so two runs differ only by the clock. Timings are
`process.hrtime.bigint()` after a full warmup replay, and only `applyAction`
is inside the clock when the table says `applyAction`: the policy that
decided the actions ran earlier, when the log was recorded.

The bundle breakdown is a second build (`packages/client/scripts/
bundleBreakdown.mjs`) with every module routed into a chunk named for where
it came from; it writes to a temp directory and never touches `dist/`.

## Baseline

Taken before any change in this pass, at the branch base.

|  |  |
| --- | --- |
| Date | 2026-09-04 |
| Commit | d1aa2a5 |
| Node | v24.17.0 |
| CPU | AMD Ryzen 7 3700X 8-Core Processor × 16 |
| Platform | win32 x64 |
| Ability seeds | 1–12 (`ABIL_DECK` both sides, 3,781 actions) |
| Vanilla seeds | 1–4 (`RED_DECK` vs `GREEN_DECK`, 704 actions) |

### `applyAction` alone (µs per action)

|  | actions | mean | p50 | p95 | max |
| --- | --- | --- | --- | --- | --- |
| abilities 1–12 pooled | 3781 | 210.9 | 142.5 | 792.1 | 3884.9 |
| vanilla 1–4 pooled | 704 | 174.0 | 107.2 | 784.3 | 915.5 |

The engine README's historical figure is 244µs; the mean here is that number
on a different machine. The p95 is the interesting one: **it is the same
~790µs on every seed, vanilla included**, which says it is a kind of action
rather than a tail, and the table by type names it.

### `applyAction` by action type, ability seeds 1–12 (µs)

| type | actions | mean | p50 | p95 | max | share of time |
| --- | --- | --- | --- | --- | --- | --- |
| END_TURN | 285 | 815.3 | 802.9 | 972.1 | 2734.6 | 29.1% |
| ANSWER_CHOICE | 227 | 342.9 | 370.3 | 518.1 | 785.9 | 9.8% |
| DECLARE_BLOCK | 5 | 288.8 | 198.4 | 743.6 | 743.6 | 0.2% |
| ACTIVATE_ABILITY | 375 | 278.1 | 262.7 | 415.2 | 588.3 | 13.1% |
| PLAY_CARD | 211 | 267.8 | 214.8 | 710.3 | 882.6 | 7.1% |
| MULLIGAN | 24 | 169.5 | 176.5 | 304.1 | 305.8 | 0.5% |
| ATTACH_DON | 542 | 157.7 | 152.0 | 221.7 | 1885.7 | 10.7% |
| PLAY_COUNTER | 371 | 149.4 | 140.6 | 230.1 | 306.2 | 7.0% |
| DECLARE_ATTACK | 582 | 116.0 | 112.4 | 157.0 | 535.5 | 8.5% |
| PASS | 1159 | 97.1 | 70.1 | 291.7 | 3884.9 | 14.1% |

One action in thirteen is an END_TURN and it costs five times the median,
which makes it 29% of everything `applyAction` does over a game. A CPU
profile of END_TURN alone puts immer's `finalizeProperty` at 29% of self
time, `arrayTraps.set` at 11% and `shallowCopy` at 5%, against 9% for
`finishTurn` and 5% for `startTurn` — the reducers' own work is a fifth of
the action; the rest is the draft machinery. The cost does not grow with the
game (END_TURN is 702µs in the first hundred actions of the longest game and
784µs in the last hundred), so it is not the log: it is a fixed sweep over
every card instance.

### Per accepted action, ability seeds 1–12 pooled (µs)

|  | samples | mean | p50 | p95 | max |
| --- | --- | --- | --- | --- | --- |
| `applyAction` (per action) | 3781 | 218.2 | 152.1 | 802.4 | 5196.9 |
| `playerView` (per seat) | 7562 | 86.3 | 81.6 | 142.2 | 2404.5 |
| `legalActions` (per seat) | 7562 | 2.15 | 0.30 | 9.60 | 55.6 |
| redaction fold (per seat) | 7562 | 1.12 | 0.90 | 2.30 | 115.7 |
| `JSON.stringify(update)` (per seat) | 7562 | 42.8 | 37.9 | 61.9 | 5012.9 |
| `handleAction`, whole (per action) | 3781 | 394.2 | 328.8 | 952.4 | 6118.9 |
| overhead above `applyAction` (mean) |  | 176.0 |  |  |  |

Emissions whose view was byte-identical to the seat's previous one: **0 of
7,562**.

The server's 176µs above the engine is two `playerView`s (2 × 86µs) and
nothing else worth a row: `legalActions`, the redaction fold and the
per-action copies of `journal` and `actions` together are under 7µs. The
transport's stringify is another 2 × 43µs on top of `handleAction`, so an
accepted action costs about 480µs end to end on this machine — at one action
a second per match, 256 matches are twelve percent of one core.

### Wire: `update` bytes per seat-emission, ability seeds 1–12

|  | mean | p95 | max |
| --- | --- | --- | --- |
| `update` (KiB) | 11.2 | 19.0 | 25.0 |
| bytes sent per seat per game (KiB) | 3521.0 | 5690.9 | 5749.5 |
| `joined` at game end (KiB) | 50.2 | 70.5 | 70.5 |

The protocol document's 10.8KB average update after PR #45 is this 11.2 KiB,
measured with the real event batches.

### A match at rest, serialized (KiB, mean over ability seeds 1–12)

| part | mean | max |
| --- | --- | --- |
| whole `MatchState` | 139.0 | 195.2 |
| `game` (with its log) | 52.8 | 68.4 |
| `game.log` alone | 33.2 | 48.6 |
| `actions` | 18.2 | 27.8 |
| `seats.p1.journal` | 33.5 | 48.8 |
| `seats.p2.journal` | 33.2 | 49.0 |

### Heap: 256 finished matches held at once

|  |  |
| --- | --- |
| matches held | 256 (ability decks, seeds 1–256) |
| mean actions per match | 283 |
| heapUsed before (MiB) | 15.6 |
| heapUsed after (MiB) | 71.7 |
| delta (MiB) | 56.1 |
| per match (KiB) | 224.4 |
| mean serialized footprint (KiB) | 125.7 |

### Growth over the longest game

Longest of seeds 1–48 with the ability decks: seed 34, 510 actions,
finished (the sweep's longest, seed 6, is 473; no seed in the scan reaches
the driver's 1,500 cap).

| at action | `game` (KiB) | `game` without log (KiB) | `actions` (KiB) | `journal` p1 (KiB) |
| --- | --- | --- | --- | --- |
| 50 | 23.8 | 19.0 | 2.7 | 4.7 |
| 100 | 28.1 | 19.3 | 5.3 | 8.9 |
| 200 | 39.3 | 19.6 | 11.4 | 19.3 |
| 510 | 68.5 | 19.8 | 28.4 | 48.9 |

Board state (`game` without its log) at the end over at action 50: **×1.04**.
The three histories — `game.log`, `actions`, the journals — grow linearly,
by design and each with its reason in `session.ts`; the board does not.

### Client bundle: `packages/client/dist/assets`

| file | raw (KiB) | gzip (KiB) |
| --- | --- | --- |
| index-Cj8td3ra.js | 360.2 | 102.5 |
| index-CnlFEIb7.css | 33.7 | 6.2 |
| **total** | **393.9** | **108.7** |

### Client bundle breakdown (measurement build with named chunks)

| group | raw (KiB) | gzip (KiB) | share of gzip |
| --- | --- | --- | --- |
| react | 139.5 | 44.6 | 41.0% |
| app | 79.0 | 24.4 | 22.4% |
| engine | 61.9 | 17.1 | 15.7% |
| cards | 54.9 | 8.1 | 7.4% |
| i18n | 24.0 | 7.9 | 7.2% |
| css | 34.3 | 6.3 | 5.8% |
| zustand | 0.6 | 0.4 | 0.4% |
| **total** |  | **108.8** |  |

No `motion` group: the client has no animation library (the movement is
CSS). No sourcemaps in `dist/`.

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

## After

Same machine, same seeds, after the two engine changes below. The wire,
the match at rest, the heap, the growth and the bundle are deterministic
and did not move: the changes are read-side, and the proof that they are is
in the next section.

### `applyAction` alone (µs per action)

|  | actions | mean | p50 | p95 | max |
| --- | --- | --- | --- | --- | --- |
| abilities 1–12 pooled | 3781 | 178.1 (was 210.9) | 138.6 (142.5) | 405.1 (792.1) | 5757.9 |
| vanilla 1–4 pooled | 704 | 130.9 (174.0) | 104.3 (107.2) | 369.4 (784.3) | 444.0 |

### `applyAction` by action type, ability seeds 1–12 (µs)

| type | actions | mean | p50 | p95 | max | share of time |
| --- | --- | --- | --- | --- | --- | --- |
| END_TURN | 285 | 405.9 (was 815.3) | 379.7 | 667.6 | 733.7 | 17.2% (29.1%) |
| ANSWER_CHOICE | 227 | 333.3 | 366.6 | 499.7 | 601.6 | 11.2% |
| ACTIVATE_ABILITY | 375 | 273.9 | 254.9 | 402.8 | 540.3 | 15.3% |
| PLAY_CARD | 211 | 256.2 | 205.6 | 599.6 | 1413.1 | 8.0% |
| DECLARE_BLOCK | 5 | 231.5 | 197.4 | 436.3 | 436.3 | 0.2% |
| MULLIGAN | 24 | 167.6 | 168.5 | 302.8 | 302.8 | 0.6% |
| ATTACH_DON | 542 | 149.1 | 146.9 | 212.7 | 326.7 | 12.0% |
| PLAY_COUNTER | 371 | 144.4 | 136.6 | 224.3 | 270.4 | 8.0% |
| DECLARE_ATTACK | 582 | 124.8 | 110.4 | 149.8 | 3175.1 | 10.8% |
| PASS | 1159 | 97.6 | 75.9 | 283.6 | 5757.9 | 16.8% |

### Per accepted action, ability seeds 1–12 pooled (µs)

|  | samples | mean | p50 | p95 | max |
| --- | --- | --- | --- | --- | --- |
| `applyAction` (per action) | 3781 | 185.7 (was 218.2) | 148.5 | 418.3 (802.4) | 2973.1 |
| `playerView` (per seat) | 7562 | 70.2 (86.3) | 57.2 (81.6) | 133.7 | 2907.7 |
| `legalActions` (per seat) | 7562 | 2.12 | 0.30 | 9.70 | 108.8 |
| redaction fold (per seat) | 7562 | 1.11 | 0.90 | 2.30 | 113.8 |
| `JSON.stringify(update)` (per seat) | 7562 | 43.0 | 37.4 | 60.8 | 5888.1 |
| `handleAction`, whole (per action) | 3781 | 326.5 (394.2) | 293.8 (328.8) | 590.6 (952.4) | 6331.4 |
| overhead above `applyAction` (mean) |  | 140.9 (176.0) |  |  |  |

An accepted action now costs about 410µs end to end on this machine
(`handleAction` plus two stringifies), from about 480.

## What was optimized, and the proof

Both changes are in the engine, both are read-side, and both carry the
same proof: a sha256 over every per-action state, event batch, both
`playerView`s and both `legalActions` lists, over ability seeds 1–12 and 34
and vanilla seeds 1–4 — 4,995 actions — is identical before and after each
commit. `packages/server/tests/replay.test.ts` is green, and every test
count in the repo is unchanged (engine 498, cards 628, server 46 before the
budget tests, client 254).

### The fingerprint oracle

That proof was run by hand once, which makes it a story; a reviewer said
so, and was right. `packages/server/tests/fingerprint.test.ts` is the
same fold, kept: it drives the seventeen games through `driveMatch` and
hashes, per accepted action and in a fixed order, the new state, both
seats' event batches, both `playerView`s and both `legalActions` lists —
the payloads `handleAction` emitted, not a re-derivation — then the
rejections the driver injects, into one sha256 per game, pinned in the
test as `FINGERPRINTS`. The pinned digests were taken on the baseline
engine (`feat/server-hardening`'s four files checked out over this
branch's, rebuilt) and confirmed identical on this branch's engine; the
commit that added them says the procedure. `replay.test.ts` proves
`seed + log = game` and never looks at a view; this looks at nothing
else. 3.2 seconds for the seventeen games.

The rule: a digest moves on a semantic change — a card's text, a rule,
the redaction of an event, an affordance offered or withheld, the shape
of a view, the driver's policy — and on nothing that claims to be a
performance change. `OPTCG_PRINT_FINGERPRINTS=1` prints the table for
regeneration. A moved value is a finding to explain in the PR — which
card, which rule, which seat's view — never a value to paste over; a
perf commit that moves one has changed what a player sees, whatever it
meant to do.

**`finishTurn` reads the card table without drafting it** (`reducer/turn.ts`,
`peekCards` in `reducer/helpers.ts`). The loop that clears `usedThisTurn`
walked `Object.values(draft.cards)`, and reading a child through an immer
draft manufactures a proxy for it — about a hundred and twenty, for a few
cards that change — which `finalize` then walked. `current(draft.cards)`
is the same data as of that moment in the recipe, with no proxies; writes
still go through the draft. END_TURN mean **815 → 406µs**, pooled
`applyAction` p95 **792 → 405µs**.

**A card's keywords as one list per state** (`keywordsOf` in
`selectors.ts`). Timing `playerView`'s pieces on real states put the
keyword column first by a distance: 93µs of a view pair's 160µs was
`KEYWORDS.filter(hasKeyword)` over a hundred cards — four questions per
card, each a definition lookup, a modifier scan and two memo lookups —
against 16µs for `getPower` and 6µs each for the sort, `knows` and the
spread. The written keywords (printed plus modifier grants) are now one
set per card per state, `keywordsOf` is that plus the static grants in
`KEYWORDS` order, memoized like `staticGrantsFor`; `hasKeyword` reads the
list on a frozen state and the view reads it directly. On a draft nothing
is memoized — a draft is mutated within its recipe, and a state-identity
memo is exact only for a state that is replaced rather than changed.
`playerView` per seat **86 → 70µs** mean (p50 82 → 57); the view pair with
warm memos, standalone, **160 → 92µs**.

## What was not, and the number that left it alone

- **Skipping the no-priority seat's view when nothing it sees changed.**
  0 of 7,562 emissions carried a view byte-identical to the seat's previous
  one — every accepted action changes something both seats see (the
  priority, the DON!!, the log-derived `turn`). There is nothing to skip.
- **`legalActions` recomputation.** 2.1µs per seat, of 327 per action:
  0.6%. Not worth a memo.
- **The `[...journal]` / `[...actions]` copies in `handleAction`.** With
  `applyAction`, two views, two affordance lists and two redaction folds
  accounted for, the whole of `handleAction` is within 4µs of the sum of
  its pieces — the copies are inside the noise. O(n) per action, n a few
  hundred, and n × a pointer copy is a microsecond.
- **immer in the server.** There is none: `packages/server/package.json`
  depends on `ws` and the two workspace packages, and `handleAction`
  spreads plain objects.
- **The log inside the `produce`.** `emit` pushes every event into
  `draft.log`, so immer copies and re-walks a growing array on every
  action: measured at **7µs per action at action 50 and 59µs at action
  500** of the longest game (mean 28µs over seeds 6 and 34 — 13% of
  `applyAction` there, about 5% of an action end to end over the sweep).
  Taking the log out of the recipe touches `emit`, the four ids derived
  from `draft.log.length` (`choice-`, `mod-`, `leg-`) and the freezing in
  `applyAction`, with the risk of an event carrying a revoked draft. That
  is a change with its own proof, not a line in this one; it is the next
  thing to do if a longer format ever makes `applyAction`'s growth matter.
- **The rest of `playerView`.** 70µs per seat to describe a hundred cards,
  with `liveStatics`, `staticGrantsFor` and `zoneIndex` already memoized
  per state; the sort, `knows` and the spread are 6µs each. Honest work.
- **The transport's stringify.** 43µs per seat and 11 KiB per update; the
  protocol chose snapshots over diffs for correctness, and a diff-based
  wire is out of scope by that decision.

## Budgets

`packages/server/tests/budgets.test.ts` and
`packages/client/tests/bundleBudget.test.ts`, on the harness's own
functions. Each is the measurement with stated air; a feature that earns
the bytes moves the number in the same commit, with the reason.

| budget | measured | limit | margin |
| --- | --- | --- | --- |
| `applyAction` p95, ability seeds 1–3 | 424–444µs (three runs) | 2,000µs | ×4.5, for a two-core runner under load |
| `update` mean, seed 6 | 12.1 KiB | 19 KiB | ×1.5, rounded up |
| `update` max, seed 6 | 23.1 KiB | 35 KiB | ×1.5, rounded up |
| `joined` at game end, seed 6 | 70.5 KiB | 106 KiB | ×1.5, rounded up |
| board growth, action 50 → end, seed 6 | ×1.01 | ×1.5 | the histories are asserted to grow |
| `MatchState` at game end, serialized, seed 6 | 195.2 KiB | 293 KiB | ×1.5, rounded up; the deterministic half of the `MAX_MATCHES` figure |
| client bundle, gzip total | 108.7 KiB | 140 KiB | ×1.25, rounded up |

Not a budget but a pin: the fingerprint oracle above, which holds the
semantics the budgets are measured over. A perf change that moves a
budget the right way and a fingerprint the wrong way has not earned the
number.

## The bundle verdict

108.7 KiB gzip, of which react is 41%, the app 22%, the engine 16%, the
card data 7%, the two locales 7%, the CSS 6%. Nothing avoidable at the
10% bar: `i18n` is 7.9 KiB for **both** languages, so lazy-loading `es`
would save about 4 KiB (3.6%) and buy a fetch on the language switch;
there are no sourcemaps and no duplicated data (`cards` is 8.1 KiB
gzipped for the whole starter set). Left as it is, with the number.

## Memory per match and `MAX_MATCHES`

A finished ability-sweep match at rest — state with its log, action log,
two journals — is **224–231 KiB of heap** (256 held at once: 56–58 MiB
over a 16 MiB baseline, measured on two separate runs; 126 KiB
serialized as the mean over those 256, 139 KiB over seeds 1–12). The
heap figure is a range because it is one: it needs `--expose-gc` and a
forced collection on either side, and two runs of the same seeds land a
few KiB apart. What holds the number in place is its deterministic half.
`packages/server/tests/budgets.test.ts` pins the serialized `MatchState`
at game end on seed 6, the sweep's heaviest game — **195.2 KiB**, under a
293 KiB budget (×1.5, rounded up) — so a match that started weighing more
fails a test before it moves the heap.

`MAX_MATCHES` stays at **256**: that is under 60 MiB of matches on the
smallest host the server is meant for, with the reconnection window
(`MATCH_IDLE_TTL_MS`) bounding how long a finished one stays. 1,024 would
be about 230 MiB, which is a decision about the host, not about the game;
the number to raise it from is here.

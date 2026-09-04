# @optcg/server

The authoritative match server: two layers, and the lower one does not know
the network exists.

- **The session** (`src/session.ts`) — pure match logic. `createMatch` sets up
  via the engine, `handleAction` validates by delegation (`applyAction`),
  redacts by delegation (`playerView`, the engine's `redactEvent`), records
  the action log for replay and each seat's emitted events for reconnection.
  No `Date.now`, no `Math.random`, no I/O; the only randomness anywhere is
  the `rng` inside `GameState`, which never leaves.
- **The transport** (`src/transport.ts`) — a thin WebSocket skin: seats join
  by match id + token, actions go in, and each socket receives exactly what
  the session emitted for its seat. It is also the perimeter: the strict
  parser (`src/validate.ts`), the limits (`src/limits.ts`), the close policy,
  the caps, the expiry sweep, the heartbeat, the rate limit and the origin
  check all live here, each marked with its item in
  [`docs/threat-model.md`](../../docs/threat-model.md).

**Zero game rules.** Every game question is the engine's; if a change here
needs to decide what is legal, who sees what, or what happens when, that rule
belongs in the engine — and `tests/imports.test.ts` pins the boundary by
restricting the server's engine imports to the public routing surface.

The wire contract, the reconnection decision (per-seat event journal, with
the measured costs), the reconnection window and the close-code table are
documented in [`docs/multiplayer-protocol.md`](../../docs/multiplayer-protocol.md).

## Running it

```
node packages/server/dist/main.js [port]
```

| Variable | Meaning |
| --- | --- |
| `PORT` | The port, unless one is given as the argument. Default `8787`. |
| `OPTCG_ALLOWED_ORIGINS` | Comma-separated origins a browser may open a socket from (`https://play.example,https://staging.example`). An upgrade with an `Origin` outside the list is refused with a 403; one with no `Origin` passes. Unset means no check, and the server says so at startup — the local-development default, never the deploy's. |

The transport reports on stderr, one JSON line per event: an event name, a
message type and an error name, never a payload. TLS is assumed at a proxy in
front of the process (`wss://` outside, `ws://` on the loopback inside); the
process does not terminate it.

## Limits

The defaults, from `src/limits.ts`; `startServer({ limits })` overrides any
of them, which is how the tests reach every cap. Each has its measurement
next to it in the source.

| Limit | Default | What it bounds |
| --- | --- | --- |
| `MAX_MESSAGE_BYTES` | 16 KiB | A frame (`ws` `maxPayload`, close 1009) and the parsed string. The largest legitimate client message measured 166 bytes. |
| `MAX_JSON_DEPTH` | 8 | Nesting, root counted as one. The deepest legitimate message is four. |
| `MAX_ID_LENGTH` | 64 | `matchId`, `token`, deck ids. A UUID is 36. |
| `MAX_MATCHES` | 256 | Live matches per process; over it, `create` is `serverFull`. Provisional until the perf PR measures a match at rest. |
| `MAX_CONNECTIONS` | 512 | Open sockets; over it, the upgrade is a 503. |
| `MAX_AUTH_FAILURES` | 5 | `unknownMatch` + `badToken` per socket before it is closed. |
| `MATCH_IDLE_TTL_MS` | 30 min | How long a match with no socket lives — the reconnection window. |
| `MATCH_SWEEP_INTERVAL_MS` | 60 s | How often expiry runs. |
| `HEARTBEAT_INTERVAL_MS` | 30 s | Ping interval; a socket silent for two is terminated. |
| `RATE_WINDOW_MS` / `MAX_MESSAGES_PER_WINDOW` | 1 s / 20 | Frames per socket per window, counted before parsing. A fast human is at three. |

## Dependencies

The runtime graph is `ws` and the two workspace packages, and that is policy
(threat model M13), not the current state of an `install`: no validation,
logging or rate-limit library enters for a job a hundred hand-written lines
do. A pull request that adds a runtime dependency here is asking a question,
and the answer is usually the hundred lines.

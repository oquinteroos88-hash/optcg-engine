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
  the session emitted for its seat.

**Zero game rules.** Every game question is the engine's; if a change here
needs to decide what is legal, who sees what, or what happens when, that rule
belongs in the engine — and `tests/imports.test.ts` pins the boundary by
restricting the server's engine imports to the public routing surface.

The wire contract, the reconnection decision (per-seat event journal, with
the measured costs), and the replay guarantee are documented in
[`docs/multiplayer-protocol.md`](../../docs/multiplayer-protocol.md).

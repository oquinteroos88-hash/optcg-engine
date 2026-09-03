# Threat model — the server on the open internet

The next step of this project is a deploy: `packages/server` stops being a
process two friends run on localhost and becomes a socket anyone on the
internet can open. This document names who can attack what, which of those
attacks the architecture already answers, and which ones `feat/server-hardening`
answers. Every mitigation in that PR cites an item here by its id (`T1`, `M3`);
a mitigation with no item is scope creep, and an item with no mitigation is a
declared gap.

Players will include children. A crash, a hijacked match or a leaked hand is
not a bug here — it is the difference between a game and a broken toy.

## What the server is, in one paragraph

One Node process, one `ws` WebSocket server, everything in memory. There are no
accounts: a `create` opens a match and returns a `matchId` plus two seat
tokens; whoever holds a token holds that seat, and sending the second token to
a friend *is* the invitation. Three client messages exist — `create`, `join`,
`action` — and every game question (is this legal, whose turn, what does this
seat see) is answered by `@optcg/engine`, never by the server. That last fact
is the whole defensive posture, and it predates this document.

## Actors

### A1 — an anonymous socket

Anyone who can reach the port. No identity, no history, unlimited retries.
Can: try to join matches it was never invited to, guess tokens, send bytes
that are not the protocol, send the protocol at any rate, open as many
sockets and matches as the process will hold.

### A2 — a modified client held by a legitimate player

Has a real seat token, obtained honestly. Can send any well-formed message the
protocol admits, at any rate, in any order: the opponent's moves, answers to
choices it was never offered, handles it invented, actions before joining,
joins to full matches. Cannot see anything the wire never sent it.

### A3 — the network in between

Can read and alter plaintext traffic. **Out of scope by assumption**: the
deploy terminates TLS at a proxy in front of the process (`wss://` outside,
`ws://` on the loopback inside). This document does not defend against A3
and the code does not try; the assumption is written here so the deploy that
breaks it knows what it broke.

## Assets

- **The process.** One crash ends every match in memory; there is no
  persistence beyond process memory (declared out of scope in
  `multiplayer-protocol.md`).
- **A match.** Its state, its action log, its two seat journals. Corrupting
  one, or keeping it alive forever, is the attack.
- **Hidden information.** Hands, decks, life cards, the RNG state. The engine's
  `playerView` and `redactEvent` decide what crosses the wire; the wire-leak
  test proves nothing else does.
- **A seat.** The token is the only credential. Guessing one is a hijack.
- **Memory and CPU.** Finite, shared by every match on the process.

## Threats, and where each one is answered

| Id  | Actor | Threat | Answer |
| --- | ----- | ------ | ------ |
| T1  | A1 | Bytes that are not the protocol: invalid JSON, wrong shapes, unknown fields, wrong types, a `create` with a 2MB deck id. | M1, M2 |
| T2  | A1 | A frame large enough to exhaust memory before it is parsed, or JSON nested deep enough to blow the stack. | M2 |
| T3  | A1, A2 | A message that makes a handler throw, killing the process for everyone. | M3 |
| T4  | A1 | Guessing a seat token or a `matchId`; learning either from timing. | M4 |
| T5  | A1 | Creating matches until the process dies; opening sockets until the process dies. | M5 |
| T6  | A1, A2 | A match nobody finishes stays in memory forever; a dead socket without a FIN looks like a connected player forever. | M6, M7 |
| T7  | A1, A2 | Flooding: thousands of messages a second from one socket. | M8 |
| T8  | A1 | A page on another origin opens a socket from a player's browser (cross-site WebSocket hijacking). | M9 |
| T9  | A2 | Acting for the opponent, answering a choice not offered, inventing handles, acting before `join`, joining twice, joining a full match. | Existing architecture; **affirmed** by M10 |
| T10 | A1, A2 | Learning something hidden from an error message, a rejection reason or a close reason. | Existing wire arbiter; **extended** by M12 |
| T11 | — | A vulnerable dependency in the server's runtime graph. | M13 |

## Mitigations (the PR's contents)

- **M1 — strict parser at the socket edge** (T1). Each message type has an
  exact key set; an unknown key, a missing key or a wrong primitive type is
  `malformedMessage`. Hand-written guards, no validation library: three
  message shapes do not justify new dependency surface (see M13). The inner
  `action` is checked for being a plain object with a string `type` and a
  string `player`; its full shape stays the engine's business, which rejects
  with its own reasons — the server adds no rule of the game.
- **M2 — physical limits** (T1, T2). `ws`'s `maxPayload` plus the server's own
  byte check before parsing; a maximum JSON depth checked after parsing; a
  maximum length for every identifier string (`matchId`, `token`, deck ids).
  The numbers live in `packages/server/src/limits.ts` with the reasoning next
  to each one.
- **M3 — the process never dies for one socket** (T3). The whole per-message
  path runs under one `try/catch`. On a throw: one structured log line (event
  name, message type, error name — never the payload, never a stack to the
  client), an `internalError` to the offending socket, and that socket closed.
  Socket-level `error` events are handled so an emitter without a listener
  cannot throw.
- **M4 — unguessable, timing-safe identity** (T4). Tokens and `matchId` are
  `crypto.randomUUID()` (122 random bits); a `matchId` is minted by the server
  and derived from nothing in the game, so it cannot be recovered from the
  seed and the seed cannot be recovered from it. Token comparison is
  `crypto.timingSafeEqual`. Repeated authentication failures on one socket
  close it.
- **M5 — caps** (T5). A maximum number of live matches and a maximum number
  of open connections per process. A `create` over the cap is `serverFull`; a
  connection over the cap is closed at upgrade.
- **M6 — match expiry** (T6). A match with no live socket for
  `MATCH_IDLE_TTL_MS` is freed. **This changes the reconnection promise**: a
  seat token re-authenticates while the match lives, and a match lives while
  someone is at the table or the idle window has not run out. The trade is
  written into `multiplayer-protocol.md`, not left implicit.
- **M7 — heartbeat** (T6). The server pings every socket on an interval and
  terminates one that did not answer the previous ping. A half-open TCP
  connection stops counting as a connected player, which is what lets M6
  and M5 count honestly.
- **M8 — per-connection rate limit** (T7). A fixed-window counter per socket;
  exceeding it closes the socket with a policy-violation code. The number is
  set against the measured pace of the real game (see the PR report) so a
  fast human with drag-to-play is nowhere near it.
- **M9 — origin allowlist** (T8). When configured, an upgrade whose `Origin`
  header is not on the list is refused before the socket exists. Requests
  with no `Origin` (non-browser clients) pass — the attack is a browser one.
  Configured with `OPTCG_ALLOWED_ORIGINS` for the runnable server; unset means
  no check, which is the local-development default and is logged at startup
  so a deploy cannot forget it silently.
- **M10 — the adversary test** (T9). A client that skips the UI and talks to
  the socket directly, sending everything A2 can: each attempt is refused
  with its code, the victims' match stays playable (the test finishes it),
  and the process is alive at the end.
- **M11 — deterministic fuzzing** (T1, T2, T3). Seeded random bytes, valid
  JSON with invalid shapes, hostile unicode, truncated frames — thousands of
  messages against a test server. Zero crashes, zero unhandled rejections,
  memory stable within a coarse bound. The seed is recorded like every other
  random thing in this repo.
- **M12 — the wire arbiter, plus the error channel** (T10). The existing
  wire-leak test runs unchanged on the hardened server, and a new assertion
  keeps every server error code and close reason inside a fixed vocabulary
  that names no card, no id and no internal path.
- **M13 — dependency policy** (T11). The server's runtime dependencies are
  `ws` and the two workspace packages, and that is the aspiration, not just
  the current state: no validation, logging or rate-limit library enters for
  a job a hundred lines do. `pnpm audit` runs on the four packages as part of
  this task and its state is in the report.

## Declared gaps

- **A3 / TLS**: assumed at the proxy. Documented above.
- **Distributed denial of service**: an infrastructure concern (the proxy, the
  host). The per-process caps in M5 and M8 make one process fail cleanly
  under load; they do not make it survive a botnet.
- **Accounts, bans, moderation, reporting**: future work. Today a token is a
  seat, and there is no notion of a person.
- **Persistence**: a process restart ends every match. Unchanged by this PR.

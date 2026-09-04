/**
 * The numbers the perimeter is made of, each with the measurement or the
 * reasoning that produced it, and the threat-model item it answers
 * (`docs/threat-model.md`). A number here is a claim about the real game: the
 * measurements come from the ability and vanilla sweeps (seeds 1–12, both
 * decks, `tests/helpers.ts`'s `driveMatch`) and from `TestClient` driving a
 * match over a loopback socket as fast as the event loop allows.
 *
 * They are defaults, not law: `startServer({ limits })` overrides any of them,
 * which is how the tests reach `serverFull` with three matches or expire a
 * match in fifty milliseconds without waiting half an hour.
 */

/**
 * M2 — the largest frame a client may send, in bytes. The largest legitimate
 * client message in the whole sweep is an `ANSWER_CHOICE` partition answer at
 * **166 bytes** (`create` is 116, `join` 124); a selection naming every card
 * of a fifty-card deck would be about 600. Sixteen KiB is a hundredfold margin
 * over the real game and still small enough that a thousand of them in flight
 * is sixteen megabytes, not a memory event. `ws` enforces it before the frame
 * is assembled (`maxPayload`, close 1009) and `validate.ts` again on the
 * string, so the number is one whichever layer sees the frame first.
 */
export const MAX_MESSAGE_BYTES = 16 * 1024;

/**
 * M2 — how deeply nested a message may be, counting the root object as one.
 * The deepest legitimate message is an `ANSWER_CHOICE` whose `answer` holds an
 * array — root, `action`, `answer`, `selected`: **four**. Eight is double that
 * and nowhere near the recursion depth at which a walk over parsed JSON
 * becomes a stack problem; the walk in `validate.ts` is iterative anyway, so
 * the cap is about refusing nonsense early, not about surviving it.
 */
export const MAX_JSON_DEPTH = 8;

/**
 * M2 — the longest identifier string (`matchId`, `token`, deck ids) accepted.
 * Every id this server mints is a UUID, thirty-six characters; deck ids are
 * short catalog names. Sixty-four leaves room for a longer id scheme without
 * admitting a two-megabyte deck id (T1's example) into a map lookup.
 */
export const MAX_ID_LENGTH = 64;

/**
 * M5 — live matches per process. A finished ability-sweep match at rest —
 * state, action log, two journals — costs **224–231 KiB of heap** (256 of
 * them held at once: 56–58 MiB over a 16 MiB baseline, measured on two
 * separate runs, `docs/performance.md`), so this cap is under 60 MiB
 * of matches on the smallest host the server is meant for, and a `create`
 * loop is still not the cheapest way to fill the heap. The heap figure
 * needs a forced collection and is a range; what `tests/budgets.test.ts`
 * pins is its deterministic half, the serialized `MatchState` — 195.2 KiB
 * on the sweep's heaviest game, seed 6, under a 293 KiB budget — so the
 * weight this number rests on has a guard that cannot flap. Sized from the
 * measurement, not raised past it: 1,024 would be about 230 MiB, which is
 * a decision about the host, not about the game.
 */
export const MAX_MATCHES = 256;

/**
 * M5 — open sockets per process, enforced at the HTTP upgrade so a refused
 * connection never becomes a `WebSocket` at all. Two per match at the match
 * cap is 512, which leaves no room for spectators — there are none — and
 * exactly the room the game needs.
 */
export const MAX_CONNECTIONS = 512;

/**
 * M4 — failed authentications (`unknownMatch`, `badToken`) one socket may
 * accumulate before it is closed. A player mistyping a seat code gets several
 * tries; a guesser gets five per TCP handshake, against 122 bits of token.
 */
export const MAX_AUTH_FAILURES = 5;

/**
 * M6 — how long a match with no socket attached stays in memory. This is the
 * reconnection window: a token re-authenticates while the match lives, and a
 * match lives while someone is at the table or for this long after the last
 * one left. Thirty minutes is a phone call, a reboot, a walk to the router —
 * and it is also the longest a match nobody is playing occupies the heap.
 */
export const MATCH_IDLE_TTL_MS = 30 * 60 * 1000;

/** M6 — how often the expiry sweep runs. A minute keeps the sweep cheap and
 * the window honest to within a minute, which is the precision it needs. */
export const MATCH_SWEEP_INTERVAL_MS = 60 * 1000;

/**
 * M7 — how often every socket is pinged. A socket that has not answered the
 * previous ping by the next one is terminated, so a half-open connection
 * stops counting as a player within two intervals. Thirty seconds is the
 * conventional figure for `ws` and sits under most proxies' idle timeouts.
 */
export const HEARTBEAT_INTERVAL_MS = 30 * 1000;

/** M8 — the fixed window of the per-socket message counter. */
export const RATE_WINDOW_MS = 1000;

/**
 * M8 — messages one socket may send per window. The measure is the real
 * game: the sweep averages **243 actions per game** (122 to 473), and a
 * human with drag-to-play issues at most about three a second in a burst
 * of DON!! attachments. `TestClient` on a loopback socket, deciding and
 * sending with no think time at all, reaches **~1,200 messages per second**;
 * a browser client never gets near that. Twenty a second is seven times the
 * fastest human and a sixtieth of the machine, which is the gap a flood has
 * to live in — and it does not.
 */
export const MAX_MESSAGES_PER_WINDOW = 20;

/** Every limit `startServer` reads, overridable per instance for tests. */
export interface ServerLimits {
  MAX_MESSAGE_BYTES: number;
  MAX_JSON_DEPTH: number;
  MAX_ID_LENGTH: number;
  MAX_MATCHES: number;
  MAX_CONNECTIONS: number;
  MAX_AUTH_FAILURES: number;
  MATCH_IDLE_TTL_MS: number;
  MATCH_SWEEP_INTERVAL_MS: number;
  HEARTBEAT_INTERVAL_MS: number;
  RATE_WINDOW_MS: number;
  MAX_MESSAGES_PER_WINDOW: number;
}

export const DEFAULT_LIMITS: Readonly<ServerLimits> = Object.freeze({
  MAX_MESSAGE_BYTES,
  MAX_JSON_DEPTH,
  MAX_ID_LENGTH,
  MAX_MATCHES,
  MAX_CONNECTIONS,
  MAX_AUTH_FAILURES,
  MATCH_IDLE_TTL_MS,
  MATCH_SWEEP_INTERVAL_MS,
  HEARTBEAT_INTERVAL_MS,
  RATE_WINDOW_MS,
  MAX_MESSAGES_PER_WINDOW,
});

# The multiplayer protocol — PR #44, revised by PR #45

The wire contract between `packages/server` and a client. One number governs
compatibility: **`PROTOCOL_VERSION = 2`** travels in every `create` and `join`,
and a mismatch is refused with `protocolMismatch` before anything else happens
— an old client fails loudly, never strangely.

**Why 2 rather than an additive 1.** PR #45 put the affordance list in the
payloads. On the wire that is additive, and an old client would ignore it — but
a *new* client cannot work without it: `legalActions` needs a whole
`GameState`, and a networked client holds a redacted view. A v2 client against
a v1 server would receive payloads with no `actions`, render an empty
affordance set, and sit there looking like a game in which nothing is legal.
That is failing strangely, which is the exact outcome the number exists to
prevent, so the number moved.

The client imports this contract from `@optcg/server/protocol` — a browser-safe
entry point of types and two constants, kept apart from the package root
because that reaches for `ws` and `node:net`. Both ends read one file rather
than keeping two copies that drift.

The server holds one rule about the game: none. `applyAction` validates,
`playerView` redacts state, the engine's `redactEvent` redacts history, and a
test pins the boundary — the server's source imports nothing from the engine
but its public routing surface.

## Message shapes

Client → server (JSON over WebSocket):

| Shape | Meaning |
| --- | --- |
| `{ type: 'create', protocol, seed, deckIdP1, deckIdP2 }` | Open a match. The decks are **named**, not sent: the catalog belongs to whoever started the server, so a client cannot post a deck the server never validated. The seed is the creator's — it is the game's only randomness, and `replayMatch` needs it to be something somebody chose. |
| `{ type: 'join', protocol, matchId, token }` | Take (or retake) the seat this token names. No accounts, no matchmaking. |
| `{ type: 'action', action }` | An engine `Action`, verbatim — `ANSWER_CHOICE` with `{ kind: 'handles' }` where the choice is blind. The `action.player` must be the socket's authenticated seat. |

Server → client:

| Shape | Meaning |
| --- | --- |
| `{ type: 'created', protocol, matchId, tokens }` | The match exists. The creator keeps one seat token and sends the other to their opponent — that link *is* the invitation. |
| `{ type: 'joined', protocol, seat, view, journal, actions }` | Successful join, first time and reconnection alike. `view` is the present (`playerView`); `journal` is the history exactly as this seat saw it live (see below); `actions` is what this seat may do now. |
| `{ type: 'update', view, events, actions }` | After every accepted action: this seat's **whole** `playerView`, that action's events redacted for it, and its affordance list. Snapshots over diffs — correctness first, diffing is a future optimization. |
| `{ type: 'rejected', reason }` | To the actor **alone**, with the engine's reason verbatim. The other seat never learns the attempt existed. Rejections are request/response, not history: never journaled. |
| `{ type: 'error', code }` | Transport-level failure; `code` is a server code, never an engine reason. |

**The shapes are exact.** Each client message has the keys in its row and no
others: an unknown field, a missing field or a wrong primitive type is
`malformedMessage`, the same as bytes that are not JSON. `protocol` is an
integer, `seed` a non-negative safe integer, and every id string is bounded.
The inner `action` is checked for being a plain object with a string `type`
and a string `player`; its full shape is the engine's business, refused with
the engine's reasons (`docs/threat-model.md`, M1).

The two error vocabularies never mix. Engine reasons answer game questions
(`notYourPriority`, `choiceHandleOutOfRange`, …); server codes answer "who are
you and what did you send": `protocolMismatch`, `unknownMatch`, `unknownDeck`,
`badToken`, `seatMismatch`, `notJoined`, `malformedMessage` — and, since the
hardening, `oversizedMessage`, `rateLimited`, `serverFull`, `internalError`.
Those four are additive (an old client shows a code it does not know, which
is failing loudly), so `PROTOCOL_VERSION` did not move for them. Every code is
a bare word that is its own key, and the wire arbiter holds the close channel
to the same vocabulary.

## The affordances travel

`legalActions` has always been the affordance contract: what a client may
offer is what the engine offers, indexed. PR #45 found the half of that
sentence nobody had needed — **it had no way to cross a wire**. A client with a
redacted view cannot run `legalActions`, which needs the whole state, hidden
zones included; a client that computed its own would be encoding the rules a
second time from strictly less information.

So the engine computes, the server carries, the client indexes. The list is
`legalActions(state, seat)` verbatim, and it leaks nothing — not by a filter
here, but by what that function already is: every action it emits names cards
the seat can act *with* (its own hand and field, the opponent's public field),
and while a choice is open it emits only the bare `ANSWER_CHOICE` marker, whose
answer space lives in the redacted `pending`. A blind choice therefore publishes
a **handle count** and no identities, which is the one shape an affordance could
have leaked through. The wire leak test checks the field like every other, from
the opposite side.

## The view is the present, not the history

PR #45 also took `log` **off** `PlayerView`, and the reason is PR #44's own
finding turned around. The engine's redaction is memoryless, so a log
re-derived now is strictly more redacted than what the player watched — which
is why the journal exists. A `log` on the view is therefore history that nobody
may correctly render, and it was riding in every payload: **56% of the average
update**, growing with the game. Removing it took the average update from 24.7KB
to 10.8KB and made it constant in game length rather than linear.

`redactLog` still exists for the one reader with no journal to catch up from —
someone joining a match already in progress, or a test staging a mid-game
position — and it is honest there precisely because such a reader never saw the
live version to be short-changed against.

`seatMismatch` exists because the engine validates whose **turn** it is, not
who is **talking**: without the check, a seat could submit the opponent's
perfectly legal move and the engine would accept it.

## Sequence

```
client                          server
  |-- join {protocol,matchId,token} -->|
  |<-- joined {seat,view,journal} -----|        (or error)
  |-- action {action} ---------------->|
  |<-- update {view,events} -----------|        (both seats, each its own)
  |<-- rejected {reason} --------------|        (actor only, on refusal)
```

Nothing else travels. **No seat ever receives another seat's raw action** —
what the rival did is learned from the redacted events, never from the foreign
`ANSWER_CHOICE`, because an answer by id from the hand's owner would name
cards the other player does not know.

## Reconnection: the per-seat journal

The engine's log redaction is memoryless: re-deriving history at reconnect
time produces **more** redaction than a player legitimately saw live (a
revealed card since shuffled back nulls out even in the reveal that showed
it). Streaming and re-deriving diverge, so one had to be the authority — and
it is the journal: **the session stores, per seat, each emission's redacted
events at the moment of emission.** Reconnecting is the current `view` plus
that journal. What you see on returning is what you saw live, because it is
literally the same data. Re-derivation is forbidden as a source of history.

**The measured cost, and the shape it forced.** Journaling whole `update`
payloads was quadratic — every update carried a full view and every view
carried the whole redacted log. Over the ability sweep that measured **8.4MB
average / 16.1MB worst per seat per game**. The journal therefore stores the
**event batches only**: same history, linear cost, measured at **34KB average
/ 50KB worst per seat per game** (~250× less). The declared trade: a
returning client cannot scrub through past *board states* — it has the full
event history and the present, not the intermediate snapshots. The dishonest
third option — re-derived history pretending to be what was seen — is the one
thing this protocol rules out.

(PR #45 then removed `log` from the view outright, for the correctness reason
above, which halved the live payload as well. The journal's shape was decided
before that and is unaffected: it was already the events.)

A reconnecting token takes the seat; whatever socket held it is closed. A
disconnected seat misses nothing: every emission is journaled whether or not
a socket was listening. No deadlines, no auto-forfeit — PR 3's concerns.

## Limits, expiry and the reconnection window

The server on the open internet (`docs/threat-model.md`) changed one promise
and added a perimeter around the rest. The numbers live in
`packages/server/src/limits.ts`, each with the measurement behind it.

**The trade.** A seat token re-authenticates *while the match lives*, and a
match lives while a socket is attached to it or for `MATCH_IDLE_TTL_MS`
(thirty minutes) after the last one left. A match nobody is at for longer
than that is freed, and a token for it then names nothing: the join is
answered `unknownMatch`, the same word as for a match that never existed. The
reconnection window is therefore thirty minutes of nobody at the table —
a phone call, a reboot, a walk to the router — rather than forever, because
forever was also how long an abandoned match would have held its memory.

**Heartbeat.** The server pings every socket every `HEARTBEAT_INTERVAL_MS`
(thirty seconds) and terminates one that has not answered the previous ping —
no close frame, since the other end is not there to receive one. A half-open
connection therefore stops counting as a player within two intervals, which
is what lets "a socket is attached" mean what it says. Browsers answer pings
on their own; a client written by hand must too.

**Close codes.** A socket that sends something the protocol cannot name is
told once and closed; one that sends a well-formed thing the server cannot
honour is told and kept, because the next message may be the right one. The
close reason is always exactly the code and nothing else.

| Code | After sending it |
| --- | --- |
| `malformedMessage`, `oversizedMessage`, `protocolMismatch`, `rateLimited` | close 1008, reason = the code |
| `internalError` | close 1011, reason = the code |
| `unknownMatch`, `badToken` | keep; each counts as an authentication failure, and the `MAX_AUTH_FAILURES`-th (five) closes with 1008 `badToken` |
| `unknownDeck`, `notJoined`, `seatMismatch`, `serverFull` | keep |
| a frame over `MAX_MESSAGE_BYTES` (16 KiB) | `ws` refuses it before the parser: close 1009, no message |
| a second socket presenting a seat's token | the first socket is closed with no code and no reason — the reconnection rule above |

**Rate.** `MAX_MESSAGES_PER_WINDOW` (twenty) frames per `RATE_WINDOW_MS`
(one second) per socket, counted before parsing; over it is `rateLimited` and
the close. The sweep averages 243 actions per *game*, and a human with
drag-to-play issues at most about three a second in a burst.

**Caps.** `MAX_MATCHES` (256, provisional until the perf PR measures a match
at rest) live matches per process — a `create` over it is `serverFull`, socket
kept — and `MAX_CONNECTIONS` (512) open sockets, refused at the HTTP upgrade
with a 503 so a refused connection never becomes a socket.

**Origin.** When the runnable server is started with `OPTCG_ALLOWED_ORIGINS`,
an upgrade whose `Origin` header is not on the list is refused with a 403
before a socket exists. An upgrade with no `Origin` passes: the attack is a
page in a browser, and a page always says where it is from. Unset means no
check, which is the local-development default and is said at startup.

## Replay

`seed + action log = the match`. The session persists every accepted action
**as it arrived** — handle answers included — and `replayMatch(seed,
decklists, actions)` reconstructs the final state byte for byte
(`deepStrictEqual`, over sweep games that include handle answers and
mid-game shuffles). This works because the blind-handle order is derived from
nothing but state — the choice id and its candidate ids — which the replay
sweep re-proves on every run: a salt with any source of its own would make a
replayed handle resolve a different card.

## The wire arbiter

`tests/wireLeak.test.ts` is PR #43's leak test pointed at everything the
server emits: every update to every seat over full sweep games, every
rejection, and the rejoin payload — the view against the present, each
journal batch against the state it was redacted for. Checking history against
final knowledge would be the live-vs-re-derive divergence surfacing inside
the arbiter itself: an old batch is entitled to an id a later shuffle made
untrackable, because re-sending the same bytes teaches a returning client
nothing it did not learn live. Sabotaging the session's redaction produced
1,174 findings on the ability sweep and 104 on the vanilla one before the
revert — the arbiter bites.

## Out of scope

Accounts, room lists, spectators, deadlines and abandonment, diffs, and
persistence beyond process memory. The invitation is a seat code somebody
sends somebody, and that is deliberate: it is the least machinery that lets
two people play. (Abandonment now has one consequence — the idle expiry
above — but no forfeit: an abandoned match is freed, not decided.)

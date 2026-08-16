# The multiplayer protocol — PR #44

The wire contract between `packages/server` and a client. One number governs
compatibility: **`PROTOCOL_VERSION = 1`** travels in every `join`, and a
mismatch is refused with `protocolMismatch` before anything else happens — an
old client fails loudly, never strangely.

The server holds one rule about the game: none. `applyAction` validates,
`playerView` redacts state, the engine's `redactEvent` redacts history, and a
test pins the boundary — the server's source imports nothing from the engine
but its public routing surface.

## Message shapes

Client → server (JSON over WebSocket):

| Shape | Meaning |
| --- | --- |
| `{ type: 'join', protocol, matchId, token }` | Take (or retake) the seat this token names. No accounts, no matchmaking: a match is registered server-side with two caller-minted tokens. |
| `{ type: 'action', action }` | An engine `Action`, verbatim — `ANSWER_CHOICE` with `{ kind: 'handles' }` where the choice is blind. The `action.player` must be the socket's authenticated seat. |

Server → client:

| Shape | Meaning |
| --- | --- |
| `{ type: 'joined', protocol, seat, view, journal }` | Successful join, first time and reconnection alike. `view` is the present (`playerView`); `journal` is the history exactly as this seat saw it live (see below). |
| `{ type: 'update', view, events }` | After every accepted action: this seat's **whole** `playerView` plus that action's events redacted for it. Snapshots over diffs — correctness first, diffing is a future optimization. |
| `{ type: 'rejected', reason }` | To the actor **alone**, with the engine's reason verbatim. The other seat never learns the attempt existed. Rejections are request/response, not history: never journaled. |
| `{ type: 'error', code }` | Transport-level failure; `code` is a server code, never an engine reason. |

The two error vocabularies never mix. Engine reasons answer game questions
(`notYourPriority`, `choiceHandleOutOfRange`, …); server codes answer "who are
you and what did you send": `protocolMismatch`, `unknownMatch`, `badToken`,
`seatMismatch`, `notJoined`, `malformedMessage`.

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
payloads is quadratic — every update carries a full view and every view
carries the whole redacted log. Over the ability sweep that measured **8.4MB
average / 16.1MB worst per seat per game**. The journal therefore stores the
**event batches only**: same history, linear cost, measured at **34KB average
/ 50KB worst per seat per game** (~250× less). The declared trade: a
returning client cannot scrub through past *board states* — it has the full
event history and the present, not the intermediate snapshots. The dishonest
third option — re-derived history pretending to be what was seen — is the one
thing this protocol rules out.

A reconnecting token takes the seat; whatever socket held it is closed. A
disconnected seat misses nothing: every emission is journaled whether or not
a socket was listening. No deadlines, no auto-forfeit — PR 3's concerns.

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

Accounts, matchmaking, spectators, deadlines and abandonment, diffs,
persistence beyond process memory, and any UI — the client still plays
hot-seat over the full state and is untouched by this PR.

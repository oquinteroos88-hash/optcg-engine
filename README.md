# optcg-engine

A deterministic, fully serializable rules engine for the One Piece Card Game,
plus a card dataset, an authoritative match server, and a web client — playable
locally on one device or against somebody else over a network.

## Two people can play, with all 155 cards

**As of 16 August 2026 the project is a game two people can play over a
network**, with the full ST-01, ST-02 and OP-01 card pool, and with neither
player's client ever holding what that player is not entitled to see.

That last clause is the whole of the work behind it, done in three steps:
[`playerView`](packages/engine/README.md) derives what one seat may see from
the state (PR #43), [`@optcg/server`](packages/server/README.md) routes and
redacts by delegating every game question to the engine (PR #44), and the
client renders a `PlayerView` and nothing else (PR #45). The opponent's hand is
a count of backs because that is what arrived; a blind choice — `OP01-038`
Kanjuro asking you to pick out of a hand you may not read — is answered by
opaque handle, over the wire and across a shared table alike.

The arbiter is a leak test that runs over every state of a full sweep, both
seats, checking that nothing the server emits contains the id of a card that
seat does not know — with the list of unknown cards computed from the opposite
side, so a bug in the redaction cannot excuse itself.

### How to play with somebody

Two commands, two browsers.

```bash
pnpm --filter @optcg/server start
```

```bash
pnpm dev
```

Open the client, choose **Play online** / **Jugar en red**, and **Create match**
/ **Crear partida**: the server answers with a match id and two seat codes. Keep
one, send the other to your opponent — that link is the whole of matchmaking,
and it is what they paste into **Join** / **Unirse**. The seat code is saved
locally, so a dropped connection comes back to the same seat with everything
that happened while it was away.

For one device and two players, **Play** / **Jugar** still opens the hot-seat
game it always did.

## It plays in Spanish

**Every card and every word of the interface reads in Spanish**, chosen with the
language picker on the setup screen, in the lobby, or from the action bar in the
middle of a game. English is still there and still the authority; the picker
switches between them live.

The One Piece Card Game has no official Spanish printing, so a Spanish-speaking
child cannot read the cards. That is the barrier this removes: the 155 card
texts of OP-01, ST-01 and ST-02 are translated in
[`packages/cards/data/cards.es.json`](packages/cards/data/cards.es.json),
against a single binding term table,
[`docs/i18n-glossary.md`](docs/i18n-glossary.md) — one Spanish word per
mechanic, on every card and every button, because a `[Blocker]` that is
"Bloqueador" here and "Defensor" there teaches nobody anything.

**The language never travels.** It is not in the protocol, not in an action, not
in the game state, and the server never learns it. Two players can read the same
match in two languages at once. Card names stay English in both — the art prints
"Monkey.D.Luffy", so the panel does too.

### How to change the language

Open the client and use the **Idioma / Language** picker: it is on the setup
screen, in the network lobby, and in the bar at the bottom during a game.
Changing it mid-match re-renders the board and the log and touches nothing else.
The choice is remembered; a fresh client with nothing remembered follows the
browser, which means Spanish when `navigator.language` starts with `es`.

## The board is the playsheet

The table is a calque of the official Bandai playmat, as a CSS grid with the
zones named the way the mat names them: Life down the outer edge, the Character
Area against the centre line, then Leader / Stage / Deck, then DON!! deck / Cost
Area / Trash, with the phase track in the free space the sheet prints it in.

**Two mats facing each other.** The opponent's half is the same grid with a
mirrored template, so both Character Areas meet at the battle line and their
Life falls on your right — and **nothing is rotated**, so every label on their
half reads the right way up. A rested card really does turn 90°, and the slots
are square so that turning it moves nothing else. Attached DON!! fan out from
under the card carrying them.

On a phone held upright the far half condenses to its Character Area, its Leader
and a row of counters, while yours keeps the whole sheet. It is the same
component and the same nine areas — a different template, not a different board.

[`docs/board-design.md`](docs/board-design.md) has the templates, the asset
policy, and what was decided where the printed sheet has nothing to say.

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
| [`@optcg/server`](packages/server/README.md) | The authoritative match server: routes, persists, replays, and answers no game question itself. |
| [`@optcg/client`](packages/client/README.md) | A React client for playing hot-seat on one device or networked against somebody else. |

## Quick start

```bash
pnpm install
```

```bash
pnpm test
```

`build`, `typecheck` and `test` are recursive: pnpm walks the workspace in
dependency order, so the engine is compiled before the packages that import its
`dist`. `test` runs with `--no-bail`, so all four packages report even when one
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

**The Spanish card text is an unofficial fan translation.** Bandai has published
no Spanish printing of this game; `packages/cards/data/cards.es.json` and the
client's Spanish interface are this project's own work, not endorsed by or
affiliated with the rights holders, and they carry no more licence than the rest
of this repository grants.

**No card images are redistributed.** This repository contains none — no card
art, no card backs, no playmats — and `packages/cards/tests/noTrackedArt.test.ts`
fails if one is ever committed. What ships instead is this project's own work: a
card back drawn as an SVG and a neutral playmat drawn in CSS, so a fresh clone
plays the whole game with nothing missing.

The client can show real card art, the official backs and themed playmats, but
only from a **local archive you supply yourself**, copied into a gitignored
directory:

```bash
pnpm --filter @optcg/cards run art
```

See [`packages/cards/README.md`](packages/cards/README.md) for where that
archive is expected and how to point at your own copy.

Without it the client draws its own tiles, its own card back and its own mat,
which is what a fresh clone does and what every screenshot of this project
should be assumed to show. When the archive is there, the mats it contains show
up in the playmat picker in the action bar — they are discovered from the
directory, so nothing here names them. That choice is per seat, local, and never
sent anywhere, exactly like the language.

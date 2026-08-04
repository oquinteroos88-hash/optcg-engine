# OPTCG Engine — Phase 0 Contract (SPEC)

Fixed contract for the Phase 0 rules engine. Shapes, signatures, and rules in this
document are binding: do not rename fields, change signatures, or alter rule
semantics. The one approved extension to the original task is marked below.

## Constraints

- TypeScript strict, Node 20+, ESM. Vitest for tests.
- Only runtime dependency: `immer`. Dev tooling: `typescript`, `vitest`, `@types/node`.
- All code in `packages/engine/`.
- `GameState` is 100% serializable: no classes, functions, `Map`/`Set`, `Date`,
  or `Math.random`. It must survive `JSON.parse(JSON.stringify(state))` with
  `toEqual` equality. State must never contain explicit `undefined` values
  (JSON round-trip drops those keys).
- Pure reducer: `applyAction(state, action)` never mutates its input, no I/O.
- No `throw` for illegal actions: return `{ ok: false, reason }`.
  `createGame` with a malformed decklist throws (programming error, not a move).
  Internal impossibilities after validation passed also throw (engine bugs must
  crash loudly so the simulation catches them).

## Game components

Per player: 1 Leader, a 50-card deck, and a separate 10-card DON!! deck.

## Setup

1. Shuffle each deck with the state RNG. Leader face up.
2. Draw 5. Each player may mulligan exactly once (return hand to deck, shuffle,
   draw 5 new). Mulligan decisions are sequential: `firstPlayer` decides first.
3. After both decisions, place face-down cards from the top of each deck as life,
   equal to the Leader's Life value. Convention: `life = deck.slice(0, N)` and
   `life[0]` is the former top of the deck.
4. `firstPlayer` takes the first turn.

## Turn structure (always this order)

1. **Refresh**: all your rested cards become active; all your given/attached
   DON!! return to your cost area in **active** state.
2. **Draw**: draw 1. The `firstPlayer` skips this on turn 1.
3. **DON!!**: move 2 DON!! from your DON!! deck to your cost area; the
   `firstPlayer` moves only 1 on turn 1. Cost area cap: 10 (add only up to the
   cap; gain = `min(2 or 1, donDeckRemaining, 10 - costAreaCount)`).
4. **Main**: player actions (below).
5. **End**: `endOfTurn` modifiers expire, once-per-turn flags clear, turn passes.
   NO hand size limit, no discard.

Refresh, Draw, and DON!! are automatic — they require no player action and run
as part of the turn transition. Deck-out is checked when the draw would occur.

## Main phase actions

- **Play card**: rest as many active DON!! in the cost area as the card's cost.
  DON!! are fungible: the engine picks which (first K active in array order).
  Characters enter the character area **active**. A Stage replaces the previous
  Stage, which goes to trash. Events go to trash after being played (no effects
  in this phase).
- **Attach DON!!**: move active DON!! from cost area onto your own Leader or
  Character. Each attached DON!! grants +1000 power.
- **Attack**: see combat.

`ATTACH_DON` is only legal in Main phase with `battle === null` — once an attack
is declared, no more attaching that battle.

## DON!! lifecycle

A DON!! is in `donDeck`, in `cost` (active or rested), or `attached` to a card.
Critical details:

- Attached DON!! return to the cost area during **their owner's Refresh**, not
  during the End phase. The +1000 persists through the opponent's turn, and
  attaching DON!! defensively is legal.
- If the carrier card leaves the field, its attached DON!! return to the cost
  area **rested**, not active.

## Combat — 4 steps, no backtracking

1. **Attack**: rest one of your active Leaders or Characters and declare a
   target. Valid targets: the enemy Leader, or an enemy Character in **rested**
   state. Never an active Character. A Character cannot attack the turn it was
   played (Rush is out of scope).
2. **Block**: the defender may rest a Character with the Blocker keyword to
   redirect the attack to it. In Phase 0 no card has Blocker, but the step must
   exist in the state machine (the defender explicitly passes).
3. **Counter**: the defender discards cards **from hand** for their printed
   Counter value, adding that power to any own Leader/Character on the field —
   even one not in the battle — until the end of the battle. Multiple counters
   allowed. No counters from the field.
4. **Damage**: compare powers. **The attacker wins ties** (`>=`).
   - Attacker wins vs a Character: that Character is KO'd (goes to trash).
   - Attacker wins vs the Leader: the top life card goes to the defender's
     **hand** (Triggers are out of scope).
   - Attacker loses: nothing happens. Damage is never bidirectional.

## Field limits

Max 5 Characters. Playing a 6th requires sending one of your Characters to the
trash; that discard is **not** a KO (no KO event). Max 1 Stage.

## Win conditions

- The opponent's Leader takes damage while they have 0 life cards (`lifeOut`).
- The opponent must draw and their deck is empty (`deckOut`).
- Concession (`concede`).

## Configurable rule

`rules.firstPlayerCannotAttackTurnOne` (default `true`): the starting player
cannot declare attacks on their first turn (global turn 1). Public sources
contradict each other on whether this also binds the second player; the flag
defaults to binding ONLY the first player. Documented in the README.

## State model (exact shapes)

```ts
type PlayerId = 'p1' | 'p2';
type CardId = string;        // "TEST-001", the printed card
type InstanceId = string;    // "p1-c14", this physical copy
type Orientation = 'active' | 'rested';

interface GameState {
  version: 1;
  matchId: string;
  status: 'mulligan' | 'playing' | 'finished';
  winner: PlayerId | null;
  endReason: 'lifeOut' | 'deckOut' | 'concede' | null;
  turn: number;
  activePlayer: PlayerId;
  firstPlayer: PlayerId;
  phase: 'refresh' | 'draw' | 'don' | 'main' | 'end';
  priority: PlayerId;              // who acts NOW (defender during block/counter)
  players: Record<PlayerId, PlayerState>;
  cards: Record<InstanceId, CardInstance>;
  battle: Battle | null;
  modifiers: Modifier[];
  rng: { seed: number; cursor: number };
  log: GameEvent[];
  rules: { firstPlayerCannotAttackTurnOne: boolean };
}

interface PlayerState {
  leader: InstanceId;
  characters: InstanceId[];        // max 5, order = board position
  stage: InstanceId | null;
  hand: InstanceId[];
  deck: InstanceId[];              // [0] = top
  trash: InstanceId[];             // [0] = most recent
  life: InstanceId[];              // [0] = top; damage takes from here
  don: DonCard[];                  // the 10 DON!!, each with its location
  hasMulliganed: boolean;
}

interface CardInstance {
  instanceId: InstanceId;
  cardId: CardId;
  owner: PlayerId;
  controller: PlayerId;
  orientation: Orientation;        // only relevant on the field
  attachedDon: InstanceId[];
  playedOnTurn: number | null;
}

interface DonCard {
  instanceId: InstanceId;
  location:
    | { kind: 'donDeck' }
    | { kind: 'cost'; orientation: Orientation }
    | { kind: 'attached'; to: InstanceId };
}

interface Battle {
  step: 'attack' | 'block' | 'counter' | 'damage';
  attacker: InstanceId;
  target: InstanceId;              // changes if a Blocker enters
  originalTarget: InstanceId;
  wasBlocked: boolean;
}

interface Modifier {
  id: string;
  target: InstanceId;
  kind: 'power';                   // only power in this phase
  value: number;
  duration: 'endOfBattle' | 'endOfTurn';
  source: InstanceId;
}
```

Power is NEVER stored — always derived:
`getPower(state, id) = basePower + attachedDon.length * 1000 + sum of modifiers`.

`CardDefinition` (static data: name, cost, power, counter, life, color,
category, keywords) lives in a separate registry and does NOT enter `GameState`;
the state only stores `cardId`. The `keywords: string[]` field (empty for every
Phase 0 card) exists so Blocker validation is honest.

Off-field cards are always normalized: `orientation: 'active'`,
`attachedDon: []`, `playedOnTurn: null`.

## Actions (exact union)

```ts
type Action =
  | { type: 'MULLIGAN'; player: PlayerId; accept: boolean }
  | { type: 'PLAY_CARD'; player: PlayerId; instanceId: InstanceId; trashCharacter?: InstanceId }
  | { type: 'ATTACH_DON'; player: PlayerId; to: InstanceId; count: number }
  | { type: 'DECLARE_ATTACK'; player: PlayerId; attacker: InstanceId; target: InstanceId }
  | { type: 'DECLARE_BLOCK'; player: PlayerId; blocker: InstanceId }
  | { type: 'PLAY_COUNTER'; player: PlayerId; instanceId: InstanceId; target: InstanceId }
  | { type: 'PASS'; player: PlayerId }
  | { type: 'END_TURN'; player: PlayerId }
  | { type: 'CONCEDE'; player: PlayerId };
```

**Approved extension** (user decision, the ONLY deviation from the original
union): `PLAY_CARD.trashCharacter?: InstanceId`. Required **iff** the board has
5 Characters and the played card is a Character: absent when full →
`trashChoiceRequired`; present when not full → `trashChoiceNotAllowed`; not one
of your on-board Characters → `invalidTrashChoice`.

## Public API (exact signatures)

```ts
interface Decklist { leader: CardId; cards: CardId[] /* exactly 50 */ }

function createGame(opts: { seed: number; decks: Record<PlayerId, Decklist>;
                            firstPlayer: PlayerId }): GameState;
function applyAction(state: GameState, action: Action):
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; reason: string };
function legalActions(state: GameState, player: PlayerId): Action[];
function getPower(state: GameState, id: InstanceId): number;
```

`legalActions` is pure and exhaustive (every legal action appears; every emitted
action validates ok). `applyAction` always revalidates — it never assumes the
action came from `legalActions`.

## RNG

Deterministic serializable PRNG (counter-based mulberry32) with
`{ seed, cursor }` in the state. Shuffling consumes cursor. Same seed + same
action sequence ⇒ byte-identical state.

## Test data

No real cards. Synthetic `TEST-xxx` vanilla set (no effects): costs 1–10, power
0–12000, counter 0/1000/2000, and 2 Leaders with Life 4 and Life 5 (both power
5000 so leader-vs-leader ties exist). Two 50-card monocolor decklists, mirrored
stat lines so equal-power matchups are guaranteed. All in
`packages/engine/src/testdata/`. No 0-cost cards (bot termination relies on it).

## Bot and simulation

Random bot: uniform over `legalActions` minus `CONCEDE` (documented deviation:
with concede in the pool, sims end by random concession and validate nothing),
choosing `END_TURN` only when it is the sole remaining option. The bot uses its
own RNG stream and never touches `state.rng`.

`pnpm sim -- --games 1000`: 1000 bot-vs-bot games with distinct seeds; prints
completed games, average turns, endReason distribution, and any crash with the
seed and action log to reproduce it.

## Acceptance criteria

1. 1000 bot games finish without exceptions or illegal actions.
2. No game exceeds 200 turns (if one does, it is a flow bug — report it, do not
   raise the limit).
3. Conservation: per player, the total number of card instances is constant and
   each instance is in exactly one zone. Same for the 10 DON!!.
4. Determinism: same seed + same action log ⇒ exact `toEqual`.
5. Serialization: `JSON.parse(JSON.stringify(state))` is `toEqual` to the
   original at every step.
6. Turn leak: with no battle in progress, `legalActions` of the non-acting
   player is exactly `[CONCEDE]`.
7. Field invariants: `characters.length <= 5`, at most 1 Stage, at most 10 DON!!
   in the cost area.

Criteria 3–7 run as assertions after EVERY action during the simulation (the
sim uses `node:assert.deepStrictEqual`, not vitest matchers).

Mandated unit tests: battle tie (attacker wins), illegal attack on an active
Character, first player's turn 1 (no draw, 1 DON), 10-DON cap, attached DON
returning rested when the carrier dies, Counter from hand adding power, 6th
character discard without KO, life-0 loss, deck-out loss.

import type { Action, Decklist, GameEvent, GameState, PlayerId, ViewEvent } from '@optcg/engine';
import {
  applyAction,
  createGame,
  legalActions,
  playerView,
  redactEvent,
  PLAYER_IDS,
} from '@optcg/engine';
import type { MatchState } from '../src/session.js';
import { createMatch, handleAction, rejoinPayload } from '../src/session.js';
import type { UpdatePayload } from '../src/protocol.js';
import { driveMatch } from '../tests/helpers.js';

/**
 * The measurements, as functions: `run.ts` prints them as tables and
 * `tests/budgets.test.ts` asserts on them, so the number in the doc and the
 * number in the test come from the same code path. Everything here is
 * deterministic — fixed seeds, the shared test policy, replayed action logs —
 * so two runs differ only by the clock, and the clock is `hrtime.bigint`.
 *
 * This lives outside `src/` on purpose: it imports whatever it needs from the
 * engine to take a thing apart and time the pieces, which is exactly the
 * freedom `tests/imports.test.ts` denies the server itself.
 */

export interface Summary {
  n: number;
  mean: number;
  p50: number;
  p95: number;
  max: number;
}

/** Nearest-rank percentiles over a copy; the input is left alone. */
export function summarize(samples: readonly number[]): Summary {
  if (samples.length === 0) {
    return { n: 0, mean: 0, p50: 0, p95: 0, max: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = (p: number): number => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] as number;
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    n: sorted.length,
    mean: total / sorted.length,
    p50: rank(0.5),
    p95: rank(0.95),
    max: sorted[sorted.length - 1] as number,
  };
}

function micros(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1000;
}

function bytesOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

export interface RecordedGame {
  seed: number;
  decklists: Record<PlayerId, Decklist>;
  /** The accepted log, as the session recorded it. */
  actions: Action[];
  /** The match at game end (or at the driver's cap), journals included. */
  match: MatchState;
}

/**
 * One sweep game through the session, kept as data. Every timing below
 * replays this log rather than deciding anew, so the policy's own cost never
 * lands in a number that claims to be the engine's or the server's.
 */
export function recordGame(seed: number, decklists: Record<PlayerId, Decklist>): RecordedGame {
  const run = driveMatch(seed, decklists);
  return { seed, decklists, actions: run.match.actions, match: run.match };
}

function replayQuiet(game: RecordedGame): GameState {
  let state = createGame({ seed: game.seed, decks: game.decklists, firstPlayer: 'p1' });
  for (const action of game.actions) {
    const result = applyAction(state, action);
    if (!result.ok) {
      throw new Error(`recorded log rejected at replay: ${result.reason}`);
    }
    state = result.state;
  }
  return state;
}

/**
 * `applyAction` alone, in microseconds per action. The warmup replay is the
 * whole game once, untimed, so the JIT has seen every reducer branch the log
 * reaches before the clock starts.
 */
export function measureApplyAction(game: RecordedGame, warmup = 1): number[] {
  for (let pass = 0; pass < warmup; pass += 1) {
    replayQuiet(game);
  }
  const samples: number[] = [];
  let state = createGame({ seed: game.seed, decks: game.decklists, firstPlayer: 'p1' });
  for (const action of game.actions) {
    const start = process.hrtime.bigint();
    const result = applyAction(state, action);
    samples.push(micros(start));
    if (!result.ok) {
      throw new Error(`recorded log rejected at replay: ${result.reason}`);
    }
    state = result.state;
  }
  return samples;
}

/**
 * The same clock, filed by action type: the p95 of the pooled sample is a
 * kind of action before it is a tail, and this is what names it.
 */
export function measureApplyActionByType(game: RecordedGame, warmup = 1): Map<string, number[]> {
  const samples = measureApplyAction(game, warmup);
  const byType = new Map<string, number[]>();
  for (const [index, action] of game.actions.entries()) {
    const bucket = byType.get(action.type) ?? [];
    bucket.push(samples[index] as number);
    byType.set(action.type, bucket);
  }
  return byType;
}

/**
 * Per accepted action, what the server pays above `applyAction`. The seat
 * work is timed piece by piece — the view, the affordances, the redaction
 * fold as `session.ts` runs it, the stringify the transport will do — and
 * then the real `handleAction` is timed whole on the same input, so the sum
 * of the pieces and the whole can be compared and any gap between them is a
 * cost this table did not name.
 */
export interface ServerCosts {
  /** Per action. */
  applyAction: number[];
  /** Per action: the whole of `handleAction`, `applyAction` included. */
  handleAction: number[];
  /** Per seat-emission. */
  playerView: number[];
  legalActions: number[];
  redaction: number[];
  stringify: number[];
  updateBytes: number[];
  /** Per seat, over the whole game. */
  bytesPerSeat: Record<PlayerId, number>;
  /** `joined` at game end, per seat. */
  rejoinBytes: Record<PlayerId, number>;
  /**
   * How many emissions carried a view byte-identical to the seat's previous
   * one — the number a "skip the unchanged seat" memo would be worth.
   */
  unchangedViews: Record<PlayerId, number>;
  match: MatchState;
}

function redactAsSessionDoes(
  state: GameState,
  seat: PlayerId,
  events: readonly GameEvent[],
  droppedChoices: string[],
): ViewEvent[] {
  const dropped = new Set(droppedChoices);
  const out: ViewEvent[] = [];
  for (const event of events) {
    const redacted = redactEvent(state, seat, event, dropped);
    if (redacted !== null) {
      out.push(redacted);
    }
  }
  for (const id of dropped) {
    if (!droppedChoices.includes(id)) {
      droppedChoices.push(id);
    }
  }
  return out;
}

function replaySession(game: RecordedGame): MatchState {
  let match = createMatch(game.seed, game.decklists);
  for (const action of game.actions) {
    const result = handleAction(match, match.game.priority, action);
    if (!result.ok) {
      throw new Error(`recorded log rejected by the session: ${result.reason}`);
    }
    match = result.match;
  }
  return match;
}

export function measureServerCosts(game: RecordedGame, warmup = 1): ServerCosts {
  for (let pass = 0; pass < warmup; pass += 1) {
    replaySession(game);
  }
  const costs: ServerCosts = {
    applyAction: [],
    handleAction: [],
    playerView: [],
    legalActions: [],
    redaction: [],
    stringify: [],
    updateBytes: [],
    bytesPerSeat: { p1: 0, p2: 0 },
    rejoinBytes: { p1: 0, p2: 0 },
    unchangedViews: { p1: 0, p2: 0 },
    match: createMatch(game.seed, game.decklists),
  };
  const dropped: Record<PlayerId, string[]> = { p1: [], p2: [] };
  const lastView: Record<PlayerId, string> = {
    p1: JSON.stringify(playerView(costs.match.game, 'p1')),
    p2: JSON.stringify(playerView(costs.match.game, 'p2')),
  };
  let match = costs.match;
  for (const action of game.actions) {
    const seat = match.game.priority;
    let start = process.hrtime.bigint();
    const applied = applyAction(match.game, action);
    costs.applyAction.push(micros(start));
    if (!applied.ok) {
      throw new Error(`recorded log rejected at replay: ${applied.reason}`);
    }
    for (const player of PLAYER_IDS) {
      start = process.hrtime.bigint();
      const view = playerView(applied.state, player);
      costs.playerView.push(micros(start));
      start = process.hrtime.bigint();
      const actions = legalActions(applied.state, player);
      costs.legalActions.push(micros(start));
      start = process.hrtime.bigint();
      const events = redactAsSessionDoes(applied.state, player, applied.events, dropped[player]);
      costs.redaction.push(micros(start));
      const payload: UpdatePayload = { type: 'update', view, events, actions };
      start = process.hrtime.bigint();
      const wire = JSON.stringify(payload);
      costs.stringify.push(micros(start));
      void wire;
      const viewWire = JSON.stringify(view);
      if (viewWire === lastView[player]) {
        costs.unchangedViews[player] += 1;
      }
      lastView[player] = viewWire;
    }
    start = process.hrtime.bigint();
    const result = handleAction(match, seat, action);
    costs.handleAction.push(micros(start));
    if (!result.ok) {
      throw new Error(`recorded log rejected by the session: ${result.reason}`);
    }
    match = result.match;
    // The bytes come from the real emission, so a divergence between the
    // pieces above and the session would show up here as a byte count.
    for (const player of PLAYER_IDS) {
      const bytes = bytesOf(result.emitted[player]);
      costs.updateBytes.push(bytes);
      costs.bytesPerSeat[player] += bytes;
    }
  }
  for (const player of PLAYER_IDS) {
    costs.rejoinBytes[player] = bytesOf(rejoinPayload(match, player));
  }
  costs.match = match;
  return costs;
}

/** A match at rest, in serialized bytes, split the way `MatchState` is. */
export interface MatchFootprint {
  total: number;
  game: number;
  /** `game.log` alone — the part of the state that is a history. */
  gameLog: number;
  actions: number;
  journal: Record<PlayerId, number>;
}

export function matchFootprint(match: MatchState): MatchFootprint {
  return {
    total: bytesOf(match),
    game: bytesOf(match.game),
    gameLog: bytesOf(match.game.log),
    actions: bytesOf(match.actions),
    journal: {
      p1: bytesOf(match.seats.p1.journal),
      p2: bytesOf(match.seats.p2.journal),
    },
  };
}

export interface HeapReport {
  n: number;
  heapBefore: number;
  heapAfter: number;
  delta: number;
  perMatch: number;
  meanActions: number;
  meanFootprint: number;
}

/**
 * The heap cost of holding `n` finished matches at once — the number
 * `MAX_MATCHES` is sized from. The matches are driven with the ability decks
 * over seeds `1..n`, each kept as nothing but its `MatchState` (the driver's
 * emissions are dropped), and the heap is read after a forced collection on
 * either side. Needs `node --expose-gc`; without it the delta would include
 * whatever garbage the driver left behind, which is not the question.
 */
export function measureHeap(n: number, decklists: Record<PlayerId, Decklist>): HeapReport {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc === undefined) {
    throw new Error('measureHeap needs a forced collection: run node with --expose-gc');
  }
  const held: MatchState[] = [];
  let actions = 0;
  let footprint = 0;
  gc();
  gc();
  const heapBefore = process.memoryUsage().heapUsed;
  for (let seed = 1; seed <= n; seed += 1) {
    const match = driveMatch(seed, decklists).match;
    held.push(match);
    actions += match.actions.length;
  }
  gc();
  gc();
  const heapAfter = process.memoryUsage().heapUsed;
  for (const match of held) {
    footprint += matchFootprint(match).total;
  }
  return {
    n: held.length,
    heapBefore,
    heapAfter,
    delta: heapAfter - heapBefore,
    perMatch: (heapAfter - heapBefore) / held.length,
    meanActions: actions / held.length,
    meanFootprint: footprint / held.length,
  };
}

export interface GrowthPoint {
  action: number;
  game: number;
  gameWithoutLog: number;
  actions: number;
  journal: number;
}

/**
 * How a match grows with its length: the serialized size of each part at
 * every checkpoint and at the end. `actions` and the journals are histories
 * and grow by design; `game.log` is one too. What must stay flat is the rest
 * of the state — the board — and `gameWithoutLog` is that number.
 */
export function measureGrowth(game: RecordedGame, checkpoints: readonly number[] = [50]): GrowthPoint[] {
  const points: GrowthPoint[] = [];
  const snapshot = (match: MatchState, action: number): void => {
    points.push({
      action,
      game: bytesOf(match.game),
      gameWithoutLog: bytesOf({ ...match.game, log: [] }),
      actions: bytesOf(match.actions),
      journal: bytesOf(match.seats.p1.journal),
    });
  };
  let match = createMatch(game.seed, game.decklists);
  for (const [index, action] of game.actions.entries()) {
    const result = handleAction(match, match.game.priority, action);
    if (!result.ok) {
      throw new Error(`recorded log rejected by the session: ${result.reason}`);
    }
    match = result.match;
    if (checkpoints.includes(index + 1)) {
      snapshot(match, index + 1);
    }
  }
  snapshot(match, game.actions.length);
  return points;
}

/** The seed with the most accepted actions among those given. */
export function longestGame(
  seeds: readonly number[],
  decklists: Record<PlayerId, Decklist>,
): { seed: number; actions: number; finished: boolean; game: RecordedGame } {
  let best: { seed: number; actions: number; finished: boolean; game: RecordedGame } | null = null;
  for (const seed of seeds) {
    const game = recordGame(seed, decklists);
    if (best === null || game.actions.length > best.actions) {
      best = {
        seed,
        actions: game.actions.length,
        finished: game.match.game.status === 'finished',
        game,
      };
    }
  }
  if (best === null) {
    throw new Error('longestGame needs at least one seed');
  }
  return best;
}

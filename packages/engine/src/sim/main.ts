import { runGame } from './runGame.js';
import type { GameFailure, GameStats } from './runGame.js';

interface CliOptions {
  games: number;
  seedBase: number;
  fast: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { games: 1000, seedBase: 1, fast: false };
  // pnpm forwards a bare "--" separator; accept it either way.
  const args = argv.filter((arg) => arg !== '--');
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const readNumber = (label: string): number => {
      const raw = args[i + 1];
      const value = Number(raw);
      if (raw === undefined || !Number.isFinite(value)) {
        throw new Error(`${label} requires a numeric value`);
      }
      i += 1;
      return value;
    };
    if (arg === '--games') {
      options.games = readNumber('--games');
    } else if (arg === '--seed-base') {
      options.seedBase = readNumber('--seed-base');
    } else if (arg === '--fast') {
      options.fast = true;
    } else if (arg !== undefined) {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index] ?? 0;
}

function report(stats: GameStats[], failures: GameFailure[], options: CliOptions, ms: number): void {
  const turns = stats.map((s) => s.turns).sort((a, b) => a - b);
  const totalTurns = turns.reduce((sum, t) => sum + t, 0);
  const totalActions = stats.reduce((sum, s) => sum + s.actions, 0);

  const byReason = new Map<string, number>();
  const byWinner = new Map<string, number>();
  for (const s of stats) {
    const reason = s.endReason ?? 'none';
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    const winner = s.winner ?? 'none';
    byWinner.set(winner, (byWinner.get(winner) ?? 0) + 1);
  }

  console.log('');
  console.log('=== OPTCG engine simulation ===');
  console.log(`mode              ${options.fast ? 'fast (sampled round-trip)' : 'full (spec-compliant)'}`);
  console.log(`games requested   ${options.games}`);
  console.log(`games completed   ${stats.length}`);
  console.log(`failures          ${failures.length}`);
  console.log(`wall time         ${(ms / 1000).toFixed(1)}s`);
  console.log('');
  if (stats.length > 0) {
    console.log(`turns  avg ${(totalTurns / stats.length).toFixed(2)}  min ${turns[0]}  p50 ${percentile(turns, 0.5)}  p95 ${percentile(turns, 0.95)}  max ${turns[turns.length - 1]}`);
    console.log(`actions avg ${(totalActions / stats.length).toFixed(1)}  total ${totalActions}`);
    console.log('');
    console.log('endReason distribution');
    for (const [reason, count] of [...byReason].sort((a, b) => b[1] - a[1])) {
      const pct = ((count / stats.length) * 100).toFixed(1);
      console.log(`  ${reason.padEnd(8)} ${String(count).padStart(5)}  ${pct.padStart(5)}%`);
    }
    console.log('');
    console.log('winners');
    for (const [winner, count] of [...byWinner].sort((a, b) => b[1] - a[1])) {
      const pct = ((count / stats.length) * 100).toFixed(1);
      console.log(`  ${winner.padEnd(8)} ${String(count).padStart(5)}  ${pct.padStart(5)}%`);
    }
  }

  if (failures.length > 0) {
    console.log('');
    console.log('=== FAILURES ===');
    for (const failure of failures.slice(0, 5)) {
      console.log('');
      console.log(`seed ${failure.seed} — ${failure.error}`);
      console.log(`failed at action index ${failure.actionIndex}`);
      console.log('repro: runGame(seed) or replay(seed, actions) with');
      console.log(JSON.stringify(failure.actions));
    }
    if (failures.length > 5) {
      console.log('');
      console.log(`... and ${failures.length - 5} more failing seeds: ${failures.slice(5).map((f) => f.seed).join(', ')}`);
    }
  }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const stats: GameStats[] = [];
  const failures: GameFailure[] = [];
  const started = Date.now();

  for (let i = 0; i < options.games; i += 1) {
    const seed = options.seedBase + i;
    const outcome = runGame(seed, { fast: options.fast });
    if (outcome.ok) {
      stats.push(outcome.stats);
    } else {
      failures.push(outcome.failure);
    }
  }

  report(stats, failures, options, Date.now() - started);
  process.exitCode = failures.length === 0 ? 0 : 1;
}

main();

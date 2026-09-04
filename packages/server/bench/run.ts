import { execSync } from 'node:child_process';
import { cpus } from 'node:os';
import { ABIL_DECK } from '@optcg/engine/testdata/abilityDecks';
import { GREEN_DECK, RED_DECK } from '@optcg/engine/testdata/decks';
import { clientAssetsDir, measureAssets, measureBreakdown, repoRoot } from './bundle.js';
import type { RecordedGame, Summary } from './measure.js';
import {
  longestGame,
  matchFootprint,
  measureApplyAction,
  measureApplyActionByType,
  measureGrowth,
  measureHeap,
  measureServerCosts,
  recordGame,
  summarize,
} from './measure.js';

/**
 * The harness's front door: runs every measurement in `measure.ts` and
 * `bundle.ts` over the fixed seeds and prints markdown, which is what
 * `docs/performance.md` is pasted from. Flags: `--no-heap` skips the
 * 256-match heap hold (the slow part), `--no-bundle` skips the client, and
 * `--heap-n=<n>` holds a different number of matches.
 *
 *   pnpm --filter @optcg/server run bench
 */

const ABILITY_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const VANILLA_SEEDS = [1, 2, 3, 4];
/** Where the longest game is looked for: the sweep seeds and the next batch. */
const LONGEST_SCAN = Array.from({ length: 48 }, (_, index) => index + 1);
const ABILITIES = { p1: ABIL_DECK, p2: ABIL_DECK };
const VANILLA = { p1: RED_DECK, p2: GREEN_DECK };

const args = new Set(process.argv.slice(2));
const heapN = Number(
  process.argv.find((arg) => arg.startsWith('--heap-n='))?.slice('--heap-n='.length) ?? 256,
);

function us(value: number): string {
  return value.toFixed(value < 10 ? 2 : 1);
}

function kib(bytes: number): string {
  return (bytes / 1024).toFixed(1);
}

function mib(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function row(cells: (string | number)[]): string {
  return `| ${cells.join(' | ')} |`;
}

function table(header: string[], rows: (string | number)[][]): string {
  return [row(header), row(header.map(() => '---')), ...rows.map(row)].join('\n');
}

function summaryRow(label: string, summary: Summary): (string | number)[] {
  return [label, summary.n, us(summary.mean), us(summary.p50), us(summary.p95), us(summary.max)];
}

function git(command: string): string {
  try {
    return execSync(command, { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function section(title: string): void {
  process.stdout.write(`\n### ${title}\n\n`);
}

process.stdout.write('## Environment\n\n');
process.stdout.write(
  table(
    ['', ''],
    [
      ['Date', new Date().toISOString().slice(0, 10)],
      ['Commit', git('git rev-parse --short HEAD')],
      ['Node', process.version],
      ['CPU', `${cpus()[0]?.model.trim() ?? 'unknown'} × ${cpus().length}`],
      ['Platform', `${process.platform} ${process.arch}`],
      ['Ability seeds', ABILITY_SEEDS.join(', ')],
      ['Vanilla seeds', VANILLA_SEEDS.join(', ')],
    ],
  ),
);
process.stdout.write('\n');

// a. applyAction alone.
section('applyAction alone (µs per action)');
const abilityGames: RecordedGame[] = ABILITY_SEEDS.map((seed) => recordGame(seed, ABILITIES));
const vanillaGames: RecordedGame[] = VANILLA_SEEDS.map((seed) => recordGame(seed, VANILLA));
const perSeed: (string | number)[][] = [];
const pooled = { abilities: [] as number[], vanilla: [] as number[] };
const byType = new Map<string, number[]>();
for (const game of abilityGames) {
  const samples: number[] = [];
  for (const [type, typed] of measureApplyActionByType(game)) {
    samples.push(...typed);
    byType.set(type, [...(byType.get(type) ?? []), ...typed]);
  }
  pooled.abilities.push(...samples);
  perSeed.push(summaryRow(`abilities ${game.seed}`, summarize(samples)));
}
for (const game of vanillaGames) {
  const samples = measureApplyAction(game);
  pooled.vanilla.push(...samples);
  perSeed.push(summaryRow(`vanilla ${game.seed}`, summarize(samples)));
}
const header = ['', 'actions', 'mean', 'p50', 'p95', 'max'];
process.stdout.write(
  table(header, [
    summaryRow('abilities 1–12 pooled', summarize(pooled.abilities)),
    summaryRow('vanilla 1–4 pooled', summarize(pooled.vanilla)),
  ]),
);
process.stdout.write('\n\n');
process.stdout.write(table(header, perSeed));
process.stdout.write('\n');

section('applyAction by action type, ability seeds 1–12 (µs)');
const typed = [...byType.entries()]
  .map(([type, samples]) => ({ type, summary: summarize(samples) }))
  .sort((a, b) => b.summary.mean - a.summary.mean);
const spent = typed.reduce((sum, entry) => sum + entry.summary.mean * entry.summary.n, 0);
process.stdout.write(
  table(
    ['type', 'actions', 'mean', 'p50', 'p95', 'max', 'share of time'],
    typed.map((entry) => [
      ...summaryRow(entry.type, entry.summary),
      `${((100 * entry.summary.mean * entry.summary.n) / spent).toFixed(1)}%`,
    ]),
  ),
);
process.stdout.write('\n');

// b + c. The server's per-action work, and the wire.
section('Per accepted action, ability seeds 1–12 pooled (µs)');
const costs = abilityGames.map((game) => measureServerCosts(game));
const pool = (key: 'applyAction' | 'handleAction' | 'playerView' | 'legalActions' | 'redaction' | 'stringify' | 'updateBytes'): number[] =>
  costs.flatMap((cost) => cost[key]);
const apply = summarize(pool('applyAction'));
const handle = summarize(pool('handleAction'));
process.stdout.write(
  table(
    ['', 'samples', 'mean', 'p50', 'p95', 'max'],
    [
      summaryRow('applyAction (per action)', apply),
      summaryRow('playerView (per seat)', summarize(pool('playerView'))),
      summaryRow('legalActions (per seat)', summarize(pool('legalActions'))),
      summaryRow('redaction fold (per seat)', summarize(pool('redaction'))),
      summaryRow('JSON.stringify(update) (per seat)', summarize(pool('stringify'))),
      summaryRow('handleAction, whole (per action)', handle),
      ['overhead above applyAction (mean)', '', us(handle.mean - apply.mean), '', '', ''],
    ],
  ),
);
const unchanged = costs.reduce((sum, cost) => sum + cost.unchangedViews.p1 + cost.unchangedViews.p2, 0);
process.stdout.write(
  `\nEmissions whose view was byte-identical to the seat's previous one: ${unchanged} of ${pool('playerView').length}.\n`,
);

section('Wire: `update` bytes per seat-emission, ability seeds 1–12');
const bytes = summarize(pool('updateBytes'));
const perGame = costs.flatMap((cost) => [cost.bytesPerSeat.p1, cost.bytesPerSeat.p2]);
const rejoin = costs.flatMap((cost) => [cost.rejoinBytes.p1, cost.rejoinBytes.p2]);
process.stdout.write(
  table(
    ['', 'mean', 'p95', 'max'],
    [
      ['`update` (KiB)', kib(bytes.mean), kib(bytes.p95), kib(bytes.max)],
      ['bytes sent per seat per game (KiB)', kib(summarize(perGame).mean), kib(summarize(perGame).p95), kib(summarize(perGame).max)],
      ['`joined` at game end (KiB)', kib(summarize(rejoin).mean), kib(summarize(rejoin).p95), kib(summarize(rejoin).max)],
    ],
  ),
);
process.stdout.write('\n');

// d. A match at rest.
section('A match at rest, serialized (KiB, mean over ability seeds 1–12)');
const footprints = costs.map((cost) => matchFootprint(cost.match));
const mean = (pick: (footprint: (typeof footprints)[number]) => number): string =>
  kib(footprints.reduce((sum, footprint) => sum + pick(footprint), 0) / footprints.length);
const max = (pick: (footprint: (typeof footprints)[number]) => number): string =>
  kib(Math.max(...footprints.map(pick)));
process.stdout.write(
  table(
    ['part', 'mean', 'max'],
    [
      ['whole `MatchState`', mean((f) => f.total), max((f) => f.total)],
      ['`game` (with its log)', mean((f) => f.game), max((f) => f.game)],
      ['`game.log` alone', mean((f) => f.gameLog), max((f) => f.gameLog)],
      ['`actions`', mean((f) => f.actions), max((f) => f.actions)],
      ['`seats.p1.journal`', mean((f) => f.journal.p1), max((f) => f.journal.p1)],
      ['`seats.p2.journal`', mean((f) => f.journal.p2), max((f) => f.journal.p2)],
    ],
  ),
);
process.stdout.write('\n');

if (!args.has('--no-heap')) {
  section(`Heap: ${heapN} finished matches held at once`);
  const heap = measureHeap(heapN, ABILITIES);
  process.stdout.write(
    table(
      ['', ''],
      [
        ['matches held', heap.n],
        ['mean actions per match', heap.meanActions.toFixed(0)],
        ['heapUsed before (MiB)', mib(heap.heapBefore)],
        ['heapUsed after (MiB)', mib(heap.heapAfter)],
        ['delta (MiB)', mib(heap.delta)],
        ['per match (KiB)', kib(heap.perMatch)],
        ['mean serialized footprint (KiB)', kib(heap.meanFootprint)],
      ],
    ),
  );
  process.stdout.write('\n');
}

// e. Long life.
section('Growth over the longest game');
const longest = longestGame(LONGEST_SCAN, ABILITIES);
process.stdout.write(
  `Longest of seeds ${LONGEST_SCAN[0]}–${LONGEST_SCAN[LONGEST_SCAN.length - 1]} with the ability decks: seed ${longest.seed}, ${longest.actions} actions, ${longest.finished ? 'finished' : 'hit the driver cap'}.\n\n`,
);
const points = measureGrowth(longest.game, [50, 100, 200]);
process.stdout.write(
  table(
    ['at action', '`game` (KiB)', '`game` without log (KiB)', '`actions` (KiB)', '`journal` p1 (KiB)'],
    points.map((point) => [point.action, kib(point.game), kib(point.gameWithoutLog), kib(point.actions), kib(point.journal)]),
  ),
);
const first = points[0];
const last = points[points.length - 1];
if (first !== undefined && last !== undefined && first !== last) {
  process.stdout.write(
    `\nBoard state (game without log) end / at ${first.action}: ×${(last.gameWithoutLog / first.gameWithoutLog).toFixed(2)}.\n`,
  );
}

// f. The client bundle.
if (!args.has('--no-bundle')) {
  const root = repoRoot(import.meta.dirname);
  section('Client bundle: `packages/client/dist/assets`');
  const assets = measureAssets(clientAssetsDir(root));
  process.stdout.write(
    table(
      ['file', 'raw (KiB)', 'gzip (KiB)'],
      [
        ...assets.files.map((file) => [file.file, kib(file.raw), kib(file.gzip)]),
        ['**total**', `**${kib(assets.raw)}**`, `**${kib(assets.gzip)}**`],
      ],
    ),
  );
  process.stdout.write('\n');
  section('Client bundle breakdown (measurement build with named chunks)');
  const breakdown = measureBreakdown(root, process.env['OPTCG_BREAKDOWN_DIR']);
  const groupTotal = Object.values(breakdown.groups).reduce((sum, group) => sum + group.gzip, 0);
  process.stdout.write(
    table(
      ['group', 'raw (KiB)', 'gzip (KiB)', 'share of gzip'],
      [
        ...Object.entries(breakdown.groups)
          .sort((a, b) => b[1].gzip - a[1].gzip)
          .map(([name, size]) => [name, kib(size.raw), kib(size.gzip), `${((100 * size.gzip) / groupTotal).toFixed(1)}%`]),
        ['**total**', '', `**${kib(groupTotal)}**`, ''],
      ],
    ),
  );
  process.stdout.write('\n');
}

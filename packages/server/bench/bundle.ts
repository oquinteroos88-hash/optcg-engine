import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * The client bundle, weighed. Two numbers: what `vite build` shipped to
 * `packages/client/dist/assets` (raw and gzip, per file), and a breakdown by
 * origin from a second build that groups the same modules into named chunks.
 * The second build is a measurement, never the shipping config — it runs
 * from `packages/client/scripts/bundleBreakdown.mjs` because `vite` is the
 * client's dependency, not this package's.
 */

export interface FileSize {
  file: string;
  raw: number;
  gzip: number;
}

export interface BundleReport {
  dir: string;
  files: FileSize[];
  raw: number;
  gzip: number;
}

/** Walks up from `from` to the workspace root, the directory with the workspace file. */
export function repoRoot(from: string): string {
  let dir = from;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`no pnpm-workspace.yaml above ${from}`);
    }
    dir = parent;
  }
}

export function gzipBytes(content: Buffer): number {
  return gzipSync(content, { level: 9 }).length;
}

/**
 * Every file under a build's `assets/`, weighed. Throws if the directory is
 * missing rather than reporting zero: a bundle that was not built is not a
 * bundle that weighs nothing.
 */
export function measureAssets(dir: string): BundleReport {
  if (!existsSync(dir)) {
    throw new Error(`no client bundle at ${dir}: run \`pnpm run build\` first`);
  }
  const files: FileSize[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (!statSync(path).isFile()) {
      continue;
    }
    const content = readFileSync(path);
    files.push({ file: name, raw: content.length, gzip: gzipBytes(content) });
  }
  return {
    dir,
    files,
    raw: files.reduce((sum, file) => sum + file.raw, 0),
    gzip: files.reduce((sum, file) => sum + file.gzip, 0),
  };
}

export function clientAssetsDir(root: string): string {
  return join(root, 'packages', 'client', 'dist', 'assets');
}

export interface BreakdownReport {
  outDir: string;
  files: (FileSize & { group: string })[];
  groups: Record<string, { raw: number; gzip: number }>;
}

/**
 * The grouped build, run in the client package with node and the client's
 * own vite. `outDir` defaults to a temp directory; the shipping `dist/` is
 * never written to.
 */
export function measureBreakdown(root: string, outDir = join(tmpdir(), 'optcg-bundle-breakdown')): BreakdownReport {
  const script = join(root, 'packages', 'client', 'scripts', 'bundleBreakdown.mjs');
  const stdout = execFileSync(process.execPath, [script, outDir], {
    cwd: join(root, 'packages', 'client'),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout) as BreakdownReport;
}

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

/**
 * The shipped bundle, weighed after `vite build`: every file under
 * `dist/assets`, gzipped at level 9 the way a static host would serve it.
 * CI builds before it tests, so the directory exists there; locally a missing
 * build fails with the command to run rather than passing on nothing.
 *
 * The budget is the measurement with air, not a target: 108.7 KiB gzip at the
 * baseline (`docs/performance.md`), ×1.25 rounded up to a clean number. It
 * moves when a feature earns the bytes, in the same commit, with the number.
 */
const ASSETS = join(import.meta.dirname, '..', 'dist', 'assets');
const GZIP_BUDGET_KIB = 140;

function gzipKib(dir: string): number {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isFile()) {
      total += gzipSync(readFileSync(path), { level: 9 }).length;
    }
  }
  return total / 1024;
}

describe('the shipped bundle', () => {
  it('weighs under the budget, gzipped', () => {
    if (!existsSync(ASSETS)) {
      throw new Error(`no client bundle at ${ASSETS}: run \`pnpm run build\` first`);
    }
    const total = gzipKib(ASSETS);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(GZIP_BUDGET_KIB);
  });
});

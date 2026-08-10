import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The pnpm version is declared twice in the root manifest, and the two must
 * agree.
 *
 * `packageManager` is what Corepack and `pnpm/action-setup` read — CI installs
 * from that field and nothing else, which is why `.github/workflows/ci.yml`
 * says the pin "lives in one place". It does not: `devDependencies.pnpm` names
 * a version too, and it is the one a developer running `pnpm install` locally
 * ends up with. Nothing checks that they match, so bumping one and forgetting
 * the other would leave CI and the working copy on different pnpm versions —
 * the failure mode where a lockfile resolves differently in the two places and
 * `--frozen-lockfile` fails for reasons nobody can reproduce locally.
 *
 * It lives in the engine suite for want of a repo-level one: `pnpm -r run test`
 * has no root project to hang a test on, and of the three packages this is the
 * one whose suite is never skipped.
 */

interface RootManifest {
  packageManager?: string;
  devDependencies?: Record<string, string>;
}

const root = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
) as RootManifest;

describe('the root manifest pins one pnpm version', () => {
  it('declares packageManager as pnpm@<version>', () => {
    expect(root.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
  });

  it('declares the same version in devDependencies.pnpm', () => {
    const pinned = (root.packageManager ?? '').replace(/^pnpm@/, '');
    // An exact version, not a range: `^10.13.1` would let a local install drift
    // away from the one CI provisions while still looking like a match.
    expect(root.devDependencies?.['pnpm']).toBe(pinned);
  });
});

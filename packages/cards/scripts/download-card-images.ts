/**
 * Downloads the ST-01/ST-02 card art into the client's gitignored cache.
 *
 * Run by hand — never from build, never from test, never from CI:
 *
 *     pnpm --filter @optcg/cards run images
 *
 * **Nothing this writes is ever committed.** The destination is
 * `packages/client/public/cards/`, which is in `.gitignore`, and
 * `tests/noTrackedArt.test.ts` fails if an image file ever enters the index.
 * The card art belongs to its owners; the root README says this repository
 * redistributes none of it, and that sentence has to stay true.
 *
 * A fresh clone therefore has no images, and that is the normal case rather
 * than a broken one: `CardTile` falls back to the CSS tile it has always drawn.
 * Deleting this directory is a supported thing to do.
 *
 * Idempotent: a file that is already there is skipped, not re-fetched.
 *
 * Requires Node >= 22.6 for TypeScript type stripping, and network access.
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STARTER_IMAGE_URLS } from '../dist/starterImages.generated.js';

/**
 * Kept next to the client rather than in this package because Vite serves
 * `public/` verbatim: the file that lands at `public/cards/ST01-001.png` is
 * reachable at `/cards/ST01-001.png` with no build step and no import.
 */
const DEST = new URL('../../client/public/cards/', import.meta.url);

/** The extension is read off the address rather than assumed. */
function fileNameFor(cardId: string, url: string): string {
  const path = new URL(url).pathname;
  const dot = path.lastIndexOf('.');
  const extension = dot === -1 ? '.png' : path.slice(dot);
  return `${cardId}${extension}`;
}

async function main(): Promise<void> {
  mkdirSync(DEST, { recursive: true });
  const entries = Object.entries(STARTER_IMAGE_URLS).sort(([a], [b]) => a.localeCompare(b));
  process.stdout.write(`${entries.length} cards -> ${fileURLToPath(DEST)}\n`);

  let downloaded = 0;
  let skipped = 0;
  let bytes = 0;
  const failed: string[] = [];

  for (const [cardId, url] of entries) {
    const target = new URL(fileNameFor(cardId, url), DEST);
    if (existsSync(target) && statSync(target).size > 0) {
      skipped += 1;
      continue;
    }
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length === 0) {
        throw new Error('empty body');
      }
      // Written whole: a half-written file would be skipped on the next run and
      // would then be a permanently broken image nobody re-fetches.
      writeFileSync(target, body);
      downloaded += 1;
      bytes += body.length;
      process.stdout.write(`  ${cardId} ${(body.length / 1024).toFixed(0)} KB\n`);
    } catch (error) {
      failed.push(`${cardId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  process.stdout.write(
    `\ndownloaded ${downloaded} (${(bytes / 1024 / 1024).toFixed(1)} MB), skipped ${skipped}, failed ${failed.length}\n`,
  );
  for (const line of failed) {
    process.stdout.write(`  FAILED ${line}\n`);
  }
  // A failure is reported, not thrown: the client degrades to its CSS tiles for
  // whatever is missing, so a partial cache is a usable cache.
  if (failed.length > 0) {
    process.stdout.write('\nThe client falls back to its text tiles for these.\n');
  }
}

await main();

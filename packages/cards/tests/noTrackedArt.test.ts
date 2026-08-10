import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STARTER_IMAGE_URLS, starterCards } from '../src/starters.js';

/**
 * The repository redistributes no card art, and this is what keeps that true.
 *
 * The root README says so in its scope note, and until now it was a claim
 * nobody checked: `scripts/download-card-images.ts` writes real image files
 * into the working tree, and a `git add -A` on a bad day would commit 6.5 MB of
 * somebody else's artwork. `.gitignore` covers the one directory the script
 * writes to; this covers every directory, including the ones a future script
 * has not invented yet.
 *
 * It reads the index rather than the filesystem on purpose. An image sitting
 * untracked in the working tree is exactly the intended state — that is what
 * the local cache *is*. What must never happen is one entering git.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const IMAGE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.bmp',
  '.tif',
  '.tiff',
];

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((line) => line !== '');
}

describe('no card art is tracked by git', () => {
  const tracked = trackedFiles();

  it('reads a non-empty index, so the assertion below is not vacuous', () => {
    expect(tracked.length).toBeGreaterThan(50);
    expect(tracked).toContain('package.json');
  });

  it('tracks no image file anywhere in the repository', () => {
    const images = tracked.filter((file) =>
      IMAGE_EXTENSIONS.some((extension) => file.toLowerCase().endsWith(extension)),
    );
    // Not "no image under public/cards": any image at all. The point is the
    // README's claim, and that claim is about the repository, not a directory.
    expect(images).toEqual([]);
  });

  it('ignores the directory the download script writes to', () => {
    const ignored = execFileSync(
      'git',
      ['check-ignore', '--', 'packages/client/public/cards/ST01-001.png'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    ).trim();
    expect(ignored).not.toBe('');
  });
});

describe('every starter card has an image address to ask for', () => {
  it('covers all 34, and nothing else', () => {
    // Coverage of the module, not of the cache: a card missing here could never
    // be downloaded at all, which is a different failure from a card whose file
    // is simply not on this machine.
    expect(Object.keys(STARTER_IMAGE_URLS).sort()).toEqual(
      starterCards.map((card) => card.cardId).sort(),
    );
    expect(starterCards).toHaveLength(34);
  });

  it('addresses the pinned upstream host, with the version the dataset carries', () => {
    for (const [cardId, url] of Object.entries(STARTER_IMAGE_URLS)) {
      const parsed = new URL(url);
      expect(parsed.protocol, cardId).toBe('https:');
      expect(parsed.host, cardId).toBe('en.onepiece-cardgame.com');
      expect(parsed.pathname, cardId).toBe(`/images/cardlist/card/${cardId}.png`);
      // The reason these are read from the dataset instead of templated: the
      // real record carries a cache-busting query, and nobody here knows
      // whether dropping it is safe.
      expect(parsed.search, cardId).not.toBe('');
    }
  });
});

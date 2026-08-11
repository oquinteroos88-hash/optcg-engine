import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { starterCards } from '../src/starters.js';
import { archivePaths, artSource, donArtPath } from '../scripts/card-art-source.ts';

/**
 * The repository redistributes no card art, and this is what keeps that true.
 *
 * The root README says so in its scope note. It is not a claim anyone can hold
 * in their head: there is now a 458 MB archive of artwork sitting inside the
 * working tree and a script that copies out of it, so a `git add -A` on a bad
 * day is all it would take. `.gitignore` covers the directories in play today;
 * this covers every directory, including the ones a future script has not
 * invented yet.
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

  it('ignores every path the art ever occupies', () => {
    // The archive, the per-machine config that points at it, and the copy the
    // client serves. Checked through git itself rather than by reading
    // .gitignore, so a rule that looks right but does not match still fails.
    for (const path of [
      'packages/cards/card-art/ST01/ST01-001.png',
      'packages/cards/card-art/ST01/ST01-001_small.jpg',
      'packages/cards/card-art/Don/Don.png',
      'packages/cards/card-art.local.json',
      'packages/client/public/cards/ST01-001.png',
      'packages/client/public/cards/ST01-001_small.jpg',
      'packages/client/public/cards/don.png',
      // And anywhere at all, under any name a future script picks.
      'somewhere/else/entirely.png',
    ]) {
      const ignored = execFileSync('git', ['check-ignore', '--', path], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }).trim();
      expect(ignored, path).not.toBe('');
    }
  });
});

describe('every starter card resolves to an archive path, by name alone', () => {
  it('derives both sizes from the card id, with no table and no special cases', () => {
    // The whole mapping. `ST01-004` is `ST01/ST01-004.png` and
    // `ST01/ST01-004_small.jpg`, which is why nothing in this repository stores
    // an image address and `CardDefinition` gains no presentation field.
    const dir = '/archive';
    for (const card of starterCards) {
      const { small, large } = archivePaths(dir, card.cardId);
      const set = card.cardId.split('-')[0];
      expect(small.replace(/\\/g, '/'), card.cardId).toContain(`${set}/${card.cardId}_small.jpg`);
      expect(large.replace(/\\/g, '/'), card.cardId).toContain(`${set}/${card.cardId}.png`);
    }
    expect(starterCards).toHaveLength(34);
    // Two sets, and both are real folders of the archive layout.
    expect([...new Set(starterCards.map((card) => card.cardId.split('-')[0]))].sort()).toEqual([
      'ST01',
      'ST02',
    ]);
  });

  it('keeps the DON!! art out of the per-card scheme, because it is not a card of the set', () => {
    // `resolve` absolutizes against the drive on Windows, so the claim is the
    // tail of the path, which is the part this function decides.
    expect(donArtPath('/archive').replace(/\\/g, '/')).toMatch(/[/]archive[/]Don[/]Don\.png$/);
  });

  it('resolves an archive location without needing one to exist', () => {
    // A machine with no archive is a normal machine: the source resolves, says
    // where it looked, and reports that nothing is there. Nothing throws.
    const source = artSource();
    expect(source.dir).not.toBe('');
    expect(['env', 'card-art.local.json', 'default']).toContain(source.from);
    expect(typeof source.exists).toBe('boolean');
  });
});

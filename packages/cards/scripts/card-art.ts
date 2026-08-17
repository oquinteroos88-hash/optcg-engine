/**
 * Publishes the starter cards' art from the local archive into the client.
 *
 * Run by hand — never from build, never from test, never from CI:
 *
 *     pnpm --filter @optcg/cards run art
 *
 * **Nothing this writes is ever committed.** Source and destination are both
 * gitignored, and `tests/noTrackedArt.test.ts` fails if an image file anywhere
 * reaches the git index. The artwork belongs to its owners; the root README
 * says this repository redistributes none of it, and that has to stay true.
 *
 * A machine with no archive is a normal machine: the script says what is
 * missing and exits without failing, and the client falls back to the CSS tiles
 * it has always drawn. Deleting the destination is a supported thing to do.
 *
 * Idempotent: a file already in place with the right size is skipped.
 *
 * Requires Node >= 22.6 for TypeScript type stripping. Nothing else.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STARTER_DECKLISTS } from '../dist/starters.generated.js';
import {
  archivePaths,
  artSource,
  cardBackPath,
  donArtPath,
  donBackPath,
  playmatDir,
  playmatEntries,
} from './card-art-source.ts';

/** Vite serves `public/` verbatim, so this lands at `/cards/<file>`. */
const DEST = new URL('../../client/public/cards/', import.meta.url);

/** Every card of both starter decks, Leader included, deduplicated. */
function starterCardIds(): string[] {
  const ids = new Set<string>();
  for (const deck of STARTER_DECKLISTS) {
    ids.add(deck.leader);
    for (const entry of deck.cards) {
      ids.add(entry.cardId);
    }
  }
  return [...ids].sort();
}

/**
 * Symlink if the platform allows it, copy otherwise.
 *
 * Windows needs Developer Mode or an elevated shell to create a symlink, and
 * refuses with EPERM without them — which is a configuration of the machine,
 * not a failure of this script. The files are 5 KB and 190 KB; copying 68 of
 * them is not worth telling anyone to change their Windows settings over.
 */
type Method = 'symlink' | 'copy';

function place(from: string, to: string, preferred: Method): Method {
  if (preferred === 'symlink') {
    try {
      symlinkSync(from, to, 'file');
      return 'symlink';
    } catch {
      // Falls through to a copy, and the caller stops trying for the rest.
    }
  }
  copyFileSync(from, to);
  return 'copy';
}

function upToDate(target: string, source: string): boolean {
  if (!existsSync(target)) {
    return false;
  }
  try {
    return statSync(target).size === statSync(source).size;
  } catch {
    return false;
  }
}

function main(): void {
  const source = artSource();
  process.stdout.write(`archive: ${source.dir}  (from ${source.from})\n`);
  if (!source.exists) {
    process.stdout.write(
      '\nNo archive there, so nothing was copied.\n' +
        'Point at one with OPTCG_CARD_ART_DIR, or with card-art.local.json.\n' +
        'The client plays fine without it — it draws its own tiles.\n',
    );
    return;
  }

  mkdirSync(DEST, { recursive: true });
  const ids = starterCardIds();
  process.stdout.write(`${ids.length} cards -> ${fileURLToPath(DEST)}\n`);

  let placed = 0;
  let skipped = 0;
  let method: Method = 'symlink';
  const missing: string[] = [];

  const publish = (from: string, name: string): void => {
    if (!existsSync(from)) {
      missing.push(name);
      return;
    }
    const to = fileURLToPath(new URL(name, DEST));
    if (upToDate(to, from)) {
      skipped += 1;
      return;
    }
    if (existsSync(to)) {
      unlinkSync(to);
    }
    method = place(from, to, method);
    placed += 1;
  };

  for (const cardId of ids) {
    const { small, large } = archivePaths(source.dir, cardId);
    // Both sizes, because the client uses both: the small JPEG on the board
    // tiles, the large PNG in the preview panel.
    publish(small, `${cardId}_small.jpg`);
    publish(large, `${cardId}.png`);
  }
  // One shared image for every DON!! zone; it is a card, not a card of the set.
  publish(donArtPath(source.dir), 'don.png');

  // The optional extras: the two backs and however many playmats are there.
  publish(cardBackPath(source.dir), 'CardBackRegular.png');
  publish(donBackPath(source.dir), 'DonBack.png');
  const mats = playmatEntries(source.dir);
  if (mats.length > 0) {
    mkdirSync(new URL('playmats/', DEST), { recursive: true });
    for (const mat of mats) {
      publish(resolve(playmatDir(source.dir), `${mat.id}.png`), mat.file);
    }
  }

  // The manifest: the only way the client learns any of this exists.
  //
  // Vite serves `public/` verbatim with no index, so a browser cannot list the
  // folder, and probing for filenames would mean hardcoding which mats are
  // allowed to exist. Writing down what was actually placed is the detection.
  // It lands inside the gitignored destination, so it is never committed
  // either, and a machine with no archive returns above and writes none — the
  // client's fetch 404s and it draws its own back and its own mat.
  const manifest = {
    version: 1,
    cardBack: existsSync(cardBackPath(source.dir)) ? 'CardBackRegular.png' : null,
    donBack: existsSync(donBackPath(source.dir)) ? 'DonBack.png' : null,
    playmats: mats,
  };
  writeFileSync(fileURLToPath(new URL('manifest.json', DEST)), `${JSON.stringify(manifest, null, 2)}\n`);

  // `method` only means anything if something was actually placed by it.
  const how = placed === 0 ? '' : ` by ${method}`;
  process.stdout.write(`\nplaced ${placed}${how}, skipped ${skipped}, missing ${missing.length}\n`);
  if (missing.length > 0) {
    // The list that matters: a card the archive does not have is a hole a
    // player finds mid-game, and it should be named here first.
    process.stdout.write('\nnot in the archive:\n');
    for (const name of missing.sort()) {
      process.stdout.write(`  ${name}\n`);
    }
    process.stdout.write('\nThe client draws its text tile for these.\n');
  }
}

main();

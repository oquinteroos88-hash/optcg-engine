import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isAbsolute, resolve } from 'node:path';

/**
 * Where the local card-art archive lives.
 *
 * The archive is 458 MB of artwork that belongs to its owners. It is never
 * committed, never redistributed, and not everyone has it — so its location is
 * a per-machine setting, not a constant, and a missing archive is a normal
 * state rather than an error.
 *
 * Three ways to say where it is, first one wins:
 *
 *   1. `OPTCG_CARD_ART_DIR` in the environment.
 *   2. `packages/cards/card-art.local.json`, `{ "dir": "D:/wherever" }`.
 *      Gitignored, so it survives a pull and never reaches anyone else.
 *   3. `packages/cards/card-art/`, the default, also gitignored.
 *
 * The archive is laid out by set — `ST01/`, `OP01/`, `Don/` — with two files
 * per card, and both are used: the small JPEG on the board tiles and the large
 * PNG in the preview panel.
 */
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_DIR = resolve(PACKAGE_ROOT, 'card-art');
const LOCAL_CONFIG = resolve(PACKAGE_ROOT, 'card-art.local.json');

export interface ArtSource {
  dir: string;
  /** How it was chosen, for the script to say out loud. */
  from: 'env' | 'card-art.local.json' | 'default';
  exists: boolean;
}

export function artSource(): ArtSource {
  const fromEnv = process.env['OPTCG_CARD_ART_DIR'];
  if (fromEnv !== undefined && fromEnv !== '') {
    const dir = isAbsolute(fromEnv) ? fromEnv : resolve(process.cwd(), fromEnv);
    return { dir, from: 'env', exists: existsSync(dir) };
  }
  if (existsSync(LOCAL_CONFIG)) {
    const parsed = JSON.parse(readFileSync(LOCAL_CONFIG, 'utf8')) as { dir?: unknown };
    if (typeof parsed.dir === 'string' && parsed.dir !== '') {
      const dir = isAbsolute(parsed.dir) ? parsed.dir : resolve(PACKAGE_ROOT, parsed.dir);
      return { dir, from: 'card-art.local.json', exists: existsSync(dir) };
    }
  }
  return { dir: DEFAULT_DIR, from: 'default', exists: existsSync(DEFAULT_DIR) };
}

/**
 * The archive path of one card, both sizes.
 *
 * Derived entirely from the card id — `ST01-004` is `ST01/ST01-004.png` — which
 * is why nothing in this repository stores an image address. The set folder is
 * the id's own prefix; there is no table and there are no special cases.
 */
export function archivePaths(dir: string, cardId: string): { small: string; large: string } {
  const set = cardId.split('-')[0] ?? cardId;
  return {
    small: resolve(dir, set, `${cardId}_small.jpg`),
    large: resolve(dir, set, `${cardId}.png`),
  };
}

/** The DON!! card art, which the archive keeps in its own folder under one name. */
export function donArtPath(dir: string): string {
  return resolve(dir, 'Don', 'Don.png');
}

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The zero-game-rules rule has no direct test, so this is the proxy that
 * pins it: the server's source imports nothing from the engine but its
 * public barrel, and of that barrel only the routing surface — validate
 * (`applyAction`), redact (`playerView`, `redactEvent`), set up
 * (`createGame`), enumerate (`legalActions`), and the two constants. A new
 * value import from the engine is a review question by construction: either
 * it belongs on this list or the logic reaching for it belongs in the
 * engine.
 *
 * Type imports are exempt — types are erased and cannot smuggle a rule.
 */

const ALLOWED_ENGINE_VALUES = new Set([
  'applyAction',
  'createGame',
  'legalActions',
  'playerView',
  'redactEvent',
  'redactLog',
  'PLAYER_IDS',
]);

const SRC = join(import.meta.dirname, '..', 'src');

function sourceFiles(): string[] {
  return readdirSync(SRC)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(SRC, name));
}

const IMPORT_RE = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/g;
const BARE_IMPORT_RE = /import\s+[^{'"]*from\s+'([^']+)'/g;

describe('the server imports only the engine’s public API', () => {
  it('names no deep engine path and no other game package', () => {
    for (const file of sourceFiles()) {
      const text = readFileSync(file, 'utf8');
      for (const match of [...text.matchAll(IMPORT_RE), ...text.matchAll(BARE_IMPORT_RE)]) {
        const specifier = match[match.length - 1] as string;
        if (specifier.startsWith('@optcg/')) {
          expect(specifier, `${file} imports ${specifier}`).toBe('@optcg/engine');
        }
      }
    }
  });

  it('takes only the routing surface as values', () => {
    for (const file of sourceFiles()) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(IMPORT_RE)) {
        const [, typeOnly, names, specifier] = match;
        if (specifier !== '@optcg/engine' || typeOnly !== undefined) {
          continue;
        }
        for (const raw of (names ?? '').split(',')) {
          const name = raw.trim();
          if (name === '' || name.startsWith('type ')) {
            continue;
          }
          expect(
            ALLOWED_ENGINE_VALUES.has(name),
            `${file} imports engine value "${name}" outside the routing surface`,
          ).toBe(true);
        }
      }
    }
  });

  it('is looking at real files, not an empty directory', () => {
    expect(sourceFiles().length).toBeGreaterThanOrEqual(5);
  });
});

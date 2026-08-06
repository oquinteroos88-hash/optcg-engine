import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCANNED_DIRS = ['src/components', 'src/screens'];

// Any import of @optcg/engine (main or subpath) that is not `import type`.
const ENGINE_VALUE_IMPORT = /^\s*import\s+(?!type\b)[^;]*?from\s+['"]@optcg\/engine(?:\/[^'"]*)?['"]/;
// Bare side-effect imports are value imports too.
const ENGINE_SIDE_EFFECT_IMPORT = /^\s*import\s+['"]@optcg\/engine(?:\/[^'"]*)?['"]/;

function collectSourceFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      files.push(full);
    }
  }
  return files;
}

describe('architecture: components and screens are rule-blind', () => {
  it('never imports engine values (only `import type`) in components/screens', () => {
    const violations: string[] = [];
    for (const relDir of SCANNED_DIRS) {
      for (const file of collectSourceFiles(join(PACKAGE_ROOT, relDir))) {
        const lines = readFileSync(file, 'utf8').split(/\r?\n/);
        lines.forEach((line, index) => {
          if (ENGINE_VALUE_IMPORT.test(line) || ENGINE_SIDE_EFFECT_IMPORT.test(line)) {
            violations.push(`${relative(PACKAGE_ROOT, file)}:${index + 1}: ${line.trim()}`);
          }
        });
      }
    }
    expect(violations).toEqual([]);
  });
});

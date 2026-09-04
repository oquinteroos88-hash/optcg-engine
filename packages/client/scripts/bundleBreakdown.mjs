// The measurement build behind `packages/server/bench`: the same client, the
// same config, with every module routed into a chunk named for where it came
// from, so the gzip total can be attributed. Not the shipping build — the
// output goes to a temp directory (or the one given as the first argument)
// and `dist/` is never touched. Prints one JSON document on stdout.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

const clientDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(process.argv[2] ?? join(tmpdir(), 'optcg-bundle-breakdown'));

const GROUPS = [
  ['react', /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/],
  ['motion', /[\\/]node_modules[\\/](motion|framer-motion|motion-dom|motion-utils)[\\/]/],
  ['zustand', /[\\/]node_modules[\\/]zustand[\\/]/],
  ['engine', /[\\/](packages[\\/]engine|@optcg[\\/]engine)[\\/]/],
  ['cards', /[\\/](packages[\\/]cards|@optcg[\\/]cards)[\\/]/],
  ['i18n', /[\\/]src[\\/]i18n[\\/]/],
];

function groupOf(id) {
  for (const [name, pattern] of GROUPS) {
    if (pattern.test(id)) {
      return name;
    }
  }
  return 'app';
}

await build({
  root: clientDir,
  configFile: join(clientDir, 'vite.config.ts'),
  logLevel: 'silent',
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          return groupOf(id);
        },
      },
    },
  },
});

const assets = join(outDir, 'assets');
const files = [];
const groups = {};
for (const name of readdirSync(assets).sort()) {
  const path = join(assets, name);
  if (!statSync(path).isFile()) {
    continue;
  }
  const content = readFileSync(path);
  const prefix = name.slice(0, name.indexOf('-'));
  const group = name.endsWith('.css') ? 'css' : prefix === 'index' ? 'app' : prefix;
  const entry = { file: name, group, raw: content.length, gzip: gzipSync(content, { level: 9 }).length };
  files.push(entry);
  const total = groups[group] ?? { raw: 0, gzip: 0 };
  total.raw += entry.raw;
  total.gzip += entry.gzip;
  groups[group] = total;
}

process.stdout.write(JSON.stringify({ outDir, files, groups }));

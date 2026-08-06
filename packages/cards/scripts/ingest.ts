/**
 * Normalizes the punk-records dataset into `data/cards.en.json`.
 *
 * Run by hand — never from build, never from test:
 *
 *     pnpm --filter @optcg/cards ingest
 *
 * The committed JSON is the only thing the package reads at runtime. This
 * script is the audit trail for how that JSON came to be, which is why it
 * pins a commit SHA instead of tracking a branch: `main` is regenerated
 * upstream, and a moving source would change test expectations without a
 * single line of this repository having been touched.
 *
 * Requires Node >= 22.6 for TypeScript type stripping. Nothing else does.
 */

import { gunzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SOURCE_REPO = 'buhbbl/punk-records';
const SOURCE_COMMIT = '2a48b092cf4c77acbe22367b8334bbc75102c702';
const TARBALL_URL = `https://codeload.github.com/${SOURCE_REPO}/tar.gz/${SOURCE_COMMIT}`;

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, '..', 'data');

/**
 * The four keywords the engine implements as rules. Any other bracketed marker
 * in the effect text ("[On Play]", "[Activate: Main]") is an ability, and
 * abilities are deliberately out of scope here: this package ships data.
 */
const PRINTED_KEYWORDS = ['Rush', 'Blocker', 'Double Attack', 'Banish'] as const;

const CATEGORIES: Record<string, 'leader' | 'character' | 'event' | 'stage'> = {
  Leader: 'leader',
  Character: 'character',
  Event: 'event',
  Stage: 'stage',
};

// ---------------------------------------------------------------------------
// Source shapes. Two of them, because the dataset disagrees with itself about
// what a card record is (see the join below).
// ---------------------------------------------------------------------------

/** `english/cards/<pack_id>/<id>.json` — carries the effect and trigger text. */
interface SourceCard {
  id: string;
  name: string;
  category: string;
  colors: string[];
  cost: number | null;
  power: number | null;
  counter: number | null;
  attributes: string[];
  types: string[];
  effect: string | null;
  trigger: string | null;
  pack_id: string;
  rarity: string;
}

/** `english/index/cards_by_id.json` — same stats, no effect text, `card_id`. */
interface SourceIndexEntry {
  card_id: string;
  name: string;
  category: string;
  colors: string[];
  cost: number | null;
  power: number | null;
  counter: number | null;
  attributes: string[];
  types: string[];
}

interface NormalizedCard {
  cardId: string;
  name: string;
  category: 'leader' | 'character' | 'event' | 'stage';
  color: string;
  colors: string[];
  cost: number;
  power: number;
  counter: number | null;
  life: number;
  keywords: string[];
  types: string[];
  attributes: string[];
  effectText: string | null;
  triggerText: string | null;
}

// ---------------------------------------------------------------------------
// tar.gz reader. A tar entry is a 512-byte header followed by its content
// padded to 512; that is the whole format we need, and implementing it here
// costs less than a dependency that would have to be pinned and audited too.
// ---------------------------------------------------------------------------

function readTarGz(buffer: Buffer): Map<string, Buffer> {
  const tar = gunzipSync(buffer);
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    // Two consecutive zero blocks end the archive; one is enough to stop.
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const sizeField = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
    const size = Number.parseInt(sizeField, 8);
    const typeFlag = String.fromCharCode(header[156] ?? 0);
    if (!Number.isFinite(size)) {
      throw new Error(`tar: unreadable size field at offset ${offset}`);
    }
    const start = offset + 512;
    if (typeFlag === '0' || typeFlag === '\0') {
      entries.set(prefix === '' ? name : `${prefix}/${name}`, tar.subarray(start, start + size));
    }
    offset = start + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function parseJson<T>(entries: Map<string, Buffer>, suffix: string): T {
  for (const [name, content] of entries) {
    if (name.endsWith(suffix)) return JSON.parse(content.toString('utf8')) as T;
  }
  throw new Error(`tarball has no entry ending in ${suffix}`);
}

// ---------------------------------------------------------------------------
// Validation. The point of a scrape-derived dataset is that you do not trust
// it: every assumption below is asserted rather than assumed.
// ---------------------------------------------------------------------------

function expectInt(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${where}: expected an integer, got ${JSON.stringify(value)}`);
  }
  return value;
}

function expectStringArray(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${where}: expected an array of strings, got ${JSON.stringify(value)}`);
  }
  return value as string[];
}

function expectNonEmptyString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${where}: expected a non-empty string, got ${JSON.stringify(value)}`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/** Parallel art reprints carry a suffix: `ST01-002_p1`. Same card, other frame. */
function isParallel(cardId: string): boolean {
  return cardId.includes('_');
}

/**
 * Printed keywords, read off the effect text rather than off the index's
 * `keywords` field.
 *
 * The index lists every bracketed marker it found, so a card whose text *grants*
 * Rush to something else is indistinguishable there from a card that *has* Rush.
 * A printed keyword always appears as its own bracketed marker, so matching
 * `[Rush]` is both stricter and closer to what is actually printed.
 */
function extractKeywords(effect: string | null): string[] {
  if (effect === null) return [];
  return PRINTED_KEYWORDS.filter((keyword) => effect.includes(`[${keyword}]`));
}

/**
 * Power, read per category — because the source's `null` does not mean the same
 * thing on both sides of the line.
 *
 * On a Character it means a printed 0 (`OP01-006` Otama really is a 0-power
 * Character); on an Event or a Stage it means there is no power box at all. The
 * engine has one encoding for both, `power: 0`, exactly as the TEST set already
 * writes for its Events — so the resulting number is identical either way.
 *
 * What differs is where the number comes from, and that is the part worth
 * keeping: a Character's 0 is data read off the card, an Event's 0 is this rule.
 * Run as one blind `?? 0` they are indistinguishable, and a source that starts
 * printing a power on Events would slide in as a playable stat instead of
 * failing here.
 */
function normalizePower(
  card: SourceCard,
  category: 'leader' | 'character' | 'event' | 'stage',
  where: string,
): number {
  if (category === 'event' || category === 'stage') {
    if (card.power !== null) {
      throw new Error(`${where}: a ${category} has no power box, but the source printed ${card.power}`);
    }
    return 0;
  }
  return card.power === null ? 0 : expectInt(card.power, `${where}.power`);
}

function normalize(card: SourceCard): NormalizedCard {
  const where = card.id;
  const category = CATEGORIES[card.category];
  if (category === undefined) {
    throw new Error(`${where}: unknown category ${JSON.stringify(card.category)}`);
  }

  const colors = expectStringArray(card.colors, `${where}.colors`).map((c) => c.toLowerCase());
  if (colors.length === 0) throw new Error(`${where}: no colors`);

  const types = expectStringArray(card.types, `${where}.types`);
  if (types.length === 0) throw new Error(`${where}: no types`);

  // Leaders: the source has no `life` field and puts Life in `cost`. Leaders
  // have no cost in OPTCG, so nothing is lost by the move — but a Leader read
  // as a 5-cost card would be nonsense, which is why this is asserted.
  //
  // A Leader's `cost: 0` therefore comes from *this* rule, not from the
  // printed-zero mapping below: there is no such thing as a Leader that costs
  // zero, so a Leader arriving with no cost at all is a source failure, not a
  // value to normalize.
  if (category === 'leader' && card.cost === null) {
    throw new Error(`${where}: a Leader with no cost field to read Life from`);
  }
  const sourceCost = card.cost === null ? 0 : expectInt(card.cost, `${where}.cost`);
  const cost = category === 'leader' ? 0 : sourceCost;
  const life = category === 'leader' ? sourceCost : 0;
  if (category === 'leader' && (life < 1 || life > 6)) {
    throw new Error(`${where}: implausible Leader life ${life}`);
  }

  const counter = card.counter === null ? null : expectInt(card.counter, `${where}.counter`);
  if (counter !== null && counter <= 0) {
    throw new Error(`${where}: counter ${counter} — 0 is not a printed Counter value`);
  }

  return {
    cardId: where,
    name: expectNonEmptyString(card.name, `${where}.name`),
    category,
    // The engine's `CardDefinition.color` is a single string. Multicolor cards
    // keep the full list in `colors`; `color` is the first printed one so the
    // engine's selectors keep working unchanged.
    color: colors[0] as string,
    colors,
    cost,
    power: normalizePower(card, category, where),
    counter,
    life,
    keywords: extractKeywords(card.effect),
    types,
    attributes: expectStringArray(card.attributes, `${where}.attributes`),
    effectText: card.effect,
    triggerText: card.trigger,
  };
}

// ---------------------------------------------------------------------------
// Cross-source join. Both files describe the same card; the fields they share
// must agree. A disagreement is the dataset contradicting itself, which is
// worth knowing even when we cannot tell which side is right.
// ---------------------------------------------------------------------------

const SHARED_FIELDS = [
  'name',
  'category',
  'colors',
  'cost',
  'power',
  'counter',
  'types',
  'attributes',
] as const;

function projectIndexEntry(entry: SourceIndexEntry): Record<string, unknown> {
  const projection: Record<string, unknown> = {};
  for (const field of SHARED_FIELDS) projection[field] = entry[field];
  return projection;
}

function compareSources(
  card: SourceCard,
  entry: SourceIndexEntry,
): Array<{ field: string; perCard: unknown; index: unknown }> {
  const divergences: Array<{ field: string; perCard: unknown; index: unknown }> = [];
  for (const field of SHARED_FIELDS) {
    const a = JSON.stringify(card[field]);
    const b = JSON.stringify(entry[field]);
    if (a !== b) divergences.push({ field, perCard: card[field], index: entry[field] });
  }
  return divergences;
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  process.stdout.write(`Fetching ${TARBALL_URL}\n`);
  const response = await fetch(TARBALL_URL);
  if (!response.ok) throw new Error(`fetch failed: ${response.status} ${response.statusText}`);
  const entries = readTarGz(Buffer.from(await response.arrayBuffer()));

  const manifest = parseJson<{ generated_at: number; version: string; language: string }>(
    entries,
    'english/manifest.json',
  );
  const index = parseJson<Record<string, SourceIndexEntry>>(
    entries,
    'english/index/cards_by_id.json',
  );

  // Per-card records, keyed by id. The same parallel appears in two pack
  // directories upstream; identical payloads, so last-write-wins is safe, but
  // the collision is counted and reported rather than swallowed.
  const perCard = new Map<string, SourceCard>();
  let duplicateFiles = 0;
  for (const [name, content] of entries) {
    if (!/\/english\/cards\/\d+\/[^/]+\.json$/.test(name)) continue;
    const card = JSON.parse(content.toString('utf8')) as SourceCard;
    if (perCard.has(card.id)) duplicateFiles += 1;
    perCard.set(card.id, card);
  }

  // --- join ---------------------------------------------------------------
  const onlyInIndex = Object.keys(index).filter((id) => !perCard.has(id));
  const onlyInPerCard = [...perCard.keys()].filter((id) => !(id in index));

  const divergences: Array<{ cardId: string; field: string; perCard: unknown; index: unknown }> =
    [];
  for (const [id, card] of perCard) {
    const entry = index[id];
    if (entry === undefined) continue;
    for (const d of compareSources(card, entry)) divergences.push({ cardId: id, ...d });
  }

  // --- normalize ----------------------------------------------------------
  const baseIds = [...perCard.keys()].filter((id) => !isParallel(id)).sort();
  const parallelsFiltered = perCard.size - baseIds.length;
  const cards = baseIds.map((id) => normalize(perCard.get(id) as SourceCard));

  const byCategory: Record<string, number> = {};
  for (const card of cards) byCategory[card.category] = (byCategory[card.category] ?? 0) + 1;

  const leadersRemapped = cards.filter((c) => c.category === 'leader' && c.life > 0).length;
  const nullCost = baseIds.filter((id) => (perCard.get(id) as SourceCard).cost === null);
  const nullPowerCharacters = baseIds.filter((id) => {
    const card = perCard.get(id) as SourceCard;
    return card.category === 'Character' && card.power === null;
  });

  // --- write --------------------------------------------------------------
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(join(DATA_DIR, 'cards.en.json'), `${JSON.stringify(cards, null, 2)}\n`);

  // The index projection, committed so the cross-source check is a test that
  // runs offline instead of a claim this script made once and nobody can re-run.
  const projection: Record<string, unknown> = {};
  for (const id of baseIds) {
    const entry = index[id];
    if (entry !== undefined) projection[id] = projectIndexEntry(entry);
  }
  writeFileSync(
    join(DATA_DIR, 'source-index.en.json'),
    `${JSON.stringify(projection, null, 2)}\n`,
  );

  writeFileSync(
    join(DATA_DIR, 'PROVENANCE.md'),
    renderProvenance({
      manifest,
      totals: {
        indexEntries: Object.keys(index).length,
        perCardFiles: perCard.size,
        baseCards: cards.length,
        parallelsFiltered,
        duplicateFiles,
        leadersRemapped,
      },
      byCategory,
      onlyInIndex,
      onlyInPerCard,
      divergences,
      nullCost,
      nullPowerCharacters,
    }),
  );

  // --- report -------------------------------------------------------------
  process.stdout.write(`\ncards.en.json: ${cards.length} cards\n`);
  for (const [category, count] of Object.entries(byCategory).sort()) {
    process.stdout.write(`  ${category.padEnd(10)} ${count}\n`);
  }
  process.stdout.write(`parallels filtered: ${parallelsFiltered}\n`);
  process.stdout.write(`leaders remapped cost -> life: ${leadersRemapped}\n`);
  process.stdout.write(`cross-source divergences: ${divergences.length}\n`);
  process.stdout.write(`ids only in index: ${onlyInIndex.length}\n`);
  process.stdout.write(`ids only in per-card files: ${onlyInPerCard.length}\n`);
  process.stdout.write(`null cost (normalized to 0): ${nullCost.length}\n`);
  process.stdout.write(`Characters with null power (normalized to 0): ${nullPowerCharacters.length}\n`);
}

function renderProvenance(r: {
  manifest: { generated_at: number; version: string; language: string };
  totals: Record<string, number>;
  byCategory: Record<string, number>;
  onlyInIndex: string[];
  onlyInPerCard: string[];
  divergences: Array<{ cardId: string; field: string; perCard: unknown; index: unknown }>;
  nullCost: string[];
  nullPowerCharacters: string[];
}): string {
  const list = (ids: string[]): string => (ids.length === 0 ? '_none_' : ids.join(', '));
  const generated = new Date(r.manifest.generated_at * 1000).toISOString();
  return `# Provenance — cards.en.json

Generated by \`scripts/ingest.ts\`. Do not edit by hand; re-run the ingest.

## Source

| | |
| --- | --- |
| Repository | [${SOURCE_REPO}](https://github.com/${SOURCE_REPO}) |
| Commit | \`${SOURCE_COMMIT}\` |
| Tarball | ${TARBALL_URL} |
| Manifest \`generated_at\` | ${r.manifest.generated_at} (${generated}) |
| Manifest \`version\` / \`language\` | ${r.manifest.version} / ${r.manifest.language} |
| Downloaded | ${new Date().toISOString().slice(0, 10)} |

The commit is pinned deliberately. Upstream regenerates the dataset, so a
branch reference would silently change these counts — and the tests that assert
them — without a commit in this repository.

### Why the tarball and not \`english/index/cards_by_id.json\`

The index does not carry \`effect\` or \`trigger\`; those live in the per-card
files under \`english/cards/<pack_id>/<id>.json\`. Both are needed, so the ingest
takes the repository tarball at the pinned commit: one request, both sources,
same pin. The two are joined by card id, and their shared fields are compared —
see \`data/source-index.en.json\` and the cross-source test.

## Counts

| | |
| --- | --- |
${Object.entries(r.totals)
  .map(([k, v]) => `| ${k} | ${v} |`)
  .join('\n')}

### Cards by category

| Category | Cards |
| --- | --- |
${Object.entries(r.byCategory)
  .sort()
  .map(([k, v]) => `| ${k} | ${v} |`)
  .join('\n')}

## Normalization applied

1. **Leader \`cost\` is Life.** The source has no \`life\` field; for
   \`category: "Leader"\` its \`cost\` holds the Life value. Normalized to
   \`life: <value>, cost: 0\` (the engine encodes "no cost" as 0, not null).
2. **Parallel printings dropped.** Ids containing \`_\` (\`ST01-002_p1\`) are
   alternate art of a card already present.
3. **Dropped fields.** \`img_url\`, \`img_full_url\`, \`rarity\`, \`pack_id\`,
   \`block_number\` — none of them affect play.
4. **\`null\` numerics become 0.** The source encodes a printed 0 as \`null\` for
   \`cost\` and \`power\`. \`counter\` is the exception: there \`null\` is the
   printed "—", which the engine already models as \`counter: null\`.
5. **Colors lowercased**, matching the engine's existing sets. \`color\` is the
   first printed color; \`colors\` keeps the full list for multicolor cards.
6. **Keywords** are read from the effect text as bracketed markers
   (\`[Blocker]\`), restricted to the four the engine implements. Card abilities
   are **not** in this package.

## Source anomalies

These are the places where the upstream scrape may be lying. Recorded rather
than corrected: the fix belongs upstream, and a silent correction here would be
indistinguishable from a bug.

- **Ids present in only one source** — index only: ${list(r.onlyInIndex)}; per-card
  files only: ${list(r.onlyInPerCard)}.
- **Cross-source field divergences**: ${r.divergences.length}${
    r.divergences.length === 0
      ? ' — the two files agree on every shared field of every joined card.'
      : `\n${r.divergences
          .map(
            (d) =>
              `  - \`${d.cardId}\`.${d.field}: per-card ${JSON.stringify(d.perCard)} vs index ${JSON.stringify(d.index)}`,
          )
          .join('\n')}`
  }
- **\`cost: null\`** (${r.nullCost.length} cards, all Events, normalized to 0):
  ${list(r.nullCost)}
- **\`power: null\` on Characters** (${r.nullPowerCharacters.length} cards,
  normalized to 0 — a Character with printed power 0 is legal, e.g. \`OP01-006\`
  Otama, but the encoding is indistinguishable from a missing value):
  ${list(r.nullPowerCharacters)}
`;
}

await main();

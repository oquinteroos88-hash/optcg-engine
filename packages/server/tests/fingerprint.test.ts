import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Decklist, PlayerId } from '@optcg/engine';
import { PLAYER_IDS } from '@optcg/engine';
import { ABIL_DECK } from '@optcg/engine/testdata/abilityDecks';
import { GREEN_DECK, RED_DECK } from '@optcg/engine/testdata/decks';
import type { SweepResult } from './helpers.js';
import { driveMatch } from './helpers.js';

/**
 * The semantic fingerprint oracle: one sha256 per game over everything the
 * server emitted while playing it — the state after every accepted action,
 * both seats' event batches, both `playerView`s, both `legalActions` lists,
 * and the rejections the driver provoked — pinned here as a hex digest.
 *
 * `replay.test.ts` proves `seed + log = game`; it never looks at a view. The
 * two engine commits in the performance pass were justified by exactly this
 * fold, run once by hand and identical before and after, and a reviewer was
 * right that a proof nothing can re-run is a story. This is the proof, kept.
 *
 * What moves a digest: a semantic change, and only that — a card's text, a
 * rule, the redaction of an event, an affordance offered or withheld, the
 * shape of a view, the driver's policy. What must not move it: anything
 * that claims to be a performance change. A perf commit that moves a
 * fingerprint has changed what a player sees, whatever it meant to do.
 *
 * Regenerating honestly: run with `OPTCG_PRINT_FINGERPRINTS=1` and the test
 * prints the table below. A moved value is a finding to explain in the PR —
 * which card, which rule, which seat's view — never a value to paste over
 * quietly. The pinned digests were taken on `feat/server-hardening`'s
 * engine, before either perf commit, and confirmed byte-identical on this
 * branch's engine; the commit that added them says how.
 */

const ABILITIES: Record<PlayerId, Decklist> = { p1: ABIL_DECK, p2: ABIL_DECK };
const VANILLA: Record<PlayerId, Decklist> = { p1: RED_DECK, p2: GREEN_DECK };

interface Game {
  key: string;
  seed: number;
  decks: Record<PlayerId, Decklist>;
}

/** Ability seeds 1–12 are the sweep, 34 the longest game found; vanilla 1–4 is the plain-card corpus. */
const GAMES: readonly Game[] = [
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 34].map((seed) => ({ key: `abilities:${seed}`, seed, decks: ABILITIES })),
  ...[1, 2, 3, 4].map((seed) => ({ key: `vanilla:${seed}`, seed, decks: VANILLA })),
];

const FINGERPRINTS: Record<string, string> = {
  'abilities:1': 'e42f1390312ea4ca7230676625b2aeb4d1ab65245922f3b6082abb47832be439',
  'abilities:2': 'eb651261e54fca82e2d1591f6b08dab4c04a60934c6ebf70ac91b7dddfdcf95b',
  'abilities:3': 'cd75504e3bf8832dc8e580dbd0ac8feb71ab15a948542fcd2a3990aac3209b58',
  'abilities:4': '5ba72097c565eee7d0a05b138e9d92a56bbbe5b5a54999c8e5a7e66c042fb12a',
  'abilities:5': 'be14a20112e376874b92f7f70c537a71ffefb4b72cca25263aa4354e27bcc2f0',
  'abilities:6': '2b5168ae5f8be66bc3e95016d203e80c7d77845d66ed71aecd6f681047060ae4',
  'abilities:7': '9b4dfc125264d29381563b9af7a5d239320f6cb71f7460f427c18f18b2af1a90',
  'abilities:8': '32ded41c0d5438d3bccc8493e48c12a40b652cefc61e4c8ec0322e9b0a9c66f5',
  'abilities:9': '99fd071ad10fc8dd9892aa7a1a3640139f1da85cdc1a05a900c1dd793208360f',
  'abilities:10': '6e241231f5fa162a0eec0c5c5603659734525abd224e55ff19e9a0cc46a209e5',
  'abilities:11': '45587a9029cf174590e6f8eeb20c9aaa57fc83806339ff9730842fc5bcee0937',
  'abilities:12': '6bf81772aa7b0fe6ea13736210864406b72a4820cb3849de9387e2b875ca7d5d',
  'abilities:34': '520d13b21e290a39ff228db5c011e7050537774fce6b384298c14ea7f4821a93',
  'vanilla:1': '7a6e45c59a413edc5edd7b34416c923b4682135a51c5929193cd990c8bb1e947',
  'vanilla:2': 'f60796672de52c60ae4de7f2060e77936835b414408180499b1accd0227460f4',
  'vanilla:3': '9a648d2fe8d6aee3e9d525027fd632b71e46d864698e75478373c36c6449c853',
  'vanilla:4': '122acb7482c2c9b1ae057209b855c0bc2a88d469ad0b3ac16698af8f5bf86205',
};

/**
 * The fold, in a fixed order per accepted action: the new state, then the
 * event batch, the view and the affordances for each seat in `PLAYER_IDS`
 * order; then the rejections the driver injected, after the game. Every
 * piece is what `handleAction` emitted — the driver's `emissions` are the
 * payloads themselves — so this hashes the wire, not a re-derivation of it.
 */
export function fingerprint(run: SweepResult): { digest: string; actions: number } {
  const hash = createHash('sha256');
  const perAction = PLAYER_IDS.length;
  if (run.emissions.length % perAction !== 0) {
    throw new Error(`expected ${perAction} emissions per action, got ${run.emissions.length} in total`);
  }
  let actions = 0;
  for (let index = 0; index < run.emissions.length; index += perAction) {
    const batch = run.emissions.slice(index, index + perAction);
    batch.forEach((emission, offset) => {
      if (emission.seat !== PLAYER_IDS[offset]) {
        throw new Error(`emission ${index + offset} is for ${emission.seat}, expected ${PLAYER_IDS[offset]}`);
      }
    });
    const state = batch[0]?.state;
    hash.update(JSON.stringify(state));
    for (const emission of batch) {
      hash.update(JSON.stringify(emission.payload.events));
    }
    for (const emission of batch) {
      hash.update(JSON.stringify(emission.payload.view));
    }
    for (const emission of batch) {
      hash.update(JSON.stringify(emission.payload.actions));
    }
    actions += 1;
  }
  for (const rejection of run.rejections) {
    hash.update(JSON.stringify({ seat: rejection.seat, reason: rejection.reason }));
  }
  return { digest: hash.digest('hex'), actions };
}

interface Row {
  key: string;
  actions: number;
  expected: string;
  actual: string;
}

function table(rows: readonly Row[]): string {
  const lines = ['| game | actions | pinned | measured | |', '| --- | --- | --- | --- | --- |'];
  for (const row of rows) {
    const mark = row.expected === row.actual ? 'same' : 'MOVED';
    lines.push(`| ${row.key} | ${row.actions} | ${row.expected} | ${row.actual} | ${mark} |`);
  }
  return lines.join('\n');
}

describe('semantic fingerprint', () => {
  it('every game the server plays hashes to its pinned digest — state, events, views and affordances', { timeout: 240_000 }, () => {
    const rows: Row[] = [];
    for (const game of GAMES) {
      const run = driveMatch(game.seed, game.decks, { injectRejections: true });
      const { digest, actions } = fingerprint(run);
      rows.push({ key: game.key, actions, expected: FINGERPRINTS[game.key] ?? '(unpinned)', actual: digest });
    }
    const rendered = table(rows);
    if (process.env['OPTCG_PRINT_FINGERPRINTS'] === '1') {
      // The regeneration path, on purpose the only one: the table is pasted
      // into FINGERPRINTS by hand, with the reason a value moved in the PR.
      process.stdout.write(`\n${rendered}\n\n`);
    }
    const measured = Object.fromEntries(rows.map((row) => [row.key, row.actual]));
    expect(measured, `a fingerprint moved:\n${rendered}`).toEqual(FINGERPRINTS);
  });
});

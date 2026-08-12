import { describe, it } from 'vitest';
import { applyAction, createGame } from '@optcg/engine';
import { decide } from '@optcg/engine/testing';
import { OP01_DECKS } from './support.js';

const TARGETS = [
  'OP01-006-onPlay',
  'OP01-017-whenAttacking',
  'OP01-022-whenAttacking',
  'OP01-033-onPlay',
  'OP01-034-whenAttacking',
  'OP01-035-whenAttacking',
  'OP01-048-onPlay',
  'OP01-052-whenAttacking',
  'OP01-054-onPlay',
];

function run(seed: number) {
  let state = createGame({ seed, decks: OP01_DECKS, firstPlayer: 'p1' });
  const fired = new Set<string>();
  for (let step = 0; step < 400; step += 1) {
    if (state.status === 'finished') break;
    const action = decide(state, state.priority, seed, step);
    if (action === undefined) break;
    const result = applyAction(state, action);
    if (!result.ok) return null;
    state = result.state;
    for (const e of result.events) if (e.type === 'abilityTriggered') fired.add(e.abilityId);
  }
  const clean = state.pending === null && state.stack.length === 0 && state.resume.length === 0;
  return { fired, clean, finished: state.status === 'finished', endReason: state.endReason };
}

describe('op01 hunt', () => {
  it('scans', { timeout: 3_600_000 }, () => {
    const rows: { seed: number; got: Set<string> }[] = [];
    const reasons: Record<string, number> = {};
    for (let seed = 1; seed <= 300; seed += 1) {
      const r = run(seed);
      if (r === null || !r.clean) continue;
      reasons[r.endReason ?? 'unfinished'] = (reasons[r.endReason ?? 'unfinished'] ?? 0) + 1;
      rows.push({ seed, got: r.fired });
    }
    for (const t of TARGETS) {
      const hits = rows.filter((r) => r.got.has(t)).map((r) => r.seed);
      console.log(`HUNT ${t}: ${hits.length} — ${hits.slice(0, 12).join(',')}`);
    }
    const need = new Set(TARGETS);
    const chosen: number[] = [];
    while (need.size > 0) {
      let best: (typeof rows)[number] | undefined;
      let gain = 0;
      for (const r of rows) {
        if (chosen.includes(r.seed)) continue;
        let g = 0;
        for (const t of r.got) if (need.has(t)) g += 1;
        if (g > gain) {
          gain = g;
          best = r;
        }
      }
      if (best === undefined) break;
      chosen.push(best.seed);
      for (const t of best.got) need.delete(t);
    }
    console.log('HUNT COVER:', chosen.join(','), 'MISSING:', [...need].join(',') || 'none');
    console.log('HUNT REASONS:', JSON.stringify(reasons), 'clean games:', rows.length);
  });
});

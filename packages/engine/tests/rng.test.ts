import { describe, expect, it } from 'vitest';
import type { RngState } from '../src/rng.js';
import { next, nextInt, shuffle } from '../src/rng.js';

// Known-answer vectors computed with the reference sequential mulberry32:
// value at cursor c must equal the (c+1)-th output of mulberry32(seed).
const SEED_42 = [
  0.6011037519201636, 0.44829055899754167, 0.8524657934904099, 0.6697340414393693,
  0.17481389874592423, 0.5265925421845168, 0.2732279943302274, 0.6247446539346129,
];
const SEED_123 = [0.7872516233474016, 0.1785435655619949, 0.49531551403924823, 0.23136196262203157];
const SEED_0 = [0.26642920868471265, 0.0003297457005828619, 0.2232720274478197, 0.1462021479383111];

function collect(seed: number, count: number): number[] {
  let rng: RngState = { seed, cursor: 0 };
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const r = next(rng);
    out.push(r.value);
    rng = r.rng;
  }
  return out;
}

describe('rng', () => {
  it('matches the pinned known-answer vector for seed 42', () => {
    expect(collect(42, 8)).toEqual(SEED_42);
  });

  it('matches the pinned known-answer vectors for seeds 123 and 0', () => {
    expect(collect(123, 4)).toEqual(SEED_123);
    expect(collect(0, 4)).toEqual(SEED_0);
  });

  it('is pure: input state is untouched and repeat calls agree', () => {
    const rng: RngState = { seed: 42, cursor: 3 };
    const a = next(rng);
    const b = next(rng);
    expect(a.value).toBe(b.value);
    expect(a.rng).toEqual({ seed: 42, cursor: 4 });
    expect(rng).toEqual({ seed: 42, cursor: 3 });
  });

  it('is counter-addressed: the value at cursor c does not depend on history', () => {
    const direct = next({ seed: 42, cursor: 5 });
    expect(direct.value).toBe(SEED_42[5]);
  });

  it('nextInt returns integers in [0, max) and advances the cursor by one', () => {
    let rng: RngState = { seed: 7, cursor: 0 };
    for (let i = 0; i < 100; i += 1) {
      const r = nextInt(rng, 13);
      expect(Number.isInteger(r.value)).toBe(true);
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.value).toBeLessThan(13);
      expect(r.rng.cursor).toBe(rng.cursor + 1);
      rng = r.rng;
    }
  });

  it('shuffle returns a permutation, deterministically, consuming one value per swap', () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const a = shuffle(items, { seed: 7, cursor: 0 });
    const b = shuffle(items, { seed: 7, cursor: 0 });
    expect(a.items).toEqual(b.items);
    expect([...a.items].sort((x, y) => x - y)).toEqual(items);
    expect(a.items).not.toEqual(items);
    expect(a.rng).toEqual({ seed: 7, cursor: 49 });
    const c = shuffle(items, { seed: 8, cursor: 0 });
    expect(c.items).not.toEqual(a.items);
  });

  it('shuffle does not mutate its input', () => {
    const items = [1, 2, 3, 4, 5];
    shuffle(items, { seed: 1, cursor: 0 });
    expect(items).toEqual([1, 2, 3, 4, 5]);
  });
});

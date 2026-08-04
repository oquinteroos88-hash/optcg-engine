// Counter-based mulberry32. The value at cursor c equals the (c+1)-th output of
// the classic sequential mulberry32(seed), so streams are random-access and the
// whole generator state is the serializable pair { seed, cursor }.

export interface RngState {
  seed: number;
  cursor: number;
}

const INCREMENT = 0x6d2b79f5;

function valueAt(seed: number, cursor: number): number {
  // Math.imul keeps the multiply in 32-bit space; a plain * overflows 2^53.
  let t = (seed + Math.imul(cursor + 1, INCREMENT)) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function next(rng: RngState): { value: number; rng: RngState } {
  return {
    value: valueAt(rng.seed, rng.cursor),
    rng: { seed: rng.seed, cursor: rng.cursor + 1 },
  };
}

export function nextInt(rng: RngState, maxExclusive: number): { value: number; rng: RngState } {
  const r = next(rng);
  return { value: Math.floor(r.value * maxExclusive), rng: r.rng };
}

// Fisher-Yates; consumes exactly one value per swap (length - 1 total).
export function shuffle<T>(items: readonly T[], rng: RngState): { items: T[]; rng: RngState } {
  const result = [...items];
  let current = rng;
  for (let i = result.length - 1; i > 0; i -= 1) {
    const draw = nextInt(current, i + 1);
    current = draw.rng;
    const j = draw.value;
    const swapped = result[i] as T;
    result[i] = result[j] as T;
    result[j] = swapped;
  }
  return { items: result, rng: current };
}

/**
 * Deterministic RNG so a quest is fully reproducible from its seed. Two people
 * with the same seed and the same slider value get the exact same misiune,
 * which is what makes sharing a quest by code work without a server.
 */

/** Mulberry32 — small, fast, good enough spread for picking from word pools. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a — turns a share code like "K7QX-2M" back into a numeric seed. */
export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type Rng = () => number;

export function randInt(rng: Rng, minInclusive: number, maxInclusive: number): number {
  return minInclusive + Math.floor(rng() * (maxInclusive - minInclusive + 1));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

/** Picks `count` distinct items; returns fewer if the pool is smaller. */
export function pickMany<T>(rng: Rng, items: readonly T[], count: number): T[] {
  const pool = items.slice();
  const out: T[] = [];
  while (out.length < count && pool.length > 0) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return out;
}

const CODE_ALPHABET = "ACDEFGHJKLMNPQRTUVWXY3479";

/** Human-typable share code (no 0/O, 1/I/L mixups), e.g. "K7QX-2MF". */
export function seedToCode(seed: number): string {
  let n = seed >>> 0;
  let out = "";
  for (let i = 0; i < 7; i++) {
    out += CODE_ALPHABET[n % CODE_ALPHABET.length];
    n = Math.floor(n / CODE_ALPHABET.length);
    if (out.length === 4) out += "-";
  }
  return out;
}

export function codeToSeed(code: string): number {
  return hashString(code.trim().toUpperCase());
}

/** A fresh seed for "dă-mi altă misiune". */
export function randomSeed(): number {
  return (Math.floor(Math.random() * 0xffffffff) ^ Date.now()) >>> 0;
}

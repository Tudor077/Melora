import {
  eligibleActions,
  eligibleTwists,
  forbidsOf,
  inRange,
  requirementsOf,
  targetsFor,
} from "./grammar";
import { tierFor } from "./tiers";
import type { Scene } from "./types";
import { ACTIONS, PROOFS, TARGETS, TITLES, TWISTS } from "./vocab";

/** n choose k, on doubles — the counts here never get near the precision edge. */
function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let out = 1;
  for (let i = 0; i < k; i++) out = (out * (n - i)) / (i + 1);
  return out;
}

/**
 * The honest answer to "how many sidequests are there?" — counted from the real
 * pools at the current settings, not a number typed into the UI.
 */
export function countCombinations(stupidity: number, scene: Scene): number {
  const tier = tierFor(stupidity);
  const proofs = PROOFS.filter((p) => inRange(p, stupidity)).length;
  const titles = TITLES.filter((t) => inRange(t, stupidity)).length;
  if (proofs === 0 || titles === 0) return 0;

  let total = 0;
  for (const action of eligibleActions(ACTIONS, stupidity, scene)) {
    const targets = targetsFor(TARGETS, action, stupidity, scene).length;
    if (targets === 0) continue;

    const pool = eligibleTwists(TWISTS, stupidity, requirementsOf(action), forbidsOf(action));
    // The only way two constraints can clash is speech, so a valid set is one
    // that avoids mixing the silent constraint with a talkative one. Counting
    // that exactly keeps the number on screen true rather than optimistic.
    const silent = pool.filter((t) => t.blocks?.includes("vorbire")).length;
    const talkative = pool.filter((t) => t.needs?.includes("vorbire")).length;
    const neutral = pool.length - silent - talkative;

    let twistWays = 0;
    for (let k = tier.twists[0]; k <= tier.twists[1]; k++) {
      twistWays +=
        choose(neutral + talkative, k) + choose(neutral + silent, k) - choose(neutral, k);
    }

    total += targets * twistWays;
  }
  return total * proofs * titles;
}

/** "3,4 miliarde" reads better on a phone than 3403291200. */
export function formatCount(value: number): string {
  const units: [limit: number, one: string, many: string][] = [
    [1e15, "cvadrilion", "cvadrilioane"],
    [1e12, "trilion", "trilioane"],
    [1e9, "miliard", "miliarde"],
    [1e6, "milion", "milioane"],
    [1e3, "mie", "mii"],
  ];
  for (const [limit, one, many] of units) {
    // A hair below the next unit still rounds up to it, so promote rather than
    // print "1.000 milioane".
    if (value >= limit * 0.9995) {
      const scaled = value / limit;
      const digits = scaled >= 100 ? 0 : 1;
      const text = scaled.toLocaleString("ro-RO", { maximumFractionDigits: digits });
      // Romanian needs the singular for exactly one: "1 miliard", not "1 miliarde".
      return `${text} ${text === "1" ? one : many}`;
    }
  }
  return value.toLocaleString("ro-RO");
}

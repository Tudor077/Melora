/**
 * Self-check for the quest grammar. There is no test runner in this repo, so
 * this runs as a plain script: `npm run check --workspace @melora/sidequests`.
 *
 * It guards the three things that silently rot as vocabulary gets added:
 *   1. no fragment pairing produces broken Romanian agreement,
 *   2. no quest carries two constraints that contradict each other,
 *   3. the combination count shown in the UI is the real one.
 */
import { generateQuest } from "./generate";
import {
  eligibleActions,
  eligibleTwists,
  forbidsOf,
  inRange,
  requirementsOf,
  targetsFor,
  twistsClash,
} from "./grammar";
import { SCENES } from "./scenes";
import { countCombinations } from "./stats";
import { tierFor } from "./tiers";
import type { Scene } from "./types";
import { ACTIONS, PROOFS, TARGETS, TITLES, TWISTS } from "./vocab";

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

// 1. Targets carry their own article, so no rendered sentence may end up in an
// oblique case it cannot agree with.
const OBLIQUE = /\bunei\b|\bunui\b/;
const ALLOWED_OBLIQUE = /unui prieten|unui pelerinaj|unei străzi|unui public/;
let pairs = 0;
for (const action of ACTIONS) {
  for (const target of TARGETS) {
    if (!action.accepts.includes(target.kind)) continue;
    const line = action.text.replace("{t}", target.text);
    pairs++;
    check(!line.includes("{t}"), `placeholder nerezolvat: ${line}`);
    check(
      !OBLIQUE.test(line) || ALLOWED_OBLIQUE.test(line),
      `acord suspect (genitiv/dativ): ${line}`,
    );
  }
}
check(pairs > 1500, `prea puține perechi acțiune × țintă: ${pairs}`);

// 2. Generation must stay coherent across the whole slider, in every scene.
const scenes: Scene[] = SCENES.map((s) => s.id);
let generated = 0;
for (const scene of scenes) {
  for (let stupidity = 0; stupidity <= 100; stupidity++) {
    for (let i = 0; i < 5; i++) {
      const quest = generateQuest({ seed: stupidity * 6151 + i * 99991 + scene.length, stupidity, scene });
      generated++;
      check(quest.points > 0, `misiune fără puncte: ${quest.brief}`);
      check(quest.minutes > 0, `misiune fără timp: ${quest.brief}`);
      check(new Set(quest.twists).size === quest.twists.length, `twist duplicat: ${quest.brief}`);

      const chosen = TWISTS.filter((t) => quest.twists.includes(t.text));
      for (let a = 0; a < chosen.length; a++) {
        for (let b = a + 1; b < chosen.length; b++) {
          check(!twistsClash(chosen[a], chosen[b]), `constrângeri contradictorii: ${quest.brief}`);
        }
      }
    }
  }
}

// 3. Same seed, same quest — sharing a code depends on it.
const first = generateQuest({ seed: 12345, stupidity: 70, scene: "oras" });
const again = generateQuest({ seed: 12345, stupidity: 70, scene: "oras" });
check(first.brief === again.brief && first.points === again.points, "generarea nu e deterministă");

// 4. The headline number must match a brute-force enumeration.
function bruteForce(stupidity: number, scene: Scene): number {
  const tier = tierFor(stupidity);
  const proofs = PROOFS.filter((p) => inRange(p, stupidity)).length;
  const titles = TITLES.filter((t) => inRange(t, stupidity)).length;
  let total = 0;
  for (const action of eligibleActions(ACTIONS, stupidity, scene)) {
    const targets = targetsFor(TARGETS, action, stupidity, scene).length;
    const pool = eligibleTwists(TWISTS, stupidity, requirementsOf(action), forbidsOf(action));
    let ways = 0;
    const walk = (start: number, chosen: number[]): void => {
      if (chosen.length >= tier.twists[0]) ways++;
      if (chosen.length === tier.twists[1]) return;
      for (let i = start; i < pool.length; i++) {
        if (chosen.some((j) => twistsClash(pool[i], pool[j]))) continue;
        chosen.push(i);
        walk(i + 1, chosen);
        chosen.pop();
      }
    };
    walk(0, []);
    total += targets * ways;
  }
  return total * proofs * titles;
}

for (const stupidity of [0, 25, 50, 75, 100]) {
  for (const scene of ["oras", "muzeu", "plaja"] as Scene[]) {
    const shown = countCombinations(stupidity, scene);
    const actual = bruteForce(stupidity, scene);
    check(shown === actual, `numărătoare greșită la ${stupidity}/${scene}: ${shown} vs ${actual}`);
  }
}

const grandTotal = scenes.reduce((sum, scene) => sum + countCombinations(100, scene), 0);

if (failures.length > 0) {
  console.error(`✗ ${failures.length} probleme:`);
  for (const failure of failures.slice(0, 25)) console.error("  -", failure);
  process.exit(1);
}

console.log(`✓ ${pairs} perechi acțiune × țintă, ${generated} misiuni generate, numărătoare exactă`);
console.log(`✓ ${grandTotal.toLocaleString("ro-RO")} de misiuni doar la prostie 100, însumat pe scene`);

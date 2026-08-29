import { mulberry32, randInt, seedToCode, type Rng } from "./rng";
import {
  eligibleActions,
  eligibleTwists,
  forbidsOf,
  inRange,
  pickTwists,
  requirementsOf,
  targetsFor,
  weightedPick,
} from "./grammar";
import { tierFor } from "./tiers";
import type { Quest, Scene } from "./types";
import { ACTIONS, PROOFS, TARGETS, TITLES, TWISTS } from "./vocab";

export interface GenerateOptions {
  seed: number;
  /** 0–100. The only knob that matters. */
  stupidity: number;
  scene: Scene;
}

/**
 * Builds one quest, entirely offline. Same options in, same quest out — the
 * app leans on that to re-render a saved quest from three small numbers instead
 * of storing its text.
 */
export function generateQuest({ seed, stupidity, scene }: GenerateOptions): Quest {
  const rng: Rng = mulberry32(seed);
  const tier = tierFor(stupidity);

  const action = weightedPick(rng, eligibleActions(ACTIONS, stupidity, scene), stupidity);
  const target = weightedPick(rng, targetsFor(TARGETS, action, stupidity, scene), stupidity);
  const needs = requirementsOf(action);

  const twistPool = eligibleTwists(TWISTS, stupidity, needs, forbidsOf(action));
  const twistCount = randInt(rng, tier.twists[0], tier.twists[1]);
  const twists = pickTwists(rng, twistPool, stupidity, twistCount);

  const proof = weightedPick(rng, PROOFS.filter((p) => inRange(p, stupidity)), stupidity);
  const title = weightedPick(rng, TITLES.filter((t) => inRange(t, stupidity)), stupidity);

  const actionText = action.text.replace("{t}", target.text);
  const twistTexts = twists.map((t) => t.text);
  const brief = [actionText, ...twistTexts, `Dovadă: ${proof.text}.`].join(" ");

  const twistCost = twists.reduce((sum, t) => sum + t.cost, 0);
  const points = Math.round(((10 + stupidity / 5 + twistCost) * tier.multiplier) / 5) * 5;
  const minutes = randInt(rng, tier.minutes[0], tier.minutes[1]);

  return {
    id: `${seed}:${stupidity}:${scene}`,
    code: seedToCode(seed),
    seed,
    title: title.text,
    brief,
    action: actionText,
    twists: twistTexts,
    proof: proof.text,
    stupidity,
    tier: tier.index,
    scene,
    points,
    minutes,
  };
}

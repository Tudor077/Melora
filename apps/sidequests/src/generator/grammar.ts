import type { Action, Ranged, Requirement, Scene, Target, Twist } from "./types";
import type { Rng } from "./rng";

/**
 * Actions declare their requirements implicitly, through the way they are
 * written — tagging 60+ sentences by hand would rot the moment someone adds a
 * line to `vocab.ts`. These patterns are the contract: if you write an action
 * that needs speech, use a speech verb; if it needs a camera, say "poză".
 */
const NEEDS_SPEECH =
  /voce tare|întreab|roag[ăa]|cere-i|cere o|explic|discurs|anunț|fredon|comenteaz|prezint|șoptește|convinge|compliment|recenzie|crainic|argumenteaz|tur ghidat|cânt|sfaturi de viață|permisiunea|cunoștință|mulțumire|mulțumește|numeri cu voce/i;
const EXPLICITLY_SILENT = /fără să spui|niciun cuvânt|fără cuvinte|în tăcere/i;
const NEEDS_PHONE = /fotografiaz|poz[ăa]|foto|video|captur/i;
const NEEDS_FRIEND = /prieten/i;

/** Requirements an action rules out — a silent action bars talkative twists. */
export function forbidsOf(action: Action): Requirement[] {
  return EXPLICITLY_SILENT.test(action.text) ? ["vorbire"] : [];
}

export function requirementsOf(action: Action): Requirement[] {
  const out: Requirement[] = [];
  const silent = EXPLICITLY_SILENT.test(action.text);
  if (!silent && (NEEDS_SPEECH.test(action.text) || action.accepts.includes("persoana"))) {
    out.push("vorbire");
  }
  if (NEEDS_PHONE.test(action.text)) out.push("telefon");
  if (NEEDS_FRIEND.test(action.text)) out.push("prieten");
  return out;
}

export function inRange(item: Ranged, stupidity: number): boolean {
  return stupidity >= item.min && stupidity <= item.max;
}

export function fitsScene(item: { scenes?: Scene[] }, scene: Scene): boolean {
  return !item.scenes || item.scenes.includes(scene);
}

/**
 * Weighting alone still let a "fotografiază statuia" slip out at prostie 95,
 * which makes the slider feel broken. Above the low tiers we also refuse
 * fragments that unlock far below where the slider sits: at 95 only fragments
 * that need at least 50 qualify, at 30 everything still does.
 */
function aboveFloor(item: Ranged, stupidity: number, window: number): boolean {
  return item.min >= stupidity - window;
}

const ACTION_WINDOW = 45;
const TWIST_WINDOW = 60;

export function eligibleActions(all: Action[], stupidity: number, scene: Scene): Action[] {
  const inTier = all.filter((a) => inRange(a, stupidity) && aboveFloor(a, stupidity, ACTION_WINDOW));
  // Never return nothing: relax the floor, then the scene, rather than failing.
  const base = inTier.length > 0 ? inTier : all.filter((a) => inRange(a, stupidity));
  const scoped = base.filter((a) => fitsScene(a, scene));
  return scoped.length > 0 ? scoped : base;
}

/** Twists an action can carry without contradicting what it already demands. */
export function eligibleTwists(
  all: Twist[],
  stupidity: number,
  needs: readonly Requirement[],
  forbids: readonly Requirement[] = [],
): Twist[] {
  const compatible = all.filter(
    (t) =>
      inRange(t, stupidity) &&
      !t.blocks?.some((b) => needs.includes(b)) &&
      !t.needs?.some((n) => forbids.includes(n)),
  );
  const inTier = compatible.filter((t) => aboveFloor(t, stupidity, TWIST_WINDOW));
  return inTier.length > 0 ? inTier : compatible;
}

export function targetsFor(
  all: Target[],
  action: Action,
  stupidity: number,
  scene: Scene,
): Target[] {
  const matches = all.filter((t) => action.accepts.includes(t.kind) && inRange(t, stupidity));
  const scoped = matches.filter((t) => fitsScene(t, scene));
  return scoped.length > 0 ? scoped : matches;
}

/**
 * Fragments unlocked near the current slider position are the ones that make
 * the setting feel like it did something, so they get weighted up; broad
 * "works anywhere" fragments stay in the mix but stop dominating at the
 * extremes.
 */
function weightOf(item: Ranged, stupidity: number): number {
  const center = (item.min + item.max) / 2;
  const distance = Math.abs(stupidity - center) / 100;
  return 0.25 + (1 - distance) ** 2 * 2;
}

export function weightedPick<T extends Ranged>(rng: Rng, items: readonly T[], stupidity: number): T {
  let total = 0;
  const weights = items.map((item) => {
    const w = weightOf(item, stupidity);
    total += w;
    return w;
  });
  let roll = rng() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}


/** Two constraints clash when one demands exactly what the other forbids. */
export function twistsClash(a: Twist, b: Twist): boolean {
  return (
    (a.blocks?.some((x) => b.needs?.includes(x)) ?? false) ||
    (b.blocks?.some((x) => a.needs?.includes(x)) ?? false)
  );
}

/** Picks constraints one at a time, dropping whatever the last pick rules out. */
export function pickTwists(
  rng: Rng,
  pool: readonly Twist[],
  stupidity: number,
  count: number,
): Twist[] {
  let remaining = pool.slice();
  const chosen: Twist[] = [];
  while (chosen.length < count && remaining.length > 0) {
    const next = weightedPick(rng, remaining, stupidity);
    chosen.push(next);
    remaining = remaining.filter((t) => t !== next && !twistsClash(next, t));
  }
  return chosen;
}

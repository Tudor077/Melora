import { DEFAULT_VIBES, type AudioFeatures, type VibeProfile } from "./types";

function distance(a: number, b: number): number {
  return Math.abs(a - b);
}

export function scoreVibeMatch(features: AudioFeatures, vibe: VibeProfile): number {
  const keys = Object.keys(vibe.targets) as Array<keyof VibeProfile["targets"]>;
  if (keys.length === 0) return 0;

  let total = 0;
  for (const key of keys) {
    const target = vibe.targets[key];
    if (target == null) continue;
    total += distance(features[key], target);
  }

  return 1 - total / keys.length;
}

export function classifyVibes(
  features: AudioFeatures,
  vibes: VibeProfile[] = DEFAULT_VIBES,
  threshold = 0.72,
): { primary: VibeProfile | null; matched: VibeProfile[] } {
  const scored = vibes
    .map((vibe) => ({ vibe, score: scoreVibeMatch(features, vibe) }))
    .sort((a, b) => b.score - a.score);

  const matched = scored.filter((entry) => entry.score >= threshold).map((entry) => entry.vibe);
  return {
    primary: scored[0]?.vibe ?? null,
    matched,
  };
}

export function getVibeById(id: string, vibes: VibeProfile[] = DEFAULT_VIBES): VibeProfile | undefined {
  return vibes.find((vibe) => vibe.id === id);
}

export function averageAudioTargets(vibes: VibeProfile[]): Partial<AudioFeatures> {
  if (vibes.length === 0) return {};

  const sums = { energy: 0, valence: 0, danceability: 0, acousticness: 0 };
  let count = 0;

  for (const vibe of vibes) {
    for (const key of Object.keys(sums) as Array<keyof typeof sums>) {
      const value = vibe.targets[key];
      if (value != null) {
        sums[key] += value;
        count += 1;
      }
    }
  }

  if (count === 0) return {};
  return {
    energy: sums.energy / count,
    valence: sums.valence / count,
    danceability: sums.danceability / count,
    acousticness: sums.acousticness / count,
  } as Partial<AudioFeatures>;
}

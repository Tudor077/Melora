import type { Scene } from "./types";

export interface SceneMeta {
  id: Scene;
  label: string;
  emoji: string;
}

/** Order matters — this is the chip row on the home screen. */
export const SCENES: SceneMeta[] = [
  { id: "oras", label: "Oraș", emoji: "🏙️" },
  { id: "muzeu", label: "Muzeu", emoji: "🖼️" },
  { id: "piata", label: "Piață", emoji: "🧺" },
  { id: "mancare", label: "Masă", emoji: "🍽️" },
  { id: "parc", label: "Parc", emoji: "🌳" },
  { id: "plaja", label: "Plajă", emoji: "🏖️" },
  { id: "munte", label: "Munte", emoji: "⛰️" },
  { id: "transport", label: "Drum", emoji: "🚉" },
  { id: "noapte", label: "Noapte", emoji: "🌙" },
];

export function sceneMeta(id: Scene): SceneMeta {
  return SCENES.find((s) => s.id === id) ?? SCENES[0];
}

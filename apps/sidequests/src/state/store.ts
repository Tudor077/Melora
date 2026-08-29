import type { Quest, Scene } from "../generator/types";

const KEY = "sidequest:v1";

export interface LogEntry {
  id: string;
  code: string;
  title: string;
  brief: string;
  points: number;
  stupidity: number;
  scene: Scene;
  /** Epoch ms. */
  at: number;
  status: "done" | "abandoned";
}

export interface ActiveQuest {
  quest: Quest;
  /** Epoch ms when the timer started. */
  startedAt: number;
}

export interface SaveState {
  version: 1;
  stupidity: number;
  scene: Scene;
  xp: number;
  /** Quest ids already shown, newest last — the anti-repeat guard. */
  seen: string[];
  active: ActiveQuest | null;
  log: LogEntry[];
}

export const DEFAULT_STATE: SaveState = {
  version: 1,
  stupidity: 35,
  scene: "oras",
  xp: 0,
  seen: [],
  active: null,
  log: [],
};

/** Keeps the save small enough that writing it on every reroll stays cheap. */
const SEEN_LIMIT = 400;
const LOG_LIMIT = 200;

export function loadState(): SaveState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<SaveState>;
    if (parsed.version !== 1) return DEFAULT_STATE;
    return {
      ...DEFAULT_STATE,
      ...parsed,
      seen: Array.isArray(parsed.seen) ? parsed.seen.slice(-SEEN_LIMIT) : [],
      log: Array.isArray(parsed.log) ? parsed.log.slice(0, LOG_LIMIT) : [],
    };
  } catch {
    // A corrupt or blocked store should cost the player their history, never
    // the app itself.
    return DEFAULT_STATE;
  }
}

export function saveState(state: SaveState): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        ...state,
        seen: state.seen.slice(-SEEN_LIMIT),
        log: state.log.slice(0, LOG_LIMIT),
      }),
    );
  } catch {
    // Private mode / full quota: play on without persistence.
  }
}

const LEVEL_STEP = 250;

export function levelFor(xp: number): { level: number; into: number; needed: number } {
  // Each level costs a bit more than the last, so the 5x payout of the top tier
  // is felt without making level 2 instant.
  let level = 1;
  let remaining = xp;
  let cost = LEVEL_STEP;
  while (remaining >= cost) {
    remaining -= cost;
    level++;
    cost = Math.round(cost * 1.25);
  }
  return { level, into: remaining, needed: cost };
}

export const RANKS = [
  "Turist rătăcit",
  "Explorator amator",
  "Cercetaș urban",
  "Agent de teren",
  "Maestru al prostiei",
  "Legendă locală",
];

export function rankFor(level: number): string {
  return RANKS[Math.min(RANKS.length - 1, level - 1)];
}

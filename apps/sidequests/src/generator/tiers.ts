/**
 * The slider is the whole product, so the tiers are deliberately opinionated:
 * each one has its own voice, its own payout and its own time budget. Nothing
 * above tier 0 gets harder to *do* — it only gets harder to do with a straight
 * face.
 */
export interface Tier {
  index: number;
  name: string;
  emoji: string;
  blurb: string;
  /** Points multiplier — looking dumber has to pay better. */
  multiplier: number;
  /** How many extra constraints get stacked on the action. */
  twists: [min: number, max: number];
  minutes: [min: number, max: number];
  accent: string;
}

export const TIERS: Tier[] = [
  {
    index: 0,
    name: "Turist cuminte",
    emoji: "🙂",
    blurb: "Misiuni pe care le poți povesti bunicii.",
    multiplier: 1,
    twists: [0, 1],
    minutes: [10, 30],
    accent: "#4ade80",
  },
  {
    index: 1,
    name: "Ușor ciudat",
    emoji: "🤨",
    blurb: "Nimeni nu se uită. Probabil.",
    multiplier: 1.6,
    twists: [1, 1],
    minutes: [8, 25],
    accent: "#38bdf8",
  },
  {
    index: 2,
    name: "Ciudat rău",
    emoji: "😅",
    blurb: "Cineva sigur s-a întors după tine.",
    multiplier: 2.4,
    twists: [1, 2],
    minutes: [6, 20],
    accent: "#facc15",
  },
  {
    index: 3,
    name: "Jenant",
    emoji: "🫣",
    blurb: "Prietenii se prefac că nu te cunosc.",
    multiplier: 3.5,
    twists: [2, 2],
    minutes: [5, 15],
    accent: "#fb923c",
  },
  {
    index: 4,
    name: "Cretinism absolut",
    emoji: "🤡",
    blurb: "Legal, sigur, dar complet lipsit de demnitate.",
    multiplier: 5,
    twists: [2, 3],
    minutes: [4, 12],
    accent: "#f43f5e",
  },
];

export function tierFor(stupidity: number): Tier {
  const index = Math.min(TIERS.length - 1, Math.floor(stupidity / 20));
  return TIERS[index];
}

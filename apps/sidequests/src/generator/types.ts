/** Where you are. Biases which actions and targets are even plausible. */
export type Scene =
  | "oras"
  | "muzeu"
  | "plaja"
  | "munte"
  | "transport"
  | "piata"
  | "mancare"
  | "noapte"
  | "parc";

/**
 * What kind of thing a slot refers to. Actions declare which kinds they accept,
 * so we never generate "Salută un felinar stradal" unless the action says a
 * lifeless target is fine.
 */
export type TargetKind =
  | "obiect"
  | "persoana"
  | "loc"
  | "animal"
  | "mancare"
  | "semn";

/** Every fragment is only eligible inside a stupidity window [min, max]. */
export interface Ranged {
  min: number;
  max: number;
}

export interface Target extends Ranged {
  /** Noun phrase carrying its own article, so it drops into any slot cleanly. */
  text: string;
  kind: TargetKind;
  /** Omitted means "works anywhere". */
  scenes?: Scene[];
}

export interface Action extends Ranged {
  /** Imperative sentence with a single `{t}` placeholder for the target. */
  text: string;
  accepts: TargetKind[];
  scenes?: Scene[];
}

/**
 * What an action needs in order to be doable. Twists can forbid one of these,
 * and the generator refuses to pair a twist with an action it would contradict
 * — otherwise you get "Fotografiază statuia. Fă-o fără să atingi telefonul."
 */
export type Requirement = "vorbire" | "telefon" | "prieten";

export interface Twist extends Ranged {
  text: string;
  /** Extra points this constraint is worth on its own. */
  cost: number;
  /** Actions needing any of these are never paired with this twist. */
  blocks?: Requirement[];
  /** What this constraint itself demands — two twists that contradict each
   *  other ("vorbește mai grav" + "nu spune niciun cuvânt") never co-occur. */
  needs?: Requirement[];
}

export interface Proof extends Ranged {
  text: string;
}

export interface Quest {
  /** Stable id: same seed + slider + scene always rebuilds this quest. */
  id: string;
  code: string;
  seed: number;
  title: string;
  /** Full brief, ready to read out loud. */
  brief: string;
  action: string;
  twists: string[];
  proof: string;
  stupidity: number;
  tier: number;
  scene: Scene;
  points: number;
  minutes: number;
}

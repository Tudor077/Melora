import {
  artistExposure,
  artistFeedback,
  genreFeedback,
  trackSeenRecency,
  type FeedbackStore,
} from "./feedback";
import type { TasteProfile } from "./taste";
import type { SpotifyTrack } from "./types";

/**
 * Where a candidate came from. Dev-mode Spotify gives us no audio features
 * and no batch artist lookup, so the query that surfaced a track is the only
 * cheap description of it we have: a hit from `"jungle year:2024"` is a
 * jungle track, and that is enough to both rank and label it.
 */
export interface CandidateSource {
  kind: "genre" | "collab" | "related" | "hearted" | "fallback";
  /** Genre the query was built from, when the wave was genre-driven */
  genre?: string;
  /** Seed artist the query was built from, for collab/related waves */
  artistName?: string;
  /** How much the user likes this source, 0..1 */
  strength: number;
}

export interface Candidate {
  track: SpotifyTrack;
  sources: CandidateSource[];
}

export interface ScoredCandidate extends Candidate {
  score: number;
  /** Genres inferred from provenance, used for chips, filters and sorting */
  genres: string[];
  /** Per-component contributions, handy when tuning weights */
  breakdown: Record<string, number>;
}

/** Deterministic RNG so one session's jitter is reproducible. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function bell(value: number, center: number, width: number): number {
  const z = (value - center) / width;
  return Math.exp(-0.5 * z * z);
}

function releaseYear(track: SpotifyTrack): number | null {
  const raw = track.album?.release_date;
  if (!raw) return null;
  const year = Number.parseInt(raw.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

export interface ScoreContext {
  profile: TasteProfile;
  feedback: FeedbackStore;
  now?: number;
  /** Adds a stable per-session wobble so two batches are never identical */
  random?: () => number;
}

/**
 * Weights are deliberately readable rather than learned: with one user and no
 * server, a hand-tuned linear model is easier to reason about than anything
 * that needs training data we do not have.
 */
const WEIGHTS = {
  source: 1,
  genreFeedback: 0.55,
  collab: 0.5,
  artistFeedback: 0.7,
  popularityFit: 0.45,
  eraFit: 0.3,
  jitter: 0.18,
  seenPenalty: 1.3,
  fatiguePenalty: 0.35,
  sanityPenalty: 0.9,
};

export function scoreCandidate(candidate: Candidate, context: ScoreContext): ScoredCandidate {
  const { profile, feedback } = context;
  const now = context.now ?? Date.now();
  const random = context.random ?? Math.random;
  const track = candidate.track;

  const genres = [
    ...new Set(
      candidate.sources
        .map((source) => source.genre)
        .filter((genre): genre is string => Boolean(genre)),
    ),
  ];

  // How strongly the user's own taste vouches for the query behind this hit.
  // Max, not sum: showing up in two searches is not twice as relevant, and a
  // sum would push whatever the widest query returned to the top. Being
  // reachable from *different kinds* of query is real corroboration though,
  // so that earns a small, capped nudge.
  const bestStrength = candidate.sources.reduce((max, source) => Math.max(max, source.strength), 0);
  const distinctKinds = new Set(candidate.sources.map((source) => source.kind)).size;
  const sourceStrength = bestStrength + Math.min(2, distinctKinds - 1) * 0.08;

  // Hearts and skips on earlier batches, which is the only place the model
  // learns something the taste profile could not already tell us.
  const genreVote =
    genres.length > 0
      ? genres.reduce((sum, genre) => sum + genreFeedback(feedback, genre, now), 0) / genres.length
      : 0;

  // A track fronted by someone new but featuring an artist the user loves is
  // the single best kind of discovery, so it gets its own term. "Loves" can
  // come from the library (profile) or from a recent heart (feedback); the
  // profile alone would miss artists the user only just discovered here.
  const primaryId = track.artists[0]?.id ?? "";
  const collab = track.artists.slice(1).reduce((max, artist) => {
    if (!artist.id) return max;
    const affinity = Math.max(
      profile.artistWeights[artist.id] ?? 0,
      artistFeedback(feedback, artist.id, now),
    );
    return Math.max(max, affinity);
  }, 0);

  const artistVote = primaryId ? artistFeedback(feedback, primaryId, now) : 0;

  // An artist we have surfaced batch after batch without ever earning a heart
  // is quietly failing; let someone new have the slot. A positive artist vote
  // switches the penalty off entirely.
  const exposure = primaryId ? artistExposure(feedback, primaryId, now) : 0;
  const fatigue = artistVote > 0.1 ? 0 : Math.max(0, Math.min(1, (exposure - 4) / 8));

  // Since Feb 2026 dev-mode responses may omit `popularity` entirely, and a
  // single NaN here poisons the whole score (and NaN never wins a comparison,
  // so selection would pick nothing). Missing data scores neutral instead.
  const popularity = Number.isFinite(track.popularity) ? track.popularity : null;
  const popularityMedian = Number.isFinite(profile.popularityMedian)
    ? profile.popularityMedian
    : 45;

  // Aim slightly below the user's own median popularity: familiar enough to
  // be their kind of music, obscure enough to be news to them.
  const popularityTarget = Math.max(10, Math.min(78, popularityMedian - 8));
  const popularityFit = popularity == null ? 0.5 : bell(popularity, popularityTarget, 26);

  const year = releaseYear(track);
  const currentYear = new Date(now).getFullYear();
  const eraMedianYear = Number.isFinite(profile.eraMedianYear)
    ? profile.eraMedianYear
    : currentYear - 4;
  const recentShare = Number.isFinite(profile.recentShare) ? profile.recentShare : 0.5;
  const eraFit = (() => {
    if (year == null) return 0.5;
    // Two pulls: the era the user actually listens to, and new releases,
    // mixed by how modern their library already is.
    const familiar = bell(year, eraMedianYear, 8);
    const fresh = bell(year, currentYear, 3);
    return familiar * (1 - recentShare * 0.5) + fresh * (recentShare * 0.5 + 0.15);
  })();

  // Repeats are the loudest complaint an hourly app can generate. Checked by
  // id and by normalised key, so re-releases count as repeats too.
  const seenPenalty = trackSeenRecency(feedback, track, now);

  // Interludes, skits, DJ sets and sleep loops all pass the junk regex but
  // are not songs anyone wants in a 24-track batch.
  const durationMin = Number.isFinite(track.duration_ms) ? track.duration_ms / 60000 : 3;
  const sanityPenalty =
    (durationMin < 1.1 ? 0.6 : 0) +
    (durationMin > 11 ? 0.5 : 0) +
    // Popularity 0 is usually a dead upload, unless the user lives underground.
    (popularity != null && popularity <= 2 && popularityMedian > 25 ? 0.5 : 0);

  const jitter = random();

  const breakdown = {
    source: WEIGHTS.source * sourceStrength,
    genreFeedback: WEIGHTS.genreFeedback * genreVote,
    collab: WEIGHTS.collab * collab,
    artistFeedback: WEIGHTS.artistFeedback * artistVote,
    popularityFit: WEIGHTS.popularityFit * popularityFit,
    eraFit: WEIGHTS.eraFit * eraFit,
    jitter: WEIGHTS.jitter * jitter,
    seenPenalty: -WEIGHTS.seenPenalty * seenPenalty,
    fatiguePenalty: -WEIGHTS.fatiguePenalty * fatigue,
    sanityPenalty: -WEIGHTS.sanityPenalty * sanityPenalty,
  };

  // Belt and suspenders: one NaN term must never zero out the whole batch.
  const score = Object.values(breakdown).reduce(
    (sum, value) => sum + (Number.isFinite(value) ? value : 0),
    0,
  );

  return { ...candidate, genres, score, breakdown };
}

export interface SelectOptions {
  limit: number;
  /** How hard to push back on repeating an artist within one batch */
  artistPenalty?: number;
  /** How hard to push back on repeating a genre within one batch */
  genrePenalty?: number;
  /** Hard ceiling on tracks by the same primary artist */
  maxPerArtist?: number;
}

/**
 * Greedy maximal-marginal-relevance pick.
 *
 * Taking the top N by score alone produces a batch of 24 near-identical
 * tracks, because whatever genre scores highest also returns the most hits.
 * Each pick here charges a growing penalty for an artist or genre that is
 * already represented, so the batch spans the user's taste instead of
 * drilling into one corner of it.
 */
export function selectDiverse(
  candidates: ScoredCandidate[],
  options: SelectOptions,
): ScoredCandidate[] {
  const { limit, artistPenalty = 0.55, genrePenalty = 0.3, maxPerArtist = 2 } = options;
  const pool = [...candidates].sort((a, b) => b.score - a.score);
  const chosen: ScoredCandidate[] = [];
  const artistCounts = new Map<string, number>();
  const genreCounts = new Map<string, number>();

  while (chosen.length < limit && pool.length > 0) {
    let bestIndex = -1;
    let bestValue = -Infinity;

    for (let i = 0; i < pool.length; i++) {
      const candidate = pool[i] as ScoredCandidate;
      const artistId = candidate.track.artists[0]?.id ?? candidate.track.artists[0]?.name ?? "";
      const artistCount = artistCounts.get(artistId) ?? 0;
      if (artistCount >= maxPerArtist) continue;

      const genreCount = candidate.genres.reduce(
        (max, genre) => Math.max(max, genreCounts.get(genre) ?? 0),
        0,
      );

      // A NaN score would lose every comparison and silently empty the batch.
      const score = Number.isFinite(candidate.score) ? candidate.score : -5;
      const value =
        score - artistCount * artistPenalty - Math.max(0, genreCount - 1) * genrePenalty;

      if (value > bestValue) {
        bestValue = value;
        bestIndex = i;
      }
    }

    if (bestIndex === -1) break;
    const picked = pool.splice(bestIndex, 1)[0] as ScoredCandidate;
    chosen.push(picked);

    const artistId = picked.track.artists[0]?.id ?? picked.track.artists[0]?.name ?? "";
    artistCounts.set(artistId, (artistCounts.get(artistId) ?? 0) + 1);
    for (const genre of picked.genres) genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
  }

  return chosen;
}

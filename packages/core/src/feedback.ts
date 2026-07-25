import { trackKey } from "./taste";
import type { SpotifyTrack } from "./types";

/**
 * What the user did with the picks we already made.
 *
 * Discovery without this is a slot machine: every refresh re-rolls the same
 * searches and can hand back a song that was already shown (or already
 * skipped) an hour ago. The store answers two questions:
 *
 *  1. Have we shown this track recently? (do not repeat it)
 *  2. Do hearts and skips agree with the taste profile? (re-weight genres
 *     and artists that the profile got wrong)
 */

export interface DecayedScore {
  /** Signed score, positive = liked, negative = skipped */
  value: number;
  /** When `value` was last updated, for time decay */
  at: number;
}

export interface ArtistScore extends DecayedScore {
  /** Display name, kept so a hearted artist can seed a search query later. */
  name?: string;
}

export interface FeedbackStore {
  version: 1;
  /** lowercase genre -> score */
  genres: Record<string, DecayedScore>;
  /** artistId -> score */
  artists: Record<string, ArtistScore>;
  /**
   * artistId -> decayed count of batches this artist appeared in. Fuels the
   * fatigue penalty: an artist we keep showing without ever earning a heart
   * should gradually make room for someone else.
   */
  exposure: Record<string, DecayedScore>;
  /** trackId (and normalised track key) -> last time it appeared in a batch */
  seen: Record<string, number>;
}

const FEEDBACK_KEY = "melora:feedback:v1";
/** Tastes drift; a like from two months ago should not outvote last week. */
const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;
/** How long a shown track stays "recently shown". */
export const SEEN_TTL_MS = 10 * 24 * 60 * 60 * 1000;
// Each track writes two seen entries (id + normalised key), so this holds
// roughly MAX_SEEN / 2 distinct tracks.
const MAX_SEEN = 2500;
const MAX_SCORES = 400;
/** Exposure is a count, not a vote, so it gets its own, wider clamp. */
const MAX_EXPOSURE = 12;

export function emptyFeedback(): FeedbackStore {
  return { version: 1, genres: {}, artists: {}, exposure: {}, seen: {} };
}

function decay(score: DecayedScore | undefined, now: number): number {
  if (!score) return 0;
  const age = Math.max(0, now - score.at);
  return score.value * Math.pow(0.5, age / HALF_LIFE_MS);
}

function bump(
  bucket: Record<string, DecayedScore>,
  key: string,
  delta: number,
  now: number,
): void {
  const clean = key.trim();
  if (!clean) return;
  // Decay what is there before adding, so old and new events share a clock.
  const current = decay(bucket[clean], now);
  // Clamped so one obsessive week cannot permanently pin a genre at the top.
  const next = Math.max(-4, Math.min(4, current + delta));
  bucket[clean] = { value: next, at: now };
}

/** Drop stale entries so the store cannot grow without bound. */
function prune(store: FeedbackStore, now: number): FeedbackStore {
  const seenEntries = Object.entries(store.seen)
    .filter(([, at]) => now - at < SEEN_TTL_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_SEEN);

  const trim = <T extends DecayedScore>(bucket: Record<string, T>) =>
    Object.fromEntries(
      Object.entries(bucket)
        .filter(([, score]) => Math.abs(decay(score, now)) > 0.02)
        .sort((a, b) => Math.abs(decay(b[1], now)) - Math.abs(decay(a[1], now)))
        .slice(0, MAX_SCORES),
    );

  return {
    version: 1,
    genres: trim(store.genres),
    artists: trim(store.artists),
    exposure: trim(store.exposure),
    seen: Object.fromEntries(seenEntries),
  };
}

export function loadFeedback(
  storage: Pick<Storage, "getItem"> = globalThis.localStorage,
): FeedbackStore {
  try {
    const raw = storage.getItem(FEEDBACK_KEY);
    if (!raw) return emptyFeedback();
    const parsed = JSON.parse(raw) as Partial<FeedbackStore>;
    return {
      version: 1,
      genres: parsed.genres ?? {},
      artists: parsed.artists ?? {},
      exposure: parsed.exposure ?? {},
      seen: parsed.seen ?? {},
    };
  } catch {
    return emptyFeedback();
  }
}

export function saveFeedback(
  store: FeedbackStore,
  storage: Pick<Storage, "setItem"> = globalThis.localStorage,
): void {
  try {
    storage.setItem(FEEDBACK_KEY, JSON.stringify(prune(store, Date.now())));
  } catch {
    // Storage full: feedback degrades to session-only, discovery still works.
  }
}

export type FeedbackEvent =
  | { kind: "shown"; track: SpotifyTrack; genres?: string[] }
  | { kind: "like"; track: SpotifyTrack; genres?: string[] }
  | { kind: "unlike"; track: SpotifyTrack; genres?: string[] }
  /** Left the track early. `playedMs` tells us how early. */
  | { kind: "skip"; track: SpotifyTrack; genres?: string[]; playedMs: number }
  /** Listened to (most of) it without hearting; a mild positive. */
  | { kind: "played"; track: SpotifyTrack; genres?: string[]; playedMs: number };

/**
 * How much a single event moves the needle. A heart is worth several plays,
 * and an instant skip is worth more than a slow one, but no skip is ever as
 * loud as a like: people skip for reasons that have nothing to do with taste
 * (wrong moment, already know it, phone in pocket).
 */
function eventWeight(event: FeedbackEvent): number {
  switch (event.kind) {
    case "like":
      return 1;
    case "unlike":
      return -0.6;
    case "skip":
      // Under 5s reads as "not for me"; a skip at 25s is nearly neutral.
      return event.playedMs < 5000 ? -0.35 : event.playedMs < 20000 ? -0.15 : -0.05;
    case "played":
      return event.playedMs > 25000 ? 0.25 : 0;
    case "shown":
      return 0;
  }
}

/** Fold events into the store. Returns a new store; callers persist it. */
export function applyFeedback(
  store: FeedbackStore,
  events: FeedbackEvent[],
  now = Date.now(),
): FeedbackStore {
  const next: FeedbackStore = {
    version: 1,
    genres: { ...store.genres },
    artists: { ...store.artists },
    exposure: { ...store.exposure },
    seen: { ...store.seen },
  };

  for (const event of events) {
    // Both keys, so a re-release under a new Spotify id still reads as seen.
    next.seen[event.track.id] = now;
    next.seen[trackKey(event.track)] = now;

    // Every appearance counts towards fatigue, whatever the user did with it.
    const primary = event.track.artists[0];
    if (event.kind === "shown" && primary?.id) {
      const current = decay(next.exposure[primary.id], now);
      next.exposure[primary.id] = { value: Math.min(MAX_EXPOSURE, current + 1), at: now };
    }

    const weight = eventWeight(event);
    if (weight === 0) continue;

    // The primary artist owns the outcome; features get a fraction.
    event.track.artists.forEach((artist, index) => {
      if (!artist.id) return;
      bump(next.artists, artist.id, weight * (index === 0 ? 1 : 0.3), now);
      // The name is what a later search wave will query by.
      const entry = next.artists[artist.id];
      if (entry && artist.name) entry.name = artist.name;
    });

    const genres = event.genres ?? [];
    if (genres.length > 0) {
      // Split the credit so a track tagged with six genres does not shout
      // six times as loud as one tagged with a single genre.
      const share = weight / Math.sqrt(genres.length);
      for (const genre of genres) bump(next.genres, genre.toLowerCase(), share, now);
    }
  }

  return prune(next, now);
}

/** Signed genre feeling in roughly -1..1, from hearts and skips only. */
export function genreFeedback(store: FeedbackStore, genre: string, now = Date.now()): number {
  return Math.tanh(decay(store.genres[genre.toLowerCase()], now) / 2);
}

/** Signed artist feeling in roughly -1..1. */
export function artistFeedback(store: FeedbackStore, artistId: string, now = Date.now()): number {
  return Math.tanh(decay(store.artists[artistId], now) / 2);
}

/**
 * Decayed count of batches this artist has appeared in. Feeds the fatigue
 * penalty in scoring: repetition without a heart is a quiet "no".
 */
export function artistExposure(store: FeedbackStore, artistId: string, now = Date.now()): number {
  return Math.max(0, decay(store.exposure[artistId], now));
}

/**
 * Artists the user hearted recently enough that the score still stands tall.
 * These are the best search seeds the app has: an explicit "more like this"
 * that the taste profile will not reflect for weeks.
 */
export function likedArtistSeeds(
  store: FeedbackStore,
  now = Date.now(),
): Array<{ id: string; name: string; affinity: number }> {
  return Object.entries(store.artists)
    .map(([id, score]) => ({ id, name: score.name ?? "", affinity: decay(score, now) }))
    .filter((entry) => entry.name.length > 0 && entry.affinity >= 0.5)
    .sort((a, b) => b.affinity - a.affinity);
}

/** True while a track is still inside the "do not repeat" window. */
export function wasSeenRecently(store: FeedbackStore, trackId: string, now = Date.now()): boolean {
  const at = store.seen[trackId];
  return at != null && now - at < SEEN_TTL_MS;
}

/**
 * 0 for never shown, rising to 1 for shown just now. Used as a soft penalty
 * so a repeat is possible when the pool is thin, but never preferred.
 */
export function seenRecency(store: FeedbackStore, trackId: string, now = Date.now()): number {
  const at = store.seen[trackId];
  if (at == null) return 0;
  const age = now - at;
  if (age >= SEEN_TTL_MS) return 0;
  return 1 - age / SEEN_TTL_MS;
}

/**
 * Seen-recency for a full track: checks the Spotify id and the normalised
 * "name|artist" key, so the album cut of last week's single still counts as
 * a repeat.
 */
export function trackSeenRecency(store: FeedbackStore, track: SpotifyTrack, now = Date.now()): number {
  return Math.max(seenRecency(store, track.id, now), seenRecency(store, trackKey(track), now));
}

/** Artists the user keeps skipping, so discovery can stop suggesting them. */
export function dislikedArtistIds(store: FeedbackStore, now = Date.now()): string[] {
  return Object.keys(store.artists).filter((id) => decay(store.artists[id], now) <= -0.8);
}

import { SpotifyClient } from "./spotify/client";
import type { SpotifyTrack } from "./types";

/**
 * A weighted picture of what the user actually listens to.
 *
 * Building it costs a dozen API calls, so it is cached: an hourly refresh
 * should spend its request budget on finding *new* tracks, not on re-reading
 * a library that barely changes between two batches.
 */
export interface TasteProfile {
  builtAt: number;
  /** artistId -> affinity 0..1 (1 = current obsession) */
  artistWeights: Record<string, number>;
  /** artistId -> display name, for search queries */
  artistNames: Record<string, string>;
  /** artistId -> its own genre tags, so a seed artist can label what it finds */
  artistTags: Record<string, string[]>;
  /** lowercase genre -> affinity 0..1 */
  genreWeights: Record<string, number>;
  /** Tracks the user already has, so discovery never shows them */
  knownTrackIds: string[];
  /** Artists the user already has as a primary artist */
  knownArtistIds: string[];
  /** Normalised "name|artist" keys, catching re-releases of known songs */
  knownTrackKeys: string[];
  /** Median popularity of the user's own library (0..100) */
  popularityMedian: number;
  /** Median release year of the user's own library */
  eraMedianYear: number;
  /** Share of the library released in the last three years (0..1) */
  recentShare: number;
}

const PROFILE_KEY = "melora:taste-profile:v2";
/** A library does not change meaningfully within a day, and dev-mode quotas
 *  (2026) make every rebuild's ~8 calls expensive — feedback (hearts/skips)
 *  carries the short-term signal between rebuilds. */
const PROFILE_TTL_MS = 24 * 60 * 60 * 1000;

/** Recency weight of the three Spotify listening windows. */
const TERM_WEIGHTS: Array<{ term: "short_term" | "medium_term" | "long_term"; weight: number }> = [
  { term: "short_term", weight: 1 },
  { term: "medium_term", weight: 0.8 },
  { term: "long_term", weight: 0.55 },
];

/** Top tracks only use two windows: long_term rarely adds artists the other
 *  two missed, and each extra window is an API call the quota can't spare. */
const TRACK_TERMS = TERM_WEIGHTS.slice(0, 2);

/**
 * Strip the noise Spotify puts in track titles so two releases of the same
 * song collapse onto one key ("Song - 2011 Remaster" === "Song").
 */
export function trackKey(track: SpotifyTrack): string {
  const name = track.name
    .toLowerCase()
    .replace(/\s*[-–]\s*(\d{4}\s*)?(remaster(ed)?|remix|radio edit|single version|album version|mono|stereo|live|deluxe|bonus track|extended|instrumental)\b.*$/i, "")
    .replace(/\s*[([][^)\]]*(remaster|version|edit|mix|live|feat\.?|ft\.?|with)[^)\]]*[)\]]/gi, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const artist = (track.artists[0]?.name ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return `${name}|${artist}`;
}

function median(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);
}

function releaseYear(track: SpotifyTrack): number | null {
  const raw = track.album?.release_date;
  if (!raw) return null;
  const year = Number.parseInt(raw.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

/** Scale a weight map so its largest value is 1, keeping ratios intact. */
function normalize(map: Map<string, number>): Record<string, number> {
  let max = 0;
  for (const value of map.values()) if (value > max) max = value;
  const out: Record<string, number> = {};
  if (max <= 0) return out;
  for (const [key, value] of map) out[key] = value / max;
  return out;
}

export interface BuildTasteProfileOptions {
  /**
   * Genre tags per artist name from an outside source (MusicBrainz), since
   * Spotify leaves `genres` empty on niche artists. Keys are lowercased
   * artist names.
   */
  artistGenres?: Record<string, string[]>;
  /** Genres the user pinned by hand; they always land near the top. */
  pinnedGenres?: string[];
}

/**
 * Read the four corners of the account (top artists, top tracks, Liked Songs,
 * own playlists) and fold them into one weighted profile. Everything is
 * best-effort: a missing scope or an empty library just narrows the picture.
 */
export async function buildTasteProfile(
  client: SpotifyClient,
  options: BuildTasteProfileOptions = {},
): Promise<TasteProfile> {
  const { artistGenres = {}, pinnedGenres = [] } = options;

  const [artistTermResults, trackTermResults, savedPages, playlistsResult] = await Promise.all([
    Promise.allSettled(TERM_WEIGHTS.map(({ term }) => client.getTopArtists(30, term))),
    Promise.allSettled(TRACK_TERMS.map(({ term }) => client.getTopTracks(50, term))),
    // Liked Songs are the strongest deliberate signal the account holds, so
    // they get two pages; the profile is rebuilt daily, so the cost is small.
    Promise.allSettled([client.getSavedTracks(50, 0), client.getSavedTracks(50, 50)]),
    client.getUserPlaylists(20).catch(() => null),
  ]);

  const artistWeights = new Map<string, number>();
  const artistNames = new Map<string, string>();
  const artistTags = new Map<string, string[]>();
  const genreWeights = new Map<string, number>();
  const knownTrackIds = new Set<string>();
  const knownTrackKeys = new Set<string>();
  const knownArtistIds = new Set<string>();
  const popularities: number[] = [];
  const years: number[] = [];

  const bumpArtist = (id: string, name: string, weight: number) => {
    artistWeights.set(id, (artistWeights.get(id) ?? 0) + weight);
    artistNames.set(id, name);
  };

  const bumpGenre = (genre: string, weight: number) => {
    const clean = genre.toLowerCase().trim();
    if (!clean || clean.length > 30) return;
    genreWeights.set(clean, (genreWeights.get(clean) ?? 0) + weight);
  };

  /** Genres for an artist: Spotify's own tags first, MusicBrainz as backup. */
  const genresForArtist = (name: string, spotifyGenres?: string[], id?: string): string[] => {
    const own = spotifyGenres ?? [];
    const extra = artistGenres[name.toLowerCase()] ?? [];
    const all = [...new Set([...own, ...extra])];
    if (id && all.length > 0 && !artistTags.has(id)) artistTags.set(id, all.slice(0, 3));
    return all;
  };

  // Top artists: the strongest signal, and the only place Spotify hands us
  // genres directly. Rank inside each term matters too (#1 beats #30).
  artistTermResults.forEach((result, termIndex) => {
    if (result.status !== "fulfilled") return;
    const termWeight = TERM_WEIGHTS[termIndex]?.weight ?? 0.5;
    result.value.items.forEach((artist, rank) => {
      const rankWeight = 1 / (1 + rank * 0.08);
      const weight = termWeight * rankWeight;
      bumpArtist(artist.id, artist.name, weight);
      knownArtistIds.add(artist.id);
      for (const genre of genresForArtist(artist.name, artist.genres, artist.id)) bumpGenre(genre, weight);
    });
  });

  // Top tracks: artist credit plus popularity/era stats.
  trackTermResults.forEach((result, termIndex) => {
    if (result.status !== "fulfilled") return;
    const termWeight = TRACK_TERMS[termIndex]?.weight ?? 0.5;
    result.value.items.forEach((track, rank) => {
      const weight = termWeight * (1 / (1 + rank * 0.05)) * 0.6;
      knownTrackIds.add(track.id);
      knownTrackKeys.add(trackKey(track));
      if (Number.isFinite(track.popularity)) popularities.push(track.popularity);
      const year = releaseYear(track);
      if (year) years.push(year);
      track.artists.forEach((artist, artistIndex) => {
        if (!artist.id) return;
        // Featured artists count, but less than the act you actually followed.
        bumpArtist(artist.id, artist.name, weight * (artistIndex === 0 ? 1 : 0.4));
        if (artistIndex === 0) knownArtistIds.add(artist.id);
        for (const genre of genresForArtist(artist.name, artist.genres, artist.id)) {
          bumpGenre(genre, weight * 0.5);
        }
      });
    });
  });

  // Liked Songs, newest first: a deliberate save is a strong endorsement, and
  // the newest saves say more about right now than page 2 does.
  savedPages.forEach((result, pageIndex) => {
    if (result.status !== "fulfilled") return;
    result.value.items.forEach((item, index) => {
      const track = item.track;
      if (!track) return;
      const position = pageIndex * 50 + index;
      const weight = 0.7 * (1 / (1 + position * 0.02));
      knownTrackIds.add(track.id);
      knownTrackKeys.add(trackKey(track));
      if (Number.isFinite(track.popularity)) popularities.push(track.popularity);
      const year = releaseYear(track);
      if (year) years.push(year);
      const primary = track.artists[0];
      if (primary?.id) {
        bumpArtist(primary.id, primary.name, weight);
        knownArtistIds.add(primary.id);
        for (const genre of genresForArtist(primary.name, primary.genres, primary.id)) bumpGenre(genre, weight * 0.6);
      }
    });
  });

  // A sample of the user's own playlists. Sorted by size so a 400-track main
  // playlist beats a 3-track scratch list, then capped to keep requests sane.
  if (playlistsResult) {
    const picks = playlistsResult.items
      .filter((playlist) => (playlist.tracks?.total ?? 0) > 0)
      .sort((a, b) => (b.tracks?.total ?? 0) - (a.tracks?.total ?? 0))
      .slice(0, 3);
    const results = await Promise.allSettled(picks.map((playlist) => client.getPlaylistTracks(playlist.id, 40)));
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      for (const item of result.value.items) {
        const track = item.track;
        if (!track) continue;
        knownTrackIds.add(track.id);
        knownTrackKeys.add(trackKey(track));
        if (Number.isFinite(track.popularity)) popularities.push(track.popularity);
        const year = releaseYear(track);
        if (year) years.push(year);
        const primary = track.artists[0];
        if (primary?.id) {
          bumpArtist(primary.id, primary.name, 0.35);
          knownArtistIds.add(primary.id);
          for (const genre of genresForArtist(primary.name, primary.genres, primary.id)) bumpGenre(genre, 0.25);
        }
      }
    }
  }

  const normalizedGenres = normalize(genreWeights);
  // Pinned genres are an explicit instruction, so they outrank anything
  // inferred, without wiping out the inferred ones.
  for (const genre of pinnedGenres) {
    const clean = genre.toLowerCase().trim();
    if (clean) normalizedGenres[clean] = 1;
  }

  const now = new Date().getFullYear();
  const recentCount = years.filter((year) => year >= now - 3).length;

  return {
    builtAt: Date.now(),
    artistWeights: normalize(artistWeights),
    artistNames: Object.fromEntries(artistNames),
    artistTags: Object.fromEntries(artistTags),
    genreWeights: normalizedGenres,
    knownTrackIds: [...knownTrackIds],
    knownArtistIds: [...knownArtistIds],
    knownTrackKeys: [...knownTrackKeys],
    popularityMedian: median(popularities, 45),
    eraMedianYear: Math.round(median(years, now - 4)),
    recentShare: years.length > 0 ? recentCount / years.length : 0.5,
  };
}

export interface ArtistSeed {
  id: string;
  name: string;
  weight: number;
  /** Best genre tag we hold for this artist, used to label what it finds */
  genre: string | null;
}

/** Artists ordered by affinity, for seeding searches. */
export function topArtistSeeds(profile: TasteProfile, count: number): ArtistSeed[] {
  return Object.entries(profile.artistWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([id, weight]) => ({
      id,
      name: profile.artistNames[id] ?? "",
      weight,
      genre: profile.artistTags?.[id]?.[0] ?? null,
    }))
    .filter((seed) => seed.name.length > 0);
}

/** Artist names ordered by affinity, for seeding searches. */
export function topArtistNames(profile: TasteProfile, count: number): string[] {
  return topArtistSeeds(profile, count).map((seed) => seed.name);
}

/** Genres ordered by affinity. */
export function rankedGenres(profile: TasteProfile): Array<{ genre: string; weight: number }> {
  return Object.entries(profile.genreWeights)
    .map(([genre, weight]) => ({ genre, weight }))
    .sort((a, b) => b.weight - a.weight);
}

export function loadCachedProfile(
  storage: Pick<Storage, "getItem"> = globalThis.localStorage,
): TasteProfile | null {
  try {
    const raw = storage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const profile = JSON.parse(raw) as TasteProfile;
    if (!profile.builtAt || Date.now() - profile.builtAt > PROFILE_TTL_MS) return null;
    if (!profile.genreWeights || !profile.artistWeights) return null;
    return profile;
  } catch {
    return null;
  }
}

export function cacheProfile(
  profile: TasteProfile,
  storage: Pick<Storage, "setItem"> = globalThis.localStorage,
): void {
  try {
    storage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Storage full or unavailable: the profile just gets rebuilt next time.
  }
}

/**
 * Cached profile if it is still fresh, otherwise a rebuild. A stale cached
 * profile is still returned if the rebuild fails, since discovery with an old
 * profile beats discovery with none.
 */
export async function getTasteProfile(
  client: SpotifyClient,
  options: BuildTasteProfileOptions & { force?: boolean } = {},
  storage: Storage = globalThis.localStorage,
): Promise<TasteProfile> {
  const { force, ...buildOptions } = options;
  if (!force) {
    const cached = loadCachedProfile(storage);
    if (cached) return cached;
  }

  try {
    const profile = await buildTasteProfile(client, buildOptions);
    cacheProfile(profile, storage);
    return profile;
  } catch (error) {
    const stale = (() => {
      try {
        const raw = storage.getItem(PROFILE_KEY);
        return raw ? (JSON.parse(raw) as TasteProfile) : null;
      } catch {
        return null;
      }
    })();
    if (stale) return stale;
    throw error;
  }
}

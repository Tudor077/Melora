import { SpotifyApiError, SpotifyClient } from "./spotify/client";
import { filterTracks, sortTracks } from "./sorting";
import {
  dislikedArtistIds,
  emptyFeedback,
  genreFeedback,
  likedArtistSeeds,
  loadFeedback,
  type FeedbackStore,
} from "./feedback";
import {
  hashString,
  scoreCandidate,
  seededRandom,
  selectDiverse,
  type Candidate,
  type CandidateSource,
  type ScoredCandidate,
} from "./scoring";
import {
  getTasteProfile,
  rankedGenres,
  topArtistSeeds,
  trackKey,
  type ArtistSeed,
  type TasteProfile,
} from "./taste";
import type {
  DiscoveryCadence,
  DiscoveryFilters,
  DiscoverySession,
  EnrichedTrack,
  SortOption,
  SpotifyTrack,
  VibeProfile,
} from "./types";
import { DEFAULT_VIBES } from "./types";

export type BpmFallbackFn = (track: SpotifyTrack) => Promise<number | null>;

export interface GenerateDiscoveryOptions {
  cadence: DiscoveryCadence;
  sort?: SortOption;
  filters?: DiscoveryFilters;
  limit?: number;
  vibes?: VibeProfile[];
  bpmFallback?: BpmFallbackFn;
  /**
   * Genres injected by the caller (MusicBrainz artist tags, user-pinned
   * genres). Needed because Spotify leaves `genres` empty on niche artists,
   * which silently collapses discovery to mainstream genres.
   */
  extraGenres?: string[];
  /**
   * Genre tags per lowercased artist name, from MusicBrainz. Feeds both the
   * taste profile weights and the genre labels shown on each card.
   */
  artistGenres?: Record<string, string[]>;
  /** Prebuilt profile. Omit to load the cached one (or build it). */
  profile?: TasteProfile;
  /** Hearts and skips from earlier batches. Omit to load from storage. */
  feedback?: FeedbackStore;
  /** Rebuild the taste profile even if a fresh one is cached. */
  forceProfile?: boolean;
}

function cadenceToMs(cadence: DiscoveryCadence): number {
  return cadence === "hourly" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
}

function sessionStorageKey(cadence: DiscoveryCadence): string {
  return `melora:discovery:${cadence}`;
}

const ROTATION_KEY = "melora:rotation:v1";

// ---------------------------------------------------------------------------
// Search cache. Dev-mode quotas (2026) trip after a handful of calls, and
// search results for a given query barely change hour to hour — so a repeat
// of a recent query should cost nothing. Keyed by "query|offset".
const SEARCH_CACHE_KEY = "melora:search-cache:v1";
const SEARCH_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const SEARCH_CACHE_MAX = 40;

interface SearchCacheEntry {
  at: number;
  items: SpotifyTrack[];
}

export interface CachedSearch {
  search: (q: string, limit: number, offset: number) => Promise<{ tracks: { items: SpotifyTrack[] } }>;
  cacheHits: () => number;
  apiCalls: () => number;
}

export function createCachedSearch(
  client: SpotifyClient,
  storage?: Pick<Storage, "getItem" | "setItem">,
): CachedSearch {
  let cache: Record<string, SearchCacheEntry> = {};
  try {
    cache = JSON.parse(storage?.getItem(SEARCH_CACHE_KEY) ?? "{}") as Record<string, SearchCacheEntry>;
  } catch {
    cache = {};
  }
  let hits = 0;
  let calls = 0;

  const persist = () => {
    if (!storage) return;
    try {
      cache = Object.fromEntries(
        Object.entries(cache)
          .filter(([, entry]) => Date.now() - entry.at < SEARCH_CACHE_TTL_MS)
          .sort((a, b) => b[1].at - a[1].at)
          .slice(0, SEARCH_CACHE_MAX),
      );
      storage.setItem(SEARCH_CACHE_KEY, JSON.stringify(cache));
    } catch {
      // Storage full: the cache degrades to memory-only, discovery still works.
    }
  };

  return {
    search: async (q, limit, offset) => {
      const key = `${q}|${offset}`;
      const hit = cache[key];
      if (hit && Date.now() - hit.at < SEARCH_CACHE_TTL_MS) {
        hits += 1;
        return { tracks: { items: hit.items } };
      }
      calls += 1;
      const result = await client.searchTracks(q, limit, offset);
      cache[key] = { at: Date.now(), items: result.tracks.items };
      persist();
      return result;
    },
    cacheHits: () => hits,
    apiCalls: () => calls,
  };
}

/**
 * A counter that ticks once per generated batch.
 *
 * Search results for a given query are stable, so without rotation every
 * refresh re-reads page 1 of the same queries and shows the same songs. The
 * counter shifts result offsets and year windows so consecutive batches walk
 * through the catalogue instead of standing still.
 */
function nextRotation(storage: Pick<Storage, "getItem" | "setItem"> | undefined): number {
  if (!storage) return Math.floor(Math.random() * 1000);
  try {
    const current = Number.parseInt(storage.getItem(ROTATION_KEY) ?? "0", 10);
    const next = (Number.isFinite(current) ? current : 0) + 1;
    storage.setItem(ROTATION_KEY, String(next));
    return next;
  } catch {
    return Math.floor(Math.random() * 1000);
  }
}

function shuffle<T>(arr: T[], random: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

/**
 * Pick `count` items with probability proportional to weight, without
 * replacement. Uniform shuffling treats a genre the user barely touches the
 * same as their favourite; this keeps favourites likely without making the
 * batch deterministic.
 */
function weightedSample<T>(
  items: Array<{ item: T; weight: number }>,
  count: number,
  random: () => number,
): T[] {
  const pool = items.filter((entry) => entry.weight > 0).map((entry) => ({ ...entry }));
  const chosen: T[] = [];
  while (chosen.length < count && pool.length > 0) {
    const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
    if (total <= 0) break;
    let target = random() * total;
    let index = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      target -= (pool[i] as { weight: number }).weight;
      if (target <= 0) {
        index = i;
        break;
      }
    }
    chosen.push((pool.splice(index, 1)[0] as { item: T }).item);
  }
  return chosen;
}

export async function collectSeedTrackIds(client: SpotifyClient, limit = 5): Promise<string[]> {
  const [topTracksResult, savedTracksResult, playlistsResult] = await Promise.allSettled([
    client.getTopTracks(limit * 2, "medium_term"),
    client.getSavedTracks(limit * 2),
    client.getUserPlaylists(10),
  ]);

  const topTracks = topTracksResult.status === "fulfilled" ? topTracksResult.value.items : [];
  const savedTracks =
    savedTracksResult.status === "fulfilled"
      ? savedTracksResult.value.items.map((item) => item.track)
      : [];

  const playlists =
    playlistsResult.status === "fulfilled" ? playlistsResult.value.items : [];

  // Pick a couple of non-empty playlists and sample a few tracks from each
  const playlistTrackResults = await Promise.allSettled(
    playlists
      .filter((pl) => pl.tracks != null && pl.tracks.total > 0)
      .slice(0, 3)
      .map((pl) => client.getPlaylistTracks(pl.id, 10)),
  );
  const playlistTracks = playlistTrackResults.flatMap((result) =>
    result.status === "fulfilled"
      ? result.value.items.map((item) => item.track).filter((t): t is SpotifyTrack => t !== null)
      : [],
  );

  const ids = new Set<string>();
  for (const track of topTracks) ids.add(track.id);
  for (const track of savedTracks) ids.add(track.id);
  for (const track of playlistTracks) ids.add(track.id);

  return [...ids].slice(0, limit);
}

async function enrichTracks(
  client: SpotifyClient,
  candidates: ScoredCandidate[],
  artistGenres: Record<string, string[]>,
  _vibes: VibeProfile[] = DEFAULT_VIBES,
  bpmFallback?: BpmFallbackFn,
): Promise<EnrichedTrack[]> {
  // /audio-features and /artists?ids= (batch) are unavailable for development
  // mode apps since Feb 2026 — skip the calls instead of letting them fail.
  void client;
  const enriched: EnrichedTrack[] = candidates.map((candidate) => ({
    track: candidate.track,
    features: null,
    // Genres come from provenance (the query that found the track) plus any
    // MusicBrainz tags we already hold for its artist. Without this the genre
    // chips and the genre sort have nothing to work with.
    genres: [
      ...new Set([
        ...candidate.genres,
        ...candidate.track.artists.flatMap((artist) => artistGenres[artist.name.toLowerCase()] ?? []),
      ]),
    ].slice(0, 5),
    primaryVibe: null,
    matchedVibes: [],
    bpm: null,
    musicKey: null,
  }));

  if (bpmFallback) {
    const missing = enriched.filter((e) => e.bpm === null && e.track.preview_url);
    const bpmResults = await Promise.allSettled(
      missing.map((e) => bpmFallback(e.track)),
    );
    const bpmMap = new Map<string, number | null>();
    missing.forEach((e, i) => {
      const result = bpmResults[i];
      bpmMap.set(e.track.id, result.status === "fulfilled" ? result.value : null);
    });
    return enriched.map((e) =>
      e.bpm === null && bpmMap.has(e.track.id)
        ? { ...e, bpm: bpmMap.get(e.track.id) ?? null }
        : e,
    );
  }

  return enriched;
}

// MusicBrainz/Spotify tags that are not real music genres, or that pull in
// novelty compilations ("Comedy Hits", holiday albums…) when used as
// free-text search terms.
const JUNK_GENRES = new Set([
  "comedy", "parody", "novelty", "meme",
  "spoken word", "podcast", "audiobook", "poetry",
  "children's music", "childrens music", "kids", "lullaby",
  "seen live", "favorites", "favourite", "american", "british", "usa",
  "christmas", "halloween", "holiday",
  "karaoke", "tribute", "covers", "cover",
  "soundtrack", "musical", "broadway", "theme",
  "white noise", "sleep", "meditation", "asmr", "ambient noise",
  "workout", "fitness",
  // Tags that describe a release, a decade or a mood rather than a sound —
  // as search terms they return compilations, not music the user would pick.
  "male vocalists", "female vocalists", "singer-songwriter songs",
  "00s", "10s", "80s", "90s", "70s", "60s",
  "albums i own", "vinyl", "cd", "radio", "playlist",
]);

// Junk the free-text search waves love to return: karaoke/tribute/8-bit
// covers, sleep-noise tracks, novelty compilations, and the sped-up /
// slowed-reverb reuploads that flood every genre query.
const JUNK_TRACK_RE =
  /karaoke|tribute|cover version|originally performed|made famous|in the style of|8[- ]?bit|lullab|white noise|rain sounds|sleep (music|sound|aid)|asmr|workout (mix|music)|kidz bop|comedy hits|parody|sped[- ]?up|slowed( *[+&] *reverb)?|nightcore|\bloop(ed)? (version|edit)\b|hardstyle remix of/i;

function isJunkTrack(track: SpotifyTrack): boolean {
  return (
    JUNK_TRACK_RE.test(track.name) ||
    JUNK_TRACK_RE.test(track.album?.name ?? "") ||
    track.artists.some((a) => JUNK_TRACK_RE.test(a.name))
  );
}

const cleanGenre = (genre: string) =>
  !JUNK_GENRES.has(genre.toLowerCase().trim()) && genre.length < 30 && genre.trim().length > 1;

/** Days since release, or null when Spotify gave us no date. */
function daysSinceRelease(track: SpotifyTrack, now: number): number | null {
  const raw = track.album?.release_date;
  if (!raw) return null;
  const time = Date.parse(raw.length === 4 ? `${raw}-01-01` : raw);
  if (!Number.isFinite(time)) return null;
  return (now - time) / (24 * 60 * 60 * 1000);
}

interface CollectContext {
  profile: TasteProfile;
  feedback: FeedbackStore;
  rotation: number;
  random: () => number;
  now: number;
  extraGenres: string[];
  dislikedArtists: Set<string>;
  /** Cache-backed /search; repeat queries within the TTL cost no API call. */
  cachedSearch: CachedSearch;
}

/**
 * Run the search waves and return everything worth scoring.
 *
 * Dev-mode Spotify has no /recommendations and caps /search at 10 results, so
 * the shape here is "many small, differently-angled queries" rather than one
 * authoritative call. Each wave attaches provenance to what it finds, which
 * is what lets the scorer rank across waves at all.
 */
async function collectCandidates(
  client: SpotifyClient,
  limit: number,
  context: CollectContext,
): Promise<{ candidates: Candidate[]; trace: string[] }> {
  const { profile, feedback, rotation, random, now, extraGenres, dislikedArtists, cachedSearch } =
    context;
  const { search } = cachedSearch;
  void client;

  const knownTrackIds = new Set(profile.knownTrackIds);
  const knownTrackKeys = new Set(profile.knownTrackKeys ?? []);
  const knownArtistIds = new Set(profile.knownArtistIds);

  const candidates = new Map<string, Candidate>();
  // Normalised "name|artist" -> candidate id, so the single and the album cut
  // of the same song collapse into one candidate instead of two batch slots.
  const keyToId = new Map<string, string>();
  // Waves swallow individual failures on purpose (one bad query must not sink
  // the batch), but when *everything* fails the user deserves the real error,
  // not a silent empty screen.
  const waveErrors: unknown[] = [];
  const noteFailures = (results: Array<PromiseSettledResult<unknown>>) => {
    for (const result of results) {
      if (result.status === "rejected") waveErrors.push(result.reason);
    }
  };

  // Human-readable trace of what each wave contributed. Rendered in the UI
  // when a batch comes back empty, because "No tracks found" with no cause is
  // undebuggable from a screenshot.
  const trace: string[] = [];
  let absorbedBefore = 0;
  const traceWave = (wave: string, results: Array<PromiseSettledResult<unknown>>) => {
    const failed = results.filter((r) => r.status === "rejected").length;
    trace.push(`${wave}: ${results.length}q/${failed}fail +${candidates.size - absorbedBefore}`);
    absorbedBefore = candidates.size;
  };

  // Once Spotify answers 429 there is no point firing the remaining waves:
  // the client fails them fast during cooldown, so they cannot succeed. Stop
  // collecting, keep whatever arrived before the limit.
  const rateLimited = () =>
    waveErrors.some((err) => err instanceof SpotifyApiError && err.status === 429);

  /**
   * Fold search results into the candidate pool. A track found by two waves
   * keeps both sources, so the scorer can see it was reachable from more than
   * one angle.
   */
  const absorb = (
    tracks: SpotifyTrack[],
    source: CandidateSource,
    opts: { allowKnownArtist?: boolean; maxAgeDays?: number } = {},
  ) => {
    for (const track of tracks) {
      if (!track?.id) continue;
      if (knownTrackIds.has(track.id)) continue;
      const key = trackKey(track);
      if (knownTrackKeys.has(key)) continue;
      if (isJunkTrack(track)) continue;
      const primary = track.artists[0];
      if (!primary) continue;
      if (dislikedArtists.has(primary.id)) continue;
      if (!opts.allowKnownArtist && knownArtistIds.has(primary.id)) continue;
      if (opts.maxAgeDays != null) {
        const age = daysSinceRelease(track, now);
        if (age == null || age > opts.maxAgeDays) continue;
      }

      const existingId = candidates.has(track.id) ? track.id : keyToId.get(key);
      const existing = existingId ? candidates.get(existingId) : undefined;
      if (existing) {
        existing.sources.push(source);
      } else {
        candidates.set(track.id, { track, sources: [source] });
        keyToId.set(key, track.id);
      }
    }
  };

  // ---- Genre pool -------------------------------------------------------
  // Listening history says what the user played; hearts and skips say what
  // they want *now*. Bending the sampling weights by feedback stops the app
  // spending a quarter of its queries on a genre it watched them skip five
  // times, while the floor keeps that genre able to come back later.
  const adjust = (genre: string, weight: number) =>
    Math.max(0.02, weight * (1 + genreFeedback(feedback, genre, now)));

  const ranked = rankedGenres(profile)
    .filter((entry) => cleanGenre(entry.genre))
    .map((entry) => ({ genre: entry.genre, weight: adjust(entry.genre, entry.weight) }))
    .sort((a, b) => b.weight - a.weight);
  const core = ranked.slice(0, 14);
  const tail = ranked.slice(14, 45);

  const exploit = weightedSample(
    core.map((entry) => ({ item: entry.genre, weight: entry.weight ** 1.5 })),
    5,
    random,
  );
  // Exploration slice: without it the profile keeps re-confirming itself and
  // the app never surfaces a corner of the library the user forgot about.
  const explore = weightedSample(
    tail.map((entry) => ({ item: entry.genre, weight: Math.max(entry.weight, 0.05) })),
    2,
    random,
  );
  // Caller-supplied genres (MusicBrainz tags, genres the user pinned by hand)
  // are the only signal there is for niche artists, so they take fixed slots.
  const pinned = shuffle([...new Set(extraGenres)].filter(cleanGenre), random).slice(0, 2);

  // Exploration goes ahead of the weakest exploit picks: appended last it
  // would be the first thing the cap below cuts, which is exactly backwards.
  // Capped at 4: dev-mode quotas (2026) allow only 10-20 calls per window,
  // so every query has to earn its slot — a small, well-weighted slate beats
  // a wide one that gets the whole batch throttled.
  const searchGenres = [
    ...new Set([...pinned, ...exploit.slice(0, 4), ...explore, ...exploit.slice(4)]),
  ].slice(0, 4);
  if (searchGenres.length === 0) searchGenres.push("pop", "hip hop", "electronic", "rock");

  trace.push(
    `profile: ${knownTrackIds.size} known tracks, ${ranked.length} genres, ` +
      `${Object.keys(profile.artistWeights).length} artists, ${dislikedArtists.size} disliked`,
    `search genres: ${searchGenres.join(", ")}`,
  );

  const genreWeight = (genre: string) => profile.genreWeights[genre.toLowerCase()] ?? 0.35;

  // ---- Year windows -----------------------------------------------------
  // Anchored on the era the user actually listens to, tilted towards new
  // music by how modern their library is, and rotated so refresh #2 does not
  // ask the same years as refresh #1.
  const currentYear = new Date(now).getFullYear();
  const eraYear = Math.min(currentYear, Math.max(1960, profile.eraMedianYear));
  const yearPool = [
    currentYear,
    currentYear - 1,
    currentYear - 2,
    ...(profile.recentShare < 0.6 ? [eraYear, eraYear - 1, eraYear + 1] : [currentYear - 3]),
  ].filter((year, index, all) => year <= currentYear && all.indexOf(year) === index);

  // ---- Wave 1: collaborations ------------------------------------------
  // Tracks where a favourite artist appears but somebody new is fronting it
  // (features, remixes, joint releases). Highest hit rate of any wave.
  const seeds = topArtistSeeds(profile, 14);
  const collabSeeds = shuffle(seeds, random).slice(0, 3);
  const collabPromise = Promise.allSettled(
    collabSeeds.map((seed) =>
      search(`artist:"${seed.name.replace(/"/g, "")}"`, 10, (rotation % 3) * 10),
    ),
  );

  // ---- Wave 1b: artists the user hearted in earlier batches ------------
  // A heart on a discovery is the loudest "more like this" the app ever
  // hears, but the taste profile cannot see it until the artist climbs the
  // library rankings weeks later. Seeding searches straight from feedback
  // closes that loop in the very next batch.
  const profileSeedIds = new Set(seeds.map((seed) => seed.id));
  const heartedSeeds = likedArtistSeeds(feedback, now)
    .filter((seed) => !profileSeedIds.has(seed.id))
    .slice(0, 2);
  const heartedPromise = Promise.allSettled(
    heartedSeeds.map((seed) =>
      search(`artist:"${seed.name.replace(/"/g, "")}"`, 10, (rotation % 2) * 10),
    ),
  );

  const collabResults = await collabPromise;
  noteFailures(collabResults);
  collabResults.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    const seed = collabSeeds[index] as ArtistSeed;
    // Label the find with the seed artist's own genre: people who record
    // together usually share one, and an unlabelled track cannot be filtered.
    absorb(result.value.tracks.items, {
      kind: "collab",
      artistName: seed.name,
      genre: seed.genre ?? undefined,
      strength: 0.75 + seed.weight * 0.25,
    });
  });
  traceWave("collab", collabResults);

  const heartedResults = await heartedPromise;
  noteFailures(heartedResults);
  heartedResults.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    const seed = heartedSeeds[index] as { name: string; affinity: number };
    // The hearted artist may have entered the library since the heart, so the
    // known-artist filter is waived; known *tracks* are still filtered out.
    absorb(
      result.value.tracks.items,
      { kind: "hearted", artistName: seed.name, strength: 0.8 + Math.min(1, seed.affinity) * 0.2 },
      { allowKnownArtist: true },
    );
  });
  traceWave("hearted", heartedResults);

  if (rateLimited()) {
    trace.push("rate limited — skipping remaining waves");
    if (candidates.size === 0) throw waveErrors[0];
    return { candidates: [...candidates.values()], trace };
  }

  // ---- Wave 2: genre + year -------------------------------------------
  // One query per genre — the request budget no longer allows both shapes.
  // The top genres get the precise `genre:"x"` filter (Spotify's own answer);
  // the rest get the noisier free-text form, which always returns something,
  // so an unsupported genre filter degrades instead of emptying the batch.
  const genreQueries = searchGenres.map((genre, index) => {
    const year = yearPool[(index + rotation) % yearPool.length] as number;
    const base = (rotation % 4) * 10;
    const precise = index < 2;
    return {
      genre,
      q: precise ? `genre:"${genre}" year:${year}` : `${genre} year:${year}`,
      offset: base,
      precise,
    };
  });
  const genreResults = await Promise.allSettled(
    genreQueries.map(({ q, offset }) => search(q, 10, offset)),
  );
  noteFailures(genreResults);
  genreResults.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    const query = genreQueries[index] as { genre: string; precise: boolean };
    absorb(result.value.tracks.items, {
      kind: "genre",
      genre: query.genre,
      // A title match is a guess about the genre; the filter is Spotify's own
      // answer, so it carries more of the user's affinity into the score.
      strength: genreWeight(query.genre) * (query.precise ? 1 : 0.7),
    });
  });
  traceWave("genre-year", genreResults);

  if (rateLimited()) {
    trace.push("rate limited — skipping remaining waves");
    if (candidates.size === 0) throw waveErrors[0];
    return { candidates: [...candidates.values()], trace };
  }

  // ---- Wave 3: fresh drops from artists the user already loves ---------
  // Deliberately allowed past the known-artist filter, but only for genuinely
  // new releases, and capped later so it cannot take over the batch.
  const dropSeeds = shuffle(seeds.slice(0, 10), random).slice(0, 1);
  const dropResults = await Promise.allSettled(
    dropSeeds.map((seed) =>
      search(`artist:"${seed.name.replace(/"/g, "")}" year:${currentYear}`, 10, 0),
    ),
  );
  noteFailures(dropResults);
  dropResults.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    const seed = dropSeeds[index] as ArtistSeed;
    absorb(
      result.value.tracks.items,
      { kind: "related", artistName: seed.name, genre: seed.genre ?? undefined, strength: 0.8 },
      { allowKnownArtist: true, maxAgeDays: 150 },
    );
  });
  traceWave("fresh-drops", dropResults);

  // Enough to give the diversity pass real choice? Then stop spending calls.
  // The bar is `limit`, not a multiple of it: with a 10-20 call quota the
  // deep wave is a last resort for a starving batch, not a routine top-up.
  if (candidates.size >= limit || rateLimited()) {
    return { candidates: [...candidates.values()], trace };
  }

  // ---- Wave 4: plain genre text at deeper offsets ----------------------
  const deepQueries = searchGenres.slice(0, 2).map((genre) => ({
    genre,
    offset: ((rotation % 5) + 2) * 10,
  }));
  const deepResults = await Promise.allSettled(
    deepQueries.map(({ genre, offset }) => search(genre, 10, offset)),
  );
  noteFailures(deepResults);
  deepResults.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    const genre = (deepQueries[index] as { genre: string }).genre;
    absorb(result.value.tracks.items, { kind: "genre", genre, strength: genreWeight(genre) * 0.8 });
  });
  traceWave("deep", deepResults);

  if (candidates.size > 0) return { candidates: [...candidates.values()], trace };

  // ---- Last resort ------------------------------------------------------
  // Nothing matched, usually a brand-new account with no listening history.
  // Take whatever comes back rather than showing an empty screen.
  const fallback = await search(searchGenres[0] ?? "new music", 10, 0).catch((error: unknown) => {
    waveErrors.push(error);
    return null;
  });
  if (fallback) {
    absorb(fallback.tracks.items, { kind: "fallback", strength: 0.2 }, { allowKnownArtist: true });
  }
  trace.push(`fallback: ${fallback ? "ran" : "failed"} +${candidates.size - absorbedBefore}`);

  // Still nothing and every query blew up: this is an auth/rate-limit outage,
  // not an empty catalogue. Surface it so the UI can say what went wrong
  // instead of rendering "No tracks found" over a broken session.
  if (candidates.size === 0 && waveErrors.length > 0) throw waveErrors[0];

  return { candidates: [...candidates.values()], trace };
}

export async function generateDiscoverySession(
  client: SpotifyClient,
  options: GenerateDiscoveryOptions,
  storage?: Storage,
): Promise<DiscoverySession> {
  const {
    cadence,
    sort,
    filters,
    limit = 20,
    vibes = DEFAULT_VIBES,
    bpmFallback,
    extraGenres = [],
    artistGenres = {},
    forceProfile,
  } = options;

  const store = storage ?? (globalThis as { localStorage?: Storage }).localStorage;
  const now = Date.now();

  const profile =
    options.profile ??
    (await getTasteProfile(
      client,
      { artistGenres, pinnedGenres: extraGenres, force: forceProfile },
      store as Storage,
    ));
  const feedback = options.feedback ?? (store ? loadFeedback(store) : emptyFeedback());

  const rotation = nextRotation(store);
  // Seeded from the rotation so a batch is reproducible while debugging, yet
  // different on every refresh.
  const random = seededRandom(hashString(`melora:${cadence}:${rotation}`));

  // Decayed, via the shared helper: a run of skips three months ago should
  // not blacklist an artist forever. (The raw `value` read here previously
  // did exactly that.)
  const dislikedArtists = new Set(dislikedArtistIds(feedback, now));

  const cachedSearch = createCachedSearch(client, store);
  const { candidates, trace } = await collectCandidates(client, limit, {
    profile,
    feedback,
    rotation,
    random,
    now,
    extraGenres,
    dislikedArtists,
    cachedSearch,
  });
  trace.push(`search: ${cachedSearch.apiCalls()} API calls, ${cachedSearch.cacheHits()} cache hits`);

  const scored = candidates.map((candidate) =>
    scoreCandidate(candidate, { profile, feedback, now, random }),
  );

  // Fresh drops from artists the user already has are welcome, but they are
  // not discovery — hold them to a slice of the batch.
  const isFreshDrop = (candidate: ScoredCandidate) =>
    candidate.sources.every((source) => source.kind === "related");
  const freshCap = Math.max(1, Math.round(limit * 0.15));
  const fresh = scored.filter(isFreshDrop).sort((a, b) => b.score - a.score).slice(0, freshCap);
  const rest = scored.filter((candidate) => !isFreshDrop(candidate));

  const selected = selectDiverse([...rest, ...fresh], { limit });

  let enriched = await enrichTracks(client, selected, artistGenres, vibes, bpmFallback);

  if (filters) enriched = filterTracks(enriched, filters);
  if (sort) enriched = sortTracks(enriched, sort);

  trace.push(
    `candidates ${candidates.length} -> selected ${selected.length} -> after filters ${enriched.length}`,
  );

  return {
    id: crypto.randomUUID(),
    cadence,
    generatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + cadenceToMs(cadence)).toISOString(),
    seedTrackIds: [],
    tracks: enriched,
    debug: trace.join("\n"),
  };
}

export function loadCachedSession(
  cadence: DiscoveryCadence,
  storage: Pick<Storage, "getItem"> = globalThis.localStorage,
): DiscoverySession | null {
  const raw = storage.getItem(sessionStorageKey(cadence));
  if (!raw) return null;

  try {
    const session = JSON.parse(raw) as DiscoverySession;
    if (new Date(session.expiresAt).getTime() <= Date.now()) return null;
    // An empty batch is a failed batch (auth outage, rate limit). Serving it
    // from cache would pin "No tracks found" on screen for a full hour.
    if (!session.tracks || session.tracks.length === 0) return null;
    return session;
  } catch {
    return null;
  }
}

export function cacheSession(
  session: DiscoverySession,
  storage: Pick<Storage, "setItem"> = globalThis.localStorage,
): void {
  // Never pin a failed (empty) batch; the next load should retry instead.
  if (session.tracks.length === 0) return;
  storage.setItem(sessionStorageKey(session.cadence), JSON.stringify(session));
}

export async function getOrCreateDiscoverySession(
  client: SpotifyClient,
  options: GenerateDiscoveryOptions,
  storage?: Storage,
): Promise<DiscoverySession> {
  const store = storage ?? globalThis.localStorage;
  const cached = loadCachedSession(options.cadence, store);
  if (cached) return cached;

  const session = await generateDiscoverySession(client, options, store);
  cacheSession(session, store);
  return session;
}

export async function createPlaylistFromSession(
  client: SpotifyClient,
  session: DiscoverySession,
  name: string,
): Promise<string> {
  const description = `Melora ${session.cadence} picks - generated ${new Date(session.generatedAt).toLocaleString()}`;
  const playlist = await client.createPlaylist(name, description, false);
  await client.addTracksToPlaylist(
    playlist.id,
    session.tracks.map((entry) => entry.track.uri),
  );
  return playlist.external_urls.spotify;
}

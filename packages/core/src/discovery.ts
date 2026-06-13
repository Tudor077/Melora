import { SpotifyClient } from "./spotify/client";
import { filterTracks, sortTracks } from "./sorting";
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
}

function cadenceToMs(cadence: DiscoveryCadence): number {
  return cadence === "hourly" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
}

function sessionStorageKey(cadence: DiscoveryCadence): string {
  return `melora:discovery:${cadence}`;
}

function uniqueTracks(tracks: SpotifyTrack[], limit: number): SpotifyTrack[] {
  const byId = new Map<string, SpotifyTrack>();
  const byNameArtist = new Set<string>();
  for (const track of tracks) {
    const nameKey = `${track.name.toLowerCase()}|${track.artists[0]?.name.toLowerCase() ?? ""}`;
    if (!byId.has(track.id) && !byNameArtist.has(nameKey)) {
      byId.set(track.id, track);
      byNameArtist.add(nameKey);
    }
    if (byId.size >= limit) break;
  }
  return [...byId.values()];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
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
  tracks: SpotifyTrack[],
  _vibes: VibeProfile[] = DEFAULT_VIBES,
  bpmFallback?: BpmFallbackFn,
): Promise<EnrichedTrack[]> {
  // /audio-features and /artists?ids= (batch) are unavailable for development
  // mode apps since Feb 2026 — skip the calls instead of letting them fail.
  void client;
  const enriched: EnrichedTrack[] = tracks.map((track) => ({
    track,
    features: null,
    genres: [],
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

async function collectDiscoveryTracks(
  client: SpotifyClient,
  limit: number,
  extraGenres: string[] = [],
): Promise<SpotifyTrack[]> {
  const [topArtistsResult, topTracksResult] = await Promise.allSettled([
    client.getTopArtists(20, "medium_term"),
    client.getTopTracks(50, "medium_term"),
  ]);

  const topArtists = topArtistsResult.status === "fulfilled" ? topArtistsResult.value.items : [];
  const topTracks = topTracksResult.status === "fulfilled" ? topTracksResult.value.items : [];

  const knownArtistIds = new Set(topArtists.map((a) => a.id));
  const knownTrackIds = new Set(topTracks.map((t) => t.id));

  const candidates: SpotifyTrack[] = [];

  const absorb = (items: SpotifyTrack[], filterArtist = true) => {
    for (const track of items) {
      if (knownTrackIds.has(track.id)) continue;
      if (filterArtist && knownArtistIds.has(track.artists[0]?.id ?? "")) continue;
      candidates.push(track);
    }
  };

  // Genre pool: caller-supplied genres (MusicBrainz tags, user-pinned) get
  // priority slots; Spotify artist genres fill the rest. Spotify's own tags
  // are empty for niche artists, so extras carry most of the signal.
  const spotifyGenres = [...new Set(topArtists.flatMap((a) => a.genres ?? []))];
  const prioritized = shuffle([...new Set(extraGenres)]).slice(0, 5);
  const searchGenres = [
    ...new Set([...prioritized, ...shuffle(spotifyGenres)]),
  ].slice(0, 8);
  if (searchGenres.length === 0) {
    searchGenres.push("pop", "hip hop", "electronic", "rock");
  }

  // Dev-mode apps cap /search at limit=10 (Feb 2026), so we run many small
  // queries instead of a few big ones.

  // Wave 1: collab search — tracks where a favorite artist appears but the
  // primary artist is someone new (features, remixes, covers)
  const featArtists = shuffle(topArtists.slice(0, 10)).slice(0, 6);
  const featResults = await Promise.allSettled(
    featArtists.map((a) => client.searchTracks(`artist:"${a.name.replace(/"/g, "")}"`, 10)),
  );
  for (const r of featResults) {
    if (r.status === "fulfilled") absorb(r.value.tracks.items);
  }

  // Wave 2: genre as free text + year filter; second page only for the
  // first few genres to keep the request count sane (limit is capped at 10)
  const years = ["2025", "2024", "2023"];
  const genreQueries = searchGenres.flatMap((g, i) => {
    const year = years[i % years.length];
    const queries = [{ q: `${g} year:${year}`, offset: 0 }];
    if (i < 4) queries.push({ q: `${g} year:${year}`, offset: 10 });
    return queries;
  });
  const genreResults = await Promise.allSettled(
    genreQueries.map(({ q, offset }) => client.searchTracks(q, 10, offset)),
  );
  for (const r of genreResults) {
    if (r.status === "fulfilled") absorb(r.value.tracks.items);
  }

  if (candidates.length >= limit) return uniqueTracks(shuffle(candidates), limit);

  // Wave 3: plain genre text at deeper offsets for extra variety
  const extraResults = await Promise.allSettled(
    searchGenres.flatMap((g) => [
      client.searchTracks(g, 10, 0),
      client.searchTracks(g, 10, 10),
    ]),
  );
  for (const r of extraResults) {
    if (r.status === "fulfilled") absorb(r.value.tracks.items);
  }

  if (candidates.length > 0) return uniqueTracks(shuffle(candidates), limit);

  // Final fallback: plain text search, keep anything not already known
  const fallback = await client.searchTracks(searchGenres[0] ?? "music", 10).catch(() => null);
  if (fallback) absorb(fallback.tracks.items, false);

  return uniqueTracks(shuffle(candidates), limit);
}

export async function generateDiscoverySession(
  client: SpotifyClient,
  options: GenerateDiscoveryOptions,
): Promise<DiscoverySession> {
  const { cadence, sort, filters, limit = 20, vibes = DEFAULT_VIBES, bpmFallback, extraGenres } = options;
  // /recommendations is unavailable for development mode apps (Feb 2026) —
  // go straight to search-based discovery instead of a guaranteed-404 attempt.
  const seedTrackIds: string[] = [];
  const tracks = await collectDiscoveryTracks(client, limit, extraGenres ?? []);

  let enriched = await enrichTracks(client, tracks, vibes, bpmFallback);

  if (filters) enriched = filterTracks(enriched, filters);
  if (sort) enriched = sortTracks(enriched, sort);

  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    cadence,
    generatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + cadenceToMs(cadence)).toISOString(),
    seedTrackIds,
    tracks: enriched,
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
    return session;
  } catch {
    return null;
  }
}

export function cacheSession(
  session: DiscoverySession,
  storage: Pick<Storage, "setItem"> = globalThis.localStorage,
): void {
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

  const session = await generateDiscoverySession(client, options);
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

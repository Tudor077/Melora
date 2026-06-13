import type {
  AudioFeatures,
  RecommendationSeedOptions,
  SpotifyArtist,
  SpotifyTrack,
  SpotifyUser,
  TokenResponse,
} from "../types";

const SPOTIFY_API = "https://api.spotify.com/v1";

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function formatErrorBody(body: unknown): string | null {
  if (!body) return null;
  if (typeof body === "string") return body;
  if (typeof body !== "object") return String(body);

  const error = "error" in body ? body.error : body;
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return JSON.stringify(body);

  const message = "message" in error && typeof error.message === "string" ? error.message : null;
  const reason = "reason" in error && typeof error.reason === "string" ? error.reason : null;
  return [message, reason].filter(Boolean).join(" - ") || JSON.stringify(body);
}

export class SpotifyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "SpotifyApiError";
  }
}

export interface SpotifyClientOptions {
  getAccessToken: () => string | null;
  fetchImpl?: typeof fetch;
}

export class SpotifyClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: SpotifyClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = this.options.getAccessToken();
    if (!token) {
      throw new SpotifyApiError("Not authenticated with Spotify", 401);
    }

    const response = await this.fetchImpl(`${SPOTIFY_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      const body = await readResponseBody(response);
      const details = formatErrorBody(body);
      const message = `Spotify API error: ${response.status} on ${path}${details ? ` - ${details}` : ""}`;
      throw new SpotifyApiError(message, response.status, body);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    // Some endpoints (e.g. PUT /me/library) return 200 with an empty body —
    // response.json() would throw "Unexpected end of JSON input" on that.
    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  getCurrentUser(): Promise<SpotifyUser> {
    return this.request<SpotifyUser>("/me");
  }

  getTopTracks(limit = 20, timeRange: "short_term" | "medium_term" | "long_term" = "medium_term") {
    return this.request<{ items: SpotifyTrack[] }>(
      `/me/top/tracks?limit=${limit}&time_range=${timeRange}`,
    );
  }

  getSavedTracks(limit = 20, offset = 0) {
    return this.request<{ items: Array<{ track: SpotifyTrack }> }>(
      `/me/tracks?limit=${limit}&offset=${offset}`,
    );
  }

  // Add track(s) to the user's Liked Songs (requires user-library-modify).
  // Feb 2026: per-type PUT /me/tracks is gone in dev mode (403) — replaced by
  // the generic PUT /me/library which takes Spotify URIs.
  saveTracks(ids: string[]) {
    if (ids.length === 0) return Promise.resolve();
    const uris = ids.slice(0, 50).map((id) => `spotify:track:${id}`);
    // Feb 2026 dev-mode endpoints take params in the query string, not body.
    const params = new URLSearchParams({ uris: uris.join(",") });
    return this.request<void>(`/me/library?${params.toString()}`, { method: "PUT" });
  }

  // Remove track(s) from Liked Songs. Feb 2026: DELETE /me/library with uris.
  removeTracks(ids: string[]) {
    if (ids.length === 0) return Promise.resolve();
    const uris = ids.slice(0, 50).map((id) => `spotify:track:${id}`);
    const params = new URLSearchParams({ uris: uris.join(",") });
    return this.request<void>(`/me/library?${params.toString()}`, { method: "DELETE" });
  }

  // Check which of the given tracks are already in the library.
  // Feb 2026: GET /me/library/contains?uris=... → array of booleans (in order).
  checkSavedTracks(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([] as boolean[]);
    const uris = ids.slice(0, 50).map((id) => `spotify:track:${id}`);
    const params = new URLSearchParams({ uris: uris.join(",") });
    return this.request<boolean[]>(`/me/library/contains?${params.toString()}`);
  }

  getRecommendations(options: RecommendationSeedOptions) {
    const params = new URLSearchParams();
    if (options.seedTracks?.length) params.set("seed_tracks", options.seedTracks.slice(0, 5).join(","));
    if (options.seedArtists?.length) params.set("seed_artists", options.seedArtists.slice(0, 5).join(","));
    if (options.seedGenres?.length) params.set("seed_genres", options.seedGenres.slice(0, 5).join(","));

    params.set("limit", String(options.limit ?? 20));
    if (options.minPopularity != null) params.set("min_popularity", String(options.minPopularity));
    if (options.targetEnergy != null) params.set("target_energy", String(options.targetEnergy));
    if (options.targetValence != null) params.set("target_valence", String(options.targetValence));
    if (options.targetDanceability != null) params.set("target_danceability", String(options.targetDanceability));
    if (options.targetTempo != null) params.set("target_tempo", String(options.targetTempo));
    if (options.minTempo != null) params.set("min_tempo", String(options.minTempo));
    if (options.maxTempo != null) params.set("max_tempo", String(options.maxTempo));

    return this.request<{ tracks: SpotifyTrack[] }>(`/recommendations?${params.toString()}`);
  }

  getAudioFeatures(ids: string[]) {
    if (ids.length === 0) return Promise.resolve({ audio_features: [] as Array<AudioFeatures | null> });
    const chunk = ids.slice(0, 100);
    return this.request<{ audio_features: Array<AudioFeatures | null> }>(
      `/audio-features?ids=${chunk.join(",")}`,
    );
  }

  getArtists(ids: string[]) {
    if (ids.length === 0) return Promise.resolve({ artists: [] as SpotifyArtist[] });
    const chunk = ids.slice(0, 50);
    return this.request<{ artists: SpotifyArtist[] }>(`/artists?ids=${chunk.join(",")}`);
  }

  getArtistTopTracks(id: string, market = "US") {
    return this.request<{ tracks: SpotifyTrack[] }>(
      `/artists/${encodeURIComponent(id)}/top-tracks?market=${encodeURIComponent(market)}`,
    );
  }

  searchTracks(query: string, limit = 10, offset = 0) {
    // Feb 2026: development mode apps max out at limit=10 on /search (400 above that)
    const cappedLimit = Math.min(limit, 10);
    const params = new URLSearchParams({ q: query, type: "track", limit: String(cappedLimit), offset: String(offset) });
    return this.request<{ tracks: { items: SpotifyTrack[] } }>(`/search?${params.toString()}`);
  }

  // Feb 2026: /users/{id}/playlists is gone for dev mode — use /me/playlists
  createPlaylist(name: string, description: string, isPublic = false) {
    return this.request<{ id: string; external_urls: { spotify: string } }>(
      `/me/playlists`,
      {
        method: "POST",
        body: JSON.stringify({ name, description, public: isPublic }),
      },
    );
  }

  // Feb 2026: /playlists/{id}/tracks renamed to /playlists/{id}/items
  addTracksToPlaylist(playlistId: string, uris: string[]) {
    return this.request<void>(`/playlists/${playlistId}/items`, {
      method: "POST",
      body: JSON.stringify({ uris }),
    });
  }

  getTopArtists(limit = 20, timeRange: "short_term" | "medium_term" | "long_term" = "medium_term") {
    return this.request<{ items: SpotifyArtist[] }>(
      `/me/top/artists?limit=${limit}&time_range=${timeRange}`,
    );
  }

  getRelatedArtists(artistId: string) {
    return this.request<{ artists: SpotifyArtist[] }>(
      `/artists/${encodeURIComponent(artistId)}/related-artists`,
    );
  }

  getNewReleases(limit = 20, offset = 0) {
    return this.request<{ albums: { items: Array<{ id: string; name: string; artists: SpotifyArtist[]; release_date: string }> } }>(
      `/browse/new-releases?limit=${limit}&offset=${offset}`,
    );
  }

  getAlbumTracks(albumId: string, limit = 10) {
    return this.request<{ items: Array<Omit<SpotifyTrack, "album">> }>(
      `/albums/${encodeURIComponent(albumId)}/tracks?limit=${limit}`,
    );
  }

  getUserPlaylists(limit = 20, offset = 0) {
    return this.request<{ items: Array<{ id: string; name: string; tracks: { total: number } | null }> }>(
      `/me/playlists?limit=${limit}&offset=${offset}`,
    );
  }

  getPlaylistTracks(playlistId: string, limit = 20, offset = 0) {
    return this.request<{ items: Array<{ track: SpotifyTrack | null }> }>(
      `/playlists/${encodeURIComponent(playlistId)}/tracks?limit=${limit}&offset=${offset}&fields=items(track(id,name,uri,artists,album,popularity,explicit,duration_ms,preview_url,external_urls))`,
    );
  }
}

export interface AuthConfig {
  clientId: string;
  redirectUri: string;
  scopes?: readonly string[];
}

export function buildAuthUrl(config: AuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    scope: (config.scopes ?? []).join(" "),
    state,
    show_dialog: "true",
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export function parseAuthCallback(search: string): { code: string; state: string } | null {
  const params = new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return null;
  return { code, state };
}

export interface StoredTokens extends TokenResponse {
  expires_at: number;
}

export function isTokenExpired(tokens: StoredTokens, skewMs = 60_000): boolean {
  return Date.now() >= tokens.expires_at - skewMs;
}

export function normalizeTokenResponse(response: TokenResponse): StoredTokens {
  return {
    ...response,
    expires_at: Date.now() + response.expires_in * 1000,
  };
}

/** PKCE helpers for mobile / desktop flows without a backend secret */
export function generateCodeVerifier(length = 64): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const random = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(random, (byte) => chars[byte % chars.length]).join("");
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function buildPkceAuthUrl(
  config: AuthConfig,
  state: string,
  codeChallenge: string,
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    scope: (config.scopes ?? []).join(" "),
    state,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
    show_dialog: "true",
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

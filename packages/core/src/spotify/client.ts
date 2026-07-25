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
  /** In-flight request ceiling. Dev mode caps /search at 10 results, so
   *  discovery fires dozens of small queries and needs a throttle. */
  maxConcurrent?: number;
  /** Minimum ms between request starts. Dev-mode quotas (2026) trip after
   *  10-20 calls in a rolling window, so bursts are what get apps throttled. */
  minIntervalMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The 429 cooldown outlives the page: a reload creates a fresh client, and
 * without persistence every F5 fired a brand-new batch straight into the
 * rate limit — the exact behaviour that keeps the throttle alive.
 */
const COOLDOWN_KEY = "melora:spotify-cooldown-until";

function loadStoredCooldown(): number {
  try {
    const raw = (globalThis as { localStorage?: Storage }).localStorage?.getItem(COOLDOWN_KEY);
    const stored = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(stored) && stored > Date.now() ? stored : 0;
  } catch {
    return 0;
  }
}

export class SpotifyClient {
  private readonly fetchImpl: typeof fetch;
  private readonly maxConcurrent: number;
  private readonly minIntervalMs: number;
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  /** Set while Spotify has us in a 429 timeout; every request waits it out. */
  private cooldownUntil = loadStoredCooldown();
  /** Next moment a request is allowed to start (global pacing). */
  private nextSlotAt = 0;

  constructor(private readonly options: SpotifyClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    // 2, not 6: dev-mode rate limits are tight and burst-sensitive, and the
    // batch is latency-bound on MusicBrainz anyway.
    this.maxConcurrent = options.maxConcurrent ?? 2;
    this.minIntervalMs = options.minIntervalMs ?? 900;
  }

  /**
   * Global request pacing: ~1 request/second regardless of how many callers
   * queue up. Dev-mode quotas measure a rolling window, so a steady trickle
   * passes where a parallel burst of the same size gets everything 429'd.
   */
  private async pace(): Promise<void> {
    const now = Date.now();
    const wait = this.nextSlotAt - now;
    this.nextSlotAt = Math.max(this.nextSlotAt, now) + this.minIntervalMs;
    if (wait > 0) await sleep(wait);
  }

  private setCooldown(until: number): void {
    this.cooldownUntil = Math.max(this.cooldownUntil, until);
    try {
      (globalThis as { localStorage?: Storage }).localStorage?.setItem(
        COOLDOWN_KEY,
        String(this.cooldownUntil),
      );
    } catch {
      // Storage unavailable: in-memory cooldown still protects this session.
    }
  }

  /** Semaphore: discovery hands us ~40 queries at once, Spotify wants fewer. */
  private async acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return;
    }
    // The slot is handed over by release(), which never gives it up in the
    // meantime — so nothing is counted here, or two callers racing a release
    // would both squeeze past the limit.
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
      return;
    }
    this.active -= 1;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    await this.acquire();
    try {
      return await this.requestWithRetry<T>(path, init);
    } finally {
      this.release();
    }
  }

  private async requestWithRetry<T>(path: string, init?: RequestInit, attempt = 0): Promise<T> {
    const token = this.options.getAccessToken();
    if (!token) {
      throw new SpotifyApiError("Not authenticated with Spotify", 401);
    }

    const wait = this.cooldownUntil - Date.now();
    if (wait > 0) {
      // Long cooldown: fail fast without touching the network. Queueing forty
      // requests behind a rate limit and releasing them together is exactly
      // the "request storm" behaviour that gets an app throttled for longer.
      if (wait > 10_000) {
        throw new SpotifyApiError(
          `Spotify rate limit: cooling down for ${Math.ceil(wait / 1000)}s`,
          429,
        );
      }
      await sleep(wait);
    }

    // Even outside a cooldown, keep request starts spaced out.
    await this.pace();

    const response = await this.fetchImpl(`${SPOTIFY_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });

    // 429 applies to the whole app, not just this call, so park every other
    // request behind the same cooldown instead of each one discovering it.
    // Retry-After is honoured in full — trimming it and retrying anyway reads
    // as abuse on Spotify's side and stretches the throttle window.
    if (response.status === 429) {
      const header = Number.parseInt(response.headers.get("Retry-After") ?? "", 10);
      const delay = (Number.isFinite(header) ? header : 2 ** attempt) * 1000;
      this.setCooldown(Date.now() + delay);
      // Short cooldowns (Retry-After of a few seconds) are worth waiting out
      // in place; anything longer means Spotify wants quiet, so surface the
      // error instead of piling retries onto the throttle.
      if (attempt < 2 && delay <= 10_000) {
        await sleep(delay);
        return this.requestWithRetry<T>(path, init, attempt + 1);
      }
      throw new SpotifyApiError(
        `Spotify rate limit hit (retry in ${Math.ceil(delay / 1000)}s)`,
        429,
      );
    }

    // Transient upstream failures; one retry costs less than a failed batch.
    if (response.status >= 500 && attempt < 2) {
      await sleep(300 * (attempt + 1));
      return this.requestWithRetry<T>(path, init, attempt + 1);
    }

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

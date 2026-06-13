import {
  buildPkceAuthUrl,
  generateCodeChallenge,
  generateCodeVerifier,
  isTokenExpired,
  normalizeTokenResponse,
  parseAuthCallback,
  SPOTIFY_SCOPES,
  SpotifyClient,
  type StoredTokens,
  type TokenResponse,
} from "@melora/core";

// In Tauri builds, TAURI_ENV_PLATFORM is injected automatically by the CLI.
// We use it to switch between the desktop deep-link redirect and the web redirect.
const IS_TAURI = Boolean(import.meta.env.TAURI_ENV_PLATFORM);

// Desktop uses a custom URL scheme so no local server is needed.
// Web uses the env-configured redirect URI (e.g. http://127.0.0.1:5173/callback).
const DESKTOP_REDIRECT_URI = "melora://callback";

const TOKEN_KEY = "melora:spotify:tokens";
const STATE_KEY = "melora:spotify:oauth_state";
const VERIFIER_KEY = "melora:spotify:pkce_verifier";

// PKCE state/verifier MUST survive the round-trip through the external
// browser. On Android the app is backgrounded while the system browser
// handles Spotify+Google auth; when the melora://callback deep link returns,
// the WebView may have been recreated and sessionStorage wiped — which made
// login silently fail and leave the user on the landing page. localStorage
// persists across that, so we use it for the short-lived OAuth handshake
// values (cleared as soon as the callback is processed).
const authStore = {
  get(key: string): string | null {
    return localStorage.getItem(key);
  },
  set(key: string, value: string): void {
    localStorage.setItem(key, value);
  },
  remove(key: string): void {
    localStorage.removeItem(key);
  },
};

function getConfig() {
  const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID;

  if (!clientId || clientId === "your_spotify_client_id_here") {
    throw new Error("Set VITE_SPOTIFY_CLIENT_ID in apps/web/.env");
  }

  const redirectUri = IS_TAURI
    ? DESKTOP_REDIRECT_URI
    : import.meta.env.VITE_SPOTIFY_REDIRECT_URI;

  if (!redirectUri) {
    throw new Error("Set VITE_SPOTIFY_REDIRECT_URI in apps/web/.env");
  }

  return { clientId, redirectUri, scopes: SPOTIFY_SCOPES };
}

export function loadStoredTokens(): StoredTokens | null {
  const raw = localStorage.getItem(TOKEN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return null;
  }
}

export function saveStoredTokens(tokens: StoredTokens): void {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

export function clearStoredTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// In Tauri, route Spotify API requests through Rust's HTTP client to avoid
// browser CORS/Origin restrictions that can cause 403s on some endpoints.
async function getTauriFetch(): Promise<typeof fetch> {
  if (!IS_TAURI) return fetch;
  try {
    const { fetch: tauriFetch } = await import(/* @vite-ignore */ "@tauri-apps/plugin-http");
    return tauriFetch as unknown as typeof fetch;
  } catch {
    return fetch;
  }
}

let _tauriFetchCache: typeof fetch | null = null;
export async function getHttpFetch(): Promise<typeof fetch> {
  if (_tauriFetchCache) return _tauriFetchCache;
  _tauriFetchCache = await getTauriFetch();
  return _tauriFetchCache;
}

export function getSpotifyClient(): SpotifyClient {
  return new SpotifyClient({
    getAccessToken: () => {
      const tokens = loadStoredTokens();
      if (!tokens || isTokenExpired(tokens)) return null;
      return tokens.access_token;
    },
    // Provide a lazy fetch that upgrades to Tauri's HTTP client when available.
    // This bypasses browser CORS and Origin header restrictions.
    fetchImpl: (input, init) =>
      getHttpFetch().then((f) => f(input as string, init)),
  });
}

export async function startSpotifyLogin(): Promise<void> {
  const config = getConfig();
  const state = crypto.randomUUID();
  const verifier = generateCodeVerifier();

  authStore.set(STATE_KEY, state);
  authStore.set(VERIFIER_KEY, verifier);

  const challenge = await generateCodeChallenge(verifier);
  const authUrl = buildPkceAuthUrl(config, state, challenge);

  if (IS_TAURI) {
    // Open Spotify auth in the system browser, not the in-app WebView.
    const { openUrl } = await import(/* @vite-ignore */ "@tauri-apps/plugin-opener");
    await openUrl(authUrl);
  } else {
    window.location.href = authUrl;
  }
}

async function exchangeCodeForTokens(code: string, verifier: string): Promise<StoredTokens> {
  const config = getConfig();
  const body = new URLSearchParams({
    client_id: config.clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    code_verifier: verifier,
  });

  const f = await getHttpFetch();
  const response = await f("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || "Failed to exchange Spotify authorization code");
  }

  return normalizeTokenResponse((await response.json()) as TokenResponse);
}

export async function handleSpotifyCallback(search: string): Promise<boolean> {
  const parsed = parseAuthCallback(search);
  if (!parsed) return false;

  const expectedState = authStore.get(STATE_KEY);
  const verifier = authStore.get(VERIFIER_KEY);

  if (!expectedState || expectedState !== parsed.state) {
    throw new Error("OAuth state mismatch. Please try logging in again.");
  }
  if (!verifier) {
    throw new Error("Missing PKCE verifier. Please try logging in again.");
  }

  authStore.remove(STATE_KEY);
  authStore.remove(VERIFIER_KEY);

  const tokens = await exchangeCodeForTokens(parsed.code, verifier);
  saveStoredTokens(tokens);
  return true;
}

export function isAuthenticated(): boolean {
  const tokens = loadStoredTokens();
  return Boolean(tokens && !isTokenExpired(tokens));
}

export function logout(): void {
  clearStoredTokens();
}

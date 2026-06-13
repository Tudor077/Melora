# Melora

Discover new songs **hourly** or **daily** based on what you already love on Spotify. Sort and filter picks by **BPM**, **genre**, **vibe**, energy, mood, popularity, and release date — then export to a fresh Spotify playlist.

On your phone, every track is full-screen — **swipe** to the next one and it plays automatically. Tap the **heart** to save it to your Liked Songs.

---

## Download & install (for users)

Grab the latest build from the [download page](download.html) or the releases folder:

- **Windows** — `releases/v0.3.0/Melora-Setup.exe` (or the `.msi`). SmartScreen may warn for a new publisher → **More info → Run anyway**.
- **Android** — `releases/v0.3.0/Melora.apk`. Allow installs from your browser when prompted.

### First run: connect your own Spotify app

Melora runs on **your own free Spotify app**, so there are no account limits and nothing to wait for. The app walks you through it on first launch — it takes ~2 minutes, once:

1. Open the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and click **Create app**.
2. Give it any name. Add this **Redirect URI** exactly:

   ```
   melora://callback
   ```

   and tick **Web API**, then save.
3. Open the app's **Settings**, copy its **Client ID**, and paste it into Melora's setup screen.

That's it — you're the owner of your own Spotify app, so you're authorised automatically. (You can change the Client ID later from the login screen.)

> **Why?** Spotify apps start in *Development Mode*, where only up to 25 manually-added users can use a given app. Letting each person run their own app sidesteps that entirely — no allowlist, no Spotify approval needed.

---

## Monorepo layout

```
Melora/
├── packages/core/     Shared Spotify client, vibes, sorting, discovery logic
├── apps/web/          Vite + React (primary UI today)
├── apps/desktop/      Tauri shell wrapping the web app
└── apps/mobile/       Expo shell sharing @melora/core
```

## Spotify Developer setup (start here)

You said you don't have credentials yet — here's the full flow:

### 1. Create a Spotify Developer app

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Log in with your Spotify account
3. Click **Create app**
4. Name it **Melora** (or anything you like)
5. Set redirect URI to:

   ```
   http://127.0.0.1:5173/callback
   ```

6. Save, then open the app and copy the **Client ID**

> Melora uses **PKCE** (no client secret in the browser). You only need the Client ID for local web development.

### 2. Configure environment variables

```bash
cp .env.example apps/web/.env
```

Edit `apps/web/.env`:

```env
VITE_SPOTIFY_CLIENT_ID=your_client_id_here
VITE_SPOTIFY_REDIRECT_URI=http://127.0.0.1:5173/callback
```

### 3. Install and run

From the repo root:

```bash
npm install
npm run dev
```

Open the local URL printed by Vite and click **Connect with Spotify**. Melora prefers
[http://127.0.0.1:5173](http://127.0.0.1:5173), but if that port is busy Vite may start on the
next open port, such as `5174`.

If Vite uses a different port, add that callback URL in the Spotify Developer Dashboard and update
`VITE_SPOTIFY_REDIRECT_URI` in `apps/web/.env` to match, for example:

```env
VITE_SPOTIFY_REDIRECT_URI=http://127.0.0.1:5174/callback
```

### Redirect URI checklist

| Platform | Redirect URI |
|----------|--------------|
| Web (Vite) | `http://127.0.0.1:5173/callback` |
| Tauri desktop | Same as web during dev |
| Expo mobile | `melora://callback` (add in Spotify dashboard when wiring mobile auth) |

## How discovery works

1. **Seeds** — Melora reads your top tracks and saved/liked songs
2. **Recommendations** — Spotify's `/recommendations` endpoint finds similar tracks
3. **Enrichment** — Each track gets audio features (BPM/tempo, energy, valence, danceability) and artist genres
4. **Vibes** — Tracks are labeled with vibes like Chill, Hype, Focus, Happy, etc.
5. **Cadence** — Results are cached per hour or per day so you get a fresh batch on schedule
6. **Playlist export** — One click creates a new private Spotify playlist from the current batch

## Sorting & filters

- **Sort:** BPM, genre, vibe, energy, mood (valence), danceability, popularity, release date
- **Filter:** BPM min/max, vibe chips, genre chips, explicit toggle (in core)

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start web app |
| `npm run dev:desktop` | Tauri desktop (requires Rust + Tauri prerequisites) |
| `npm run dev:mobile` | Expo dev server |
| `npm run build` | Build all workspaces |

## Spotify API scopes used

- `user-read-private`, `user-read-email`
- `user-top-read`, `user-library-read`
- `playlist-read-private`, `playlist-modify-public`, `playlist-modify-private`

## Next steps

- [ ] Add token refresh handling in the web app
- [ ] Wire Expo AuthSession + SecureStore for mobile login
- [ ] Add "exclude already heard" using recently played
- [ ] Push notifications for hourly/daily drops on mobile/desktop

## Requirements

- Node.js 20+
- Spotify account + Developer app Client ID
- For desktop: [Rust](https://rustup.rs/) + [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- For mobile: Expo Go or dev builds

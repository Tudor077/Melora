# Melora

### ⬇️ [Download Melora](https://tudor077.github.io/Melora/download.html) for Windows, Linux & Android

Discover new songs **hourly** or **daily** based on what you already love on Spotify. Sort and filter picks by **BPM**, **genre**, **vibe**, energy, mood, popularity, and release date, then export to a fresh Spotify playlist.

On your phone, every track is full-screen. **Swipe** to the next one and it plays automatically. Tap the **heart** to save it to your Liked Songs.

---

## Download & install (for users)

Grab the latest build from the [download page](download.html) or the releases folder:

- **Windows**: `releases/latest/Melora.exe`. Just run it, no install needed. SmartScreen may warn for a new publisher, so pick **More info, Run anyway**.
- **Linux**: `Melora.AppImage` from the [latest GitHub Release](https://github.com/Tudor077/Melora/releases/latest) (too big for the repo — it carries its own WebKitGTK and codecs). `chmod +x Melora.AppImage`, then run it — portable, no install. Needs FUSE (`fuse2` on Arch, `libfuse2` on Debian/Ubuntu); without it, run it with `--appimage-extract-and-run`.
- **Android**: `releases/latest/Melora.apk`. Allow installs from your browser when prompted.

### First run: connect your own Spotify app

Melora runs on **your own free Spotify app**, so there are no account limits and nothing to wait for. The app walks you through it on first launch, and it takes about 2 minutes, once:

1. Open the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and click **Create app**.
2. Give it any name. Add this **Redirect URI** exactly:

   ```
   melora://callback
   ```

   and tick **Web API**, then save.
3. Open the app's **Settings**, copy its **Client ID**, and paste it into Melora's setup screen.

That's it. You're the owner of your own Spotify app, so you're authorised automatically. (You can change the Client ID later from the login screen.)

> **Why?** Spotify apps start in *Development Mode*, where only up to 25 manually-added users can use a given app. Letting each person run their own app sidesteps that entirely, with no allowlist and no Spotify approval needed.

---

## Monorepo layout

```
Melora/
├── packages/core/     Shared Spotify client, vibes, sorting, discovery logic
├── apps/web/          Vite + React (primary UI today)
├── apps/desktop/      Tauri shell wrapping the web app
├── apps/mobile/       Expo shell sharing @melora/core
└── apps/sidequests/   Sidequest — offline tourist-quest generator (own product, see its README)
```

`apps/sidequests` builds into `sidequest/` at the repo root, so the Pages site serves it at
[/Melora/sidequest/](https://tudor077.github.io/Melora/sidequest/) — install it from a phone
browser with **Add to Home Screen**. See [apps/sidequests/README.md](apps/sidequests/README.md).

## Spotify Developer setup (start here)

Here's the full flow:

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

Spotify retired `/recommendations` and `/audio-features` for development-mode
apps, and caps `/search` at 10 results a call. Melora builds its own
recommender on top of what is left: many small searches, ranked locally.

1. **Taste profile**: top artists across all three listening windows, top
   tracks, Liked Songs and your biggest playlists are folded into weighted
   artist and genre affinities, plus the popularity band and era you actually
   listen in. Spotify leaves `genres` empty on niche artists, so MusicBrainz
   tags fill the gap. Cached for six hours, since a library barely moves.
2. **Search waves**: collaborations featuring artists you love, genre searches
   (both Spotify's `genre:` filter and free text) anchored on your era, and
   brand-new releases from your favourites. Every hit remembers the query that
   found it, which is what gives an unlabelled track a genre.
3. **Scoring**: each candidate is ranked on taste match, collaboration bonus,
   how well its popularity and release year fit your habits, and what your
   hearts and skips have said about that genre or artist before.
4. **Diversity pass**: picks are chosen greedily with a growing penalty for an
   artist or genre already in the batch, so 24 picks span your taste instead
   of drilling into one corner of it.
5. **No repeats**: shown tracks are remembered for ten days, and each refresh
   walks to different pages of its queries.
6. **Feedback**: hearts, skips and how long you actually listened feed back
   into genre and artist scores, decaying with a 30-day half-life. Skip enough
   drum and bass and Melora stops spending searches on it, without locking the
   genre out for good.
7. **Cadence**: results are cached per hour or per day so you get a fresh batch
   on schedule.
8. **Playlist export**: one click creates a new private Spotify playlist from
   the current batch.

All of it runs on the device and lives in `localStorage`. There is no server,
and nothing about your listening leaves your machine.

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
| `npm run build:linux` | Build the Linux AppImage into `releases/latest/` (Linux only) |
| `npm run dev:sidequests` | Start the Sidequest app (see `apps/sidequests/README.md`) |

## Spotify API scopes used

- `user-read-private`, `user-read-email`
- `user-top-read`, `user-library-read`
- `playlist-read-private`, `playlist-modify-public`, `playlist-modify-private`

## Next steps

- [ ] Add token refresh handling in the web app
- [ ] Wire Expo AuthSession + SecureStore for mobile login
- [x] Add "exclude already heard" (shown tracks are remembered for 10 days)
- [ ] Push notifications for hourly/daily drops on mobile/desktop

## Requirements

- Node.js 20+
- Spotify account + Developer app Client ID
- For desktop: [Rust](https://rustup.rs/) + [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- For mobile: Expo Go or dev builds

### Building on Linux (Arch / CachyOS)

```bash
sudo pacman -S --needed base-devel webkit2gtk-4.1 libappindicator-gtk3 librsvg appmenu-gtk-module xdotool patchelf fuse2 squashfs-tools gst-plugins-good nodejs npm rustup
rustup default stable
npm install
npm run build:linux
```

On Debian/Ubuntu the equivalents are `build-essential libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf libfuse2 squashfs-tools`.

Cargo output goes to `apps/desktop/src-tauri/target-linux/`, kept separate from the
Windows `target/` so a dual-boot checkout does not rebuild everything on each switch.
The AppImage bundles GStreamer (`bundleMediaFramework`), so the Spotify embed player
has its codecs on distros that ship none — which is most of the 168 MB.

It lands in `releases/latest/Melora.AppImage`, git-ignored: at that size GitHub
rejects it in a commit, so `scripts/release.mjs` uploads it to the GitHub Release
and the download page links there. Build it before cutting a release, or the
release script warns and ships Windows + Android only.

On NVIDIA the app forces `WEBKIT_DISABLE_DMABUF_RENDERER=1` at startup
([main.rs](apps/desktop/src-tauri/src/main.rs)); without it WebKitGTK cannot
allocate its GBM buffers and the window stays blank.

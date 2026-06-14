import { useEffect, useState } from "react";
import { useMeloraApp } from "./hooks/useMeloraApp";
import { useSpotifyEmbed } from "./hooks/useSpotifyEmbed";
import { useIsMobile } from "./hooks/useIsMobile";
import { TrackCard } from "./components/TrackCard";
import { MobileFeed } from "./components/MobileFeed";
import { SpotifySetup } from "./components/SpotifySetup";
import { CadenceToggle } from "./components/CadenceToggle";

function formatExpiry(iso: string, now: number): string {
  const diff = new Date(iso).getTime() - now;
  if (diff <= 0) return "now";
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  return `${minutes}:${pad(seconds)}`;
}

type BpmBand = "all" | "slow" | "mid" | "fast";

const BPM_BANDS: Array<{ id: BpmBand; label: string }> = [
  { id: "all", label: "All BPM" },
  { id: "slow", label: "< 100" },
  { id: "mid", label: "100–130" },
  { id: "fast", label: "> 130" },
];

function inBand(bpm: number | null, band: BpmBand): boolean {
  if (band === "all") return true;
  if (bpm == null) return false;
  if (band === "slow") return bpm < 100;
  if (band === "mid") return bpm >= 100 && bpm <= 130;
  return bpm > 130;
}

export default function App() {
  const app = useMeloraApp();
  const embed = useSpotifyEmbed();
  const { playback, playTrack, togglePlay } = embed;
  const isMobile = useIsMobile();
  const [bpmBand, setBpmBand] = useState<BpmBand>("all");
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(Date.now());

  // Live clock for the countdown + kill the browser right-click context menu
  // (this is a native-feeling app, not a web page).
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const noCtx = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", noCtx);
    return () => {
      clearInterval(tick);
      document.removeEventListener("contextmenu", noCtx);
    };
  }, []);

  const isSearching = query.trim().length > 0;
  const shownTracks = app.visibleTracks.filter((entry) => inBand(entry.bpm, bpmBand));
  // Desktop grid shows live Spotify search results while a query is typed,
  // otherwise the discovery picks. Mobile always uses discovery picks.
  const desktopTracks = isSearching ? (app.searchResults ?? []) : shownTracks;

  // Debounce the query into a real Spotify search.
  const runSearch = app.runSearch;
  useEffect(() => {
    const id = setTimeout(() => runSearch(query), 400);
    return () => clearTimeout(id);
  }, [query, runSearch]);

  if (!app.clientId) {
    return <SpotifySetup onSave={app.saveClientId} />;
  }

  if (!app.authed) {
    return (
      <div className="page landing">
        <div className="hero">
          <img className="brand-logo" src="/melora-logo.png" alt="Melora" />
          <p className="eyebrow">Melora</p>
          <h1>Fresh songs on your schedule</h1>
          <p className="lede">
            Connect Spotify to get hourly or daily picks based on your taste. Preview tracks
            directly and export straight to a new playlist.
          </p>
          <button className="primary" onClick={app.login} disabled={app.loading}>
            {app.loading ? "Connecting…" : "Connect with Spotify"}
          </button>
          {app.error && <p className="error">{app.error}</p>}
          <div className="setup-note">
            Using your own Spotify app.{" "}
            <button className="link-btn" onClick={app.changeClientId}>
              Use a different Client ID
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isMobile) {
    return <MobileFeed app={app} embed={embed} tracks={shownTracks} />;
  }

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Melora</p>
          <h1>{app.cadence === "hourly" ? "This hour's picks" : "Today's picks"}</h1>
          {app.session && (
            <p className="meta">
              Refreshes in {formatExpiry(app.session.expiresAt, now)} • artists similar to your taste
            </p>
          )}
        </div>
        <div className="topbar-actions">
          <button
            className="ghost"
            onClick={() => app.refreshSession()}
            disabled={app.loading || app.refreshesLeft === 0}
            title={`${app.refreshesLeft} of 5 refreshes left this hour`}
          >
            Refresh now{app.refreshesLeft < 5 ? ` (${app.refreshesLeft})` : ""}
          </button>
          <button className="ghost" onClick={app.createPlaylist} disabled={app.loading || !app.session}>
            Save as playlist
          </button>
          <button className="ghost" onClick={app.logout}>
            Log out
          </button>
        </div>
      </header>

      <CadenceToggle cadence={app.cadence} onChange={app.setCadence} />

      <div className="chip-row bpm-filter">
        {BPM_BANDS.map((band) => (
          <button
            key={band.id}
            className={`chip ${bpmBand === band.id ? "active" : ""}`}
            onClick={() => setBpmBand(band.id)}
          >
            {band.label}
          </button>
        ))}
      </div>

      <div className="search-row">
        <svg className="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
        </svg>
        <input
          className="search-input"
          type="search"
          placeholder="Search Spotify by song, artist or genre…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
        {app.searching && <span className="search-spinner spin" aria-hidden="true" />}
        {query && (
          <button className="search-clear" aria-label="Clear search" onClick={() => setQuery("")}>✕</button>
        )}
      </div>

      {app.error && <p className="error banner">{app.error}</p>}
      {app.playlistUrl && (
        <p className="success banner">
          Playlist created!{" "}
          <a href={app.playlistUrl} target="_blank" rel="noreferrer">
            Open in Spotify
          </a>
        </p>
      )}

      {!isSearching && app.loading && !app.session ? (
        <div className="loading">Finding songs you'll love…</div>
      ) : isSearching && app.searching && desktopTracks.length === 0 ? (
        <div className="loading">Searching Spotify…</div>
      ) : (
        <section className="track-grid">
          {desktopTracks.map((entry) => (
            <TrackCard
              key={entry.track.id}
              entry={entry}
              isActive={playback.trackId === entry.track.id}
              isPlaying={playback.trackId === entry.track.id && !playback.isPaused}
              progress={
                playback.trackId === entry.track.id && playback.duration > 0
                  ? playback.position / playback.duration
                  : 0
              }
              isLiked={app.likedTrackIds.has(entry.track.id)}
              onToggleLike={() => app.toggleLike(entry.track.id)}
              onClick={() => {
                if (playback.trackId === entry.track.id) {
                  togglePlay();
                } else {
                  playTrack(entry.track.id);
                }
              }}
            />
          ))}
          {desktopTracks.length === 0 && !app.searching && !app.loading && (
            <p className="empty">
              {isSearching
                ? `No results for "${query.trim()}".`
                : app.visibleTracks.length === 0
                  ? "No tracks found. Try refreshing to discover new music."
                  : "No tracks in this BPM range (some are still loading their BPM)."}
            </p>
          )}
        </section>
      )}

      <footer className="attribution">
        Powered by Spotify
      </footer>
    </div>
  );
}

import { useState } from "react";
import { useMeloraApp } from "./hooks/useMeloraApp";
import { useSpotifyEmbed } from "./hooks/useSpotifyEmbed";
import { useIsMobile } from "./hooks/useIsMobile";
import { TrackCard } from "./components/TrackCard";
import { MobileFeed } from "./components/MobileFeed";
import { SpotifySetup } from "./components/SpotifySetup";
import { CadenceToggle } from "./components/CadenceToggle";

function formatExpiry(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "expired";
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
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

  const shownTracks = app.visibleTracks.filter((entry) => inBand(entry.bpm, bpmBand));

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
              Refreshes in {formatExpiry(app.session.expiresAt)} • artists similar to your taste
            </p>
          )}
        </div>
        <div className="topbar-actions">
          <button className="ghost" onClick={() => app.refreshSession()} disabled={app.loading}>
            Refresh now
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

      <div className="chip-row genre-pins">
        <span className="label genre-pins-label">Your genres:</span>
        {app.pinnedGenres.map((genre) => (
          <button
            key={genre}
            className="chip active"
            title="Remove"
            onClick={() => app.removePinnedGenre(genre)}
          >
            {genre} ✕
          </button>
        ))}
        <form
          className="genre-pin-form"
          onSubmit={(e) => {
            e.preventDefault();
            const input = e.currentTarget.elements.namedItem("genre") as HTMLInputElement;
            if (input.value.trim()) {
              app.addPinnedGenre(input.value);
              input.value = "";
              app.refreshSession();
            }
          }}
        >
          <input name="genre" className="genre-pin-input" placeholder="+ add genre (e.g. breakcore)" autoComplete="off" />
        </form>
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

      {app.loading && !app.session ? (
        <div className="loading">Finding songs you'll love…</div>
      ) : (
        <section className="track-grid">
          {shownTracks.map((entry) => (
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
              onClick={() => {
                if (playback.trackId === entry.track.id) {
                  togglePlay();
                } else {
                  playTrack(entry.track.id);
                }
              }}
            />
          ))}
          {!app.loading && shownTracks.length === 0 && (
            <p className="empty">
              {app.visibleTracks.length === 0
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

import { useEffect, useRef, useState } from "react";
import type { EnrichedTrack } from "@melora/core";
import type { useMeloraApp } from "../hooks/useMeloraApp";
import type { useSpotifyEmbed } from "../hooks/useSpotifyEmbed";

interface MobileFeedProps {
  app: ReturnType<typeof useMeloraApp>;
  embed: ReturnType<typeof useSpotifyEmbed>;
  tracks: EnrichedTrack[];
}

/**
 * Phone UI: one full-screen track per page, swipe left/right (horizontal
 * scroll-snap) to move between them. Whichever slide settles into view
 * auto-plays through the shared headless Spotify embed — the same player
 * the desktop grid uses, just a different presentation. When a track's
 * preview ends it auto-advances to the next slide.
 */
export function MobileFeed({ app, embed, tracks }: MobileFeedProps) {
  const { playback, playTrack, togglePlay } = embed;
  const containerRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLElement | null)[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  // The first audible playback needs a user tap (mobile autoplay policy);
  // after that, swiping is itself a gesture so slide changes auto-play.
  const unlockedRef = useRef(false);
  // trackId we've already auto-skipped, so end-of-track fires the skip once.
  const skipGuardRef = useRef<string | null>(null);
  // Identity of the current track set, to detect a refresh (new session).
  const tracksKeyRef = useRef("");

  // Stable identity of the current track set (cheap; ids are short).
  const tracksKey = tracks.map((t) => t.track.id).join(",");

  const scrollToIndex = (i: number) => {
    slideRefs.current[i]?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  };

  // Track which slide is centered in the viewport. Re-runs when the track set
  // changes so the observer watches the new slide nodes (keyed by track id).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio >= 0.6) {
            const idx = Number((e.target as HTMLElement).dataset.index);
            if (!Number.isNaN(idx)) setActiveIndex(idx);
          }
        }
      },
      { root: container, threshold: [0.6] },
    );
    for (const el of slideRefs.current) if (el) observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracksKey]);

  // Auto-play the centered slide once the user has unlocked audio.
  useEffect(() => {
    const entry = tracks[activeIndex];
    if (!entry || !unlockedRef.current) return;
    if (playback.trackId !== entry.track.id) playTrack(entry.track.id);
  }, [activeIndex, tracks, playback.trackId, playTrack]);

  // Auto-advance when the current track/preview reaches its end.
  useEffect(() => {
    const { trackId, duration, position } = playback;
    if (!trackId || duration <= 0) return;
    const nearEnd = position >= duration - 1200;
    if (nearEnd && skipGuardRef.current !== trackId) {
      skipGuardRef.current = trackId;
      const next = activeIndex + 1;
      if (next < tracks.length) scrollToIndex(next);
    }
  }, [playback, activeIndex, tracks.length]);

  // On refresh (new track set) stop auto-playing and reset to the first slide,
  // so a previous-session track doesn't relaunch and the feed starts clean.
  useEffect(() => {
    if (tracksKeyRef.current && tracksKey !== tracksKeyRef.current) {
      unlockedRef.current = false;
      skipGuardRef.current = null;
      setActiveIndex(0);
      containerRef.current?.scrollTo({ left: 0, top: 0 });
    }
    tracksKeyRef.current = tracksKey;
  }, [tracksKey]);

  return (
    <div className="mobile-feed-wrap">
      <header className="mobile-bar">
        <span className="mobile-brand">
          <img src="/melora-logo.png" alt="" className="mobile-brand-logo" />
          <span className="eyebrow">Melora</span>
        </span>
        <div className="mobile-bar-actions">
          <button className="mobile-icon-btn" onClick={() => app.refreshSession()} disabled={app.loading} aria-label="Refresh">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button className="mobile-icon-btn" onClick={app.createPlaylist} disabled={app.loading || !app.session} aria-label="Save as playlist">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </button>
          <button className="mobile-icon-btn" onClick={app.logout} aria-label="Log out">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 17l5-5-5-5M21 12H9M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </header>

      {app.playlistUrl && (
        <a className="mobile-toast" href={app.playlistUrl} target="_blank" rel="noreferrer">
          Playlist created — open in Spotify
        </a>
      )}
      {app.error && <p className="mobile-toast error">{app.error}</p>}

      {app.loading && tracks.length === 0 ? (
        <div className="mobile-loading">Finding songs you'll love…</div>
      ) : tracks.length === 0 ? (
        <div className="mobile-loading">No tracks. Pull refresh to discover more.</div>
      ) : (
        <div className="mobile-feed" ref={containerRef}>
          {tracks.map((entry, i) => {
            const { track } = entry;
            const art = track.album.images?.[0]?.url;
            const isActive = playback.trackId === track.id;
            const isPlaying = isActive && !playback.isPaused;
            const progress =
              isActive && playback.duration > 0 ? playback.position / playback.duration : 0;
            return (
              <section
                key={track.id}
                className="mobile-slide"
                data-index={i}
                ref={(el) => { slideRefs.current[i] = el; }}
              >
                {art && <div className="mobile-slide-bg" style={{ backgroundImage: `url(${art})` }} />}
                <div className="mobile-slide-inner">
                  {art && <img className="mobile-cover" src={art} alt={track.album.name} />}
                  <div className="mobile-meta">
                    <h2 className="mobile-title">{track.name}</h2>
                    <p className="mobile-artist">{track.artists.map((a) => a.name).join(", ")}</p>
                    {entry.bpm != null && (
                      <div className="mobile-bpm">
                        <span className="mobile-bpm-num">{entry.bpm}</span>
                        <span className="mobile-bpm-label">BPM</span>
                      </div>
                    )}
                  </div>
                  <div className="mobile-controls">
                    <button
                      className="mobile-play"
                      aria-label={isPlaying ? "Pause" : "Play"}
                      onClick={() => {
                        unlockedRef.current = true;
                        if (isActive) togglePlay();
                        else playTrack(track.id);
                      }}
                    >
                      {isPlaying ? (
                        <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor">
                          <rect x="6" y="4" width="4" height="16" rx="1" />
                          <rect x="14" y="4" width="4" height="16" rx="1" />
                        </svg>
                      ) : (
                        <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M8 5.14v14l11-7-11-7z" />
                        </svg>
                      )}
                    </button>
                    {(() => {
                      const liked = app.likedTrackIds.has(track.id);
                      return (
                        <button
                          className={`mobile-like ${liked ? "liked" : ""}`}
                          aria-label={liked ? "Remove from Liked Songs" : "Add to Liked Songs"}
                          onClick={() => app.toggleLike(track.id)}
                        >
                          <svg width="26" height="26" viewBox="0 0 24 24" fill={liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                            <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      );
                    })()}
                  </div>
                  <div className="mobile-progress">
                    <div className="mobile-progress-fill" style={{ width: `${progress * 100}%` }} />
                  </div>
                  <p className="mobile-hint">← swipe for the next track</p>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

import type { CSSProperties } from "react";
import type { EnrichedTrack } from "@melora/core";

interface TrackCardProps {
  entry: EnrichedTrack;
  isActive: boolean;
  isPlaying: boolean;
  /** 0..1 playback progress, only meaningful when active */
  progress: number;
  isLiked: boolean;
  onToggleLike: () => void;
  onClick: () => void;
}

export function TrackCard({ entry, isActive, isPlaying, progress, isLiked, onToggleLike, onClick }: TrackCardProps) {
  const { track } = entry;
  const albumArt = track.album.images?.[0]?.url;
  const artists = track.artists.map((a) => a.name).join(", ");

  return (
    <article className={`track-card ${isActive ? "active" : ""}`} onClick={onClick}>
      <div className="track-banner">
        {albumArt && <img src={albumArt} alt={track.album.name} className="track-art" />}
        <button
          className={`card-like ${isLiked ? "liked" : ""}`}
          aria-label={isLiked ? "Remove from Liked Songs" : "Add to Liked Songs"}
          onClick={(e) => { e.stopPropagation(); onToggleLike(); }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill={isLiked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
            <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="track-play-overlay">
          <div className="track-play-icon">
            {isPlaying ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5.14v14l11-7-11-7z" />
              </svg>
            )}
          </div>
        </div>
        <div className="track-banner-overlay">
          <p className="track-album">{track.album.name}</p>
          <h3 className="track-name">{track.name}</h3>
          <p className="track-artist">
            <span className="track-artist-name">{artists}</span>
            {entry.bpm != null && <span className="track-bpm-inline">{entry.bpm} bpm</span>}
          </p>
        </div>
      </div>
      {isActive && (
        <div
          className="track-ring"
          style={{ "--ring-progress": `${Math.min(360, progress * 360)}deg` } as CSSProperties}
        />
      )}
    </article>
  );
}

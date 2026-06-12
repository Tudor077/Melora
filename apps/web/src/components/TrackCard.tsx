import type { EnrichedTrack } from "@melora/core";

interface TrackCardProps {
  entry: EnrichedTrack;
  isActive: boolean;
  isPlaying: boolean;
  /** 0..1 playback progress, only meaningful when active */
  progress: number;
  onClick: () => void;
}

export function TrackCard({ entry, isActive, isPlaying, progress, onClick }: TrackCardProps) {
  const { track } = entry;
  const albumArt = track.album.images?.[0]?.url;
  const artists = track.artists.map((a) => a.name).join(", ");

  return (
    <article className={`track-card ${isActive ? "active" : ""}`} onClick={onClick}>
      <div className="track-banner">
        {albumArt && <img src={albumArt} alt={track.album.name} className="track-art" />}
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
          <p className="track-artist">{artists}</p>
        </div>
        {isActive && (
          <div className="track-progress">
            <div className="track-progress-fill" style={{ width: `${Math.min(100, progress * 100)}%` }} />
          </div>
        )}
      </div>
    </article>
  );
}

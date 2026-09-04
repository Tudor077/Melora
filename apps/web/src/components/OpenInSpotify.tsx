import type { SpotifyTrack } from "@melora/core";
import { openExternal, spotifyTrackUrl } from "../lib/open-external";

interface Props {
  track: SpotifyTrack;
  /** `card` sits on the album art, `mobile` sits in the feed's control row. */
  variant: "card" | "mobile";
}

/**
 * Hands the track to Spotify itself. On a free account this is the only way to
 * hear the whole song — Spotify's embedded player stops at a 30-second preview
 * unless the listener is Premium — and it is a useful shortcut on any plan.
 */
export function OpenInSpotify({ track, variant }: Props) {
  const size = variant === "mobile" ? 24 : 18;

  return (
    <button
      className={variant === "mobile" ? "mobile-open" : "card-open"}
      title="Play the full track in Spotify"
      aria-label="Play the full track in Spotify"
      onClick={(e) => {
        e.stopPropagation();
        void openExternal(spotifyTrackUrl(track));
      }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0m5.52 17.34c-.24.36-.66.48-1.02.24-2.82-1.74-6.36-2.1-10.56-1.14-.42.12-.78-.18-.9-.54-.12-.42.18-.78.54-.9 4.56-1.02 8.52-.6 11.64 1.32.42.18.48.66.3 1.02m1.44-3.3c-.3.42-.84.6-1.26.3-3.24-1.98-8.16-2.58-11.94-1.38-.48.12-1.02-.12-1.14-.6-.12-.48.12-1.02.6-1.14 4.38-1.32 9.78-.66 13.5 1.62.36.18.54.78.24 1.2m.12-3.36C15.24 8.4 8.82 8.16 5.1 9.3c-.6.18-1.2-.18-1.38-.72-.18-.6.18-1.2.72-1.38 4.32-1.32 11.4-1.02 15.9 1.62.54.3.72 1.02.42 1.56-.3.42-1.02.6-1.56.3" />
      </svg>
    </button>
  );
}

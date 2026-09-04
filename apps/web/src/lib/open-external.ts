import type { SpotifyTrack } from "@melora/core";

const IS_TAURI = Boolean(import.meta.env.TAURI_ENV_PLATFORM);

/**
 * Opens a URL outside the app. In Tauri builds `window.open` would either do
 * nothing or trap the page inside the webview, so the opener plugin hands it
 * to the real browser (and, on Android, to the Spotify app when the link is
 * one Spotify claims).
 */
export async function openExternal(url: string): Promise<void> {
  if (IS_TAURI) {
    try {
      const { openUrl } = await import(/* @vite-ignore */ "@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    } catch {
      /* fall through to the plain anchor behaviour */
    }
  }
  window.open(url, "_blank", "noopener");
}

/**
 * The https link, not the `spotify:` URI: it is a universal link, so a phone
 * with Spotify installed opens the app and everyone else gets the web player.
 * This is the escape hatch for free accounts, whose embedded playback Spotify
 * limits to a 30-second preview.
 */
export function spotifyTrackUrl(track: SpotifyTrack): string {
  return track.external_urls?.spotify ?? `https://open.spotify.com/track/${track.id}`;
}

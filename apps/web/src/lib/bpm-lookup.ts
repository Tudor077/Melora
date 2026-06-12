import { getHttpFetch } from "./spotify-auth";

/**
 * BPM lookup via ReccoBeats (https://reccobeats.com) — a free API that
 * serves audio features for Spotify track IDs, filling the gap left by
 * Spotify's removed /audio-features endpoint.
 *
 * Batch endpoint, no auth, CORS enabled (verified). Results are cached per
 * Spotify track id in localStorage. We can't analyze audio ourselves:
 * preview_url is null for new apps and the embed iframe is cross-origin.
 */

const IS_TAURI = Boolean(import.meta.env.TAURI_ENV_PLATFORM);
const CACHE_KEY = "melora:bpm-cache:v2";
const BATCH_SIZE = 40;

let cache: Record<string, number | null> = (() => {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}") as Record<string, number | null>;
  } catch {
    return {};
  }
})();

function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // storage full — cache becomes session-only
  }
}

/** Resolve BPM for many Spotify track ids at once. Returns only the hits. */
export async function lookupBpms(trackIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const missing: string[] = [];

  for (const id of trackIds) {
    if (id in cache) {
      const bpm = cache[id];
      if (bpm != null) result.set(id, bpm);
    } else {
      missing.push(id);
    }
  }
  if (missing.length === 0) return result;

  const doFetch = IS_TAURI ? await getHttpFetch() : fetch.bind(globalThis);

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const chunk = missing.slice(i, i + BATCH_SIZE);
    try {
      const resp = await doFetch(
        `https://api.reccobeats.com/v1/audio-features?ids=${chunk.join(",")}`,
      );
      if (!resp.ok) {
        console.warn(`[Melora BPM] ReccoBeats responded ${resp.status} for ${chunk.length} ids`);
        continue;
      }
      const json = (await resp.json()) as {
        content?: Array<{ href?: string; tempo?: number }>;
      };

      // Items carry the Spotify id only inside their open.spotify.com href
      const seen = new Set<string>();
      for (const item of json.content ?? []) {
        const match = item.href?.match(/track\/([A-Za-z0-9]+)/);
        if (!match) continue;
        const spotifyId = match[1];
        const bpm =
          typeof item.tempo === "number" && item.tempo > 0
            ? Math.round(item.tempo)
            : null;
        cache[spotifyId] = bpm;
        seen.add(spotifyId);
        if (bpm != null) result.set(spotifyId, bpm);
      }
      // Tracks ReccoBeats doesn't know stay null in cache (no refetch loop)
      for (const id of chunk) {
        if (!seen.has(id)) cache[id] = null;
      }
    } catch {
      // network error — leave these ids uncached so a later session retries
    }
  }

  saveCache();
  console.info(
    `[Melora BPM] looked up ${missing.length} tracks, resolved ${result.size} BPMs (rest unknown to ReccoBeats)`,
  );
  return result;
}

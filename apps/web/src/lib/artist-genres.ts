/**
 * Artist → genre tags via the MusicBrainz search API.
 *
 * Spotify leaves `genres` empty on niche artists, which starves the
 * discovery algorithm of taste signal (no breakcore/dnb/jungle even when
 * the user lives in that scene). MusicBrainz tags cover scene artists well
 * (verified: kiyosumi → jungle/breakcore, Sewerslvt → dnb/breakcore).
 *
 * Free, no key, CORS enabled. Rate limit: 1 req/s — lookups run
 * sequentially with spacing and are cached per artist name forever.
 * The search response already includes tags, so it's one request/artist.
 */

const CACHE_KEY = "melora:artist-genres:v1";
const REQUEST_SPACING_MS = 1100;

let cache: Record<string, string[]> = (() => {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}") as Record<string, string[]>;
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

interface MbArtist {
  name?: string;
  score?: number;
  tags?: Array<{ name?: string; count?: number }>;
}

async function fetchArtistTags(name: string): Promise<string[]> {
  try {
    const query = encodeURIComponent(`artist:"${name.replace(/"/g, "")}"`);
    const resp = await fetch(
      `https://musicbrainz.org/ws/2/artist/?query=${query}&fmt=json&limit=1`,
    );
    if (!resp.ok) return [];
    const json = (await resp.json()) as { artists?: MbArtist[] };
    const artist = json.artists?.[0];
    // Low score = fuzzy match on a different artist — better no tags than wrong ones
    if (!artist || (artist.score ?? 0) < 90) return [];
    return (artist.tags ?? [])
      .filter((t) => t.name)
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
      .slice(0, 5)
      .map((t) => t.name as string);
  } catch {
    return [];
  }
}

/**
 * Resolve genre tags per artist. Cached names are free; uncached ones are
 * fetched sequentially (1/s) until `budgetMs` runs out — whatever was fetched
 * gets cached, so the pool grows across refreshes.
 *
 * Returns a map rather than a flat list so each tag keeps the artist it came
 * from: the taste profile weights a tag by how much the user listens to that
 * artist, and track cards label themselves from the same map.
 */
export async function lookupArtistGenreMap(
  artistNames: string[],
  budgetMs = 8000,
): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  const missing: string[] = [];

  for (const name of artistNames) {
    const key = name.toLowerCase();
    if (key in cache) result[key] = cache[key] as string[];
    else missing.push(name);
  }

  const deadline = Date.now() + budgetMs;
  for (const name of missing) {
    if (Date.now() >= deadline) break;
    const tags = await fetchArtistTags(name);
    cache[name.toLowerCase()] = tags;
    result[name.toLowerCase()] = tags;
    if (missing.indexOf(name) < missing.length - 1) {
      await new Promise((r) => setTimeout(r, REQUEST_SPACING_MS));
    }
  }
  saveCache();

  return result;
}

/** Tags already cached for these artists, with no network access at all. */
export function cachedArtistGenreMap(artistNames: string[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const name of artistNames) {
    const key = name.toLowerCase();
    if (key in cache) result[key] = cache[key] as string[];
  }
  return result;
}

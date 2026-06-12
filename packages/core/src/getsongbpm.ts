export interface BpmData {
  bpm: number | null;
  key: string | null;
}

type SearchItem = {
  id: string;
  title?: string;
  tempo?: string;
  open_key?: string;
  artist?: { name?: string };
};

async function safeFetch(url: string): Promise<unknown> {
  try {
    const resp = await fetch(url);
    const text = await resp.text();
    console.debug("[GetSongBPM]", url, resp.status, text.slice(0, 300));
    if (!resp.ok) return null;
    return JSON.parse(text);
  } catch (e) {
    console.debug("[GetSongBPM] fetch error", e);
    return null;
  }
}

export async function fetchBpmForTrack(
  artistName: string,
  trackTitle: string,
  apiKey: string,
  baseUrl = "https://api.getsongbpm.com",
): Promise<BpmData> {
  const searchUrl =
    `${baseUrl}/search/?api_key=${encodeURIComponent(apiKey)}` +
    `&type=song&lookup=${encodeURIComponent(trackTitle)}`;

  const searchData = (await safeFetch(searchUrl)) as {
    search?: SearchItem[];
  } | null;

  if (!searchData?.search?.length) return { bpm: null, key: null };

  const normalizedArtist = artistName.toLowerCase();
  const match =
    searchData.search.find((r) => {
      const rArtist = r.artist?.name?.toLowerCase() ?? "";
      return (
        rArtist.includes(normalizedArtist) ||
        normalizedArtist.includes(rArtist)
      );
    }) ?? searchData.search[0];

  if (!match) return { bpm: null, key: null };

  // Some responses include tempo directly in search results
  if (match.tempo) {
    return { bpm: Number(match.tempo) || null, key: match.open_key ?? null };
  }

  // Fetch full song details for tempo
  const songUrl =
    `${baseUrl}/song/?api_key=${encodeURIComponent(apiKey)}` +
    `&id=${encodeURIComponent(match.id)}`;

  const songData = (await safeFetch(songUrl)) as {
    song?: { tempo?: string; open_key?: string };
  } | null;

  if (!songData?.song) return { bpm: null, key: null };

  return {
    bpm: Number(songData.song.tempo) || null,
    key: songData.song.open_key ?? null,
  };
}

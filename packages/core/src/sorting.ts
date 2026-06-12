import type {
  DiscoveryFilters,
  EnrichedTrack,
  SortDirection,
  SortField,
  SortOption,
} from "./types";

function compareNumbers(a: number, b: number, direction: SortDirection): number {
  return direction === "asc" ? a - b : b - a;
}

function compareStrings(a: string, b: string, direction: SortDirection): number {
  const result = a.localeCompare(b, undefined, { sensitivity: "base" });
  return direction === "asc" ? result : -result;
}

export function sortTracks(tracks: EnrichedTrack[], sort: SortOption): EnrichedTrack[] {
  const copy = [...tracks];

  copy.sort((left, right) => {
    const featuresLeft = left.features;
    const featuresRight = right.features;

    switch (sort.field) {
      case "bpm":
        return compareNumbers(left.bpm ?? 0, right.bpm ?? 0, sort.direction);
      case "energy":
        return compareNumbers(featuresLeft?.energy ?? 0, featuresRight?.energy ?? 0, sort.direction);
      case "valence":
        return compareNumbers(featuresLeft?.valence ?? 0, featuresRight?.valence ?? 0, sort.direction);
      case "danceability":
        return compareNumbers(
          featuresLeft?.danceability ?? 0,
          featuresRight?.danceability ?? 0,
          sort.direction,
        );
      case "popularity":
        return compareNumbers(left.track.popularity, right.track.popularity, sort.direction);
      case "release_date":
        return compareStrings(
          left.track.album.release_date ?? "",
          right.track.album.release_date ?? "",
          sort.direction,
        );
      case "genre": {
        const genreLeft = left.genres[0] ?? "";
        const genreRight = right.genres[0] ?? "";
        return compareStrings(genreLeft, genreRight, sort.direction);
      }
      case "vibe": {
        const vibeLeft = left.primaryVibe?.label ?? "";
        const vibeRight = right.primaryVibe?.label ?? "";
        return compareStrings(vibeLeft, vibeRight, sort.direction);
      }
      default:
        return 0;
    }
  });

  return copy;
}

export function filterTracks(tracks: EnrichedTrack[], filters: DiscoveryFilters): EnrichedTrack[] {
  return tracks.filter((entry) => {
    const { track, features, genres, matchedVibes } = entry;

    if (filters.excludeExplicit && track.explicit) return false;

    if (filters.genres?.length) {
      const hasGenre = filters.genres.some((genre) =>
        genres.some((g) => g.toLowerCase().includes(genre.toLowerCase())),
      );
      if (!hasGenre) return false;
    }

    if (filters.vibes?.length) {
      const hasVibe = filters.vibes.some((vibeId) =>
        matchedVibes.some((vibe) => vibe.id === vibeId),
      );
      if (!hasVibe) return false;
    }

    if (features) {
      if (filters.bpmMin != null && features.tempo < filters.bpmMin) return false;
      if (filters.bpmMax != null && features.tempo > filters.bpmMax) return false;
      if (filters.energyMin != null && features.energy < filters.energyMin) return false;
      if (filters.energyMax != null && features.energy > filters.energyMax) return false;
      if (filters.valenceMin != null && features.valence < filters.valenceMin) return false;
      if (filters.valenceMax != null && features.valence > filters.valenceMax) return false;
    }

    return true;
  });
}

export const SORT_OPTIONS: Array<{ field: SortField; label: string }> = [
  { field: "bpm", label: "BPM" },
  { field: "genre", label: "Genre" },
  { field: "vibe", label: "Vibe" },
  { field: "energy", label: "Energy" },
  { field: "valence", label: "Mood" },
  { field: "danceability", label: "Danceability" },
  { field: "popularity", label: "Popularity" },
  { field: "release_date", label: "Release Date" },
];

export function uniqueGenres(tracks: EnrichedTrack[]): string[] {
  const set = new Set<string>();
  for (const entry of tracks) {
    for (const genre of entry.genres) set.add(genre);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

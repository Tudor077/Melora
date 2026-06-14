export interface SpotifyImage {
  url: string;
  height: number | null;
  width: number | null;
}

export interface SpotifyArtist {
  id: string;
  name: string;
  genres?: string[];
  images?: SpotifyImage[];
  external_urls?: { spotify: string };
}

export interface SpotifyAlbum {
  id: string;
  name: string;
  images?: SpotifyImage[];
  release_date?: string;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  uri: string;
  preview_url: string | null;
  duration_ms: number;
  popularity: number;
  explicit: boolean;
  artists: SpotifyArtist[];
  album: SpotifyAlbum;
  external_urls?: { spotify: string };
}

export interface AudioFeatures {
  id: string;
  tempo: number;
  energy: number;
  valence: number;
  danceability: number;
  acousticness: number;
  instrumentalness: number;
  speechiness: number;
  liveness: number;
  loudness: number;
  key: number;
  mode: number;
  time_signature: number;
}

export interface SpotifyUser {
  id: string;
  display_name: string | null;
  email?: string;
  images?: SpotifyImage[];
  product?: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

export type DiscoveryCadence = "hourly" | "daily";

export type SortField =
  | "bpm"
  | "energy"
  | "valence"
  | "danceability"
  | "popularity"
  | "release_date"
  | "genre"
  | "vibe";

export type SortDirection = "asc" | "desc";

export interface SortOption {
  field: SortField;
  direction: SortDirection;
}

export interface VibeProfile {
  id: string;
  label: string;
  description: string;
  emoji: string;
  /** Target audio feature ranges used for filtering & labeling */
  targets: Partial<Pick<AudioFeatures, "energy" | "valence" | "danceability" | "acousticness">>;
}

export interface DiscoveryFilters {
  genres?: string[];
  vibes?: string[];
  bpmMin?: number;
  bpmMax?: number;
  energyMin?: number;
  energyMax?: number;
  valenceMin?: number;
  valenceMax?: number;
  excludeExplicit?: boolean;
}

export interface EnrichedTrack {
  track: SpotifyTrack;
  features: AudioFeatures | null;
  genres: string[];
  primaryVibe: VibeProfile | null;
  matchedVibes: VibeProfile[];
  /** Best available BPM — from Spotify features when available, else from GetSongBPM */
  bpm: number | null;
  /** Best available musical key string e.g. "G# min" or Camelot notation from GetSongBPM */
  musicKey: string | null;
}

export interface DiscoverySession {
  id: string;
  cadence: DiscoveryCadence;
  generatedAt: string;
  expiresAt: string;
  seedTrackIds: string[];
  tracks: EnrichedTrack[];
}

export interface RecommendationSeedOptions {
  seedTracks?: string[];
  seedArtists?: string[];
  seedGenres?: string[];
  limit?: number;
  minPopularity?: number;
  targetEnergy?: number;
  targetValence?: number;
  targetDanceability?: number;
  targetTempo?: number;
  minTempo?: number;
  maxTempo?: number;
}

// Only the scopes Melora actually uses, to keep the consent screen minimal:
// top artists/tracks (discovery), library read+modify (Liked Songs), and
// creating private playlists. Dropped: user-read-private, user-read-email,
// playlist-read-private, playlist-modify-public (unused).
export const SPOTIFY_SCOPES = [
  "user-top-read",
  "user-library-read",
  "user-library-modify",
  "playlist-modify-private",
] as const;

export const DEFAULT_VIBES: VibeProfile[] = [
  {
    id: "chill",
    label: "Chill",
    description: "Low energy, relaxed mood",
    emoji: "🌊",
    targets: { energy: 0.35, valence: 0.45, danceability: 0.4, acousticness: 0.55 },
  },
  {
    id: "hype",
    label: "Hype",
    description: "High energy, ready to move",
    emoji: "🔥",
    targets: { energy: 0.85, valence: 0.65, danceability: 0.75 },
  },
  {
    id: "focus",
    label: "Focus",
    description: "Steady, low distraction",
    emoji: "🎯",
    targets: { energy: 0.45, valence: 0.4, danceability: 0.35, acousticness: 0.35 },
  },
  {
    id: "happy",
    label: "Happy",
    description: "Bright and uplifting",
    emoji: "☀️",
    targets: { energy: 0.6, valence: 0.85, danceability: 0.6 },
  },
  {
    id: "melancholy",
    label: "Melancholy",
    description: "Moody and introspective",
    emoji: "🌧️",
    targets: { energy: 0.35, valence: 0.2, danceability: 0.35, acousticness: 0.45 },
  },
  {
    id: "late-night",
    label: "Late Night",
    description: "Dark, slow, atmospheric",
    emoji: "🌙",
    targets: { energy: 0.3, valence: 0.25, danceability: 0.45, acousticness: 0.25 },
  },
  {
    id: "workout",
    label: "Workout",
    description: "Driving tempo and energy",
    emoji: "💪",
    targets: { energy: 0.9, valence: 0.55, danceability: 0.8 },
  },
  {
    id: "romantic",
    label: "Romantic",
    description: "Warm, intimate feel",
    emoji: "💫",
    targets: { energy: 0.4, valence: 0.55, danceability: 0.45, acousticness: 0.4 },
  },
];

export const SPOTIFY_SEED_GENRES = [
  "acoustic",
  "afrobeat",
  "alt-rock",
  "ambient",
  "blues",
  "chill",
  "classical",
  "dance",
  "deep-house",
  "electronic",
  "folk",
  "funk",
  "hip-hop",
  "house",
  "indie",
  "jazz",
  "k-pop",
  "latin",
  "metal",
  "pop",
  "punk",
  "r-n-b",
  "reggae",
  "rock",
  "soul",
  "synth-pop",
  "techno",
  "trance",
  "trip-hop",
] as const;

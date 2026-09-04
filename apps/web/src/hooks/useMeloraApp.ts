import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyFeedback,
  cacheSession,
  createPlaylistFromSession,
  DEFAULT_VIBES,
  filterTracks,
  getOrCreateDiscoverySession,
  generateDiscoverySession,
  getTasteProfile,
  loadCachedProfile,
  loadFeedback,
  saveFeedback,
  sortTracks,
  SORT_OPTIONS,
  planFromUser,
  topArtistNames,
  uniqueGenres,
  type DiscoveryCadence,
  type DiscoveryFilters,
  type DiscoveryPreferences,
  type DiscoverySession,
  type EnrichedTrack,
  type FeedbackEvent,
  type FeedbackStore,
  type SortField,
  type SortOption,
  type SpotifyPlan,
} from "@melora/core";
import { lookupBpms } from "../lib/bpm-lookup";
import { cachedArtistGenreMap, lookupArtistGenreMap } from "../lib/artist-genres";
import { stopPlayback } from "./useSpotifyEmbed";

const PINNED_GENRES_KEY = "melora:pinned-genres:v1";
const REFRESH_TIMES_KEY = "melora:refresh-times:v1";
const PREFERENCES_KEY = "melora:preferences:v1";
const SEARCH_HISTORY_KEY = "melora:search-history:v1";
const MAX_REFRESH_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;
const SEARCH_HISTORY_TTL_MS = 30 * 24 * HOUR_MS;

function loadPreferences(): DiscoveryPreferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? "null") as
      | DiscoveryPreferences
      | null;
    if (parsed && Array.isArray(parsed.genres)) return parsed;
  } catch {
    // fall through to defaults
  }
  return { genres: [] };
}

interface SearchHistoryEntry {
  q: string;
  at: number;
}

function loadSearchHistory(): SearchHistoryEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) ?? "[]") as SearchHistoryEntry[];
    return parsed.filter((entry) => Date.now() - entry.at < SEARCH_HISTORY_TTL_MS);
  } catch {
    return [];
  }
}

/** Newest first, deduped, capped — a search is an interest vote. */
function recordSearchTerm(term: string): void {
  const clean = term.toLowerCase().trim();
  if (clean.length < 3 || clean.length > 40) return;
  try {
    const rest = loadSearchHistory().filter((entry) => entry.q !== clean);
    const next = [{ q: clean, at: Date.now() }, ...rest].slice(0, 12);
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // best-effort
  }
}

function loadRefreshTimes(): number[] {
  try {
    const all = JSON.parse(localStorage.getItem(REFRESH_TIMES_KEY) ?? "[]") as number[];
    return all.filter((t) => Date.now() - t < HOUR_MS);
  } catch {
    return [];
  }
}

function loadPinnedGenres(): string[] {
  try {
    return JSON.parse(localStorage.getItem(PINNED_GENRES_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}
import {
  clearClientId,
  getClientId,
  getSpotifyClient,
  handleSpotifyCallback,
  isAuthenticated,
  logout,
  setClientId as persistClientId,
  startSpotifyLogin,
} from "../lib/spotify-auth";

const IS_TAURI = Boolean(import.meta.env.TAURI_ENV_PLATFORM);

export function useMeloraApp() {
  const [authed, setAuthed] = useState(isAuthenticated());
  const [clientId, setClientIdState] = useState<string | null>(getClientId());
  const saveClientId = useCallback((id: string) => {
    persistClientId(id);
    setClientIdState(getClientId());
  }, []);
  // Reset to the setup screen: drop the Client ID and any session/login tied
  // to it (a token from a different app would be invalid anyway).
  const changeClientId = useCallback(() => {
    logout();
    clearClientId();
    setAuthed(false);
    setSession(null);
    setClientIdState(null);
  }, []);
  const [loading, setLoading] = useState(false);
  // Separate from `loading` (which also covers saving a playlist) so the UI
  // can say "Refreshing…" only when a batch is actually being generated.
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cadence, setCadence] = useState<DiscoveryCadence>("hourly");
  const [sortField, setSortField] = useState<SortField>("bpm");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [filters, setFilters] = useState<DiscoveryFilters>({});
  const [session, setSession] = useState<DiscoverySession | null>(null);
  const [playlistUrl, setPlaylistUrl] = useState<string | null>(null);
  const [pinnedGenres, setPinnedGenres] = useState<string[]>(loadPinnedGenres);
  // Ref mirrors pinnedGenres synchronously so a refresh fired right after
  // add/remove sees the new list (state updates are async)
  const pinnedGenresRef = useRef<string[]>(pinnedGenres);

  // Preferences panel: what the user explicitly wants to hear. Ref for the
  // same reason as pinned genres — refresh reads it inside an async callback.
  const [preferences, setPreferencesState] = useState<DiscoveryPreferences>(loadPreferences);
  const preferencesRef = useRef<DiscoveryPreferences>(preferences);
  const setPreferences = useCallback((next: DiscoveryPreferences) => {
    preferencesRef.current = next;
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
    } catch {
      // best-effort
    }
    setPreferencesState(next);
  }, []);

  // Hearts, skips and impressions from earlier batches. Kept in a ref because
  // discovery reads it inside an async callback, where a state snapshot would
  // be one render behind.
  const feedbackRef = useRef<FeedbackStore>(loadFeedback());
  const pushFeedback = useCallback((events: FeedbackEvent[]) => {
    if (events.length === 0) return;
    feedbackRef.current = applyFeedback(feedbackRef.current, events);
    saveFeedback(feedbackRef.current);
  }, []);

  // Every track the UI has shown, so an event fired from a card can look up
  // that track's genres without threading the whole entry through the call.
  const trackIndexRef = useRef<Map<string, EnrichedTrack>>(new Map());

  /**
   * Record what the user did with a track. Genres come from the index, so the
   * signal lands on the genre as well as the artist: skipping three drum and
   * bass tracks in a row should quiet drum and bass, not just those artists.
   */
  const recordTrackEvent = useCallback(
    (kind: "like" | "unlike" | "skip" | "played", trackId: string, playedMs = 0) => {
      const entry = trackIndexRef.current.get(trackId);
      if (!entry) return;
      const base = { track: entry.track, genres: entry.genres };
      pushFeedback([
        kind === "like" || kind === "unlike"
          ? { kind, ...base }
          : { kind, ...base, playedMs },
      ]);
    },
    [pushFeedback],
  );

  const client = useMemo(() => getSpotifyClient(), []);

  // Which plan the account is on. Playback inside Melora goes through
  // Spotify's embed, and Spotify serves a 30-second preview there to anyone
  // who is not Premium — so the UI needs to know, to offer the full track in
  // the Spotify app instead of leaving people staring at a stub.
  const [plan, setPlan] = useState<SpotifyPlan>("unknown");
  useEffect(() => {
    if (!authed) {
      setPlan("unknown");
      return;
    }
    let cancelled = false;
    void client
      .getCurrentUser()
      .then((user) => {
        if (!cancelled) setPlan(planFromUser(user));
      })
      .catch(() => {
        // A token minted before `user-read-private` was requested, or an
        // offline start: "unknown" is a valid state, so stay quiet.
        if (!cancelled) setPlan("unknown");
      });
    return () => {
      cancelled = true;
    };
  }, [authed, client]);
  const sort: SortOption = useMemo(
    () => ({ field: sortField, direction: sortDirection }),
    [sortField, sortDirection],
  );

  const visibleTracks = useMemo(() => {
    if (!session) return [];
    const filtered = filterTracks(session.tracks, filters);
    return sortTracks(filtered, sort);
  }, [session, filters, sort]);

  const availableGenres = useMemo(() => (session ? uniqueGenres(session.tracks) : []), [session]);

  const refreshSession = useCallback(
    async (force = false) => {
      if (!isAuthenticated()) return;
      // Stop any track left playing from the previous session so the headless
      // embed doesn't keep playing something that's no longer on screen.
      stopPlayback();
      setLoading(true);
      setRefreshing(true);
      setError(null);
      setPlaylistUrl(null);

      try {
        // MusicBrainz tags for the user's top artists. Spotify's own genre
        // field is empty for niche artists, so without this the taste profile
        // collapses to whatever mainstream tags it can find.
        const pinned = pinnedGenresRef.current;
        let artistGenres: Record<string, string[]> = {};
        try {
          // The cached profile already knows the top artists; only a cold
          // start (no profile yet) spends an API call on the name list.
          const cachedProfile = loadCachedProfile();
          const names = cachedProfile
            ? topArtistNames(cachedProfile, 20)
            : (await client.getTopArtists(20, "medium_term")).items.map((a) => a.name);
          // Cached tags are instant. Uncached ones get a short budget here so
          // a first run is not stuck behind MusicBrainz's 1 req/s limit, then
          // a background pass keeps filling the cache for the next refresh.
          artistGenres = { ...cachedArtistGenreMap(names), ...(await lookupArtistGenreMap(names, 3000)) };
          void lookupArtistGenreMap(names, 25000).catch(() => {});
        } catch {
          // profiling is best-effort; pinned genres still apply
        }

        const profile = await getTasteProfile(client, {
          artistGenres,
          pinnedGenres: pinned,
        });

        // Sort and filters stay out of the batch itself: the UI re-sorts and
        // re-filters what it has, so baking them in here would only mean a
        // discarded track is gone for good when the user widens a filter.
        const options = {
          cadence,
          limit: 24,
          extraGenres: pinned,
          artistGenres,
          profile,
          feedback: feedbackRef.current,
          preferences: preferencesRef.current,
          searchInterests: loadSearchHistory().map((entry) => entry.q),
        };
        let nextSession;
        if (force) {
          nextSession = await generateDiscoverySession(client, options);
          // getOrCreate caches for us; a forced batch has to cache itself, or
          // a reload would drop back to the batch it replaced.
          cacheSession(nextSession);
        } else {
          nextSession = await getOrCreateDiscoverySession(client, options);
        }

        setSession(nextSession);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load recommendations");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    // Deliberately not depending on sort/filters: those are view state, and
    // re-running discovery when the user flips a sort order is 30 wasted
    // API calls for a batch that would come back identical.
    [cadence, client],
  );

  const addPinnedGenre = useCallback((genre: string) => {
    const clean = genre.trim().toLowerCase();
    if (!clean || pinnedGenresRef.current.includes(clean)) return;
    const next = [...pinnedGenresRef.current, clean];
    pinnedGenresRef.current = next;
    localStorage.setItem(PINNED_GENRES_KEY, JSON.stringify(next));
    setPinnedGenres(next);
  }, []);

  const removePinnedGenre = useCallback((genre: string) => {
    const next = pinnedGenresRef.current.filter((g) => g !== genre);
    pinnedGenresRef.current = next;
    localStorage.setItem(PINNED_GENRES_KEY, JSON.stringify(next));
    setPinnedGenres(next);
  }, []);

  const processCallback = useCallback(
    (search: string) => {
      setLoading(true);
      handleSpotifyCallback(search)
        .then((handled) => {
          if (!handled) return;
          setAuthed(true);
          if (!IS_TAURI) window.history.replaceState({}, "", "/");
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : (err ? String(err) : "Unknown error");
          setError(msg || "Spotify login failed");
        })
        .finally(() => setLoading(false));
    },
    [],
  );

  // Web: handle ?code= in the URL after Spotify redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("code")) processCallback(window.location.search);
  }, [processCallback]);

  // Tauri: handle deep link melora://callback?code=...&state=...
  // Desktop: Rust's single-instance callback emits "deep-link-received"
  // (onOpenUrl doesn't fire there because single-instance intercepts the
  // second launch). Android/iOS: the OS delivers the link to the running
  // app, so onOpenUrl is the channel. Both listeners coexist safely.
  useEffect(() => {
    if (!IS_TAURI) return;
    let unlisten: (() => void) | undefined;
    let unlistenMobile: (() => void) | undefined;

    const handleDeepLink = (raw: string) => {
      try {
        const url = new URL(raw);
        if (url.protocol === "melora:" && url.host === "callback") {
          processCallback(url.search);
        }
      } catch {
        // ignore malformed URLs
      }
    };

    import(/* @vite-ignore */ "@tauri-apps/api/event").then(({ listen }) => {
      listen<string>("deep-link-received", (event) => handleDeepLink(event.payload))
        .then((fn) => { unlisten = fn; });
    });

    import(/* @vite-ignore */ "@tauri-apps/plugin-deep-link").then(({ onOpenUrl, getCurrent }) => {
      onOpenUrl((urls) => { for (const u of urls) handleDeepLink(u); })
        .then((fn) => { unlistenMobile = fn; });
      // Cold start: if Android launched the activity straight from the
      // melora://callback intent, onOpenUrl (registered just now) misses the
      // initial URL — getCurrent() returns it instead.
      getCurrent().then((urls) => {
        if (urls) for (const u of urls) handleDeepLink(u);
      }).catch(() => {});
    }).catch(() => {
      // plugin not available — desktop path covers it
    });

    return () => { unlisten?.(); unlistenMobile?.(); };
  }, [processCallback]);

  useEffect(() => {
    if (authed) void refreshSession();
  }, [authed, cadence, refreshSession]);

  // Auto-dismiss the "playlist created" toast after a few seconds.
  useEffect(() => {
    if (!playlistUrl) return;
    const t = setTimeout(() => setPlaylistUrl(null), 5000);
    return () => clearTimeout(t);
  }, [playlistUrl]);

  // BPM enrichment via ReccoBeats: the session renders immediately, then one
  // batch lookup fills in the badges (cached per track in localStorage).
  useEffect(() => {
    if (!session) return;
    const sessionId = session.id;
    const missingIds = session.tracks
      .filter((entry) => entry.bpm === null)
      .map((entry) => entry.track.id);
    if (missingIds.length === 0) return;

    let cancelled = false;
    void lookupBpms(missingIds).then((bpms) => {
      if (cancelled || bpms.size === 0) return;
      setSession((prev) => {
        if (!prev || prev.id !== sessionId) return prev;
        return {
          ...prev,
          tracks: prev.tracks.map((e) => {
            const bpm = bpms.get(e.track.id);
            return bpm != null ? { ...e, bpm } : e;
          }),
        };
      });
    });
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  // A generated batch counts as shown: the next batch should move on rather
  // than serve the same songs again an hour later.
  useEffect(() => {
    if (!session || session.tracks.length === 0) return;
    for (const entry of session.tracks) trackIndexRef.current.set(entry.track.id, entry);
    pushFeedback(
      session.tracks.map((entry) => ({
        kind: "shown" as const,
        track: entry.track,
        genres: entry.genres,
      })),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  const [likedTrackIds, setLikedTrackIds] = useState<Set<string>>(new Set());

  // When a session loads, ask Spotify which of its tracks are already in the
  // user's Liked Songs so the hearts render in the right state.
  useEffect(() => {
    if (!session || session.tracks.length === 0) return;
    const ids = session.tracks.map((e) => e.track.id);
    let cancelled = false;
    void client
      .checkSavedTracks(ids)
      .then((flags) => {
        if (cancelled) return;
        const arr = Array.isArray(flags)
          ? flags
          : ((flags as { found?: boolean[]; contains?: boolean[] })?.found ??
            (flags as { contains?: boolean[] })?.contains ??
            []);
        setLikedTrackIds((prev) => {
          const next = new Set(prev);
          ids.forEach((id, i) => {
            if (arr[i]) next.add(id);
            else next.delete(id);
          });
          return next;
        });
      })
      .catch(() => {
        // best-effort; hearts just start empty
      });
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);
  // Toggle a track in/out of Liked Songs. Optimistic — flip the heart now,
  // roll back if the request fails.
  const toggleLike = useCallback(
    async (trackId: string) => {
      const wasLiked = likedTrackIds.has(trackId);
      setLikedTrackIds((prev) => {
        const next = new Set(prev);
        if (wasLiked) next.delete(trackId);
        else next.add(trackId);
        return next;
      });
      // A heart is the loudest taste signal the app gets, so it feeds the
      // model straight away rather than waiting for the next profile rebuild.
      recordTrackEvent(wasLiked ? "unlike" : "like", trackId);
      try {
        if (wasLiked) await client.removeTracks([trackId]);
        else await client.saveTracks([trackId]);
      } catch (err) {
        setLikedTrackIds((prev) => {
          const next = new Set(prev);
          if (wasLiked) next.add(trackId);
          else next.delete(trackId);
          return next;
        });
        setError(err instanceof Error ? err.message : "Couldn't update Liked Songs");
      }
    },
    [client, likedTrackIds, recordTrackEvent],
  );

  // Manual refresh is capped at 5 per rolling hour.
  const [refreshTimes, setRefreshTimes] = useState<number[]>(loadRefreshTimes);
  const recentRefreshes = refreshTimes.filter((t) => Date.now() - t < HOUR_MS);
  const refreshesLeft = Math.max(0, MAX_REFRESH_PER_HOUR - recentRefreshes.length);
  const manualRefresh = useCallback(() => {
    const now = Date.now();
    const recent = loadRefreshTimes();
    if (recent.length >= MAX_REFRESH_PER_HOUR) {
      const waitMin = Math.max(1, Math.ceil((HOUR_MS - (now - recent[0])) / 60000));
      setError(`Refresh limit reached (${MAX_REFRESH_PER_HOUR}/hour). Try again in ${waitMin}m.`);
      return;
    }
    const next = [...recent, now];
    localStorage.setItem(REFRESH_TIMES_KEY, JSON.stringify(next));
    setRefreshTimes(next);
    void refreshSession(true);
  }, [refreshSession]);

  // Real Spotify search (not just filtering the current page). Free-text, so
  // a song title, an artist, or a genre word ("techno", "lofi") all work.
  const [searchResults, setSearchResults] = useState<EnrichedTrack[] | null>(null);
  const [searching, setSearching] = useState(false);
  // The term the user last let sit. Recorded into search history only after
  // 4s of stability, so "brea", "break", "breakc"… don't pollute the signal.
  const lastSearchRef = useRef<string>("");
  const runSearch = useCallback(
    async (query: string) => {
      const q = query.trim();
      lastSearchRef.current = q.toLowerCase();
      if (!q) {
        setSearchResults(null);
        setSearching(false);
        return;
      }
      window.setTimeout(() => {
        if (lastSearchRef.current === q.toLowerCase()) recordSearchTerm(q);
      }, 4000);
      setSearching(true);
      try {
        // Dev-mode caps /search at limit=10, so pull two pages for ~20 hits.
        const [a, b] = await Promise.all([
          client.searchTracks(q, 10, 0),
          client.searchTracks(q, 10, 10).catch(() => null),
        ]);
        const items = [...a.tracks.items, ...(b?.tracks.items ?? [])];
        const seen = new Set<string>();
        const enriched: EnrichedTrack[] = [];
        for (const track of items) {
          if (seen.has(track.id)) continue;
          seen.add(track.id);
          enriched.push({
            track,
            features: null,
            genres: [],
            primaryVibe: null,
            matchedVibes: [],
            bpm: null,
            musicKey: null,
          });
        }
        for (const entry of enriched) trackIndexRef.current.set(entry.track.id, entry);
        setSearchResults(enriched);
      } catch (err) {
        setSearchResults([]);
        setError(err instanceof Error ? err.message : "Search failed");
      } finally {
        setSearching(false);
      }
    },
    [client],
  );

  const createPlaylist = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const label = cadence === "hourly" ? "Melora Hourly" : "Melora Daily";
      const date = new Date().toLocaleDateString();
      const url = await createPlaylistFromSession(client, session, `${label} • ${date}`);
      setPlaylistUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create playlist");
    } finally {
      setLoading(false);
    }
  }, [cadence, client, session]);

  return {
    authed,
    plan,
    clientId,
    saveClientId,
    changeClientId,
    loading,
    refreshing,
    error,
    cadence,
    setCadence,
    sortField,
    setSortField,
    sortDirection,
    setSortDirection,
    filters,
    setFilters,
    session,
    visibleTracks,
    availableGenres,
    vibes: DEFAULT_VIBES,
    sortOptions: SORT_OPTIONS,
    playlistUrl,
    likedTrackIds,
    toggleLike,
    recordTrackEvent,
    pinnedGenres,
    addPinnedGenre,
    removePinnedGenre,
    preferences,
    setPreferences,
    login: () => { void startSpotifyLogin(); },
    logout: () => {
      logout();
      setAuthed(false);
      setSession(null);
    },
    refreshSession: manualRefresh,
    refreshesLeft,
    searchResults,
    searching,
    runSearch,
    createPlaylist,
  };
}

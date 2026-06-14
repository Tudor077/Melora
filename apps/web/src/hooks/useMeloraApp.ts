import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createPlaylistFromSession,
  DEFAULT_VIBES,
  filterTracks,
  getOrCreateDiscoverySession,
  generateDiscoverySession,
  sortTracks,
  SORT_OPTIONS,
  uniqueGenres,
  type DiscoveryCadence,
  type DiscoveryFilters,
  type DiscoverySession,
  type SortField,
  type SortOption,
} from "@melora/core";
import { lookupBpms } from "../lib/bpm-lookup";
import { lookupArtistGenres } from "../lib/artist-genres";
import { stopPlayback } from "./useSpotifyEmbed";

const PINNED_GENRES_KEY = "melora:pinned-genres:v1";
const REFRESH_TIMES_KEY = "melora:refresh-times:v1";
const MAX_REFRESH_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

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

  const client = useMemo(() => getSpotifyClient(), []);
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
      setError(null);
      setPlaylistUrl(null);

      try {
        // Taste profile: MusicBrainz tags for top artists (Spotify's own
        // genre field is empty for niche artists) + user-pinned genres.
        const pinned = pinnedGenresRef.current;
        let extraGenres = [...pinned];
        try {
          const top = await client.getTopArtists(12, "medium_term");
          const mbGenres = await lookupArtistGenres(top.items.map((a) => a.name));
          extraGenres = [...new Set([...pinned, ...mbGenres])];
        } catch {
          // profiling is best-effort; pinned genres still apply
        }

        const options = { cadence, sort, filters, limit: 24, extraGenres };
        const nextSession = force
          ? await generateDiscoverySession(client, options)
          : await getOrCreateDiscoverySession(client, options);

        setSession(nextSession);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load recommendations");
      } finally {
        setLoading(false);
      }
    },
    [cadence, client, filters, sort],
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
    [client, likedTrackIds],
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
    clientId,
    saveClientId,
    changeClientId,
    loading,
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
    pinnedGenres,
    addPinnedGenre,
    removePinnedGenre,
    login: () => { void startSpotifyLogin(); },
    logout: () => {
      logout();
      setAuthed(false);
      setSession(null);
    },
    refreshSession: manualRefresh,
    refreshesLeft,
    createPlaylist,
  };
}

import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  getSpotifyClient,
  handleSpotifyCallback,
  isAuthenticated,
  logout,
  startSpotifyLogin,
} from "../lib/spotify-auth";

const IS_TAURI = Boolean(import.meta.env.TAURI_ENV_PLATFORM);

export function useMeloraApp() {
  const [authed, setAuthed] = useState(isAuthenticated());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cadence, setCadence] = useState<DiscoveryCadence>("hourly");
  const [sortField, setSortField] = useState<SortField>("bpm");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [filters, setFilters] = useState<DiscoveryFilters>({});
  const [session, setSession] = useState<DiscoverySession | null>(null);
  const [playlistUrl, setPlaylistUrl] = useState<string | null>(null);

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
      setLoading(true);
      setError(null);
      setPlaylistUrl(null);

      try {
        const nextSession = force
          ? await generateDiscoverySession(client, { cadence, sort, filters, limit: 24 })
          : await getOrCreateDiscoverySession(client, { cadence, sort, filters, limit: 24 });

        setSession(nextSession);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load recommendations");
      } finally {
        setLoading(false);
      }
    },
    [cadence, client, filters, sort],
  );

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

    import(/* @vite-ignore */ "@tauri-apps/plugin-deep-link").then(({ onOpenUrl }) => {
      onOpenUrl((urls) => { for (const u of urls) handleDeepLink(u); })
        .then((fn) => { unlistenMobile = fn; });
    }).catch(() => {
      // plugin not available — desktop path covers it
    });

    return () => { unlisten?.(); unlistenMobile?.(); };
  }, [processCallback]);

  useEffect(() => {
    if (authed) void refreshSession();
  }, [authed, cadence, refreshSession]);

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
    login: () => { void startSpotifyLogin(); },
    logout: () => {
      logout();
      setAuthed(false);
      setSession(null);
    },
    refreshSession: () => refreshSession(true),
    createPlaylist,
  };
}

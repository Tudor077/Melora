import { useEffect, useState } from "react";

/**
 * Headless Spotify playback via the official iFrame Embed API.
 *
 * The embed iframe stays mounted off-screen while our own UI drives it
 * through the EmbedController (loadUri/play/togglePlay + playback_update).
 *
 * Hard-won rules (docs + community threads):
 *  - Commands sent before the controller's `ready` event are silently
 *    dropped — every action is queued and flushed on `ready`.
 *  - The API script must be injected exactly once; React StrictMode
 *    double-mounts effects, so all state lives at module level, not in
 *    the hook.
 * Docs: https://developer.spotify.com/documentation/embeds/references/iframe-api
 */

interface PlaybackUpdateData {
  isPaused: boolean;
  isBuffering: boolean;
  duration: number;
  position: number;
}

interface EmbedController {
  loadUri: (uri: string) => void;
  play: () => void;
  pause: () => void;
  resume: () => void;
  togglePlay: () => void;
  seek: (seconds: number) => void;
  destroy: () => void;
  addListener: (event: string, cb: (e?: { data: PlaybackUpdateData }) => void) => void;
}

interface SpotifyIframeApi {
  createController: (
    element: HTMLElement,
    options: { uri: string; width?: number | string; height?: number | string },
    callback: (controller: EmbedController) => void,
  ) => void;
}

declare global {
  interface Window {
    onSpotifyIframeApiReady?: (api: SpotifyIframeApi) => void;
  }
}

export interface EmbedPlayback {
  trackId: string | null;
  isPaused: boolean;
  isBuffering: boolean;
  /** ms */
  position: number;
  /** ms */
  duration: number;
}

// ── module-level singleton (survives StrictMode remounts and HMR) ──────────

let apiPromise: Promise<SpotifyIframeApi> | null = null;
let controller: EmbedController | null = null;
let controllerReady = false;
let creatingController = false;
let currentTrackId: string | null = null;
let commandQueue: Array<() => void> = [];

let playbackState: EmbedPlayback = {
  trackId: null,
  isPaused: true,
  isBuffering: false,
  position: 0,
  duration: 0,
};
const subscribers = new Set<(s: EmbedPlayback) => void>();

function emit(partial: Partial<EmbedPlayback>) {
  playbackState = { ...playbackState, ...partial };
  for (const cb of subscribers) cb(playbackState);
}

function loadIframeApi(): Promise<SpotifyIframeApi> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    window.onSpotifyIframeApiReady = (api) => resolve(api);
    const script = document.createElement("script");
    script.src = "https://open.spotify.com/embed/iframe-api/v1";
    script.async = true;
    document.body.appendChild(script);
  });
  return apiPromise;
}

function ensureHost(): HTMLElement {
  const existing = document.getElementById("melora-embed-host");
  if (existing) return existing;
  const host = document.createElement("div");
  host.id = "melora-embed-host";
  // Must stay INSIDE the viewport: the embed lazy-initializes via
  // IntersectionObserver and `ready` never fires for off-screen iframes
  // (verified — left:-9999px kills it). opacity:0 hides it without
  // removing it from the intersection geometry.
  host.style.position = "fixed";
  host.style.right = "0";
  host.style.bottom = "0";
  host.style.width = "300px";
  host.style.height = "80px";
  host.style.opacity = "0";
  host.style.pointerEvents = "none";
  host.setAttribute("aria-hidden", "true");
  document.body.appendChild(host);
  return host;
}

function flushQueue() {
  const queue = commandQueue;
  commandQueue = [];
  for (const cmd of queue) cmd();
}

function runOrQueue(cmd: () => void) {
  if (controller && controllerReady) cmd();
  else commandQueue.push(cmd);
}

async function ensureController(initialTrackId: string) {
  if (controller || creatingController) return;
  creatingController = true;

  const api = await loadIframeApi();
  const host = ensureHost();
  // createController replaces this element with the iframe
  const slot = document.createElement("div");
  host.appendChild(slot);

  api.createController(
    slot,
    { uri: `spotify:track:${initialTrackId}`, width: 300, height: 80 },
    (ctrl) => {
      controller = ctrl;
      ctrl.addListener("ready", () => {
        controllerReady = true;
        flushQueue();
      });
      ctrl.addListener("playback_update", (e) => {
        if (!e) return;
        emit({
          trackId: currentTrackId,
          isPaused: e.data.isPaused,
          isBuffering: e.data.isBuffering,
          position: e.data.position,
          duration: e.data.duration,
        });
      });
    },
  );
}

function playTrack(trackId: string) {
  currentTrackId = trackId;
  // optimistic UI; real state arrives via playback_update
  emit({ trackId, isPaused: false, isBuffering: true, position: 0, duration: 0 });

  if (!controller) {
    void ensureController(trackId);
  }
  runOrQueue(() => {
    // read currentTrackId at flush time — the user may have clicked another
    // card while the controller was still initializing
    const id = currentTrackId;
    if (!id || !controller) return;
    controller.loadUri(`spotify:track:${id}`);
    controller.play();
  });
}

function togglePlay() {
  runOrQueue(() => controller?.togglePlay());
}

// ── React hook: subscribe to the singleton ─────────────────────────────────

export function useSpotifyEmbed() {
  const [playback, setPlayback] = useState<EmbedPlayback>(playbackState);

  useEffect(() => {
    subscribers.add(setPlayback);
    setPlayback(playbackState);
    return () => {
      subscribers.delete(setPlayback);
    };
  }, []);

  return { playback, playTrack, togglePlay };
}

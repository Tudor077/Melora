import { useState } from "react";
import type { SpotifyPlan } from "@melora/core";

const DISMISSED_KEY = "melora:free-notice-dismissed";

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Says out loud what Spotify's embed would otherwise let people discover by
 * confusion: on a free account the in-app player gives 30 seconds, and the
 * Spotify button on each track gives the whole song. Shown once, then never
 * again — and never for Premium, nor when the plan could not be read.
 */
export function FreePlanNotice({ plan }: { plan: SpotifyPlan }) {
  const [dismissed, setDismissed] = useState(wasDismissed);

  if (plan !== "free" || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* private mode: it reappears next launch, which is survivable */
    }
  };

  return (
    <div className="free-note" role="note">
      <p>
        You're on a free Spotify account, so the player here previews 30 seconds of each
        track. Everything else works — hearts, filters, playlists. Tap the Spotify button on
        a track to play it in full.
      </p>
      <button className="free-note-close" onClick={dismiss} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}

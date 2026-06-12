import { useEffect, useRef, useState } from "react";
import type { EnrichedTrack } from "@melora/core";

interface BottomPlayerProps {
  entry: EnrichedTrack | null;
  playerKey?: number;
  onStop: () => void;
}

export function BottomPlayer({ entry, playerKey: externalKey = 0, onStop }: BottomPlayerProps) {
  const [visible, setVisible] = useState(false);
  const [embedKey, setEmbedKey] = useState(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const track = entry?.track ?? null;

  useEffect(() => {
    if (!track) { setVisible(false); return; }
    setEmbedKey((k) => k + 1);
    setVisible(true);
    scheduleHide();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, externalKey]);

  const scheduleHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), 5000);
  };

  if (!entry || !track) return null;

  const src = `https://open.spotify.com/embed/track/${track.id}?utm_source=generator&theme=0&autoplay=1`;

  return (
    <div className={`bottom-player ${visible ? "bp-visible" : ""}`} onMouseEnter={() => { setVisible(true); if (hideTimer.current) clearTimeout(hideTimer.current); }} onMouseLeave={scheduleHide}>
      <button className="bp-stop-btn" onClick={onStop} title="Stop">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <rect x="4" y="4" width="16" height="16" rx="2"/>
        </svg>
      </button>
      <div className="bp-inner">
        <iframe
          key={embedKey}
          src={src}
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          title={track.name}
          className="bp-embed"
        />
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";

// Mobile = the Android Tauri build, or any narrow/touch viewport (so the
// swipe feed is also reachable in a phone-sized browser during dev).
const IS_ANDROID = import.meta.env.TAURI_ENV_PLATFORM === "android";

function check(): boolean {
  if (IS_ANDROID) return true;
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 720px)").matches;
}

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(check);

  useEffect(() => {
    if (IS_ANDROID) return;
    const mq = window.matchMedia("(max-width: 720px)");
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

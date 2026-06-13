import { useState } from "react";

const IS_TAURI = Boolean(import.meta.env.TAURI_ENV_PLATFORM);
const DASHBOARD_URL = "https://developer.spotify.com/dashboard";
const REDIRECT_URI = "melora://callback";

async function openExternal(url: string) {
  if (IS_TAURI) {
    try {
      const { openUrl } = await import(/* @vite-ignore */ "@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    } catch {
      /* fall through to anchor */
    }
  }
  window.open(url, "_blank", "noopener");
}

/**
 * First-run setup for distributed builds: the user pastes the Client ID of
 * their own free Spotify app. This avoids the 25-user Development-mode
 * allowlist — everyone runs against an app they own.
 */
export function SpotifySetup({ onSave }: { onSave: (id: string) => void }) {
  const [value, setValue] = useState("");
  const trimmed = value.trim();
  // Spotify client IDs are 32 hex chars.
  const looksValid = /^[0-9a-f]{32}$/i.test(trimmed);

  return (
    <div className="page landing">
      <div className="hero setup-hero">
        <img className="brand-logo" src="/melora-logo.png" alt="Melora" />
        <p className="eyebrow">One-time setup</p>
        <h1>Connect your own Spotify app</h1>
        <p className="lede">
          Melora runs on your own free Spotify app, so there are no account limits.
          It takes about two minutes — you only do this once.
        </p>

        <ol className="setup-steps">
          <li>
            Open the{" "}
            <button className="link-btn" onClick={() => openExternal(DASHBOARD_URL)}>
              Spotify Developer Dashboard
            </button>{" "}
            and click <strong>Create app</strong>.
          </li>
          <li>
            Give it any name. Add this <strong>Redirect URI</strong>:
            <code className="copy-field">{REDIRECT_URI}</code>
            and tick <strong>Web API</strong>, then save.
          </li>
          <li>
            Open the app's <strong>Settings</strong>, copy its <strong>Client ID</strong>,
            and paste it below.
          </li>
        </ol>

        <form
          className="setup-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (looksValid) onSave(trimmed);
          }}
        >
          <input
            className="setup-input"
            placeholder="Paste your Spotify Client ID"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <button className="primary" type="submit" disabled={!looksValid}>
            Save &amp; continue
          </button>
        </form>
        {trimmed.length > 0 && !looksValid && (
          <p className="setup-hint">A Client ID is 32 letters/numbers — check you copied the whole thing.</p>
        )}
      </div>
    </div>
  );
}

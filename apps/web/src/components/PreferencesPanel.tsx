import { useState } from "react";
import type { DiscoveryPreferences } from "@melora/core";

const ADVENTURE_LEVELS: Array<{ label: string; value: number }> = [
  { label: "Safe", value: 0.15 },
  { label: "Balanced", value: 0.4 },
  { label: "Adventurous", value: 0.85 },
];

const ERAS: Array<{ id: "new" | "mixed" | "classics"; label: string }> = [
  { id: "new", label: "New releases" },
  { id: "mixed", label: "Mixed" },
  { id: "classics", label: "My era" },
];

const MAX_SELECTED_GENRES = 6;

interface PreferencesPanelProps {
  preferences: DiscoveryPreferences;
  onChange: (next: DiscoveryPreferences) => void;
  /** Genres worth offering as chips (session genres, pinned, defaults). */
  genreSuggestions: string[];
}

/**
 * The "what do I want to hear" panel. Everything here feeds straight into
 * which searches the next batch runs — selected genres take most of the
 * genre-wave slots, adventurousness widens the sampling, era shifts years.
 */
export function PreferencesPanel({ preferences, onChange, genreSuggestions }: PreferencesPanelProps) {
  const [customGenre, setCustomGenre] = useState("");
  const selected = preferences.genres;
  // Selected chips always stay visible, even if the suggestion list rotates.
  const options = [...new Set([...selected, ...genreSuggestions])].slice(0, 16);
  const adventure = preferences.adventurousness ?? 0.4;
  const era = preferences.era ?? "mixed";

  const toggleGenre = (genre: string) => {
    const next = selected.includes(genre)
      ? selected.filter((g) => g !== genre)
      : [...selected, genre].slice(0, MAX_SELECTED_GENRES);
    onChange({ ...preferences, genres: next });
  };

  const addCustom = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    const clean = customGenre.trim().toLowerCase();
    setCustomGenre("");
    if (!clean || selected.includes(clean)) return;
    onChange({ ...preferences, genres: [...selected, clean].slice(0, MAX_SELECTED_GENRES) });
  };

  return (
    <div className="prefs-panel">
      <div className="prefs-section">
        <p className="prefs-label">Focus on these genres</p>
        <div className="chip-row">
          {options.map((genre) => (
            <button
              key={genre}
              className={`chip ${selected.includes(genre) ? "active" : ""}`}
              onClick={() => toggleGenre(genre)}
            >
              {genre}
            </button>
          ))}
        </div>
        <form className="prefs-add" onSubmit={addCustom}>
          <input
            className="prefs-input"
            placeholder="Add any genre…"
            value={customGenre}
            onChange={(e) => setCustomGenre(e.target.value)}
          />
          <button className="ghost" type="submit">
            Add
          </button>
        </form>
      </div>

      <div className="prefs-section">
        <p className="prefs-label">Adventurousness</p>
        <div className="chip-row">
          {ADVENTURE_LEVELS.map((level) => (
            <button
              key={level.label}
              className={`chip ${Math.abs(adventure - level.value) < 0.15 ? "active" : ""}`}
              onClick={() => onChange({ ...preferences, adventurousness: level.value })}
            >
              {level.label}
            </button>
          ))}
        </div>
      </div>

      <div className="prefs-section">
        <p className="prefs-label">Era</p>
        <div className="chip-row">
          {ERAS.map((option) => (
            <button
              key={option.id}
              className={`chip ${era === option.id ? "active" : ""}`}
              onClick={() => onChange({ ...preferences, era: option.id })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <p className="prefs-note">Applies on the next refresh.</p>
    </div>
  );
}

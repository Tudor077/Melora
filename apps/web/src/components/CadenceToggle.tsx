import type { DiscoveryCadence } from "@melora/core";

interface CadenceToggleProps {
  cadence: DiscoveryCadence;
  onChange: (cadence: DiscoveryCadence) => void;
}

export function CadenceToggle({ cadence, onChange }: CadenceToggleProps) {
  return (
    <div className="cadence-toggle" role="tablist" aria-label="Discovery cadence">
      <button
        role="tab"
        aria-selected={cadence === "hourly"}
        className={cadence === "hourly" ? "active" : ""}
        onClick={() => onChange("hourly")}
      >
        Hourly
      </button>
      <button
        role="tab"
        aria-selected={cadence === "daily"}
        className={cadence === "daily" ? "active" : ""}
        onClick={() => onChange("daily")}
      >
        Daily
      </button>
    </div>
  );
}

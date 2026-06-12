import type { DiscoveryFilters, SortField, VibeProfile } from "@melora/core";

interface FilterBarProps {
  sortField: SortField;
  sortDirection: "asc" | "desc";
  sortOptions: Array<{ field: SortField; label: string }>;
  filters: DiscoveryFilters;
  vibes: VibeProfile[];
  onSortFieldChange: (field: SortField) => void;
  onSortDirectionChange: (direction: "asc" | "desc") => void;
  onFiltersChange: (filters: DiscoveryFilters) => void;
}

export function FilterBar({
  sortField,
  sortDirection,
  sortOptions,
  filters,
  vibes,
  onSortFieldChange,
  onSortDirectionChange,
  onFiltersChange,
}: FilterBarProps) {
  const toggleVibe = (id: string) => {
    const current = filters.vibes ?? [];
    const next = current.includes(id) ? current.filter((v) => v !== id) : [...current, id];
    onFiltersChange({ ...filters, vibes: next.length ? next : undefined });
  };

  return (
    <section className="filter-bar">
      <div className="filter-group">
        <label htmlFor="sort-field">Sort by</label>
        <div className="inline-controls">
          <select
            id="sort-field"
            value={sortField}
            onChange={(e) => onSortFieldChange(e.target.value as SortField)}
          >
            {sortOptions.map((o) => (
              <option key={o.field} value={o.field}>{o.label}</option>
            ))}
          </select>
          <button
            className="ghost"
            onClick={() => onSortDirectionChange(sortDirection === "asc" ? "desc" : "asc")}
          >
            {sortDirection === "asc" ? "↑ Asc" : "↓ Desc"}
          </button>
        </div>
      </div>

      <div className="filter-group wide">
        <span className="label">Vibe</span>
        <div className="chip-row">
          {vibes.map((vibe) => (
            <button
              key={vibe.id}
              className={`chip ${filters.vibes?.includes(vibe.id) ? "active" : ""}`}
              onClick={() => toggleVibe(vibe.id)}
            >
              {vibe.emoji} {vibe.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

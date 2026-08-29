import { tierFor } from "../generator/tiers";
import type { ActiveQuest } from "../state/store";

interface Props {
  active: ActiveQuest;
  /** Milliseconds left; negative once the timer has run out. */
  remaining: number;
  onComplete: () => void;
  onAbandon: () => void;
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function ActiveQuestPanel({ active, remaining, onComplete, onAbandon }: Props) {
  const { quest } = active;
  const tier = tierFor(quest.stupidity);
  const expired = remaining <= 0;
  const total = quest.minutes * 60_000;
  const progress = Math.max(0, Math.min(1, remaining / total));
  // Late is still done — it just pays half, so nobody is punished for a queue.
  const payout = expired ? Math.round(quest.points / 2) : quest.points;

  return (
    <article className="card card--active" style={{ ["--accent" as string]: tier.accent }}>
      <header className="card__head">
        <span className="card__tier">În desfășurare</span>
        <span className={expired ? "clock clock--over" : "clock"}>
          {expired ? `+${formatClock(-remaining)}` : formatClock(remaining)}
        </span>
      </header>

      <div className="timerbar" aria-hidden="true">
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>

      <h1 className="card__title">{quest.title}</h1>
      <p className="card__action">{quest.action}</p>

      {quest.twists.length > 0 && (
        <ul className="card__twists">
          {quest.twists.map((twist) => (
            <li key={twist}>{twist}</li>
          ))}
        </ul>
      )}

      <p className="card__proof">
        <span className="card__proof-label">Dovadă</span>
        {quest.proof}
      </p>

      {expired && <p className="card__warn">Timpul a expirat. Mai poți preda, dar pe jumătate de puncte.</p>}

      <div className="card__actions">
        <button type="button" className="btn btn--ghost" onClick={onAbandon}>
          Renunț
        </button>
        <button type="button" className="btn btn--primary" onClick={onComplete}>
          Gata · +{payout}p
        </button>
      </div>
    </article>
  );
}

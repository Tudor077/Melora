import { sceneMeta } from "../generator/scenes";
import { TIERS } from "../generator/tiers";
import { levelFor, rankFor, type LogEntry } from "../state/store";

interface Props {
  xp: number;
  log: LogEntry[];
  onClose: () => void;
  onClear: () => void;
}

function formatDate(at: number): string {
  return new Date(at).toLocaleDateString("ro-RO", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function Journal({ xp, log, onClose, onClear }: Props) {
  const { level, into, needed } = levelFor(xp);
  const done = log.filter((entry) => entry.status === "done");
  const boldest = done.reduce<LogEntry | null>(
    (best, entry) => (!best || entry.stupidity > best.stupidity ? entry : best),
    null,
  );

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Jurnal">
      <div className="sheet__panel">
        <header className="sheet__head">
          <h2>Jurnal</h2>
          <button type="button" className="btn btn--icon" onClick={onClose} aria-label="Închide">
            ✕
          </button>
        </header>

        <div className="level">
          <p className="level__rank">
            Nivel {level} · {rankFor(level)}
          </p>
          <div className="level__bar" aria-hidden="true">
            <span style={{ transform: `scaleX(${Math.min(1, into / needed)})` }} />
          </div>
          <p className="level__xp">
            {xp} puncte · {needed - into} până la nivelul {level + 1}
          </p>
        </div>

        <dl className="tally">
          <div>
            <dt>Terminate</dt>
            <dd>{done.length}</dd>
          </div>
          <div>
            <dt>Abandonate</dt>
            <dd>{log.length - done.length}</dd>
          </div>
          <div>
            <dt>Record prostie</dt>
            <dd>{boldest ? `${boldest.stupidity}` : "—"}</dd>
          </div>
        </dl>

        {log.length === 0 ? (
          <p className="empty">Nimic încă. Trage de prostimetru și acceptă ceva.</p>
        ) : (
          <ol className="history">
            {log.map((entry) => (
              <li
                key={entry.id + entry.at}
                className={entry.status === "done" ? "history__item" : "history__item history__item--out"}
                style={{
                  ["--accent" as string]:
                    TIERS[Math.min(TIERS.length - 1, Math.floor(entry.stupidity / 20))].accent,
                }}
              >
                <div className="history__top">
                  <strong>{entry.title}</strong>
                  <span>{entry.status === "done" ? `+${entry.points}p` : "abandon"}</span>
                </div>
                <p className="history__brief">{entry.brief}</p>
                <p className="history__meta">
                  {sceneMeta(entry.scene).emoji} · prostie {entry.stupidity} · {formatDate(entry.at)} ·{" "}
                  {entry.code}
                </p>
              </li>
            ))}
          </ol>
        )}

        {log.length > 0 && (
          <button type="button" className="btn btn--danger" onClick={onClear}>
            Șterge jurnalul
          </button>
        )}
      </div>
    </div>
  );
}

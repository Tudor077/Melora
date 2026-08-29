import { tierFor } from "../generator/tiers";
import { sceneMeta } from "../generator/scenes";
import type { Quest } from "../generator/types";

interface Props {
  quest: Quest;
  /** Rerolls animate, so the card knows when to replay its entrance. */
  animationKey: number;
  onReroll: () => void;
  onAccept: () => void;
  onShare: () => void;
}

export function QuestCard({ quest, animationKey, onReroll, onAccept, onShare }: Props) {
  const tier = tierFor(quest.stupidity);
  const scene = sceneMeta(quest.scene);

  return (
    <article
      key={animationKey}
      className="card card--enter"
      style={{ ["--accent" as string]: tier.accent }}
    >
      <header className="card__head">
        <span className="card__tier">
          <span aria-hidden="true">{tier.emoji}</span> {tier.name}
        </span>
        <span className="card__code">{quest.code}</span>
      </header>

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

      <dl className="card__meta">
        <div>
          <dt>Puncte</dt>
          <dd>{quest.points}</dd>
        </div>
        <div>
          <dt>Timp</dt>
          <dd>{quest.minutes} min</dd>
        </div>
        <div>
          <dt>Loc</dt>
          <dd>
            <span aria-hidden="true">{scene.emoji}</span> {scene.label}
          </dd>
        </div>
      </dl>

      <div className="card__actions">
        <button type="button" className="btn btn--ghost" onClick={onReroll}>
          Alta
        </button>
        <button type="button" className="btn btn--primary" onClick={onAccept}>
          Accept misiunea
        </button>
        <button type="button" className="btn btn--icon" onClick={onShare} aria-label="Trimite misiunea">
          ↗
        </button>
      </div>
    </article>
  );
}

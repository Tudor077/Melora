import { TIERS, tierFor } from "../generator/tiers";

interface Props {
  value: number;
  onChange: (value: number) => void;
}

/** The one control the whole app is built around. */
export function StupiditySlider({ value, onChange }: Props) {
  const tier = tierFor(value);

  return (
    <section className="slider" aria-label="Prostimetru">
      <header className="slider__head">
        <div>
          <p className="slider__label">Prostimetru</p>
          <p className="slider__tier">
            <span aria-hidden="true">{tier.emoji}</span> {tier.name}
          </p>
        </div>
        <output className="slider__value" style={{ color: tier.accent }}>
          {value}
        </output>
      </header>

      <input
        className="slider__input"
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label="Nivel de prostie"
        aria-valuetext={`${value} din 100, ${tier.name}`}
        style={{ accentColor: tier.accent }}
      />

      <div className="slider__ticks" aria-hidden="true">
        {TIERS.map((t) => (
          <span
            key={t.index}
            className={t.index === tier.index ? "tick tick--on" : "tick"}
            style={t.index === tier.index ? { background: t.accent } : undefined}
          />
        ))}
      </div>

      <p className="slider__blurb">{tier.blurb}</p>
    </section>
  );
}

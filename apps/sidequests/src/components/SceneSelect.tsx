import { SCENES } from "../generator/scenes";
import type { Scene } from "../generator/types";

interface Props {
  value: Scene;
  onChange: (scene: Scene) => void;
}

export function SceneSelect({ value, onChange }: Props) {
  return (
    <section className="scenes" aria-label="Unde ești">
      <p className="scenes__label">Unde ești</p>
      <div className="scenes__row">
        {SCENES.map((scene) => (
          <button
            key={scene.id}
            type="button"
            className={scene.id === value ? "chip chip--on" : "chip"}
            aria-pressed={scene.id === value}
            onClick={() => onChange(scene.id)}
          >
            <span aria-hidden="true">{scene.emoji}</span> {scene.label}
          </button>
        ))}
      </div>
    </section>
  );
}

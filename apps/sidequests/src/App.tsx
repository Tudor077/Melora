import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { generateQuest } from "./generator/generate";
import { codeToSeed, randomSeed } from "./generator/rng";
import { countCombinations, formatCount } from "./generator/stats";
import { tierFor } from "./generator/tiers";
import type { Quest, Scene } from "./generator/types";
import { ActiveQuestPanel } from "./components/ActiveQuestPanel";
import { Journal } from "./components/Journal";
import { QuestCard } from "./components/QuestCard";
import { SceneSelect } from "./components/SceneSelect";
import { StupiditySlider } from "./components/StupiditySlider";
import { levelFor, loadState, rankFor, saveState, type LogEntry } from "./state/store";

/** Two quests are "the same" when they ask the same thing, whatever the seed. */
function signatureOf(quest: Quest): string {
  return quest.action;
}

function buzz(pattern: number | number[]): void {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(pattern);
}

export default function App() {
  const [state, setState] = useState(loadState);
  const [seed, setSeed] = useState(randomSeed);
  const [animationKey, setAnimationKey] = useState(0);
  const [journalOpen, setJournalOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const toastTimer = useRef<number | undefined>(undefined);

  const { stupidity, scene, active } = state;

  useEffect(() => saveState(state), [state]);

  // One ticking clock for the whole app, and only while something is running.
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    setNow(Date.now());
    return () => window.clearInterval(id);
  }, [active]);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const say = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const quest = useMemo(
    () => generateQuest({ seed, stupidity, scene }),
    [seed, stupidity, scene],
  );

  const combinations = useMemo(() => countCombinations(stupidity, scene), [stupidity, scene]);

  const reroll = useCallback(() => {
    // The pools are big, but at low stupidity they are not infinite; try a few
    // seeds to dodge a recent repeat, then accept whatever comes out rather
    // than spinning forever.
    const recent = new Set(state.seen.slice(-60));
    let next = randomSeed();
    for (let attempt = 0; attempt < 12; attempt++) {
      const candidate = randomSeed();
      if (!recent.has(signatureOf(generateQuest({ seed: candidate, stupidity, scene })))) {
        next = candidate;
        break;
      }
      next = candidate;
    }
    setSeed(next);
    setAnimationKey((key) => key + 1);
    buzz(12);
  }, [state.seen, stupidity, scene]);

  // Remember what was shown, so the anti-repeat guard has something to work with.
  useEffect(() => {
    const signature = signatureOf(quest);
    setState((prev) =>
      prev.seen[prev.seen.length - 1] === signature
        ? prev
        : { ...prev, seen: [...prev.seen, signature].slice(-400) },
    );
  }, [quest]);

  const accept = useCallback(() => {
    setState((prev) => ({ ...prev, active: { quest, startedAt: Date.now() } }));
    setNow(Date.now());
    buzz([18, 40, 18]);
  }, [quest]);

  const finish = useCallback(
    (status: LogEntry["status"]) => {
      setState((prev) => {
        if (!prev.active) return prev;
        const { quest: done, startedAt } = prev.active;
        const expired = Date.now() - startedAt > done.minutes * 60_000;
        const points = status === "done" ? (expired ? Math.round(done.points / 2) : done.points) : 0;
        const entry: LogEntry = {
          id: done.id,
          code: done.code,
          title: done.title,
          brief: done.brief,
          points,
          stupidity: done.stupidity,
          scene: done.scene,
          at: Date.now(),
          status,
        };
        return { ...prev, xp: prev.xp + points, active: null, log: [entry, ...prev.log].slice(0, 200) };
      });
      if (status === "done") {
        buzz([25, 50, 25, 50, 60]);
        say("Bravo. Notat în jurnal.");
      } else {
        say("Misiune abandonată.");
      }
      setSeed(randomSeed());
      setAnimationKey((key) => key + 1);
    },
    [say],
  );

  const share = useCallback(async () => {
    const text = `${quest.title} (prostie ${quest.stupidity}, cod ${quest.code})\n\n${quest.brief}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Sidequest", text });
        return;
      }
      await navigator.clipboard.writeText(text);
      say("Copiat. Trimite-l cui vrei.");
    } catch {
      // Cancelled share or a browser without clipboard permission — nothing to do.
    }
  }, [quest, say]);

  const openByCode = useCallback(() => {
    const input = window.prompt("Cod misiune (ex. K7QX-2MF):");
    if (!input) return;
    setSeed(codeToSeed(input));
    setAnimationKey((key) => key + 1);
    say("Misiune încărcată din cod.");
  }, [say]);

  const clearLog = useCallback(() => {
    if (!window.confirm("Ștergi tot jurnalul și punctele?")) return;
    setState((prev) => ({ ...prev, xp: 0, log: [] }));
  }, []);

  const tier = tierFor(stupidity);
  const { level } = levelFor(state.xp);
  const remaining = active ? active.quest.minutes * 60_000 - (now - active.startedAt) : 0;

  return (
    <div className="app" style={{ ["--accent" as string]: tier.accent }}>
      <div className="glow" aria-hidden="true" />

      <header className="topbar">
        <div>
          <p className="topbar__brand">Sidequest</p>
          <p className="topbar__sub">
            Nivel {level} · {rankFor(level)}
          </p>
        </div>
        <div className="topbar__right">
          <button type="button" className="btn btn--icon" onClick={openByCode} aria-label="Deschide după cod">
            #
          </button>
          <button type="button" className="btn btn--pill" onClick={() => setJournalOpen(true)}>
            {state.xp}p
          </button>
        </div>
      </header>

      <main className="main">
        {active ? (
          <ActiveQuestPanel
            active={active}
            remaining={remaining}
            onComplete={() => finish("done")}
            onAbandon={() => finish("abandoned")}
          />
        ) : (
          <>
            <QuestCard
              quest={quest}
              animationKey={animationKey}
              onReroll={reroll}
              onAccept={accept}
              onShare={share}
            />
            <StupiditySlider
              value={stupidity}
              onChange={(value) => setState((prev) => ({ ...prev, stupidity: value }))}
            />
            <SceneSelect
              value={scene}
              onChange={(next: Scene) => setState((prev) => ({ ...prev, scene: next }))}
            />
            <p className="count">
              {formatCount(combinations)} de misiuni posibile la setările astea. Totul se
              generează pe telefon, fără internet.
            </p>
          </>
        )}
      </main>

      {journalOpen && (
        <Journal
          xp={state.xp}
          log={state.log}
          onClose={() => setJournalOpen(false)}
          onClear={clearLog}
        />
      )}

      {toast && <p className="toast">{toast}</p>}
    </div>
  );
}

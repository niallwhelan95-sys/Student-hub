import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, X } from "lucide-react";
import { Button, IconButton } from "./ui";

const PRESETS = [10, 25, 45];

/** Optional, low-key focus timer. Ends with a gentle notification, never an alarm. */
export function FocusTimer({ onClose }: { onClose: () => void }) {
  const [minutes, setMinutes] = useState(25);
  const [remaining, setRemaining] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const endAt = useRef<number | null>(null);

  useEffect(() => {
    if (!running) return;
    endAt.current = Date.now() + remaining * 1000;
    const t = setInterval(() => {
      const left = Math.max(0, Math.round((endAt.current! - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) {
        setRunning(false);
        if ("Notification" in window && Notification.permission === "granted") new Notification("Focus session done", { body: "Nice work. Take a short break." });
        document.title = "✓ Session done — Margin";
        setTimeout(() => (document.title = "Margin"), 8000);
      }
    }, 500);
    return () => clearInterval(t);
  }, [running]); // `remaining` is read once when (re)starting; the interval tracks endAt from then on.

  const pick = (m: number) => {
    setMinutes(m);
    setRemaining(m * 60);
    setRunning(false);
  };

  const mm = Math.floor(remaining / 60);
  const ss = String(remaining % 60).padStart(2, "0");
  const pct = 1 - remaining / (minutes * 60);

  return (
    <div className="mb-2 rounded-xl border border-line bg-surface p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted">Focus session</span>
        <IconButton label="Close timer" size="sm" onClick={onClose}>
          <X className="size-3.5" />
        </IconButton>
      </div>
      <div className="my-1 text-center font-display text-3xl font-semibold tabular-nums" aria-live="off">
        {mm}:{ss}
      </div>
      <div className="mb-2.5 h-1 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full bg-accent transition-[width]" style={{ width: `${pct * 100}%` }} />
      </div>
      <div className="flex items-center gap-1.5">
        {PRESETS.map((m) => (
          <button key={m} onClick={() => pick(m)} className={`rounded-md px-2 py-1 text-xs ${m === minutes ? "bg-accent-soft text-accent-text" : "text-muted hover:bg-surface-2"}`}>
            {m}m
          </button>
        ))}
        <span className="flex-1" />
        <IconButton label="Reset" size="sm" onClick={() => pick(minutes)}>
          <RotateCcw className="size-3.5" />
        </IconButton>
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            if (!running && "Notification" in window && Notification.permission === "default") void Notification.requestPermission();
            setRunning((r) => !r);
          }}
          icon={running ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        >
          {running ? "Pause" : "Start"}
        </Button>
      </div>
    </div>
  );
}

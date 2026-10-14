import { Mic, Square, X, RotateCcw, AlertCircle } from "lucide-react";
import { formatElapsed, type useDictation } from "../hooks/useDictation";
import { Button, IconButton, cx, Spinner } from "./ui";

type D = ReturnType<typeof useDictation>;

export function DictateButton({ d, size = "md" }: { d: D; size?: "sm" | "md" }) {
  const recording = d.state === "recording";
  const busy = d.state === "requesting" || d.state === "transcribing";
  const unsupported = d.mode === "unsupported";
  return (
    <IconButton
      label={unsupported ? "Voice dictation isn't supported in this browser" : recording ? "Stop dictation" : "Dictate (speak instead of typing)"}
      size={size}
      onClick={() => (recording ? d.stop() : d.start())}
      disabled={busy || unsupported}
      className={cx(recording && "bg-danger-soft text-danger hover:bg-danger-soft hover:text-danger")}
    >
      {recording ? <Square className="size-4 fill-current" /> : busy ? <Spinner /> : <Mic className="size-[1.15rem]" />}
    </IconButton>
  );
}

/** Live recording strip: what's happening, how long, input level, and clear stop/cancel controls. */
export function DictationStatus({ d, interim }: { d: D; interim?: string }) {
  if (d.state === "recording") {
    const bars = 14;
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-danger/30 bg-danger-soft/60 px-3 py-2 text-sm" role="status" aria-live="polite">
        <span className="recording-dot size-2.5 rounded-full bg-danger" aria-hidden />
        <span className="font-medium text-danger">Listening</span>
        <span className="tabular-nums text-muted">{formatElapsed(d.elapsed)}</span>
        {d.mode === "server" && (
          <span className="flex h-4 items-end gap-[2px]" aria-hidden>
            {Array.from({ length: bars }, (_, i) => (
              <span
                key={i}
                className="w-[3px] rounded-full bg-danger/70 transition-[height] duration-75"
                style={{ height: `${Math.max(12, Math.min(100, d.level * 100 * (0.6 + 0.4 * Math.sin((i + 1) * 1.7))))}%` }}
              />
            ))}
          </span>
        )}
        {interim && <span className="min-w-0 flex-1 truncate italic text-muted">{interim}</span>}
        <span className="ml-auto flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={d.cancel} icon={<X className="size-3.5" />}>
            Discard
          </Button>
          <Button size="sm" variant="primary" onClick={d.stop} icon={<Square className="size-3 fill-current" />}>
            Done
          </Button>
        </span>
      </div>
    );
  }
  if (d.state === "requesting") return <p className="px-1 text-sm text-muted">Waiting for microphone permission…</p>;
  if (d.state === "transcribing")
    return (
      <p className="flex items-center gap-2 px-1 text-sm text-muted" role="status">
        <Spinner /> Transcribing your recording…
      </p>
    );
  if (d.error)
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn" role="alert">
        <AlertCircle className="size-4 shrink-0" />
        <span className="flex-1">{d.error}</span>
        {d.state === "failed" && (
          <Button size="sm" variant="secondary" onClick={d.retry} icon={<RotateCcw className="size-3.5" />}>
            Retry
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={d.state === "failed" ? d.cancel : d.clearError}>
          Dismiss
        </Button>
      </div>
    );
  return null;
}

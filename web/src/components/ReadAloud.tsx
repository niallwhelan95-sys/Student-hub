import { useEffect, useRef, useState } from "react";
import { Pause, Play, Square, Volume2 } from "lucide-react";
import { getPrefs, setPrefs, usePrefs } from "../lib/prefs";
import { pauseSpeaking, resumeSpeaking, setSpeechPrefsGetter, speak, speechSupported, stopSpeaking, useSpeech } from "../lib/speech";
import { IconButton, cx } from "./ui";

setSpeechPrefsGetter(() => ({ rate: getPrefs().ttsRate, voiceURI: getPrefs().ttsVoice }));

type Sel = { text: string; x: number; y: number };

/** Selected text from the page, or from the focused textarea/input (e.g. the message composer). */
function readSelection(): Sel | null {
  const el = document.activeElement;
  if ((el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type === "text")) && el.selectionStart !== el.selectionEnd) {
    const text = el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0).trim();
    if (text.length < 2) return null;
    const r = el.getBoundingClientRect();
    return { text, x: r.left + r.width / 2, y: r.top };
  }
  const s = window.getSelection();
  if (!s || s.isCollapsed || s.rangeCount === 0) return null;
  const text = s.toString().trim();
  if (text.length < 2) return null;
  // Ignore selections inside the player/popover itself.
  const node = s.anchorNode instanceof Element ? s.anchorNode : s.anchorNode?.parentElement;
  if (node?.closest("[data-readaloud-ui]")) return null;
  const rect = s.getRangeAt(0).getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  return { text, x: rect.left + rect.width / 2, y: rect.top };
}

/**
 * Mounted once in the app shell. Highlight any text (a message, your own draft, a document)
 * and a "Listen" button appears next to it; while reading, a compact player offers pause,
 * stop and speed. Everything runs in the browser.
 */
export function ReadAloud() {
  const [sel, setSel] = useState<Sel | null>(null);
  const speech = useSpeech();
  const [prefs] = usePrefs();
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!speechSupported()) return;
    const update = () => {
      if (timer.current) window.clearTimeout(timer.current);
      // Debounced so the button doesn't flicker while a selection is still being dragged.
      timer.current = window.setTimeout(() => setSel(readSelection()), 180);
    };
    const hide = () => setSel(null);
    document.addEventListener("selectionchange", update);
    document.addEventListener("keyup", update);
    document.addEventListener("mouseup", update);
    document.addEventListener("touchend", update);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("selectionchange", update);
      document.removeEventListener("keyup", update);
      document.removeEventListener("mouseup", update);
      document.removeEventListener("touchend", update);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, []);

  if (!speechSupported()) return null;
  const active = speech.status !== "idle";

  const left = sel ? Math.min(Math.max(sel.x, 70), window.innerWidth - 70) : 0;
  const top = sel ? (sel.y > 56 ? sel.y - 46 : sel.y + 28) : 0;

  return (
    <>
      {sel && (
        <div
          data-readaloud-ui
          className="fixed z-50 -translate-x-1/2"
          style={{ left, top }}
          // Keep the text selected when the button is pressed.
          onMouseDown={(e) => e.preventDefault()}
          onPointerDown={(e) => e.preventDefault()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              speak(sel.text);
              setSel(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-2 text-sm font-medium text-bg shadow-lg hover:opacity-90"
            aria-label="Read the selected text aloud"
          >
            <Volume2 className="size-4" /> Listen
          </button>
        </div>
      )}

      {active && (
        <div
          data-readaloud-ui
          role="region"
          aria-label="Read aloud controls"
          className="fixed inset-x-3 bottom-24 z-50 mx-auto flex max-w-md items-center gap-2 rounded-2xl border border-line bg-surface p-2 pl-3 shadow-soft sm:bottom-6"
        >
          <Volume2 className={cx("size-4 shrink-0 text-accent", speech.status === "speaking" && "recording-dot")} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{speech.text.replace(/\s+/g, " ").slice(0, 80)}</p>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-3" aria-hidden>
              <div className="h-full bg-accent transition-[width]" style={{ width: `${((speech.index + 1) / Math.max(speech.total, 1)) * 100}%` }} />
            </div>
          </div>
          <label className="sr-only" htmlFor="tts-rate">
            Reading speed
          </label>
          <select
            id="tts-rate"
            value={prefs.ttsRate}
            onChange={(e) => {
              setPrefs({ ttsRate: Number(e.target.value) });
              // Speed applies to the next sentence; restart from the current text for an immediate change.
              if (speech.status === "speaking") speak(speech.text);
            }}
            className="h-9 rounded-lg border border-line bg-surface px-1.5 text-xs"
          >
            {[0.7, 0.85, 1, 1.15, 1.3, 1.5].map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
          <IconButton label={speech.status === "paused" ? "Resume" : "Pause"} onClick={speech.status === "paused" ? resumeSpeaking : pauseSpeaking}>
            {speech.status === "paused" ? <Play className="size-4" /> : <Pause className="size-4" />}
          </IconButton>
          <IconButton label="Stop reading" onClick={stopSpeaking}>
            <Square className="size-4 fill-current" />
          </IconButton>
        </div>
      )}
    </>
  );
}

/** Small speaker button for a whole message (or the highlighted part of it). */
export function ListenButton({ getText, size = "sm" }: { getText: () => string; size?: "sm" | "md" }) {
  const speech = useSpeech();
  if (!speechSupported()) return null;
  const mine = speech.status !== "idle";
  return (
    <IconButton
      label={mine ? "Stop reading aloud" : "Read aloud (select text first to hear just that part)"}
      size={size}
      active={mine}
      onClick={() => (mine ? stopSpeaking() : speak(getText()))}
    >
      <Volume2 className="size-3.5" />
    </IconButton>
  );
}

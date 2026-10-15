import { useEffect, useState } from "react";

/**
 * Read-aloud using the browser's built-in speech synthesis: free, private (nothing is sent to
 * a server) and works offline on most devices. A single shared controller means only one thing
 * is ever read at a time, and every "Listen" control reflects the same state.
 */
export type SpeechState = { status: "idle" | "speaking" | "paused"; text: string; index: number; total: number };

const idle: SpeechState = { status: "idle", text: "", index: 0, total: 0 };
let state: SpeechState = idle;
const listeners = new Set<(s: SpeechState) => void>();
const set = (s: SpeechState) => {
  state = s;
  listeners.forEach((l) => l(s));
};

export const speechSupported = () => typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

/** Remove things that sound terrible read aloud: citation markers, markdown syntax, code, URLs. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " (code block skipped). ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[(?:[SM]\d+)(?:\s*,\s*[SM]\d+)*\]/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "link")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/(\*\*|__|\*|_|~~)/g, "")
    .replace(/\|/g, ", ")
    .replace(/\$\$?([^$]+)\$\$?/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, ".\n")
    .trim();
}

/** Browsers cut off long utterances (notably Chrome after ~15 s), so read in sentence-sized pieces. */
export function splitForSpeech(text: string, maxLen = 220): string[] {
  const sentences = text.replace(/\n+/g, " ").match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g) ?? [text];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > maxLen && cur) {
      out.push(cur.trim());
      cur = "";
    }
    if (s.length > maxLen) {
      // Very long sentence: break at commas/spaces.
      const parts = s.match(new RegExp(`.{1,${maxLen}}(?:[,;:]\\s|\\s|$)`, "g")) ?? [s];
      out.push(...parts.map((p) => p.trim()).filter(Boolean));
    } else cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter((p) => /[\p{L}\p{N}]/u.test(p));
}

export type SpeechPrefs = { rate: number; voiceURI: string };
let prefsGetter: () => SpeechPrefs = () => ({ rate: 1, voiceURI: "" });
export const setSpeechPrefsGetter = (g: () => SpeechPrefs) => {
  prefsGetter = g;
};

export function getVoices(): SpeechSynthesisVoice[] {
  return speechSupported() ? window.speechSynthesis.getVoices() : [];
}

let session = 0;

export function speak(raw: string, opts: { clean?: boolean } = {}) {
  if (!speechSupported()) return;
  const text = opts.clean === false ? raw : cleanForSpeech(raw);
  const pieces = splitForSpeech(text);
  const synth = window.speechSynthesis;
  synth.cancel();
  if (!pieces.length) return set(idle);
  const mine = ++session;
  const { rate, voiceURI } = prefsGetter();
  const voice = getVoices().find((v) => v.voiceURI === voiceURI);

  const next = (i: number) => {
    if (mine !== session) return;
    if (i >= pieces.length) return set(idle);
    const u = new SpeechSynthesisUtterance(pieces[i]);
    u.rate = rate;
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    u.onstart = () => mine === session && set({ status: "speaking", text: raw, index: i, total: pieces.length });
    u.onend = () => next(i + 1);
    u.onerror = (e) => {
      // "canceled"/"interrupted" happen on stop; anything else ends the session cleanly.
      if (mine === session && e.error !== "canceled" && e.error !== "interrupted") set(idle);
    };
    synth.speak(u);
  };
  set({ status: "speaking", text: raw, index: 0, total: pieces.length });
  next(0);
}

export function stopSpeaking() {
  if (!speechSupported()) return;
  session++;
  window.speechSynthesis.cancel();
  set(idle);
}

export function pauseSpeaking() {
  if (state.status !== "speaking") return;
  window.speechSynthesis.pause();
  set({ ...state, status: "paused" });
}

export function resumeSpeaking() {
  if (state.status !== "paused") return;
  window.speechSynthesis.resume();
  set({ ...state, status: "speaking" });
}

export function useSpeech(): SpeechState {
  const [s, setS] = useState(state);
  useEffect(() => {
    listeners.add(setS);
    setS(state);
    return () => void listeners.delete(setS);
  }, []);
  return s;
}

/** Voices load asynchronously in some browsers; this hook re-renders when they arrive. */
export function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => getVoices());
  useEffect(() => {
    if (!speechSupported()) return;
    const update = () => setVoices(getVoices());
    update();
    window.speechSynthesis.addEventListener("voiceschanged", update);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", update);
  }, []);
  return voices;
}

// Stop reading if the tab is closed or navigated away.
if (typeof window !== "undefined") window.addEventListener("pagehide", () => speechSupported() && window.speechSynthesis.cancel());

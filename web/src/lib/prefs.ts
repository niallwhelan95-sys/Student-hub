import { useEffect, useState } from "react";

/**
 * Per-device display preferences (theme, text size, motion). These are conveniences, so they
 * live in localStorage; everything academic lives on the server.
 */
export type Prefs = {
  theme: "system" | "light" | "dark";
  text: "small" | "medium" | "large";
  motion: "system" | "reduce";
  enterToSend: boolean;
  /** Read-aloud speed (0.6–1.6) and chosen voice (empty = browser default). */
  ttsRate: number;
  ttsVoice: string;
};

const DEFAULTS: Prefs = { theme: "system", text: "medium", motion: "system", enterToSend: true, ttsRate: 1, ttsVoice: "" };
const KEY = "margin.prefs";

function read(): Prefs {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>) };
  } catch {
    return DEFAULTS;
  }
}

const listeners = new Set<(p: Prefs) => void>();
let current = read();

export function applyPrefs(p: Prefs = current) {
  const root = document.documentElement;
  const dark = p.theme === "dark" || (p.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.text = p.text;
  root.dataset.motion = p.motion;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#121518" : "#1f6f6b");
}

export function setPrefs(patch: Partial<Prefs>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage may be unavailable (private mode) — prefs still apply for this session */
  }
  applyPrefs(current);
  listeners.forEach((l) => l(current));
}

export const getPrefs = () => current;

export function usePrefs():[Prefs, (patch: Partial<Prefs>) => void] {
  const [p, setP] = useState(current);
  useEffect(() => {
    listeners.add(setP);
    return () => void listeners.delete(setP);
  }, []);
  return [p, setPrefs];
}

if (typeof window !== "undefined") {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyPrefs());
}

/** Unsent drafts per conversation, so a refresh or app switch on mobile never loses typing. */
export const drafts = {
  get(key: string): string {
    try {
      return localStorage.getItem(`margin.draft.${key}`) ?? "";
    } catch {
      return "";
    }
  },
  set(key: string, value: string) {
    try {
      if (value) localStorage.setItem(`margin.draft.${key}`, value);
      else localStorage.removeItem(`margin.draft.${key}`);
    } catch {
      /* ignore */
    }
  },
};

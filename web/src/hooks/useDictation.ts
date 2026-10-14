import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../lib/api";

export type DictationState = "idle" | "requesting" | "recording" | "transcribing" | "failed";
export type DictationMode = "server" | "browser" | "unsupported";
export type DictationResult = { text: string; uncertain: string[]; mode: DictationMode };

const MAX_SECONDS = 15 * 60;

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null;
}

export function detectMode(serverAvailable: boolean): DictationMode {
  const canRecord = typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
  if (serverAvailable && canRecord) return "server";
  if (getSpeechRecognition()) return "browser";
  return "unsupported";
}

function pickMimeType(): string | undefined {
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return undefined;
}

function micErrorMessage(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Microphone access is blocked. Allow it for this site in your browser settings (the lock icon in the address bar), then try again.";
  if (name === "NotFoundError") return "No microphone was found. Plug one in or check your device settings.";
  if (name === "NotReadableError") return "Your microphone is being used by another app. Close it and try again.";
  return "Couldn't start the microphone.";
}

/**
 * Voice dictation. The student controls start/stop; audio stays in memory only until it is
 * transcribed (server mode) and is released immediately after. If transcription fails, the
 * recording is kept in memory so it can be retried rather than lost.
 */
export function useDictation(opts: {
  serverAvailable: boolean;
  onResult: (r: DictationResult) => void;
  onInterim?: (text: string) => void;
}) {
  const mode = detectMode(opts.serverAvailable);
  const [state, setState] = useState<DictationState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);

  const optsRef = useRef(opts);
  optsRef.current = opts;
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const pendingBlobRef = useRef<Blob | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTextRef = useRef("");
  const wantStopRef = useRef(false);

  const cleanupMedia = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop()); // releases the mic + browser indicator
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setLevel(0);
  }, []);

  useEffect(() => () => {
    cancelledRef.current = true;
    recorderRef.current?.state === "recording" && recorderRef.current.stop();
    recognitionRef.current?.abort();
    cleanupMedia();
  }, [cleanupMedia]);

  const transcribe = useCallback(async (blob: Blob) => {
    setState("transcribing");
    const form = new FormData();
    form.append("audio", blob, `dictation.${blob.type.includes("mp4") ? "m4a" : "webm"}`);
    try {
      const res = await fetch("/api/speech/transcribe", { method: "POST", body: form, headers: { "x-margin-client": "1" }, credentials: "same-origin" });
      const body = (await res.json().catch(() => ({}))) as { text?: string; uncertain?: string[]; error?: string };
      if (!res.ok) throw new ApiError(res.status, body.error ?? "Transcription failed");
      pendingBlobRef.current = null; // done — drop the audio
      setState("idle");
      if (!body.text?.trim()) {
        setError("No speech was detected in that recording.");
        return;
      }
      optsRef.current.onResult({ text: body.text.trim(), uncertain: body.uncertain ?? [], mode: "server" });
    } catch (err) {
      pendingBlobRef.current = blob; // keep for retry
      setError(err instanceof Error ? `${err.message}. Your recording is kept — you can retry.` : "Transcription failed. You can retry.");
      setState("failed");
    }
  }, []);

  const startServer = useCallback(async () => {
    setState("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (err) {
      setError(micErrorMessage(err));
      setState("idle");
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    cancelledRef.current = false;
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;
    recorder.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
    recorder.onstop = () => {
      cleanupMedia();
      if (cancelledRef.current) {
        chunksRef.current = [];
        setState("idle");
        return;
      }
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" });
      chunksRef.current = [];
      void transcribe(blob);
    };
    recorder.start(1000);

    // Live input level, so it's obvious the mic is hearing you.
    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let last = 0;
      const tick = (t: number) => {
        analyser.getByteTimeDomainData(data);
        if (t - last > 70) {
          let sum = 0;
          for (const v of data) sum += ((v - 128) / 128) ** 2;
          setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
          last = t;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      /* level meter is optional */
    }

    const started = Date.now();
    setElapsed(0);
    timerRef.current = window.setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      setElapsed(s);
      if (s >= MAX_SECONDS && recorder.state === "recording") recorder.stop();
    }, 250);
    setState("recording");
  }, [cleanupMedia, transcribe]);

  const startBrowser = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-GB";
    finalTextRef.current = "";
    wantStopRef.current = false;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalTextRef.current += (finalTextRef.current ? " " : "") + r[0].transcript.trim();
        else interim += r[0].transcript;
      }
      optsRef.current.onInterim?.([finalTextRef.current, interim.trim()].filter(Boolean).join(" "));
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      wantStopRef.current = true;
      setError(
        e.error === "not-allowed"
          ? micErrorMessage({ name: "NotAllowedError" })
          : e.error === "network" || e.error === "service-not-allowed"
            ? "This browser's speech service isn't available (common in embedded or privacy-focused browsers). Try Chrome, Edge or Safari — or ask whoever runs Margin to enable server transcription (STT_API_KEY)."
            : e.error === "audio-capture"
              ? micErrorMessage({ name: "NotFoundError" })
              : `Speech recognition stopped (${e.error}). Your text so far has been kept.`,
      );
    };
    rec.onend = () => {
      // Some browsers end recognition after a pause; keep listening until the student presses stop.
      if (!wantStopRef.current) {
        try {
          rec.start();
          return;
        } catch {
          /* fall through to finish */
        }
      }
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      setState("idle");
      const text = finalTextRef.current.trim();
      if (text && !cancelledRef.current) optsRef.current.onResult({ text, uncertain: [], mode: "browser" });
    };
    recognitionRef.current = rec;
    cancelledRef.current = false;
    try {
      rec.start();
    } catch (err) {
      setError(micErrorMessage(err));
      return;
    }
    const started = Date.now();
    setElapsed(0);
    timerRef.current = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 250);
    setState("recording");
  }, []);

  const start = useCallback(() => {
    setError(null);
    pendingBlobRef.current = null;
    if (mode === "server") void startServer();
    else if (mode === "browser") startBrowser();
    else setError("Voice dictation isn't supported in this browser. Try Chrome, Edge or Safari.");
  }, [mode, startServer, startBrowser]);

  const stop = useCallback(() => {
    if (mode === "server") recorderRef.current?.state === "recording" && recorderRef.current.stop();
    else {
      wantStopRef.current = true;
      recognitionRef.current?.stop();
    }
  }, [mode]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    pendingBlobRef.current = null;
    if (mode === "server") {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      else setState("idle");
    } else {
      wantStopRef.current = true;
      recognitionRef.current?.abort();
      setState("idle");
    }
    setError(null);
  }, [mode]);

  const retry = useCallback(() => {
    if (pendingBlobRef.current) {
      setError(null);
      void transcribe(pendingBlobRef.current);
    }
  }, [transcribe]);

  return { mode, state, error, elapsed, level, start, stop, cancel, retry, clearError: () => setError(null) };
}

export const formatElapsed = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

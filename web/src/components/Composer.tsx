import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUp, Paperclip, Square, X, FileText, Image as ImageIcon, AlertTriangle, Wand2, Undo2, Mic } from "lucide-react";
import { get, post, uploadFiles, ApiError } from "../lib/api";
import { drafts, usePrefs } from "../lib/prefs";
import { prepareImage, pastedFileName } from "../lib/images";
import type { DocumentSummary } from "../lib/types";
import { useDictation } from "../hooks/useDictation";
import { DictateButton, DictationStatus } from "./Dictation";
import { Button, IconButton, Spinner, cx } from "./ui";
import { useToast } from "./toast";

export type ComposerHandle = { addFiles: (files: File[]) => void; focus: () => void; setText: (t: string) => void };

type Attachment = { localId: string; name: string; isImage: boolean; status: "uploading" | "uploaded" | "error"; error?: string; document?: DocumentSummary };

export type SendPayload = { text: string; attachmentIds: string[]; inputMode: "text" | "voice" };

export const Composer = forwardRef<
  ComposerHandle,
  {
    draftKey: string;
    streaming: boolean;
    disabled?: boolean;
    moduleId?: string | null;
    conversationId?: string | null;
    serverTranscription: boolean;
    placeholder?: string;
    onSend: (p: SendPayload) => Promise<boolean> | boolean;
    onStop: () => void;
  }
>(function Composer(props, ref) {
  const [prefs] = usePrefs();
  const toast = useToast();
  const [text, setText] = useState(() => drafts.get(props.draftKey));
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [voice, setVoice] = useState<{ original: string; uncertain: string[]; beforeTidy?: string } | null>(null);
  const [interim, setInterim] = useState("");
  const [tidying, setTidying] = useState<null | "light" | "academic">(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(drafts.get(props.draftKey));
    setAttachments([]);
    setVoice(null);
  }, [props.draftKey]);
  useEffect(() => {
    drafts.set(props.draftKey, text);
  }, [props.draftKey, text]);

  // Autosize the textarea up to ~40% of the viewport.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`;
  }, [text, interim]);

  const dictation = useDictation({
    serverAvailable: props.serverTranscription,
    onInterim: setInterim,
    onResult: ({ text: spoken, uncertain }) => {
      setInterim("");
      setText((t) => (t.trim() ? `${t.trimEnd()} ${spoken}` : spoken));
      setVoice({ original: spoken, uncertain });
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
  });

  // Poll processing state of uploaded attachments so the chip shows when they're readable.
  const pendingIds = attachments.filter((a) => a.document && (a.document.status === "queued" || a.document.status === "processing")).map((a) => a.document!.id);
  useQuery({
    queryKey: ["attachment-status", pendingIds.join(",")],
    enabled: pendingIds.length > 0,
    refetchInterval: 2000,
    queryFn: async () => {
      const { documents } = await get<{ documents: DocumentSummary[] }>(`/documents?ids=${pendingIds.join(",")}`);
      setAttachments((list) => list.map((a) => ({ ...a, document: documents.find((d) => d.id === a.document?.id) ?? a.document })));
      return documents;
    },
  });

  const addFiles = useCallback(
    async (files: File[]) => {
      const prepared = await Promise.all(files.slice(0, 5).map((f, i) => prepareImage(pastedFileName(f, i))));
      for (const file of prepared) {
        const localId = Math.random().toString(36).slice(2);
        setAttachments((a) => [...a, { localId, name: file.name, isImage: file.type.startsWith("image/"), status: "uploading" }]);
        try {
          const { results } = await uploadFiles([file], { moduleId: props.moduleId, conversationId: props.conversationId });
          const r = results[0];
          setAttachments((a) =>
            a.map((x) => (x.localId === localId ? (r.document ? { ...x, status: "uploaded", document: r.document } : { ...x, status: "error", error: r.error }) : x)),
          );
          if (r.duplicate) toast("You'd already uploaded this file — reusing the existing copy.", { tone: "info" });
        } catch (err) {
          setAttachments((a) => a.map((x) => (x.localId === localId ? { ...x, status: "error", error: err instanceof ApiError ? err.message : "Upload failed" } : x)));
        }
      }
    },
    [props.moduleId, props.conversationId, toast],
  );

  useImperativeHandle(ref, () => ({ addFiles: (f) => void addFiles(f), focus: () => textareaRef.current?.focus(), setText }), [addFiles]);

  const uploading = attachments.some((a) => a.status === "uploading");
  const canSend = !props.streaming && !props.disabled && !uploading && text.trim().length > 0 && dictation.state !== "recording";

  const send = async () => {
    if (!canSend) return;
    const ok = await props.onSend({
      text: text.trim(),
      attachmentIds: attachments.filter((a) => a.document).map((a) => a.document!.id),
      inputMode: voice ? "voice" : "text",
    });
    if (ok !== false) {
      setText("");
      setAttachments([]);
      setVoice(null);
      drafts.set(props.draftKey, "");
    }
  };

  const tidy = async (mode: "light" | "academic") => {
    if (!voice) return;
    setTidying(mode);
    try {
      const { text: tidied } = await post<{ text: string }>("/speech/tidy", { text, mode });
      setVoice({ ...voice, beforeTidy: text });
      setText(tidied);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't tidy the text", { tone: "error" });
    } finally {
      setTidying(null);
    }
  };

  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

  return (
    <div className="space-y-2">
      <DictationStatus d={dictation} interim={dictation.mode === "browser" ? interim : undefined} />

      {voice && dictation.state === "idle" && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-muted">
          <Mic className="size-3.5" />
          <span>Transcribed from your voice — check it before sending.</span>
          {voice.uncertain.length > 0 && (
            <span className="flex items-center gap-1 text-warn">
              <AlertTriangle className="size-3.5" /> Unsure about: “{voice.uncertain.slice(0, 2).join("”, “")}”
            </span>
          )}
          <span className="ml-auto flex flex-wrap gap-1.5">
            {voice.beforeTidy !== undefined ? (
              <Button size="sm" variant="ghost" icon={<Undo2 className="size-3.5" />} onClick={() => (setText(voice.beforeTidy!), setVoice({ ...voice, beforeTidy: undefined }))}>
                Undo tidy
              </Button>
            ) : (
              <>
                <Button size="sm" variant="ghost" loading={tidying === "light"} disabled={!!tidying} icon={<Wand2 className="size-3.5" />} onClick={() => void tidy("light")} title="Remove filler words and fix punctuation, keeping your wording">
                  Tidy up
                </Button>
                <Button size="sm" variant="ghost" loading={tidying === "academic"} disabled={!!tidying} onClick={() => void tidy("academic")} title="Turn spoken ideas into written prose in your voice">
                  Make it written prose
                </Button>
              </>
            )}
          </span>
        </div>
      )}

      <div
        className={cx(
          "rounded-2xl border bg-surface shadow-soft transition-colors focus-within:border-accent/60",
          dictation.state === "recording" ? "border-danger/40" : "border-line",
        )}
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-line px-3 py-2.5">
            {attachments.map((a) => {
              const st = a.document?.status;
              const processing = st === "queued" || st === "processing";
              return (
                <span
                  key={a.localId}
                  className={cx(
                    "inline-flex max-w-[16rem] items-center gap-1.5 rounded-lg border px-2 py-1 text-xs",
                    a.status === "error" || st === "failed" ? "border-danger/30 bg-danger-soft text-danger" : "border-line bg-surface-2 text-ink",
                  )}
                  title={a.error ?? a.document?.statusDetail ?? a.name}
                >
                  {a.status === "uploading" || processing ? <Spinner className="size-3.5" /> : a.isImage ? <ImageIcon className="size-3.5" /> : <FileText className="size-3.5" />}
                  <span className="truncate">{a.name}</span>
                  <span className="shrink-0 text-faint">
                    {a.status === "uploading" ? "uploading" : a.status === "error" ? "failed" : processing ? "reading…" : st === "partial" ? "partly read" : st === "failed" ? "unreadable" : ""}
                  </span>
                  <button aria-label={`Remove ${a.name}`} className="text-faint hover:text-ink" onClick={() => setAttachments((l) => l.filter((x) => x.localId !== a.localId))}>
                    <X className="size-3.5" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={dictation.state === "recording" && interim ? `${text}${text ? " " : ""}${interim}` : text}
          onChange={(e) => {
            setText(e.target.value);
            if (!e.target.value) setVoice(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && prefs.enterToSend && !coarse) {
              e.preventDefault();
              void send();
            }
          }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
          readOnly={dictation.state === "recording"}
          rows={1}
          placeholder={props.placeholder ?? "Ask about your modules, paste a screenshot, or tap the mic…"}
          aria-label="Message"
          className="block max-h-[40vh] w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[0.98rem] leading-relaxed text-ink placeholder:text-faint focus:outline-none"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            accept=".pdf,.docx,.pptx,.xlsx,.csv,.txt,.md,.png,.jpg,.jpeg,.webp,.gif,.py,.js,.ts,.java,.c,.cpp,.cs,.sql,.r,.ipynb,.html,.json"
            onChange={(e) => {
              void addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <IconButton label="Attach files or images" onClick={() => fileInputRef.current?.click()}>
            <Paperclip className="size-[1.15rem]" />
          </IconButton>
          <DictateButton d={dictation} />
          <span className="ml-auto truncate text-right text-[0.7rem] text-faint">
            <span className="hidden sm:inline">{prefs.enterToSend && !coarse ? "Enter to send · Shift+Enter for a new line" : ""}</span>
          </span>
          {props.streaming ? (
            <IconButton label="Stop generating" onClick={props.onStop} className="ml-1 bg-ink text-bg hover:bg-ink hover:text-bg">
              <Square className="size-3.5 fill-current" />
            </IconButton>
          ) : (
            <IconButton
              label="Send message"
              onClick={() => void send()}
              disabled={!canSend}
              className={cx("ml-1", canSend ? "bg-accent text-accent-ink hover:bg-accent-hover hover:text-accent-ink" : "bg-surface-2")}
            >
              <ArrowUp className="size-[1.15rem]" />
            </IconButton>
          )}
        </div>
      </div>
    </div>
  );
});

import { useState } from "react";
import { Link } from "react-router-dom";
import { Copy, Check, RotateCcw, Pencil, Brain, ListTodo, Download, FileText, Mic, AlertTriangle, CalendarPlus } from "lucide-react";
import type { Citation, Message } from "../lib/types";
import { Markdown } from "./Markdown";
import { ListenButton } from "./ReadAloud";
import { Button, IconButton, Textarea, cx } from "./ui";

export type MessageActions = {
  onRegenerate?: () => void;
  onEdit?: (message: Message, newText: string) => void;
  onRemember?: (text: string, message: Message) => void;
  onTask?: (text: string, message: Message) => void;
  onDeadline?: () => void;
};

function firstLine(text: string) {
  return text
    .replace(/\[[SM]\d+\]/g, "")
    .split("\n")
    .map((l) => l.replace(/^[#>*\-\d.\s]+/, "").trim())
    .find((l) => l.length > 3)
    ?.slice(0, 160) ?? "";
}

function selectedTextWithin(el: HTMLElement | null): string {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !el) return "";
  return el.contains(sel.anchorNode) ? sel.toString().trim() : "";
}

function SourcesList({ citations }: { citations: Citation[] }) {
  const docs = citations.filter((c) => c.kind === "document");
  if (!docs.length) return null;
  const unique = [...new Map(docs.map((c) => [`${c.documentId}:${c.location}`, c])).values()];
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {unique.slice(0, 8).map((c) => (
        <Link
          key={c.ref}
          to={`/library/${c.documentId}${c.sectionId ? `#section-${c.sectionId}` : ""}`}
          className="inline-flex max-w-[18rem] items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1 text-xs text-muted hover:border-line-strong hover:text-ink"
        >
          <span className="font-semibold text-accent-text">{c.ref}</span>
          <FileText className="size-3 shrink-0" />
          <span className="truncate">{c.title}</span>
          {c.location && <span className="shrink-0 text-faint">· {c.location}</span>}
        </Link>
      ))}
    </div>
  );
}

export function MessageItem({
  message,
  isLast,
  streaming,
  attachmentNames,
  actions,
}: {
  message: Message;
  isLast: boolean;
  streaming?: boolean;
  attachmentNames?: Map<string, string>;
  actions: MessageActions;
}) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);

  const copy = () => {
    void navigator.clipboard.writeText(message.content.replace(/\[([SM]\d+)\]/g, ""));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const exportMd = () => {
    const blob = new Blob([message.content], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `margin-${new Date(message.createdAt).toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (message.role === "user") {
    return (
      <div className="group flex flex-col items-end gap-1.5">
        {message.attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {message.attachments.map((id) => (
              <Link key={id} to={`/library/${id}`} className="inline-flex max-w-[14rem] items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1 text-xs text-muted hover:text-ink">
                <FileText className="size-3.5" />
                <span className="truncate">{attachmentNames?.get(id) ?? "Attachment"}</span>
              </Link>
            ))}
          </div>
        )}
        {editing ? (
          <div className="w-full max-w-[85%] space-y-2">
            <Textarea rows={Math.min(10, draft.split("\n").length + 1)} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => (setEditing(false), setDraft(message.content))}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" disabled={!draft.trim()} onClick={() => (setEditing(false), actions.onEdit?.(message, draft.trim()))}>
                Save & resend
              </Button>
            </div>
          </div>
        ) : (
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-surface-2 px-4 py-2.5 text-[0.98rem] leading-relaxed whitespace-pre-wrap">{message.content}</div>
        )}
        {!editing && (
          <div className="flex items-center gap-0.5 text-faint opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
            {message.inputMode === "voice" && (
              <span className="mr-1 inline-flex items-center gap-1 text-[0.7rem]" title="Dictated">
                <Mic className="size-3" /> voice
              </span>
            )}
            <IconButton label="Copy" size="sm" onClick={copy}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </IconButton>
            <ListenButton getText={() => message.content} />
            {actions.onEdit && !streaming && (
              <IconButton label="Edit message" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" />
              </IconButton>
            )}
          </div>
        )}
      </div>
    );
  }

  const isStreaming = message.status === "streaming";
  return (
    <div className="group">
      <div ref={setBodyEl} className={cx(isStreaming && !message.content && "text-muted")}>
        {message.content ? (
          <div className={cx(isStreaming && "stream-caret")}>
            <Markdown text={message.content} citations={message.citations} />
          </div>
        ) : isStreaming ? (
          <p className="text-sm italic">Thinking…</p>
        ) : null}
      </div>
      {message.status === "error" && (
        <div className="mt-2 flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span className="flex-1">{message.error ?? "Something went wrong generating this answer."}</span>
          {isLast && actions.onRegenerate && (
            <Button size="sm" variant="secondary" onClick={actions.onRegenerate}>
              Try again
            </Button>
          )}
        </div>
      )}
      {message.status === "stopped" && <p className="mt-1 text-xs text-faint">Stopped early.</p>}
      {!isStreaming && <SourcesList citations={message.citations} />}
      {!isStreaming && message.content && (
        <div className="mt-1.5 flex flex-wrap items-center gap-0.5 text-faint">
          <IconButton label="Copy" size="sm" onClick={copy}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </IconButton>
          <ListenButton getText={() => selectedTextWithin(bodyEl) || message.content} />
          {isLast && actions.onRegenerate && (
            <IconButton label="Regenerate" size="sm" onClick={actions.onRegenerate}>
              <RotateCcw className="size-3.5" />
            </IconButton>
          )}
          <IconButton label="Save to memory (select text first to save just that part)" size="sm" onClick={() => actions.onRemember?.(selectedTextWithin(bodyEl) || firstLine(message.content), message)}>
            <Brain className="size-3.5" />
          </IconButton>
          <IconButton label="Turn into a task" size="sm" onClick={() => actions.onTask?.(selectedTextWithin(bodyEl) || firstLine(message.content), message)}>
            <ListTodo className="size-3.5" />
          </IconButton>
          <IconButton label="Add a deadline" size="sm" onClick={actions.onDeadline}>
            <CalendarPlus className="size-3.5" />
          </IconButton>
          <IconButton label="Download as Markdown" size="sm" onClick={exportMd}>
            <Download className="size-3.5" />
          </IconButton>
          {message.model === "offline" && <span className="ml-1 text-[0.7rem]">offline mode</span>}
        </div>
      )}
    </div>
  );
}

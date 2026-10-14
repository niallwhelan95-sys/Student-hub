import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, Image as ImageIcon, FileSpreadsheet, Presentation, FileCode, Upload, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { uploadFiles } from "../lib/api";
import { prepareImage } from "../lib/images";
import { refreshAfterActivity, useMe } from "../lib/queries";
import { KIND_LABELS, relativeDay } from "../lib/format";
import type { DocumentSummary } from "../lib/types";
import { Badge, cx } from "./ui";
import { useToast } from "./toast";

export function DocIcon({ mime, className }: { mime: string; className?: string }) {
  const cls = cx("size-4 shrink-0", className);
  if (mime.startsWith("image/")) return <ImageIcon className={cls} />;
  if (mime.includes("spreadsheet") || mime === "text/csv") return <FileSpreadsheet className={cls} />;
  if (mime.includes("presentation")) return <Presentation className={cls} />;
  if (mime === "text/plain") return <FileCode className={cls} />;
  return <FileText className={cls} />;
}

export function StatusBadge({ status, detail }: { status: DocumentSummary["status"]; detail?: string | null }) {
  if (status === "queued" || status === "processing")
    return (
      <Badge tone="accent">
        <Loader2 className="size-3 animate-spin" /> Reading
      </Badge>
    );
  if (status === "failed")
    return (
      <Badge tone="danger">
        <AlertTriangle className="size-3" /> Unreadable
      </Badge>
    );
  if (status === "partial")
    return (
      <span title={detail ?? undefined}>
        <Badge tone="warn">
          <AlertTriangle className="size-3" /> Partly read
        </Badge>
      </span>
    );
  return (
    <Badge tone="ok">
      <CheckCircle2 className="size-3" /> Ready
    </Badge>
  );
}

export function DocumentRow({ doc }: { doc: Pick<DocumentSummary, "id" | "filename" | "mimeType" | "kind" | "status" | "statusDetail" | "summary" | "createdAt"> }) {
  return (
    <Link to={`/library/${doc.id}`} className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-surface-2/60">
      <span className="mt-0.5 rounded-lg bg-surface-2 p-2 text-muted">
        <DocIcon mime={doc.mimeType} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{doc.filename}</span>
          <StatusBadge status={doc.status} detail={doc.statusDetail} />
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted">
          <span className="text-faint">{KIND_LABELS[doc.kind] ?? "Document"} · {relativeDay(doc.createdAt)}</span>
          {doc.summary ? ` — ${doc.summary}` : doc.status === "failed" || doc.status === "partial" ? ` — ${doc.statusDetail ?? ""}` : ""}
        </p>
      </div>
    </Link>
  );
}

/** Drag-and-drop or click-to-upload area. */
export function UploadZone({ moduleId, compact }: { moduleId?: string | null; compact?: boolean }) {
  const toast = useToast();
  const { data: me } = useMe();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const upload = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      const prepared = await Promise.all(files.map((f) => prepareImage(f)));
      for (let i = 0; i < prepared.length; i += 5) {
        const { results } = await uploadFiles(prepared.slice(i, i + 5), { moduleId });
        for (const r of results) {
          if (r.error) toast(`${r.filename}: ${r.error}`, { tone: "error" });
          else if (r.duplicate) toast(`${r.filename} was already in your library`, { tone: "info" });
        }
        const ok = results.filter((r) => r.document && !r.duplicate).length;
        if (ok) toast(`Uploaded ${ok} file${ok === 1 ? "" : "s"} — reading now`);
      }
      refreshAfterActivity();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Upload failed", { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void upload(Array.from(e.dataTransfer.files));
      }}
      className={cx(
        "flex flex-col items-center justify-center rounded-2xl border-2 border-dashed text-center transition-colors",
        compact ? "px-4 py-4" : "px-6 py-8",
        over ? "border-accent bg-accent-soft/60" : "border-line-strong/70 bg-surface/50",
      )}
    >
      <input ref={input} type="file" multiple hidden onChange={(e) => (void upload(Array.from(e.target.files ?? [])), (e.target.value = ""))} />
      {busy ? <Loader2 className="mb-2 size-5 animate-spin text-accent" /> : <Upload className="mb-2 size-5 text-muted" />}
      <p className="text-sm">
        <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => input.current?.click()}>
          Choose files
        </button>{" "}
        or drop them here
      </p>
      {!compact && (
        <p className="mt-1 text-xs text-faint">
          PDF, Word, PowerPoint, Excel, CSV, images, screenshots, text and code · up to {me?.capabilities.maxUploadMb ?? 30} MB each
        </p>
      )}
    </div>
  );
}

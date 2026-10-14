import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download, RefreshCw, Trash2, PenLine, AlertTriangle, ChevronLeft, CalendarClock, Copy } from "lucide-react";
import { del, get, patch, post } from "../lib/api";
import { refreshAfterActivity, useModules } from "../lib/queries";
import { fileSize, KIND_LABELS, moduleLabel, relativeDay } from "../lib/format";
import type { DocumentSection, DocumentSummary } from "../lib/types";
import { Badge, Button, Card, Field, Modal, Select, Spinner, cx } from "../components/ui";
import { StatusBadge, DocIcon } from "../components/Documents";
import { useToast } from "../components/toast";

const KINDS = Object.keys(KIND_LABELS).filter((k) => k !== "unknown");

export function DocumentPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: modules = [] } = useModules();
  const [sampleOpen, setSampleOpen] = useState(false);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["documents", "detail", id],
    queryFn: () => get<{ document: DocumentSummary; sections: DocumentSection[] }>(`/documents/${id}`),
    refetchInterval: (q) => (q.state.data && ["queued", "processing"].includes(q.state.data.document.status) ? 2000 : false),
  });

  const highlight = location.hash.startsWith("#section-") ? location.hash.slice(9) : null;
  useEffect(() => {
    if (!highlight || !data) return;
    requestAnimationFrame(() => document.getElementById(`section-${highlight}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [highlight, data]);

  if (isLoading || !data) return <Spinner />;
  const doc = data.document;
  const md = doc.metadata;
  const suggestedModule = md.suggestedModuleId ? modules.find((m) => m.id === md.suggestedModuleId) : undefined;

  const update = async (body: Record<string, unknown>) => {
    await patch(`/documents/${doc.id}`, body);
    await refetch();
    refreshAfterActivity();
  };
  const reprocess = async () => {
    await post(`/documents/${doc.id}/reprocess`);
    toast("Reprocessing…");
    await refetch();
  };
  const remove = async () => {
    if (!confirm(`Delete ${doc.filename}? It will be removed from search and future answers.`)) return;
    await del(`/documents/${doc.id}`);
    refreshAfterActivity();
    navigate("/library");
  };
  const viewable = doc.mimeType === "application/pdf" || doc.mimeType.startsWith("image/");

  return (
    <div>
      <button onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronLeft className="size-4" /> Back
      </button>
      <header className="mb-6 flex flex-wrap items-start gap-4">
        <span className="rounded-xl bg-surface-2 p-3 text-muted">
          <DocIcon mime={doc.mimeType} className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="break-words font-display text-2xl font-semibold tracking-tight">{md.title || doc.filename}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            {md.title && md.title !== doc.filename && <span>{doc.filename} ·</span>}
            <span>{fileSize(doc.sizeBytes)}</span>
            {doc.pageCount ? <span>· {doc.pageCount} {doc.mimeType.includes("presentation") ? "slides" : "pages"}</span> : null}
            <span>· uploaded {relativeDay(doc.createdAt)}</span>
            <StatusBadge status={doc.status} detail={doc.statusDetail} />
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {viewable && (
            <a href={`/api/documents/${doc.id}/file?inline=1`} target="_blank" rel="noreferrer">
              <Button variant="secondary" size="sm">
                Open original
              </Button>
            </a>
          )}
          <a href={`/api/documents/${doc.id}/file`}>
            <Button variant="ghost" size="sm" icon={<Download className="size-3.5" />}>
              Download
            </Button>
          </a>
        </div>
      </header>

      {(doc.status === "partial" || doc.status === "failed") && doc.statusDetail && (
        <div className={cx("mb-6 flex items-start gap-2 rounded-xl px-4 py-3 text-sm", doc.status === "failed" ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn")} role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="flex-1">{doc.statusDetail}</div>
          <Button size="sm" variant="secondary" icon={<RefreshCw className="size-3.5" />} onClick={() => void reprocess()}>
            Retry
          </Button>
        </div>
      )}

      {md.relatedDocuments?.length ? (
        <div className="mb-6 flex items-start gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">
          <Copy className="mt-0.5 size-4 shrink-0" />
          <span>
            This may be a revised version of{" "}
            {md.relatedDocuments.map((r, i) => (
              <span key={r.id}>
                {i > 0 && ", "}
                <Link className="font-medium text-accent-text hover:underline" to={`/library/${r.id}`}>
                  {r.filename}
                </Link>
              </span>
            ))}
            . If instructions differ, Margin will point out the conflict — consider deleting the outdated one.
          </span>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_19rem]">
        <div className="min-w-0 space-y-6">
          {doc.summary && (
            <Card className="p-5">
              <h2 className="mb-2 text-sm font-medium text-muted">Summary</h2>
              <p className="leading-relaxed">{doc.summary}</p>
              {md.keyPoints?.length ? (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                  {md.keyPoints.map((k) => (
                    <li key={k}>{k}</li>
                  ))}
                </ul>
              ) : null}
            </Card>
          )}

          {(md.gradingCriteria?.length || md.learningOutcomes?.length || md.wordLimit || md.referencingStyle) && (
            <Card className="space-y-3 p-5 text-sm">
              {md.wordLimit && (
                <p>
                  <span className="font-medium">Word limit:</span> {md.wordLimit}
                </p>
              )}
              {md.referencingStyle && (
                <p>
                  <span className="font-medium">Referencing:</span> {md.referencingStyle}
                </p>
              )}
              {md.gradingCriteria?.length ? (
                <div>
                  <p className="font-medium">Marking criteria</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
                    {md.gradingCriteria.map((g) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {md.learningOutcomes?.length ? (
                <div>
                  <p className="font-medium">Learning outcomes</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
                    {md.learningOutcomes.map((g) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="text-xs text-faint">Extracted automatically — check against the original before relying on it.</p>
            </Card>
          )}

          <section>
            <h2 className="mb-3 text-sm font-medium text-muted">Extracted text ({data.sections.length} passages)</h2>
            {["queued", "processing"].includes(doc.status) ? (
              <Card className="flex items-center gap-2 p-5 text-sm text-muted">
                <Spinner /> {doc.statusDetail ?? "Processing…"}
              </Card>
            ) : (
              <div className="space-y-3">
                {data.sections.map((s) => (
                  <article
                    key={s.id}
                    id={`section-${s.id}`}
                    className={cx("scroll-mt-24 rounded-2xl border bg-surface p-4 transition-colors", highlight === s.id ? "border-accent ring-3 ring-accent/15" : "border-line")}
                  >
                    <p className="mb-1.5 text-xs font-semibold text-accent-text">{s.location}</p>
                    {s.heading && !s.content.startsWith(s.heading) && !s.location?.includes(s.heading) && <p className="mb-1 text-sm font-medium">{s.heading}</p>}
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink/90">{s.content}</p>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <Card className="space-y-4 p-4">
            <Field label="Module">
              <Select value={doc.moduleId ?? ""} onChange={(e) => void update({ moduleId: e.target.value || null })}>
                <option value="">Not in a module</option>
                {modules.map((m) => (
                  <option key={m.id} value={m.id}>
                    {moduleLabel(m)}
                  </option>
                ))}
              </Select>
            </Field>
            {suggestedModule && !doc.moduleId && (
              <div className="rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent-text">
                Looks like it belongs to <strong>{moduleLabel(suggestedModule)}</strong>.{" "}
                <button className="font-semibold underline" onClick={() => void update({ moduleId: suggestedModule.id })}>
                  Move it there
                </button>
              </div>
            )}
            <Field label="Type">
              <Select value={doc.kind} onChange={(e) => void update({ kind: e.target.value })}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
            </Field>
          </Card>

          {md.detectedDates?.length ? (
            <Card className="p-4">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                <CalendarClock className="size-4 text-muted" /> Dates found
              </h3>
              <ul className="space-y-2 text-sm">
                {md.detectedDates.map((d, i) => (
                  <li key={i}>
                    <p>{d.label}</p>
                    <p className="text-xs text-muted">
                      {new Date(d.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      {d.location ? ` · ${d.location}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
              <Link to="/planner" className="mt-3 inline-block text-xs font-medium text-accent-text hover:underline">
                Confirm in planner →
              </Link>
            </Card>
          ) : null}

          <Card className="space-y-2 p-4">
            <Button variant="soft" size="sm" className="w-full" icon={<PenLine className="size-3.5" />} onClick={() => setSampleOpen(true)} disabled={doc.status !== "ready" && doc.status !== "partial"}>
              {doc.isOwnWriting ? "Used as a writing sample" : "Use as my writing sample"}
            </Button>
            <Button variant="ghost" size="sm" className="w-full" icon={<RefreshCw className="size-3.5" />} onClick={() => void reprocess()}>
              Reprocess
            </Button>
            <Button variant="ghost" size="sm" className="w-full text-danger hover:text-danger" icon={<Trash2 className="size-3.5" />} onClick={() => void remove()}>
              Delete
            </Button>
            {md.extraction && <p className="pt-1 text-[0.7rem] text-faint">Read with: {md.extraction.method}</p>}
            {doc.isOwnWriting && <Badge tone="accent">Your writing</Badge>}
          </Card>
        </aside>
      </div>
      <UseAsSampleModal open={sampleOpen} onClose={() => setSampleOpen(false)} docId={doc.id} />
    </div>
  );
}

function UseAsSampleModal({ open, onClose, docId }: { open: boolean; onClose: () => void; docId: string }) {
  const toast = useToast();
  const [context, setContext] = useState("essay");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await post<{ sample: { wordCount: number; exclusionNotes: string | null } }>(`/documents/${docId}/writing-sample`, { context, confirmedOwnWork: true });
      toast(`Added ${r.sample.wordCount} words to your writing profile${r.sample.exclusionNotes ? ` (${r.sample.exclusionNotes})` : ""}`);
      refreshAfterActivity();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't add sample", { tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Use as a writing sample"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!confirmed} onClick={() => void submit()}>
            Add to my profile
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-muted">Margin will learn how you write from this document. Reference lists, quotations, citations, cover-sheet fields and marker comments are removed automatically.</p>
        <Field label="What kind of writing is it?">
          <Select value={context} onChange={(e) => setContext(e.target.value)}>
            <option value="essay">Academic essay</option>
            <option value="report">Technical / business report</option>
            <option value="reflective">Reflective writing</option>
            <option value="presentation">Presentation / speaking notes</option>
            <option value="email">Email / professional</option>
            <option value="notes">Notes / brainstorming</option>
            <option value="general">Other</option>
          </Select>
        </Field>
        <label className="flex items-start gap-2.5">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
          <span>I wrote this myself (it isn't mostly AI-generated or someone else's work).</span>
        </label>
      </div>
    </Modal>
  );
}

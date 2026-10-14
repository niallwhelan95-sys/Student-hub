import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PenLine, Plus, Trash2, RotateCcw, Mic, Info, FileText } from "lucide-react";
import { del, get, patch, post } from "../lib/api";
import { queryClient, useMe } from "../lib/queries";
import { relativeDay } from "../lib/format";
import type { WritingProfile, WritingSample } from "../lib/types";
import { useDictation } from "../hooks/useDictation";
import { DictateButton, DictationStatus } from "../components/Dictation";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, Toggle, cx } from "../components/ui";
import { useToast } from "../components/toast";

const CONTEXT_LABELS: Record<string, string> = {
  general: "Overall",
  essay: "Essays",
  report: "Reports",
  reflective: "Reflective",
  presentation: "Presentations",
  email: "Emails",
  notes: "Notes",
};

type WritingData = { profiles: WritingProfile[]; samples: WritingSample[]; calibrationPrompts: string[] };

function ProfileSection({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-faint">{title}</h4>
      <ul className="space-y-1 text-sm">
        {items.map((i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-rule" />
            <span>{i}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WritingPage() {
  const toast = useToast();
  const { data: me } = useMe();
  const [ctx, setCtx] = useState("general");
  const [addOpen, setAddOpen] = useState(false);
  const [pollUntil, setPollUntil] = useState(0);
  const { data, isLoading } = useQuery({
    queryKey: ["writing"],
    queryFn: () => get<WritingData>("/writing"),
    refetchInterval: () => (Date.now() < pollUntil ? 2500 : false),
  });
  const profile = data?.profiles.find((p) => p.context === ctx) ?? data?.profiles.find((p) => p.context === "general");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    setNotes(profile?.userNotes ?? "");
  }, [profile?.id, profile?.userNotes]);

  const refresh = () => {
    setPollUntil(Date.now() + 45_000);
    void queryClient.invalidateQueries({ queryKey: ["writing"] });
  };
  const saveNotes = async () => {
    await patch(`/writing/profiles/${ctx}`, { userNotes: notes.trim() || null });
    toast("Saved — your profile will be updated with this");
    refresh();
  };
  const contextsWithSamples = ["general", ...new Set(data?.samples.map((s) => s.context).filter((c) => c !== "general"))];

  if (isLoading || !data) return <Spinner />;
  const p = profile?.profile;

  return (
    <div>
      <PageHeader
        title="Your writing voice"
        description="Margin learns how you naturally write so drafts and edits still sound like you — clearer, stronger, but yours."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAddOpen(true)}>
            Add writing sample
          </Button>
        }
      />

      {contextsWithSamples.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {contextsWithSamples.map((c) => (
            <button
              key={c}
              onClick={() => setCtx(c)}
              className={cx("rounded-full border px-3 py-1 text-sm", ctx === c ? "border-accent bg-accent-soft text-accent-text" : "border-line text-muted hover:text-ink")}
            >
              {CONTEXT_LABELS[c] ?? c}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card className="p-5 sm:p-6">
          {!profile || profile.sampleCount === 0 ? (
            <EmptyState
              icon={<PenLine className="size-6" />}
              title="No writing samples yet"
              action={
                <Button variant="primary" onClick={() => setAddOpen(true)}>
                  Add your first sample
                </Button>
              }
            >
              Paste a previous assignment, upload one from your library, or do a two-minute calibration exercise. Even one sample helps; more samples make it more accurate.
            </EmptyState>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={profile.confidence === "high" ? "ok" : profile.confidence === "medium" ? "accent" : "warn"}>{profile.confidence} confidence</Badge>
                <span className="text-xs text-muted">
                  {profile.sampleCount} sample{profile.sampleCount === 1 ? "" : "s"} · {profile.wordCount.toLocaleString()} words · updated {relativeDay(profile.updatedAt)}
                </span>
                {!profile.enabled && <Badge>personalisation off</Badge>}
              </div>
              {p ? (
                <>
                  <p className="font-display text-lg leading-relaxed">{p.summary}</p>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <ProfileSection title="What makes it yours" items={p.voice} />
                    <ProfileSection title="Vocabulary" items={p.vocabulary} />
                    <ProfileSection title="Sentences" items={p.sentenceStructure} />
                    <ProfileSection title="Structure" items={p.organisation} />
                    <ProfileSection title="How you argue" items={p.argumentation} />
                    <ProfileSection title="Phrases worth keeping" items={p.phrasesToKeep} />
                    <ProfileSection title="Doesn't sound like you" items={p.avoid} />
                    <ProfileSection title="Areas to strengthen" items={p.improvementGoals} />
                  </div>
                  <p className="text-sm">
                    <span className="font-medium">Formality:</span> <span className="text-muted">{p.formality}</span>
                  </p>
                  {p.uncertainties.length > 0 && (
                    <div className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">
                      <p className="mb-1 flex items-center gap-1.5 font-medium text-ink">
                        <Info className="size-4" /> Not sure yet
                      </p>
                      {p.uncertainties.join(" ")}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted">
                  {me?.capabilities.ai ? "Building your profile… this takes a moment after adding a sample." : "A full written profile needs the AI model. For now, here's what the measurements show:"}
                </p>
              )}
              {profile.statsDescription.length > 0 && (
                <div className="border-t border-line pt-4">
                  <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-faint">Measured from your samples</h4>
                  <ul className="space-y-0.5 text-sm text-muted">
                    {profile.statsDescription.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="space-y-3 p-4">
            <Field label="Tell Margin about your writing" hint="Your corrections always take priority. e.g. “I never say ‘utilise’”, “keep my short sentences”.">
              <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
            </Field>
            <Button size="sm" variant="soft" disabled={(profile?.userNotes ?? "") === notes} onClick={() => void saveNotes()}>
              Save notes
            </Button>
          </Card>
          {profile && (
            <Card className="space-y-4 p-4">
              <Toggle
                checked={profile.enabled}
                onChange={async (v) => (await patch(`/writing/profiles/${profile.context}`, { enabled: v }), refresh())}
                label="Use my voice when drafting"
                description="Turn off to get neutral writing help."
              />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={async () => (await post(`/writing/profiles/${profile.context}/rebuild`), refresh(), toast("Rebuilding profile…"))}>
                  Rebuild
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger hover:text-danger"
                  onClick={async () => {
                    if (!confirm("Reset the learned profile? Your samples are kept and you can rebuild later.")) return;
                    await del(`/writing/profiles/${profile.context}`);
                    refresh();
                  }}
                >
                  Reset
                </Button>
              </div>
            </Card>
          )}
          <Card>
            <h3 className="border-b border-line px-4 py-3 text-sm font-medium">Samples</h3>
            <ul className="divide-y divide-line">
              {data.samples.map((s) => (
                <li key={s.id} className="group px-4 py-3">
                  <div className="flex items-start gap-2">
                    {s.isSpoken ? <Mic className="mt-0.5 size-3.5 shrink-0 text-faint" /> : <FileText className="mt-0.5 size-3.5 shrink-0 text-faint" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{s.title}</p>
                      <p className="text-xs text-faint">
                        {CONTEXT_LABELS[s.context]} · {s.wordCount} words{s.isSpoken ? " · spoken" : ""}
                      </p>
                      {s.exclusionNotes && <p className="mt-0.5 text-[0.7rem] text-faint">{s.exclusionNotes}</p>}
                    </div>
                    <button
                      aria-label={`Delete sample ${s.title}`}
                      className="text-faint opacity-100 hover:text-danger sm:opacity-0 sm:group-hover:opacity-100"
                      onClick={async () => {
                        if (!confirm("Delete this sample? The profile will be rebuilt without it.")) return;
                        await del(`/writing/samples/${s.id}`);
                        refresh();
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </li>
              ))}
              {!data.samples.length && <li className="px-4 py-4 text-sm text-muted">None yet.</li>}
            </ul>
          </Card>
        </div>
      </div>

      <AddSampleModal open={addOpen} onClose={() => setAddOpen(false)} prompts={data.calibrationPrompts} onAdded={refresh} serverTranscription={!!me?.capabilities.serverTranscription} />
    </div>
  );
}

export function AddSampleModal({
  open,
  onClose,
  prompts,
  onAdded,
  serverTranscription,
  defaultMode = "paste",
}: {
  open: boolean;
  onClose: () => void;
  prompts: string[];
  onAdded: () => void;
  serverTranscription: boolean;
  defaultMode?: "paste" | "calibration";
}) {
  const toast = useToast();
  const [mode, setMode] = useState<"paste" | "calibration">(defaultMode);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [context, setContext] = useState("essay");
  const [confirmed, setConfirmed] = useState(false);
  const [spoken, setSpoken] = useState(false);
  const [interim, setInterim] = useState("");
  const [promptIdx, setPromptIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const d = useDictation({
    serverAvailable: serverTranscription,
    onInterim: setInterim,
    onResult: (r) => {
      setInterim("");
      setSpoken(true);
      setText((t) => (t ? `${t} ${r.text}` : r.text));
    },
  });
  useEffect(() => {
    if (open) {
      setMode(defaultMode);
      setText("");
      setTitle("");
      setConfirmed(false);
      setSpoken(false);
    }
  }, [open, defaultMode]);
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  const submit = async () => {
    setBusy(true);
    try {
      const r = await post<{ sample: { wordCount: number; exclusionNotes: string | null } }>("/writing/samples", {
        title: title.trim() || (mode === "calibration" ? "Calibration exercise" : "Pasted sample"),
        text,
        context: mode === "calibration" ? "general" : context,
        origin: spoken ? "dictation" : mode === "calibration" ? "calibration" : "paste",
        isSpoken: spoken,
        confirmedOwnWork: true,
      });
      toast(`Added ${r.sample.wordCount} words${r.sample.exclusionNotes ? ` — ${r.sample.exclusionNotes}` : ""}`);
      onAdded();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't add the sample", { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a writing sample"
      wide
      footer={
        <>
          <span className="mr-auto self-center text-xs text-faint">{words} words{words < 40 ? " · at least 40 needed" : ""}</span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!confirmed || words < 40} onClick={() => void submit()}>
            Add sample
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-1 rounded-xl bg-surface-2 p-1">
          {(["paste", "calibration"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={cx("flex-1 rounded-lg px-3 py-1.5 text-sm", mode === m ? "bg-surface font-medium shadow-sm" : "text-muted")}>
              {m === "paste" ? "Paste previous work" : "Quick calibration"}
            </button>
          ))}
        </div>
        {mode === "calibration" ? (
          <div className="rounded-xl border border-line bg-surface-2/60 p-4">
            <p className="text-sm leading-relaxed">{prompts[promptIdx]}</p>
            <button className="mt-2 text-xs text-muted hover:text-ink" onClick={() => setPromptIdx((i) => (i + 1) % prompts.length)}>
              Try a different prompt
            </button>
            <p className="mt-2 text-xs text-faint">Write or speak naturally — there's no right answer. A few paragraphs is plenty.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Year 1 marketing essay" maxLength={200} />
            </Field>
            <Field label="Type of writing">
              <Select value={context} onChange={(e) => setContext(e.target.value)}>
                {Object.entries(CONTEXT_LABELS)
                  .filter(([k]) => k !== "general")
                  .map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                <option value="general">Other</option>
              </Select>
            </Field>
          </div>
        )}
        <div className="space-y-2">
          <div className="relative">
            <Textarea
              rows={10}
              value={d.state === "recording" && interim ? `${text} ${interim}`.trim() : text}
              onChange={(e) => setText(e.target.value)}
              placeholder={mode === "paste" ? "Paste your writing here. References and quotes will be removed automatically." : "Start writing — or tap the mic and explain it out loud."}
              aria-label="Writing sample"
            />
            <div className="absolute bottom-2 right-2">
              <DictateButton d={d} size="sm" />
            </div>
          </div>
          <DictationStatus d={d} interim={d.mode === "browser" ? interim : undefined} />
          {spoken && <p className="text-xs text-muted">Spoken samples help Margin learn your vocabulary and how you explain things; they're weighted less than written work for formal writing.</p>}
        </div>
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
          <span>This is my own writing (not mostly AI-generated or written by someone else).</span>
        </label>
      </div>
    </Modal>
  );
}

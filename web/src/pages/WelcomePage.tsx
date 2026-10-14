import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Plus, X, PenLine, Upload, Check } from "lucide-react";
import { get, patch, post, del } from "../lib/api";
import { queryClient, useMe, useModules } from "../lib/queries";
import { moduleLabel } from "../lib/format";
import type { StudentProfile } from "../lib/types";
import { Button, Card, Field, Input, ProgressDots, cx } from "../components/ui";
import { ASSISTANCE_LEVELS, SUPPORT_OPTIONS } from "./SettingsPage";
import { AddSampleModal } from "./WritingPage";
import { useToast } from "../components/toast";

const STEPS = ["studies", "modules", "help", "writing", "done"] as const;

export function WelcomePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: me } = useMe();
  const { data: modules = [] } = useModules();
  const { data } = useQuery({ queryKey: ["profile"], queryFn: () => get<{ profile: StudentProfile }>("/profile") });
  const prompts = useQuery({ queryKey: ["writing"], queryFn: () => get<{ calibrationPrompts: string[] }>("/writing") });
  const [step, setStep] = useState(0);
  const [university, setUniversity] = useState("");
  const [programme, setProgramme] = useState("");
  const [year, setYear] = useState("");
  const [semester, setSemester] = useState("");
  const [rows, setRows] = useState([{ code: "", name: "" }]);
  const [level, setLevel] = useState<StudentProfile["assistanceLevel"]>("collaborative");
  const [supports, setSupports] = useState<string[]>(["one-next-step", "chunked"]);
  const [sampleOpen, setSampleOpen] = useState(false);
  const [sampleAdded, setSampleAdded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    const p = data.profile;
    setUniversity(p.university ?? "");
    setProgramme(p.programme ?? "");
    setYear(p.yearOfStudy ?? "");
    setSemester(p.semester ?? "");
    setLevel(p.assistanceLevel);
    if (p.learningPrefs.supports?.length) setSupports(p.learningPrefs.supports);
  }, [data]);

  const mark = (s: string, action: "complete" | "skip") => post("/profile/onboarding", { step: s, action }).catch(() => {});
  const next = async (action: "complete" | "skip" = "complete") => {
    setBusy(true);
    try {
      const s = STEPS[step];
      if (action === "complete") {
        if (s === "studies") await patch("/profile", { university: university || null, programme: programme || null, yearOfStudy: year || null, semester: semester || null });
        if (s === "modules") {
          for (const r of rows.filter((r) => r.name.trim())) await post("/modules", { code: r.code.trim() || null, name: r.name.trim() });
          setRows([{ code: "", name: "" }]);
          await queryClient.invalidateQueries({ queryKey: ["modules"] });
        }
        if (s === "help") await patch("/profile", { assistanceLevel: level, learningPrefs: { supports } });
      }
      await mark(s, action);
      setStep((i) => Math.min(i + 1, STEPS.length - 1));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save that step", { tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  const finish = async () => {
    await post("/profile/onboarding", { step: "done", action: "complete" });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    navigate("/");
  };

  const s = STEPS[step];
  return (
    <div className="mx-auto max-w-2xl py-4">
      <div className="mb-6 flex items-center justify-between">
        <ProgressDots total={STEPS.length} current={step} />
        <button onClick={() => void post("/profile/onboarding", { step: "all", action: "dismiss" }).then(() => navigate("/"))} className="text-sm text-muted hover:text-ink">
          Skip setup
        </button>
      </div>

      {s === "studies" && (
        <Card className="space-y-5 p-6">
          <div>
            <h1 className="font-display text-2xl font-semibold">Hi {me?.user?.displayName} — let's set up Margin.</h1>
            <p className="mt-1 text-sm text-muted">A few quick questions so I can help properly. About three minutes; skip anything you like.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="University">
              <Input value={university} onChange={(e) => setUniversity(e.target.value)} placeholder="e.g. University College Dublin" autoFocus />
            </Field>
            <Field label="Programme">
              <Input value={programme} onChange={(e) => setProgramme(e.target.value)} placeholder="e.g. BSc Business Information Systems" />
            </Field>
            <Field label="Year of study">
              <Input value={year} onChange={(e) => setYear(e.target.value)} placeholder="e.g. Year 2" />
            </Field>
            <Field label="Semester / term">
              <Input value={semester} onChange={(e) => setSemester(e.target.value)} placeholder="e.g. Autumn 2026" />
            </Field>
          </div>
          <StepButtons onNext={() => void next()} onSkip={() => void next("skip")} busy={busy} />
        </Card>
      )}

      {s === "modules" && (
        <Card className="space-y-5 p-6">
          <div>
            <h1 className="font-display text-2xl font-semibold">Which modules are you taking?</h1>
            <p className="mt-1 text-sm text-muted">Each module gets its own space for materials, chats and deadlines. You can add details later.</p>
          </div>
          {modules.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {modules.map((m) => (
                <li key={m.id} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1 text-sm">
                  <Check className="size-3.5 text-ok" /> {moduleLabel(m)}
                  <button
                    aria-label={`Remove ${m.name}`}
                    className="text-faint hover:text-danger"
                    onClick={async () => (await del(`/modules/${m.id}`), void queryClient.invalidateQueries({ queryKey: ["modules"] }))}
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[7rem_1fr_auto] gap-2">
                <Input value={r.code} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))} placeholder="Code" aria-label="Module code" />
                <Input
                  value={r.name}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  onKeyDown={(e) => e.key === "Enter" && r.name.trim() && setRows([...rows, { code: "", name: "" }])}
                  placeholder="Module name"
                  aria-label="Module name"
                  autoFocus={i === rows.length - 1}
                />
                <button aria-label="Remove row" className="px-2 text-faint hover:text-ink disabled:opacity-30" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  <X className="size-4" />
                </button>
              </div>
            ))}
            <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setRows([...rows, { code: "", name: "" }])}>
              Another module
            </Button>
          </div>
          <StepButtons onNext={() => void next()} onSkip={() => void next("skip")} busy={busy} nextLabel={rows.some((r) => r.name.trim()) ? "Add & continue" : "Continue"} />
        </Card>
      )}

      {s === "help" && (
        <Card className="space-y-5 p-6">
          <div>
            <h1 className="font-display text-2xl font-semibold">How should I help with assignments?</h1>
            <p className="mt-1 text-sm text-muted">You can switch any time, and always follow your university's rules on AI use.</p>
          </div>
          <div className="grid gap-2">
            {ASSISTANCE_LEVELS.map((l) => (
              <button
                key={l.key}
                onClick={() => setLevel(l.key)}
                className={cx("rounded-xl border p-4 text-left transition-colors", level === l.key ? "border-accent bg-accent-soft/60" : "border-line hover:border-line-strong")}
              >
                <p className="font-medium">{l.title}</p>
                <p className="mt-0.5 text-sm text-muted">{l.body}</p>
              </button>
            ))}
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">What helps you work? (pick any)</p>
            <div className="flex flex-wrap gap-2">
              {SUPPORT_OPTIONS.map((o) => {
                const on = supports.includes(o.key);
                return (
                  <button
                    key={o.key}
                    aria-pressed={on}
                    onClick={() => setSupports(on ? supports.filter((x) => x !== o.key) : [...supports, o.key])}
                    className={cx("rounded-full border px-3 py-1.5 text-sm", on ? "border-accent bg-accent-soft text-accent-text" : "border-line text-muted hover:text-ink")}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
          <StepButtons onNext={() => void next()} onSkip={() => void next("skip")} busy={busy} />
        </Card>
      )}

      {s === "writing" && (
        <Card className="space-y-5 p-6">
          <div>
            <h1 className="font-display text-2xl font-semibold">Help me learn how you write</h1>
            <p className="mt-1 text-sm text-muted">
              So that when I help you draft or edit, it still sounds like you — not like generic AI. Optional, and you can add more later.
            </p>
          </div>
          {sampleAdded ? (
            <p className="flex items-center gap-2 rounded-xl bg-ok-soft px-4 py-3 text-sm text-ok">
              <Check className="size-4" /> Sample added. Your profile is being built — see it under Writing voice.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <button onClick={() => setSampleOpen(true)} className="rounded-xl border border-line p-4 text-left hover:border-line-strong">
                <PenLine className="mb-2 size-5 text-accent" />
                <p className="font-medium">Two-minute exercise</p>
                <p className="mt-0.5 text-sm text-muted">Explain something in your own words — type it or say it.</p>
              </button>
              <Link to="/library" className="rounded-xl border border-line p-4 text-left hover:border-line-strong">
                <Upload className="mb-2 size-5 text-accent" />
                <p className="font-medium">Upload past work</p>
                <p className="mt-0.5 text-sm text-muted">Upload an essay to your library, then choose “Use as my writing sample”.</p>
              </Link>
            </div>
          )}
          <StepButtons onNext={() => void next(sampleAdded ? "complete" : "skip")} onSkip={() => void next("skip")} busy={busy} nextLabel={sampleAdded ? "Continue" : "Maybe later"} hideSkip />
          <AddSampleModal
            open={sampleOpen}
            onClose={() => setSampleOpen(false)}
            prompts={prompts.data?.calibrationPrompts ?? ["Explain a concept from one of your modules in your own words."]}
            onAdded={() => setSampleAdded(true)}
            serverTranscription={!!me?.capabilities.serverTranscription}
            defaultMode="calibration"
          />
        </Card>
      )}

      {s === "done" && (
        <Card className="space-y-5 p-6 text-center">
          <h1 className="font-display text-2xl font-semibold">You're set up.</h1>
          <p className="mx-auto max-w-md text-sm text-muted">
            The single most useful next thing: upload a module handbook or assignment brief, so my answers come from your actual course material.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {modules[0] && (
              <Button variant="primary" onClick={() => void post("/profile/onboarding", { step: "done", action: "complete" }).then(() => navigate(`/modules/${modules[0].id}`))}>
                Upload for {modules[0].code ?? modules[0].name} <ArrowRight className="size-4" />
              </Button>
            )}
            <Button variant={modules[0] ? "secondary" : "primary"} onClick={() => void finish()}>
              Go to Today
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function StepButtons({ onNext, onSkip, busy, nextLabel = "Continue", hideSkip }: { onNext: () => void; onSkip: () => void; busy: boolean; nextLabel?: string; hideSkip?: boolean }) {
  return (
    <div className="flex items-center justify-end gap-2 pt-2">
      {!hideSkip && (
        <Button variant="ghost" onClick={onSkip} disabled={busy}>
          Skip
        </Button>
      )}
      <Button variant="primary" onClick={onNext} loading={busy}>
        {nextLabel} <ArrowRight className="size-4" />
      </Button>
    </div>
  );
}

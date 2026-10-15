import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, XCircle, Download, LogOut } from "lucide-react";
import { del, get, patch, post } from "../lib/api";
import { queryClient, useMe } from "../lib/queries";
import { usePrefs } from "../lib/prefs";
import { speak, speechSupported, useVoices } from "../lib/speech";
import type { StudentProfile } from "../lib/types";
import { Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, Toggle, cx } from "../components/ui";
import { useToast } from "../components/toast";

export const SUPPORT_OPTIONS = [
  { key: "one-next-step", label: "Give me one next step" },
  { key: "chunked", label: "Break things into small chunks" },
  { key: "examples-first", label: "Examples before theory" },
  { key: "check-ins", label: "Check I've understood" },
  { key: "plain-english", label: "Plain English first" },
  { key: "time-estimates", label: "Tell me how long things take" },
];

export const ASSISTANCE_LEVELS = [
  { key: "guided", title: "Guide me", body: "Teach me and ask questions so I develop my own ideas. Don't write assessed work for me." },
  { key: "collaborative", title: "Work with me", body: "Brainstorm, outline, give feedback and draft sections together." },
  { key: "drafting", title: "Draft for me", body: "Produce substantial drafts from my instructions and sources, which I then review and make my own." },
] as const;

function Status({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <div className="flex items-start gap-3 py-2">
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-faint" />}
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted">{hint}</p>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const toast = useToast();
  const { data: me } = useMe();
  const [prefs, setPrefs] = usePrefs();
  const voices = useVoices();
  const { data } = useQuery({ queryKey: ["profile"], queryFn: () => get<{ profile: StudentProfile }>("/profile") });
  const usage = useQuery({ queryKey: ["usage"], queryFn: () => get<{ usage: { purpose: string; model: string; calls: number; input: number; output: number; cache_read: number }[] }>("/account/usage") });
  const [form, setForm] = useState<Partial<StudentProfile> & { displayName?: string }>({});
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePw, setDeletePw] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");

  useEffect(() => {
    if (data) setForm({ ...data.profile, displayName: me?.user?.displayName });
  }, [data, me?.user?.displayName]);
  if (!data || !me) return <Spinner />;

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const supports = form.learningPrefs?.supports ?? [];
  const save = async () => {
    try {
      await patch("/profile", {
        displayName: form.displayName,
        university: form.university || null,
        programme: form.programme || null,
        yearOfStudy: form.yearOfStudy || null,
        semester: form.semester || null,
        assistanceLevel: form.assistanceLevel,
        accessibilityNotes: form.accessibilityNotes || null,
        learningPrefs: form.learningPrefs,
      });
      await queryClient.invalidateQueries({ queryKey: ["profile"] });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      toast("Settings saved");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save", { tone: "error" });
    }
  };
  const logout = async () => {
    await post("/auth/logout");
    queryClient.clear();
    window.location.href = "/";
  };
  const deleteAccount = async () => {
    try {
      await del("/account", { password: deletePw, confirm: deleteConfirm });
      queryClient.clear();
      window.location.href = "/";
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't delete", { tone: "error" });
    }
  };
  const totalTokens = (usage.data?.usage ?? []).reduce((s, u) => s + u.input + u.output, 0);

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" />
      <div className="space-y-6">
        <Card className="space-y-4 p-5">
          <h2 className="font-display text-lg font-semibold">About you</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input value={form.displayName ?? ""} onChange={(e) => set("displayName", e.target.value)} />
            </Field>
            <Field label="University">
              <Input value={form.university ?? ""} onChange={(e) => set("university", e.target.value)} />
            </Field>
            <Field label="Programme">
              <Input value={form.programme ?? ""} onChange={(e) => set("programme", e.target.value)} placeholder="BSc Business Information Systems" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Year">
                <Input value={form.yearOfStudy ?? ""} onChange={(e) => set("yearOfStudy", e.target.value)} placeholder="Year 2" />
              </Field>
              <Field label="Semester">
                <Input value={form.semester ?? ""} onChange={(e) => set("semester", e.target.value)} placeholder="Autumn" />
              </Field>
            </div>
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="font-display text-lg font-semibold">How Margin helps</h2>
          <div className="grid gap-2 sm:grid-cols-3">
            {ASSISTANCE_LEVELS.map((l) => (
              <button
                key={l.key}
                onClick={() => set("assistanceLevel", l.key)}
                className={cx("rounded-xl border p-3 text-left transition-colors", form.assistanceLevel === l.key ? "border-accent bg-accent-soft/60" : "border-line hover:border-line-strong")}
              >
                <p className="text-sm font-medium">{l.title}</p>
                <p className="mt-1 text-xs text-muted">{l.body}</p>
              </button>
            ))}
          </div>
          <div className="space-y-1.5" role="group" aria-labelledby="supports-label">
            <p id="supports-label" className="text-sm font-medium">
              What helps you
            </p>
            <div className="flex flex-wrap gap-2">
              {SUPPORT_OPTIONS.map((s) => {
                const on = supports.includes(s.key);
                return (
                  <button
                    key={s.key}
                    onClick={() => set("learningPrefs", { ...form.learningPrefs, supports: on ? supports.filter((x) => x !== s.key) : [...supports, s.key] })}
                    className={cx("rounded-full border px-3 py-1.5 text-sm", on ? "border-accent bg-accent-soft text-accent-text" : "border-line text-muted hover:text-ink")}
                    aria-pressed={on}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Level of detail">
              <Select value={form.learningPrefs?.detailLevel ?? "balanced"} onChange={(e) => set("learningPrefs", { ...form.learningPrefs, detailLevel: e.target.value as "brief" })}>
                <option value="brief">Brief — just the essentials</option>
                <option value="balanced">Balanced</option>
                <option value="detailed">Detailed — give me depth</option>
              </Select>
            </Field>
            <Field label="Explanations I like">
              <Input value={form.learningPrefs?.explanationStyle ?? ""} onChange={(e) => set("learningPrefs", { ...form.learningPrefs, explanationStyle: e.target.value })} placeholder="e.g. real-world analogies" />
            </Field>
          </div>
          <Field label="Accessibility or study support (optional)" hint="Only share what you're comfortable with. It's used to shape how Margin communicates.">
            <Textarea rows={2} value={form.accessibilityNotes ?? ""} onChange={(e) => set("accessibilityNotes", e.target.value)} maxLength={2000} />
          </Field>
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => void save()}>
              Save
            </Button>
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="font-display text-lg font-semibold">Appearance (this device)</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Theme">
              <Select value={prefs.theme} onChange={(e) => setPrefs({ theme: e.target.value as "system" })}>
                <option value="system">Match system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </Select>
            </Field>
            <Field label="Text size">
              <Select value={prefs.text} onChange={(e) => setPrefs({ text: e.target.value as "medium" })}>
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
              </Select>
            </Field>
            <Field label="Motion">
              <Select value={prefs.motion} onChange={(e) => setPrefs({ motion: e.target.value as "system" })}>
                <option value="system">Match system</option>
                <option value="reduce">Reduce motion</option>
              </Select>
            </Field>
          </div>
          {speechSupported() && (
            <div className="space-y-3 border-t border-line pt-4">
              <p className="text-sm font-medium">Read aloud</p>
              <p className="text-xs text-muted">Highlight any text, or use the speaker button on a message, to have it read to you. Runs in your browser — nothing is sent anywhere.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Voice">
                  <Select value={prefs.ttsVoice} onChange={(e) => setPrefs({ ttsVoice: e.target.value })}>
                    <option value="">Browser default</option>
                    {voices.map((v) => (
                      <option key={v.voiceURI} value={v.voiceURI}>
                        {v.name} ({v.lang})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={`Speed: ${prefs.ttsRate}×`}>
                  <input type="range" min={0.6} max={1.6} step={0.05} value={prefs.ttsRate} onChange={(e) => setPrefs({ ttsRate: Number(e.target.value) })} className="h-11 w-full accent-[var(--accent)]" />
                </Field>
              </div>
              <Button size="sm" variant="soft" onClick={() => speak("This is how Margin will read to you. You can change the voice and speed here.")}>
                Test voice
              </Button>
            </div>
          )}
          <Toggle checked={prefs.enterToSend} onChange={(v) => setPrefs({ enterToSend: v })} label="Enter sends messages" description="Off: Enter adds a new line and you click send. (Always off on touch screens.)" />
        </Card>

        <Card className="p-5">
          <h2 className="mb-2 font-display text-lg font-semibold">Connections</h2>
          <Status ok={me.capabilities.ai} label="AI model" hint={me.capabilities.ai ? "Connected. Answers, document analysis and memory are on." : "Not connected — set ANTHROPIC_API_KEY in the server's .env file."} />
          <Status ok={me.capabilities.semanticSearch} label="Semantic search" hint={me.capabilities.semanticSearch ? "On — search understands meaning, not just keywords." : "Keyword search only."} />
          <Status
            ok={me.capabilities.serverTranscription}
            label="Voice transcription"
            hint={
              me.capabilities.serverTranscription
                ? "Server transcription is on. Recordings are sent for transcription and never stored."
                : "Using your browser's built-in speech recognition where available (Chrome/Edge send audio to their speech service). Set STT_API_KEY for more accurate transcription."
            }
          />
          {totalTokens > 0 && <p className="mt-3 text-xs text-muted">AI usage, last 30 days: {totalTokens.toLocaleString()} tokens across {(usage.data?.usage ?? []).reduce((s, u) => s + u.calls, 0)} requests.</p>}
        </Card>

        <Card className="space-y-3 p-5">
          <h2 className="font-display text-lg font-semibold">Your data</h2>
          <p className="text-sm text-muted">Everything is stored on your Margin server. Uploaded files and relevant passages are sent to the AI provider only when needed to answer you; raw voice recordings are never stored.</p>
          <div className="flex flex-wrap gap-2">
            <a href="/api/account/export">
              <Button icon={<Download className="size-4" />}>Export all my data</Button>
            </a>
            <Button variant="ghost" icon={<LogOut className="size-4" />} onClick={() => void logout()}>
              Sign out
            </Button>
            <Button variant="danger" className="ml-auto" onClick={() => setDeleteOpen(true)}>
              Delete account
            </Button>
          </div>
        </Card>
      </div>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete your account"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={deleteConfirm !== "DELETE" || !deletePw} onClick={() => void deleteAccount()}>
              Permanently delete
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm">
          <p>This permanently deletes your conversations, documents, memories, writing profile and planner. It can't be undone. Consider exporting your data first.</p>
          <Field label="Password">
            <Input type="password" value={deletePw} onChange={(e) => setDeletePw(e.target.value)} autoComplete="current-password" />
          </Field>
          <Field label='Type "DELETE" to confirm'>
            <Input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

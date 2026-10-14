import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, CalendarClock, CheckCircle2, Circle, FileText, ListTodo, MessageSquare, Plus, Sparkles, AlertCircle, Loader2 } from "lucide-react";
import { patch, post } from "../lib/api";
import { refreshAfterActivity, useDashboard, useMe } from "../lib/queries";
import { dueLabel, greeting, moduleLabel, MODULE_COLORS, timeAgo, urgency } from "../lib/format";
import { useDictation } from "../hooks/useDictation";
import { DictateButton, DictationStatus } from "../components/Dictation";
import { Button, Card, cx, Spinner } from "../components/ui";
import { DeadlineModal, TaskModal } from "../components/QuickModals";
import { useToast } from "../components/toast";

function QuickCapture({ serverTranscription }: { serverTranscription: boolean }) {
  const [text, setText] = useState("");
  const [interim, setInterim] = useState("");
  const [voice, setVoice] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();
  const d = useDictation({
    serverAvailable: serverTranscription,
    onInterim: setInterim,
    onResult: (r) => {
      setInterim("");
      setVoice(true);
      setText((t) => (t ? `${t} ${r.text}` : r.text));
    },
  });

  const ask = () => text.trim() && navigate(`/chat?prompt=${encodeURIComponent(text.trim())}&autosend=1${voice ? "&voice=1" : ""}`);
  const saveTask = async () => {
    if (!text.trim()) return;
    await post("/planner/tasks", { title: text.trim().slice(0, 300), priority: "essential" });
    setText("");
    setVoice(false);
    refreshAfterActivity();
    toast("Captured as a task");
  };

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2 rounded-2xl border border-line bg-surface p-2 shadow-soft focus-within:border-accent/60">
        <textarea
          value={d.state === "recording" && interim ? `${text} ${interim}`.trim() : text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask();
            }
          }}
          rows={1}
          placeholder="Jot a thought or ask…"
          aria-label="Quick capture"
          className="min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[0.98rem] placeholder:text-faint focus:outline-none"
        />
        <DictateButton d={d} />
        <Button variant="ghost" size="md" disabled={!text.trim()} onClick={() => void saveTask()} title="Save as a task">
          <ListTodo className="size-4" />
          <span className="hidden sm:inline">Task</span>
        </Button>
        <Button variant="primary" disabled={!text.trim()} onClick={ask}>
          Ask
        </Button>
      </div>
      <DictationStatus d={d} interim={d.mode === "browser" ? interim : undefined} />
    </div>
  );
}

export function Dashboard() {
  const { data: me } = useMe();
  const { data, isLoading } = useDashboard();
  const navigate = useNavigate();
  const [taskOpen, setTaskOpen] = useState(false);
  const [deadlineOpen, setDeadlineOpen] = useState(false);

  if (isLoading || !data) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }
  const step = data.nextStep;
  const runStep = () => {
    if (step.action.href) navigate(step.action.href);
    else if (step.action.prompt) navigate(`/chat?prompt=${encodeURIComponent(step.action.prompt)}&autosend=1${step.action.moduleId ? `&module=${step.action.moduleId}` : ""}`);
  };
  const moduleById = new Map(data.modules.map((m) => [m.id, m]));
  const toggleTask = async (id: string, status: string) => {
    await patch(`/planner/tasks/${id}`, { status: status === "done" ? "todo" : "done" });
    refreshAfterActivity();
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-muted">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</p>
        <h1 className="font-display text-[1.9rem] font-semibold tracking-tight">
          {greeting()}, {me?.user?.displayName}
        </h1>
      </header>

      {/* The one thing */}
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-text">
            <Sparkles className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-accent-text">Your next step</p>
            <h2 className="mt-0.5 font-display text-xl font-semibold leading-snug">{step.title}</h2>
            <p className="mt-1 text-sm text-muted">{step.reason}</p>
          </div>
          <Button variant="primary" size="lg" onClick={runStep} className="shrink-0">
            {step.action.label} <ArrowRight className="size-4" />
          </Button>
        </div>
      </Card>

      <QuickCapture serverTranscription={!!me?.capabilities.serverTranscription} />

      {data.processing.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 px-4 py-2.5 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" />
          Reading {data.processing.length} file{data.processing.length === 1 ? "" : "s"}: {data.processing.map((p) => p.filename).join(", ")}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Deadlines */}
        <Card>
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="flex items-center gap-2 font-medium">
              <CalendarClock className="size-4 text-muted" /> Coming up
            </h2>
            <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setDeadlineOpen(true)}>
              Add
            </Button>
          </div>
          {data.counts.suggestedDeadlines > 0 && (
            <Link to="/planner" className="flex items-center gap-2 border-b border-line bg-warn-soft/60 px-5 py-2.5 text-sm text-warn hover:underline">
              <AlertCircle className="size-4" /> {data.counts.suggestedDeadlines} date{data.counts.suggestedDeadlines === 1 ? "" : "s"} found in your documents — confirm them
            </Link>
          )}
          <ul className="divide-y divide-line">
            {data.deadlines.slice(0, 5).map((d) => {
              const u = urgency(d.dueAt);
              const mod = d.moduleId ? moduleById.get(d.moduleId) : undefined;
              return (
                <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                  <span className={cx("h-8 w-1 shrink-0 rounded-full", u === "overdue" ? "bg-danger" : u === "soon" ? "bg-warn" : "bg-line-strong")} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{d.title}</p>
                    <p className="truncate text-xs text-muted">
                      {mod ? `${mod.code ?? mod.name} · ` : ""}
                      {d.kind === "exam" ? "Exam · " : ""}
                      {dueLabel(d.dueAt, d.allDay)}
                    </p>
                  </div>
                </li>
              );
            })}
            {!data.deadlines.length && <li className="px-5 py-6 text-center text-sm text-muted">No confirmed deadlines in the next two months.</li>}
          </ul>
        </Card>

        {/* Tasks */}
        <Card>
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="flex items-center gap-2 font-medium">
              <ListTodo className="size-4 text-muted" /> Tasks
            </h2>
            <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setTaskOpen(true)}>
              Add
            </Button>
          </div>
          <ul className="divide-y divide-line">
            {data.tasks.slice(0, 5).map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-5 py-3">
                <button aria-label={t.status === "done" ? "Mark as not done" : "Mark as done"} onClick={() => void toggleTask(t.id, t.status)} className="text-faint hover:text-accent">
                  {t.status === "done" ? <CheckCircle2 className="size-5 text-ok" /> : <Circle className="size-5" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.title}</p>
                  {(t.dueAt || t.doneWhen) && (
                    <p className="truncate text-xs text-muted">
                      {t.dueAt ? dueLabel(t.dueAt, true) : ""}
                      {t.dueAt && t.doneWhen ? " · " : ""}
                      {t.doneWhen ? `Done when: ${t.doneWhen}` : ""}
                    </p>
                  )}
                </div>
                {t.priority === "optional" && <span className="text-[0.7rem] text-faint">optional</span>}
                {t.status === "doing" && <span className="text-[0.7rem] font-medium text-accent-text">in progress</span>}
              </li>
            ))}
            {!data.tasks.length && <li className="px-5 py-6 text-center text-sm text-muted">Nothing on your list. Capture a thought above to add one.</li>}
          </ul>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="font-medium">Modules</h2>
            <Link to="/modules" className="text-sm text-muted hover:text-ink">
              Manage
            </Link>
          </div>
          <ul className="divide-y divide-line">
            {data.modules.map((m) => (
              <li key={m.id}>
                <Link to={`/modules/${m.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2/60">
                  <span className="size-2.5 rounded-full" style={{ background: MODULE_COLORS[m.color]?.dot }} />
                  <span className="min-w-0 flex-1 truncate text-sm">{moduleLabel(m)}</span>
                  <span className="flex items-center gap-1 text-xs text-faint">
                    <FileText className="size-3" /> {m.documentCount}
                  </span>
                </Link>
              </li>
            ))}
            {!data.modules.length && (
              <li className="px-5 py-6 text-center text-sm text-muted">
                <Link to="/modules" className="font-medium text-accent-text hover:underline">
                  Add your first module
                </Link>
              </li>
            )}
          </ul>
        </Card>

        <Card>
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="font-medium">Recent conversations</h2>
            <Link to="/chat" className="text-sm text-muted hover:text-ink">
              New
            </Link>
          </div>
          <ul className="divide-y divide-line">
            {data.recentConversations.map((c) => (
              <li key={c.id}>
                <Link to={`/chat/${c.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2/60">
                  <MessageSquare className="size-4 shrink-0 text-faint" />
                  <span className="min-w-0 flex-1 truncate text-sm">{c.title}</span>
                  <span className="shrink-0 text-xs text-faint">{timeAgo(c.updatedAt)}</span>
                </Link>
              </li>
            ))}
            {!data.recentConversations.length && <li className="px-5 py-6 text-center text-sm text-muted">Your conversations will appear here.</li>}
          </ul>
        </Card>
      </div>

      <TaskModal open={taskOpen} onClose={() => setTaskOpen(false)} />
      <DeadlineModal open={deadlineOpen} onClose={() => setDeadlineOpen(false)} />
    </div>
  );
}

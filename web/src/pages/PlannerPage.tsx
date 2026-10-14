import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Check, X, CalendarPlus, ListPlus, Circle, CheckCircle2, PlayCircle, Trash2, FileText, Quote } from "lucide-react";
import { del, get, patch } from "../lib/api";
import { refreshAfterActivity, useModules } from "../lib/queries";
import { dueLabel, MODULE_COLORS, urgency } from "../lib/format";
import type { Deadline, Task } from "../lib/types";
import { Badge, Button, Card, EmptyState, IconButton, Input, PageHeader, Spinner, cx } from "../components/ui";
import { DeadlineModal, TaskModal } from "../components/QuickModals";
import { useToast } from "../components/toast";

export function PlannerPage() {
  const toast = useToast();
  const { data: modules = [] } = useModules();
  const moduleById = new Map(modules.map((m) => [m.id, m]));
  const [deadlineOpen, setDeadlineOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");

  const dl = useQuery({ queryKey: ["planner", "deadlines"], queryFn: async () => (await get<{ deadlines: Deadline[] }>("/planner/deadlines")).deadlines });
  const tk = useQuery({ queryKey: ["planner", "tasks", showDone], queryFn: async () => (await get<{ tasks: Task[] }>(`/planner/tasks?includeDone=${showDone}`)).tasks });

  const setDeadline = async (id: string, body: Record<string, unknown>, msg?: string) => {
    await patch(`/planner/deadlines/${id}`, body);
    refreshAfterActivity();
    if (msg) toast(msg);
  };
  const setTask = async (id: string, body: Record<string, unknown>) => {
    await patch(`/planner/tasks/${id}`, body);
    refreshAfterActivity();
  };

  const suggested = dl.data?.filter((d) => d.status === "suggested") ?? [];
  const confirmed = dl.data?.filter((d) => d.status === "confirmed") ?? [];
  const tasks = tk.data ?? [];
  const essential = tasks.filter((t) => t.priority === "essential" && t.status !== "done");
  const optional = tasks.filter((t) => t.priority === "optional" && t.status !== "done");
  const done = tasks.filter((t) => t.status === "done");

  const modTag = (id: string | null) => {
    const m = id ? moduleById.get(id) : undefined;
    return m ? (
      <span className="inline-flex items-center gap-1 text-xs text-muted">
        <span className="size-1.5 rounded-full" style={{ background: MODULE_COLORS[m.color]?.dot }} />
        {m.code ?? m.name}
      </span>
    ) : null;
  };

  const taskRow = (t: Task) => (
    <li key={t.id} className="group flex items-start gap-3 px-5 py-3">
      <button
        aria-label={t.status === "done" ? "Mark not done" : "Mark done"}
        className="mt-0.5 text-faint hover:text-accent"
        onClick={() => void setTask(t.id, { status: t.status === "done" ? "todo" : "done" })}
      >
        {t.status === "done" ? <CheckCircle2 className="size-5 text-ok" /> : t.status === "doing" ? <PlayCircle className="size-5 text-accent" /> : <Circle className="size-5" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={cx("text-sm font-medium", t.status === "done" && "text-muted line-through")}>{t.title}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
          {modTag(t.moduleId)}
          {t.dueAt && <span>{dueLabel(t.dueAt, true)}</span>}
          {t.estimateMinutes && <span>~{t.estimateMinutes} min</span>}
          {t.doneWhen && <span>Done when: {t.doneWhen}</span>}
        </div>
      </div>
      {t.status === "todo" && (
        <Button size="sm" variant="ghost" className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100" onClick={() => void setTask(t.id, { status: "doing" })}>
          Start
        </Button>
      )}
      <Link
        to={`/chat?prompt=${encodeURIComponent(`Help me get started on this task: "${t.title}"${t.doneWhen ? ` (done when: ${t.doneWhen})` : ""}. Give me one small first step.`)}&autosend=1${t.moduleId ? `&module=${t.moduleId}` : ""}`}
        className="hidden text-xs font-medium text-accent-text hover:underline sm:group-hover:inline"
      >
        Help me start
      </Link>
      <IconButton label="Delete task" size="sm" onClick={async () => (await del(`/planner/tasks/${t.id}`), refreshAfterActivity())}>
        <Trash2 className="size-3.5" />
      </IconButton>
    </li>
  );

  return (
    <div>
      <PageHeader
        title="Planner"
        description="Deadlines and small, doable tasks. Dates found in your documents wait here until you confirm them."
        actions={
          <>
            <Button variant="secondary" icon={<CalendarPlus className="size-4" />} onClick={() => setDeadlineOpen(true)}>
              Deadline
            </Button>
            <Button variant="primary" icon={<ListPlus className="size-4" />} onClick={() => setTaskOpen(true)}>
              Task
            </Button>
          </>
        }
      />

      {suggested.length > 0 && (
        <Card className="mb-6 border-warn/30">
          <div className="border-b border-line bg-warn-soft/50 px-5 py-3">
            <h2 className="font-medium">Found in your documents — please check</h2>
            <p className="text-xs text-muted">Margin won't treat these as real deadlines until you confirm them.</p>
          </div>
          <ul className="divide-y divide-line">
            {suggested.map((d) => (
              <li key={d.id} className="space-y-2 px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{d.title}</span>
                  {modTag(d.moduleId)}
                  <Badge tone="warn">{new Date(d.dueAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</Badge>
                </div>
                {d.sourceExcerpt && (
                  <p className="flex items-start gap-1.5 text-xs text-muted">
                    <Quote className="mt-0.5 size-3 shrink-0" /> {d.sourceExcerpt}
                    {d.sourceDocumentId && (
                      <Link to={`/library/${d.sourceDocumentId}`} className="ml-1 inline-flex shrink-0 items-center gap-0.5 font-medium text-accent-text hover:underline">
                        <FileText className="size-3" /> source
                      </Link>
                    )}
                  </p>
                )}
                {editing === d.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input type="datetime-local" className="h-9 w-auto" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                    <Button size="sm" variant="primary" onClick={() => (setEditing(null), void setDeadline(d.id, { dueAt: new Date(editDate).toISOString(), allDay: false, status: "confirmed" }, "Deadline confirmed"))}>
                      Save & confirm
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} onClick={() => void setDeadline(d.id, { status: "confirmed" }, "Deadline confirmed")}>
                      Confirm
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => (setEditing(d.id), setEditDate(d.dueAt.slice(0, 16)))}>
                      Change date
                    </Button>
                    <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => void setDeadline(d.id, { status: "dismissed" })}>
                      Not a deadline
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="border-b border-line px-5 py-3.5">
            <h2 className="font-medium">Deadlines</h2>
          </div>
          {dl.isLoading ? (
            <div className="p-5">
              <Spinner />
            </div>
          ) : confirmed.length ? (
            <ul className="divide-y divide-line">
              {confirmed.map((d) => {
                const u = urgency(d.dueAt);
                return (
                  <li key={d.id} className="group flex items-center gap-3 px-5 py-3">
                    <span className={cx("h-9 w-1 shrink-0 rounded-full", u === "overdue" ? "bg-danger" : u === "soon" ? "bg-warn" : u === "upcoming" ? "bg-accent" : "bg-line-strong")} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {d.title} {d.kind === "exam" && <Badge>exam</Badge>}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
                        {modTag(d.moduleId)}
                        <span className={cx(u === "overdue" && "text-danger")}>{dueLabel(d.dueAt, d.allDay)}</span>
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100" onClick={() => void setDeadline(d.id, { status: "done" }, "Marked as submitted 🎉")}>
                      Done
                    </Button>
                    <IconButton label="Delete deadline" size="sm" onClick={async () => (await del(`/planner/deadlines/${d.id}`), refreshAfterActivity())}>
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="No deadlines yet">Add them yourself, or upload an assignment brief and Margin will find the dates for you to confirm.</EmptyState>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="font-medium">Tasks</h2>
            <button className="text-xs text-muted hover:text-ink" onClick={() => setShowDone((s) => !s)}>
              {showDone ? "Hide completed" : "Show completed"}
            </button>
          </div>
          {tk.isLoading ? (
            <div className="p-5">
              <Spinner />
            </div>
          ) : (
            <>
              {essential.length > 0 && <ul className="divide-y divide-line">{essential.map(taskRow)}</ul>}
              {optional.length > 0 && (
                <>
                  <p className="border-t border-line bg-surface-2/50 px-5 py-1.5 text-xs font-medium text-muted">Nice to have</p>
                  <ul className="divide-y divide-line">{optional.map(taskRow)}</ul>
                </>
              )}
              {showDone && done.length > 0 && (
                <>
                  <p className="border-t border-line bg-surface-2/50 px-5 py-1.5 text-xs font-medium text-muted">Completed</p>
                  <ul className="divide-y divide-line">{done.map(taskRow)}</ul>
                </>
              )}
              {!essential.length && !optional.length && (
                <EmptyState title="Nothing to do — for now">Break big work into tasks you could start in under 15 minutes. Ask Margin to help split an assignment up.</EmptyState>
              )}
            </>
          )}
        </Card>
      </div>
      <DeadlineModal open={deadlineOpen} onClose={() => setDeadlineOpen(false)} />
      <TaskModal open={taskOpen} onClose={() => setTaskOpen(false)} />
      {modules.length === 0 && (
        <p className="mt-6 text-sm text-muted">
          Tip:{" "}
          <Link to="/modules" className="text-accent-text hover:underline">
            add your modules
          </Link>{" "}
          to group deadlines and tasks.
        </p>
      )}
    </div>
  );
}

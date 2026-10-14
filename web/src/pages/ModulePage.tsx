import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MessageSquarePlus, RefreshCw, Archive, Trash2, Pencil, CalendarPlus, ListPlus, Brain, Sparkles } from "lucide-react";
import { del, get, patch, post } from "../lib/api";
import { queryClient, refreshAfterActivity, useMe } from "../lib/queries";
import { dueLabel, MODULE_COLORS, relativeDay } from "../lib/format";
import type { Deadline, DocumentSummary, Memory, Module, Task } from "../lib/types";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Spinner, Textarea, cx } from "../components/ui";
import { DocumentRow, UploadZone } from "../components/Documents";
import { Markdown } from "../components/Markdown";
import { DeadlineModal, SaveMemoryModal, TaskModal } from "../components/QuickModals";
import { useToast } from "../components/toast";

type ModuleDetail = {
  module: Module;
  documents: DocumentSummary[];
  conversations: { id: string; title: string; updatedAt: string; kind: string }[];
  deadlines: Deadline[];
  memories: Memory[];
  tasks: Task[];
};

const TABS = ["Overview", "Materials", "Conversations", "Planner", "Memory"] as const;

export function ModulePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: me } = useMe();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const [editing, setEditing] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [deadlineOpen, setDeadlineOpen] = useState(false);
  const [memOpen, setMemOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["modules", id],
    queryFn: () => get<ModuleDetail>(`/modules/${id}`),
    refetchInterval: (q) => (q.state.data?.documents.some((d) => d.status === "queued" || d.status === "processing") ? 2500 : false),
  });

  if (isLoading || !data) return <Spinner />;
  const m = data.module;
  const color = MODULE_COLORS[m.color]?.dot;
  const suggested = data.deadlines.filter((d) => d.status === "suggested");

  const refreshProfile = async () => {
    setProfileBusy(true);
    try {
      await post(`/modules/${m.id}/profile`);
      await queryClient.invalidateQueries({ queryKey: ["modules", id] });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't build the profile", { tone: "error" });
    } finally {
      setProfileBusy(false);
    }
  };

  const archive = async () => {
    await patch(`/modules/${m.id}`, { archived: !m.archived });
    refreshAfterActivity();
    toast(m.archived ? "Module restored" : "Module archived");
  };
  const remove = async () => {
    if (!confirm(`Delete ${m.name}? Its documents and conversations are kept but detached; its memories and deadlines are deleted.`)) return;
    await del(`/modules/${m.id}`);
    refreshAfterActivity();
    navigate("/modules");
  };
  const newChat = () => navigate(`/chat?module=${m.id}`);

  return (
    <div>
      <header className="mb-6">
        <div className="mb-3 h-1 w-12 rounded-full" style={{ background: color }} />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {m.code && <p className="text-xs font-semibold uppercase tracking-wider text-muted">{m.code}</p>}
            <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-[1.75rem]">{m.name}</h1>
            {(m.coordinator || m.lecturers.length > 0) && (
              <p className="mt-1 text-sm text-muted">{[m.coordinator && `Coordinator: ${m.coordinator}`, m.lecturers.length && `Lecturers: ${m.lecturers.join(", ")}`].filter(Boolean).join(" · ")}</p>
            )}
            {m.archived && <Badge className="mt-2">Archived</Badge>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={<MessageSquarePlus className="size-4" />} onClick={newChat}>
              Ask about this module
            </Button>
            <Button variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
              Edit
            </Button>
          </div>
        </div>
      </header>

      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cx("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors", tab === t ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink")}
          >
            {t}
            {t === "Materials" && ` (${data.documents.length})`}
            {t === "Planner" && suggested.length > 0 && <span className="ml-1.5 rounded-full bg-warn-soft px-1.5 text-[0.7rem] text-warn">{suggested.length}</span>}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-medium">What Margin knows</h2>
              <Button size="sm" variant="ghost" loading={profileBusy} disabled={!me?.capabilities.ai} icon={<RefreshCw className="size-3.5" />} onClick={() => void refreshProfile()}>
                {m.profileSummary ? "Refresh" : "Build profile"}
              </Button>
            </div>
            {m.profileSummary ? (
              <>
                <Markdown text={m.profileSummary} />
                <p className="mt-3 text-xs text-faint">Updated {m.profileUpdatedAt ? relativeDay(m.profileUpdatedAt) : ""}. Check important details against your documents.</p>
              </>
            ) : (
              <div className="text-sm text-muted">
                <p>Upload the module handbook, assignment briefs or rubrics, then build a profile. Margin will summarise what it knows — and what's still missing.</p>
                {!me?.capabilities.ai && <p className="mt-2 text-warn">Building profiles needs the AI model to be connected.</p>}
              </div>
            )}
            {m.description && <p className="mt-4 border-t border-line pt-4 text-sm text-muted">{m.description}</p>}
          </Card>
          <div className="space-y-4">
            <Card className="p-4">
              <h3 className="mb-2 text-sm font-medium">Next up</h3>
              {data.deadlines.filter((d) => d.status === "confirmed").slice(0, 3).map((d) => (
                <p key={d.id} className="text-sm">
                  {d.title} <span className="text-muted">· {dueLabel(d.dueAt, d.allDay)}</span>
                </p>
              ))}
              {!data.deadlines.some((d) => d.status === "confirmed") && <p className="text-sm text-muted">No confirmed deadlines.</p>}
            </Card>
            <UploadZone moduleId={m.id} compact />
          </div>
        </div>
      )}

      {tab === "Materials" && (
        <div className="space-y-4">
          <UploadZone moduleId={m.id} />
          <Card>
            {data.documents.length ? (
              <div className="divide-y divide-line">{data.documents.map((d) => <DocumentRow key={d.id} doc={d} />)}</div>
            ) : (
              <EmptyState title="No materials yet">Handbooks, briefs, rubrics, slides and readings all help Margin give grounded answers.</EmptyState>
            )}
          </Card>
        </div>
      )}

      {tab === "Conversations" && (
        <Card>
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="font-medium">Conversations</h2>
            <Button size="sm" variant="soft" icon={<MessageSquarePlus className="size-3.5" />} onClick={newChat}>
              New
            </Button>
          </div>
          <ul className="divide-y divide-line">
            {data.conversations.map((c) => (
              <li key={c.id}>
                <Link to={`/chat/${c.id}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-surface-2/60">
                  <span className="truncate">{c.title}</span>
                  <span className="shrink-0 text-xs text-faint">{relativeDay(c.updatedAt)}</span>
                </Link>
              </li>
            ))}
            {!data.conversations.length && <li className="px-5 py-8 text-center text-sm text-muted">No conversations in this module yet.</li>}
          </ul>
        </Card>
      )}

      {tab === "Planner" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="soft" icon={<CalendarPlus className="size-4" />} onClick={() => setDeadlineOpen(true)}>
              Add deadline
            </Button>
            <Button variant="soft" icon={<ListPlus className="size-4" />} onClick={() => setTaskOpen(true)}>
              Add task
            </Button>
            <Link to="/planner" className="ml-auto self-center text-sm text-muted hover:text-ink">
              Open full planner →
            </Link>
          </div>
          <Card>
            <ul className="divide-y divide-line">
              {data.deadlines.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 px-5 py-3 text-sm">
                  <span className="min-w-0 flex-1">
                    {d.title} <span className="text-muted">· {dueLabel(d.dueAt, d.allDay)}</span>
                  </span>
                  {d.status === "suggested" && <Badge tone="warn">needs confirming</Badge>}
                  {d.status === "done" && <Badge tone="ok">done</Badge>}
                </li>
              ))}
              {data.tasks.map((t) => (
                <li key={t.id} className="flex items-center gap-2 px-5 py-3 text-sm">
                  <span className="min-w-0 flex-1">{t.title}</span>
                  <Badge>{t.status === "doing" ? "in progress" : "task"}</Badge>
                </li>
              ))}
              {!data.deadlines.length && !data.tasks.length && <li className="px-5 py-8 text-center text-sm text-muted">Nothing planned for this module yet.</li>}
            </ul>
          </Card>
        </div>
      )}

      {tab === "Memory" && (
        <div className="space-y-4">
          <div className="flex justify-between gap-2">
            <p className="text-sm text-muted">Facts Margin uses when you talk about this module.</p>
            <Button size="sm" variant="soft" icon={<Brain className="size-3.5" />} onClick={() => setMemOpen(true)}>
              Add
            </Button>
          </div>
          <Card>
            <ul className="divide-y divide-line">
              {data.memories.map((mem) => (
                <li key={mem.id} className="flex items-start gap-2 px-5 py-3 text-sm">
                  <span className="flex-1">{mem.content}</span>
                  {mem.status === "proposed" && <Badge tone="warn">unconfirmed</Badge>}
                </li>
              ))}
              {!data.memories.length && (
                <li className="px-5 py-8 text-center text-sm text-muted">
                  <Sparkles className="mx-auto mb-2 size-5" />
                  Nothing saved yet. Mention things like your lecturer's preferences in a chat, and Margin will offer to remember them.
                </li>
              )}
            </ul>
          </Card>
          <Link to="/memory" className="text-sm text-muted hover:text-ink">
            Manage all memory →
          </Link>
        </div>
      )}

      <div className="mt-10 flex flex-wrap gap-2 border-t border-line pt-6">
        <Button variant="ghost" size="sm" icon={<Archive className="size-3.5" />} onClick={() => void archive()}>
          {m.archived ? "Restore module" : "Archive module"}
        </Button>
        <Button variant="ghost" size="sm" className="text-danger hover:text-danger" icon={<Trash2 className="size-3.5" />} onClick={() => void remove()}>
          Delete module
        </Button>
      </div>

      <EditModuleModal open={editing} onClose={() => setEditing(false)} module={m} />
      <TaskModal open={taskOpen} onClose={() => setTaskOpen(false)} moduleId={m.id} />
      <DeadlineModal open={deadlineOpen} onClose={() => setDeadlineOpen(false)} moduleId={m.id} />
      <SaveMemoryModal open={memOpen} onClose={() => setMemOpen(false)} initial="" moduleId={m.id} />
    </div>
  );
}

function EditModuleModal({ open, onClose, module: m }: { open: boolean; onClose: () => void; module: Module }) {
  const toast = useToast();
  const [code, setCode] = useState(m.code ?? "");
  const [name, setName] = useState(m.name);
  const [coordinator, setCoordinator] = useState(m.coordinator ?? "");
  const [lecturers, setLecturers] = useState(m.lecturers.join(", "));
  const [description, setDescription] = useState(m.description ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await patch(`/modules/${m.id}`, {
        code: code.trim() || null,
        name: name.trim(),
        coordinator: coordinator.trim() || null,
        lecturers: lecturers.split(",").map((s) => s.trim()).filter(Boolean),
        description: description.trim() || null,
      });
      refreshAfterActivity();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save", { tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit module"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
          <Field label="Code">
            <Input value={code} onChange={(e) => setCode(e.target.value)} maxLength={30} />
          </Field>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </Field>
        </div>
        <Field label="Coordinator">
          <Input value={coordinator} onChange={(e) => setCoordinator(e.target.value)} maxLength={120} />
        </Field>
        <Field label="Lecturers" hint="Separate with commas">
          <Input value={lecturers} onChange={(e) => setLecturers(e.target.value)} />
        </Field>
        <Field label="Notes">
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        </Field>
      </div>
    </Modal>
  );
}

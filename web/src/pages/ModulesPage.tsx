import { useState } from "react";
import { Link } from "react-router-dom";
import { BookMarked, FileText, MessageSquare, Plus, CalendarClock } from "lucide-react";
import { post } from "../lib/api";
import { queryClient, useModules } from "../lib/queries";
import { dueLabel, MODULE_COLORS } from "../lib/format";
import { Button, Card, EmptyState, Field, Input, Modal, PageHeader, Spinner, Textarea } from "../components/ui";
import { useToast } from "../components/toast";

export function ModuleForm({ onDone }: { onDone: (id: string) => void }) {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [lecturers, setLecturers] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { module } = await post<{ module: { id: string } }>("/modules", {
        code: code.trim() || null,
        name: name.trim(),
        description: description.trim() || null,
        lecturers: lecturers.split(",").map((l) => l.trim()).filter(Boolean),
      });
      await queryClient.invalidateQueries({ queryKey: ["modules"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onDone(module.id);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't create module", { tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <Field label="Code" hint="Optional">
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="BSA301" maxLength={30} />
        </Field>
        <Field label="Module name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Business Systems Analysis" required maxLength={120} autoFocus />
        </Field>
      </div>
      <Field label="Lecturers" hint="Optional — separate names with commas">
        <Input value={lecturers} onChange={(e) => setLecturers(e.target.value)} placeholder="Dr Murphy, Prof. Okafor" />
      </Field>
      <Field label="Anything else worth knowing?" hint="Optional — e.g. how it's assessed, what it covers">
        <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>
          Create module
        </Button>
      </div>
    </form>
  );
}

export function ModulesPage() {
  const { data: modules, isLoading } = useModules();
  const [open, setOpen] = useState(false);
  const active = modules?.filter((m) => !m.archived) ?? [];
  const archived = modules?.filter((m) => m.archived) ?? [];

  return (
    <div>
      <PageHeader
        title="Modules"
        description="Each module keeps its own materials, conversations, deadlines and memory."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
            Add module
          </Button>
        }
      />
      {isLoading ? (
        <Spinner />
      ) : !active.length ? (
        <Card>
          <EmptyState
            icon={<BookMarked className="size-6" />}
            title="No modules yet"
            action={
              <Button variant="primary" onClick={() => setOpen(true)}>
                Add your first module
              </Button>
            }
          >
            Add the modules you're taking this semester, then upload handbooks, briefs and slides to each.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((m) => (
            <Link key={m.id} to={`/modules/${m.id}`} className="group">
              <Card className="h-full p-5 transition-colors group-hover:border-line-strong">
                <div className="mb-3 h-1 w-10 rounded-full" style={{ background: MODULE_COLORS[m.color]?.dot }} />
                {m.code && <p className="text-xs font-semibold uppercase tracking-wider text-muted">{m.code}</p>}
                <h2 className="font-display text-lg font-semibold leading-snug">{m.name}</h2>
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  <span className="flex items-center gap-1">
                    <FileText className="size-3.5" /> {m.documentCount} files
                  </span>
                  <span className="flex items-center gap-1">
                    <MessageSquare className="size-3.5" /> {m.conversationCount} chats
                  </span>
                  {m.nextDeadline && (
                    <span className="flex items-center gap-1">
                      <CalendarClock className="size-3.5" /> {dueLabel(m.nextDeadline, true)}
                    </span>
                  )}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
      {archived.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm text-muted">Archived modules ({archived.length})</summary>
          <ul className="mt-3 space-y-1">
            {archived.map((m) => (
              <li key={m.id}>
                <Link to={`/modules/${m.id}`} className="text-sm text-muted hover:text-ink">
                  {m.code ? `${m.code} · ` : ""}
                  {m.name}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Add a module">
        <ModuleForm onDone={() => setOpen(false)} />
      </Modal>
    </div>
  );
}

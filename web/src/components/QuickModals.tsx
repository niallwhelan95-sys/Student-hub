import { useEffect, useState } from "react";
import { post } from "../lib/api";
import { refreshAfterActivity, useModules } from "../lib/queries";
import { moduleLabel } from "../lib/format";
import { Button, Field, Input, Modal, Select, Textarea } from "./ui";
import { useToast } from "./toast";

function ModuleSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: modules = [] } = useModules();
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">No specific module</option>
      {modules
        .filter((m) => !m.archived)
        .map((m) => (
          <option key={m.id} value={m.id}>
            {moduleLabel(m)}
          </option>
        ))}
    </Select>
  );
}

export function SaveMemoryModal({
  open,
  onClose,
  initial,
  moduleId,
  sourceMessageId,
  conversationId,
}: {
  open: boolean;
  onClose: () => void;
  initial: string;
  moduleId?: string | null;
  sourceMessageId?: string;
  conversationId?: string;
}) {
  const toast = useToast();
  const [content, setContent] = useState(initial);
  const [category, setCategory] = useState("general");
  const [mod, setMod] = useState(moduleId ?? "");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setContent(initial);
      setMod(moduleId ?? "");
      setCategory(moduleId ? "module" : "general");
    }
  }, [open, initial, moduleId]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await post<{ created: boolean }>("/memory", { content, category, moduleId: mod || null, sourceMessageId, conversationId });
      toast(r.created ? "Saved to memory" : "Margin already remembers this");
      refreshAfterActivity();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save", { tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Remember this"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} disabled={content.trim().length < 3} onClick={() => void save()}>
            Save memory
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="What should Margin remember?" hint="Write it as one clear fact — it'll be used in future conversations.">
          <Textarea rows={4} value={content} onChange={(e) => setContent(e.target.value)} maxLength={1000} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="general">General academic</option>
              <option value="module">About a module</option>
              <option value="assignment">About an assignment</option>
              <option value="preference">How I like to work</option>
              <option value="profile">About me</option>
            </Select>
          </Field>
          <Field label="Module">
            <ModuleSelect value={mod} onChange={setMod} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

export function TaskModal({ open, onClose, initialTitle = "", moduleId, sourceMessageId }: { open: boolean; onClose: () => void; initialTitle?: string; moduleId?: string | null; sourceMessageId?: string }) {
  const toast = useToast();
  const [title, setTitle] = useState(initialTitle);
  const [doneWhen, setDoneWhen] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState("essential");
  const [estimate, setEstimate] = useState("");
  const [mod, setMod] = useState(moduleId ?? "");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setTitle(initialTitle);
      setMod(moduleId ?? "");
      setDoneWhen("");
      setDue("");
      setEstimate("");
    }
  }, [open, initialTitle, moduleId]);

  const save = async () => {
    setSaving(true);
    try {
      await post("/planner/tasks", {
        title,
        doneWhen: doneWhen || null,
        dueAt: due ? new Date(`${due}T23:59:00`).toISOString() : null,
        priority,
        estimateMinutes: estimate ? Number(estimate) : null,
        moduleId: mod || null,
        sourceMessageId,
      });
      toast("Task added to your planner");
      refreshAfterActivity();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't add task", { tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Make a task"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} disabled={!title.trim()} onClick={() => void save()}>
            Add task
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Task" hint="Small and concrete works best — something you could start today.">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} autoFocus />
        </Field>
        <Field label="Done when…" hint="How you'll know it's finished, e.g. “300-word outline saved”.">
          <Input value={doneWhen} onChange={(e) => setDoneWhen(e.target.value)} maxLength={500} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Due (optional)">
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label="Priority">
            <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="essential">Essential</option>
              <option value="optional">Nice to have</option>
            </Select>
          </Field>
          <Field label="Minutes">
            <Input type="number" min={5} max={480} step={5} placeholder="25" value={estimate} onChange={(e) => setEstimate(e.target.value)} />
          </Field>
        </div>
        <Field label="Module">
          <ModuleSelect value={mod} onChange={setMod} />
        </Field>
      </div>
    </Modal>
  );
}

export function DeadlineModal({ open, onClose, moduleId }: { open: boolean; onClose: () => void; moduleId?: string | null }) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [kind, setKind] = useState("assignment");
  const [mod, setMod] = useState(moduleId ?? "");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setTitle("");
      setDate("");
      setTime("");
      setMod(moduleId ?? "");
    }
  }, [open, moduleId]);

  const save = async () => {
    setSaving(true);
    try {
      await post("/planner/deadlines", {
        title,
        dueAt: new Date(`${date}T${time || "23:59"}:00`).toISOString(),
        allDay: !time,
        kind,
        moduleId: mod || null,
      });
      toast("Deadline added");
      refreshAfterActivity();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't add deadline", { tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a deadline"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} disabled={!title.trim() || !date} onClick={() => void save()}>
            Add deadline
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="What's due?">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Systems analysis report" autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Time (optional)">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field label="Type">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="assignment">Assignment</option>
              <option value="exam">Exam</option>
              <option value="milestone">Milestone</option>
              <option value="other">Other</option>
            </Select>
          </Field>
        </div>
        <Field label="Module">
          <ModuleSelect value={mod} onChange={setMod} />
        </Field>
      </div>
    </Modal>
  );
}

import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Brain, Check, Pencil, Pin, PinOff, Plus, Trash2, X, Clock, MessageSquare } from "lucide-react";
import { del, get, patch } from "../lib/api";
import { refreshAfterActivity, useModules } from "../lib/queries";
import { moduleLabel, relativeDay } from "../lib/format";
import type { Memory } from "../lib/types";
import { Badge, Button, Card, EmptyState, IconButton, PageHeader, Spinner, Textarea, cx } from "../components/ui";
import { SaveMemoryModal } from "../components/QuickModals";
import { useToast } from "../components/toast";

const CATEGORY_LABELS: Record<string, string> = {
  profile: "About you",
  preference: "How you like to work",
  module: "Modules",
  assignment: "Assignments",
  general: "General academic",
  working: "Current work",
};

const TABS = [
  { key: "active", label: "Remembered" },
  { key: "proposed", label: "To confirm" },
  { key: "archived", label: "Archived" },
] as const;

export function MemoryPage() {
  const toast = useToast();
  const { data: modules = [] } = useModules();
  const moduleById = new Map(modules.map((m) => [m.id, m]));
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("active");
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["memory", "all"], queryFn: async () => (await get<{ memories: Memory[] }>("/memory?status=all")).memories });

  const update = async (id: string, body: Partial<Memory>, msg?: string) => {
    await patch(`/memory/${id}`, body);
    refreshAfterActivity();
    if (msg) toast(msg);
  };
  const remove = async (id: string) => {
    await del(`/memory/${id}`);
    refreshAfterActivity();
    toast("Forgotten");
  };

  const list = (data ?? []).filter((m) => m.status === tab);
  const counts = { active: 0, proposed: 0, archived: 0 } as Record<string, number>;
  for (const m of data ?? []) counts[m.status]++;
  const grouped = Object.entries(CATEGORY_LABELS)
    .map(([cat, label]) => ({ cat, label, items: list.filter((m) => m.category === cat) }))
    .filter((g) => g.items.length);

  return (
    <div>
      <PageHeader
        title="Memory"
        description="What Margin knows about you and your studies. Everything here is used in future conversations — edit or delete anything."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAddOpen(true)}>
            Add memory
          </Button>
        }
      />
      <div className="mb-5 flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cx("-mb-px border-b-2 px-3 py-2 text-sm", tab === t.key ? "border-accent font-medium" : "border-transparent text-muted hover:text-ink")}
          >
            {t.label}
            {counts[t.key] > 0 && <span className={cx("ml-1.5 rounded-full px-1.5 text-[0.7rem]", t.key === "proposed" ? "bg-warn-soft text-warn" : "bg-surface-2 text-muted")}>{counts[t.key]}</span>}
          </button>
        ))}
      </div>
      {tab === "proposed" && list.length > 0 && (
        <p className="mb-4 rounded-xl bg-warn-soft px-4 py-2.5 text-sm text-warn">
          Margin noticed these in conversation but wasn't sure enough to rely on them. Confirm the ones that are right — unconfirmed memories are never used as facts.
        </p>
      )}
      {isLoading ? (
        <Spinner />
      ) : !grouped.length ? (
        <Card>
          <EmptyState icon={<Brain className="size-6" />} title={tab === "active" ? "Nothing remembered yet" : tab === "proposed" ? "Nothing waiting for review" : "Nothing archived"}>
            {tab === "active" && "Tell Margin about yourself in a conversation, or add a memory directly. Use the brain icon on any answer to save it."}
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-6">
          {grouped.map((g) => (
            <section key={g.cat}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-faint">{g.label}</h2>
              <Card>
                <ul className="divide-y divide-line">
                  {g.items.map((m) => (
                    <li key={m.id} className="group px-5 py-3.5">
                      {editing === m.id ? (
                        <div className="space-y-2">
                          <Textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                              Cancel
                            </Button>
                            <Button size="sm" variant="primary" onClick={() => (setEditing(null), void update(m.id, { content: draft, status: "active" }, "Memory updated"))}>
                              Save
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-[0.95rem] leading-relaxed">{m.content}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
                              {m.moduleId && moduleById.get(m.moduleId) && <span>{moduleLabel(moduleById.get(m.moduleId))}</span>}
                              <span>{m.origin === "user" ? "Added by you" : m.origin === "onboarding" ? "From setup" : "Learned from conversation"}</span>
                              <span>{relativeDay(m.updatedAt)}</span>
                              {m.stability === "temporary" && (
                                <span className="inline-flex items-center gap-1">
                                  <Clock className="size-3" /> temporary{m.expiresAt ? ` · until ${relativeDay(m.expiresAt)}` : ""}
                                </span>
                              )}
                              {m.conversationId && (
                                <Link to={`/chat/${m.conversationId}`} className="inline-flex items-center gap-1 hover:text-ink">
                                  <MessageSquare className="size-3" /> source
                                </Link>
                              )}
                              {m.pinned && <Badge tone="accent">pinned</Badge>}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                            {m.status === "proposed" && (
                              <>
                                <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} onClick={() => void update(m.id, { status: "active" }, "Confirmed")}>
                                  Confirm
                                </Button>
                                <IconButton label="Not right — discard" size="sm" onClick={() => void remove(m.id)}>
                                  <X className="size-4" />
                                </IconButton>
                              </>
                            )}
                            {m.status === "archived" && (
                              <Button size="sm" variant="ghost" onClick={() => void update(m.id, { status: "active" }, "Restored")}>
                                Restore
                              </Button>
                            )}
                            <IconButton label="Edit" size="sm" onClick={() => (setEditing(m.id), setDraft(m.content))}>
                              <Pencil className="size-3.5" />
                            </IconButton>
                            {m.status === "active" && (
                              <IconButton label={m.pinned ? "Unpin" : "Pin (always use)"} size="sm" onClick={() => void update(m.id, { pinned: !m.pinned })}>
                                {m.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                              </IconButton>
                            )}
                            <IconButton label="Forget this" size="sm" onClick={() => void remove(m.id)}>
                              <Trash2 className="size-3.5" />
                            </IconButton>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}
      <SaveMemoryModal open={addOpen} onClose={() => setAddOpen(false)} initial="" />
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, FileText, MessageSquare, Brain } from "lucide-react";
import { get } from "../lib/api";
import { useModules } from "../lib/queries";
import { moduleLabel } from "../lib/format";
import { Card, Input, PageHeader, Select, Spinner, cx } from "../components/ui";

type Results = {
  documents: { sectionId: string; documentId: string; filename: string; title: string | null; location: string | null; moduleId: string | null; snippet: string }[];
  conversations: { messageId: string; conversationId: string; title: string; role: string; snippet: string; createdAt: string }[];
  memories: { id: string; content: string; category: string; status: string; moduleId: string | null }[];
};

const TYPES = [
  { key: "all", label: "Everything" },
  { key: "documents", label: "Documents" },
  { key: "conversations", label: "Conversations" },
  { key: "memories", label: "Memory" },
] as const;

/** Render ts_headline's «…» markers as highlights without using innerHTML. */
function Highlighted({ text }: { text: string }) {
  return (
    <>
      {text.split(/(«[^»]*»)/g).map((part, i) =>
        part.startsWith("«") ? (
          <mark key={i} className="rounded bg-accent-soft px-0.5 text-accent-text">
            {part.slice(1, -1)}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [type, setType] = useState<string>("all");
  const [moduleId, setModuleId] = useState("");
  const { data: modules = [] } = useModules();
  const moduleById = new Map(modules.map((m) => [m.id, m]));
  const term = params.get("q") ?? "";

  useEffect(() => {
    const t = setTimeout(() => {
      if (q.trim() !== term) setParams(q.trim() ? { q: q.trim() } : {}, { replace: true });
    }, 300);
    return () => clearTimeout(t);
  }, [q, term, setParams]);

  const { data, isFetching } = useQuery({
    queryKey: ["search", term, type, moduleId],
    enabled: term.length > 0,
    queryFn: () => get<Results>(`/search?q=${encodeURIComponent(term)}&type=${type}${moduleId ? `&moduleId=${moduleId}` : ""}`),
  });
  const total = data ? data.documents.length + data.conversations.length + data.memories.length : 0;

  return (
    <div>
      <PageHeader title="Search" description="Find anything across your documents, conversations and memory — no need to remember where you put it." />
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. referencing style for the BSA report" className="h-12 pl-10 text-base" autoFocus aria-label="Search" />
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {TYPES.map((t) => (
          <button
            key={t.key}
            onClick={() => setType(t.key)}
            className={cx("rounded-full border px-3 py-1 text-sm", type === t.key ? "border-accent bg-accent-soft text-accent-text" : "border-line text-muted hover:text-ink")}
          >
            {t.label}
          </button>
        ))}
        <Select value={moduleId} onChange={(e) => setModuleId(e.target.value)} className="ml-auto h-9 w-auto rounded-full text-sm" aria-label="Module filter">
          <option value="">All modules</option>
          {modules.map((m) => (
            <option key={m.id} value={m.id}>
              {moduleLabel(m)}
            </option>
          ))}
        </Select>
      </div>

      {!term ? (
        <p className="text-sm text-muted">Type to search. Margin matches meaning as well as exact words.</p>
      ) : isFetching && !data ? (
        <Spinner />
      ) : !total ? (
        <p className="text-sm text-muted">No results for “{term}”.</p>
      ) : (
        <div className="space-y-8">
          {data!.documents.length > 0 && (
            <section>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-muted">
                <FileText className="size-4" /> Documents
              </h2>
              <Card>
                <ul className="divide-y divide-line">
                  {data!.documents.map((d) => (
                    <li key={d.sectionId}>
                      <Link to={`/library/${d.documentId}#section-${d.sectionId}`} className="block px-5 py-3.5 hover:bg-surface-2/60">
                        <p className="text-sm font-medium">
                          {d.title || d.filename} <span className="font-normal text-faint">· {d.location}</span>
                          {d.moduleId && moduleById.get(d.moduleId) && <span className="font-normal text-faint"> · {moduleById.get(d.moduleId)!.code ?? moduleById.get(d.moduleId)!.name}</span>}
                        </p>
                        <p className="mt-1 line-clamp-2 text-sm text-muted">{d.snippet}</p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}
          {data!.conversations.length > 0 && (
            <section>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-muted">
                <MessageSquare className="size-4" /> Conversations
              </h2>
              <Card>
                <ul className="divide-y divide-line">
                  {data!.conversations.map((c) => (
                    <li key={c.messageId}>
                      <Link to={`/chat/${c.conversationId}`} className="block px-5 py-3.5 hover:bg-surface-2/60">
                        <p className="text-sm font-medium">
                          {c.title} <span className="font-normal text-faint">· {c.role === "user" ? "you said" : "Margin said"}</span>
                        </p>
                        <p className="mt-1 line-clamp-2 text-sm text-muted">
                          <Highlighted text={c.snippet} />
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}
          {data!.memories.length > 0 && (
            <section>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-muted">
                <Brain className="size-4" /> Memory
              </h2>
              <Card>
                <ul className="divide-y divide-line">
                  {data!.memories.map((m) => (
                    <li key={m.id} className="px-5 py-3.5 text-sm">
                      {m.content} {m.status === "proposed" && <span className="text-xs text-warn">(unconfirmed)</span>}
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

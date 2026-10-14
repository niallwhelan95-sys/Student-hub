import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Library } from "lucide-react";
import { get } from "../lib/api";
import { useModules } from "../lib/queries";
import { moduleLabel } from "../lib/format";
import type { DocumentSummary } from "../lib/types";
import { Card, EmptyState, PageHeader, Select, Spinner } from "../components/ui";
import { DocumentRow, UploadZone } from "../components/Documents";

export function LibraryPage() {
  const [moduleFilter, setModuleFilter] = useState("");
  const { data: modules = [] } = useModules();
  const { data, isLoading } = useQuery({
    queryKey: ["documents", moduleFilter],
    queryFn: async () => (await get<{ documents: DocumentSummary[] }>(`/documents${moduleFilter ? `?moduleId=${moduleFilter}` : ""}`)).documents,
    refetchInterval: (q) => (q.state.data?.some((d) => d.status === "queued" || d.status === "processing") ? 2500 : false),
  });

  return (
    <div>
      <PageHeader
        title="Library"
        description="Everything you've uploaded — searchable, citable, and available in every conversation."
        actions={
          <Select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} className="h-10 w-56" aria-label="Filter by module">
            <option value="">All modules</option>
            <option value="none">Not in a module</option>
            {modules.map((m) => (
              <option key={m.id} value={m.id}>
                {moduleLabel(m)}
              </option>
            ))}
          </Select>
        }
      />
      <div className="space-y-4">
        <UploadZone moduleId={moduleFilter && moduleFilter !== "none" ? moduleFilter : null} />
        <Card>
          {isLoading ? (
            <div className="p-6">
              <Spinner />
            </div>
          ) : data?.length ? (
            <div className="divide-y divide-line">{data.map((d) => <DocumentRow key={d.id} doc={d} />)}</div>
          ) : (
            <EmptyState icon={<Library className="size-6" />} title="Nothing here yet">
              Upload a module handbook, assignment brief or lecture slides to get started.
            </EmptyState>
          )}
        </Card>
      </div>
    </div>
  );
}

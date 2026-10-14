export function relativeDay(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(d) - startOf(now)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff < 7) return d.toLocaleDateString("en-GB", { weekday: "long" });
  if (diff < 0 && diff > -7) return `${-diff} days ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
}

export function dueLabel(iso: string, allDay = false, now = new Date()): string {
  const d = new Date(iso);
  const days = Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
  const time = allDay ? "" : ` · ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  if (d.getTime() < now.getTime()) return `Overdue · ${relativeDay(iso, now)}`;
  if (days <= 1) return `${relativeDay(iso, now)}${time}`;
  return `${relativeDay(iso, now)}${days < 7 ? "" : ` (${days} days)`}${time}`;
}

export function urgency(iso: string, now = new Date()): "overdue" | "soon" | "upcoming" | "later" {
  const days = (new Date(iso).getTime() - now.getTime()) / 86_400_000;
  if (days < 0) return "overdue";
  if (days <= 3) return "soon";
  if (days <= 14) return "upcoming";
  return "later";
}

export function timeAgo(iso: string, now = new Date()): string {
  const s = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return relativeDay(iso, now);
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export const KIND_LABELS: Record<string, string> = {
  assignment_brief: "Assignment brief",
  marking_rubric: "Marking rubric",
  module_handbook: "Module handbook",
  lecture_slides: "Lecture slides",
  lecture_notes: "Lecture notes",
  reading: "Reading",
  feedback: "Feedback",
  exam_info: "Exam info",
  timetable: "Timetable",
  own_writing: "Your writing",
  screenshot: "Screenshot",
  data: "Data",
  code: "Code",
  other: "Document",
  unknown: "Document",
};

/** Module colour → Tailwind-compatible inline styles (kept muted for calm UI). */
export const MODULE_COLORS: Record<string, { dot: string; soft: string }> = {
  teal: { dot: "#2a8a84", soft: "color-mix(in srgb, #2a8a84 14%, transparent)" },
  indigo: { dot: "#5a62c4", soft: "color-mix(in srgb, #5a62c4 14%, transparent)" },
  amber: { dot: "#c08a1e", soft: "color-mix(in srgb, #c08a1e 16%, transparent)" },
  rose: { dot: "#c4566f", soft: "color-mix(in srgb, #c4566f 14%, transparent)" },
  sky: { dot: "#3a8fc4", soft: "color-mix(in srgb, #3a8fc4 14%, transparent)" },
  violet: { dot: "#8a5ac4", soft: "color-mix(in srgb, #8a5ac4 14%, transparent)" },
  lime: { dot: "#6f9a2c", soft: "color-mix(in srgb, #6f9a2c 16%, transparent)" },
  orange: { dot: "#cf6f2e", soft: "color-mix(in srgb, #cf6f2e 14%, transparent)" },
};

export const moduleLabel = (m: { code: string | null; name: string } | undefined | null) =>
  m ? (m.code ? `${m.code} · ${m.name}` : m.name) : "";

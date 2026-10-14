import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Link } from "react-router-dom";
import { Check, Copy, FileText, Brain, ExternalLink } from "lucide-react";
import type { Citation } from "../lib/types";

/** Turn [S1] / [S1, M2] markers into links the renderer can show as citation chips (outside code). */
export function linkCitations(text: string): string {
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return parts
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(/\[((?:[SM]\d+)(?:\s*,\s*[SM]\d+)*)\](?!\()/g, (_, refs: string) =>
            refs
              .split(/\s*,\s*/)
              .map((r) => `[${r}](#cite-${r})`)
              .join(""),
          ),
    )
    .join("");
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="absolute right-2 top-2 rounded-md border border-line bg-surface px-1.5 py-1 text-xs text-muted opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
      aria-label="Copy code"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

export function CitationChip({ citation, fallbackRef }: { citation?: Citation; fallbackRef: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!citation) {
    // The model cited something we never offered — show it as unverifiable rather than as a link.
    return <span className="mx-0.5 rounded bg-surface-2 px-1 text-[0.7rem] text-faint line-through" title="Unverified reference">{fallbackRef}</span>;
  }
  const isDoc = citation.kind === "document";
  const href = isDoc ? `/library/${citation.documentId}${citation.sectionId ? `#section-${citation.sectionId}` : ""}` : "/memory";
  return (
    <span ref={ref} className="relative inline-block align-baseline">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="cite mx-0.5 inline-flex -translate-y-px items-center rounded-md bg-accent-soft px-1.5 py-px text-[0.7rem] font-semibold leading-4 text-accent-text hover:brightness-95"
        aria-label={`Source ${citation.ref}: ${citation.title}${citation.location ? `, ${citation.location}` : ""}`}
        aria-expanded={open}
      >
        {citation.ref}
      </button>
      {open && (
        <span className="absolute left-0 top-full z-30 mt-1.5 block w-[min(22rem,80vw)] rounded-xl border border-line bg-surface p-3 text-left text-sm font-normal leading-snug text-ink shadow-soft">
          <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted">
            {isDoc ? <FileText className="size-3.5" /> : <Brain className="size-3.5" />}
            <span className="truncate">{citation.title}</span>
            {citation.location && <span className="shrink-0 text-faint">· {citation.location}</span>}
          </span>
          <span className="block max-h-40 overflow-y-auto whitespace-pre-line text-[0.8125rem] text-muted">{citation.excerpt}</span>
          <Link to={href} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent-text hover:underline">
            {isDoc ? "Open in document" : "View in memory"} <ExternalLink className="size-3" />
          </Link>
        </span>
      )}
    </span>
  );
}

export const Markdown = memo(function Markdown({ text, citations = [] }: { text: string; citations?: Citation[] }) {
  const byRef = new Map(citations.map((c) => [c.ref, c]));
  return (
    <div className="prose-margin">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a({ href, children }) {
            if (href?.startsWith("#cite-")) {
              const r = href.slice(6);
              return <CitationChip citation={byRef.get(r)} fallbackRef={r} />;
            }
            return (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            );
          },
          pre({ children }) {
            const text = extractText(children);
            return (
              <div className="group relative">
                <pre>{children}</pre>
                <CopyButton text={text} />
              </div>
            );
          },
        }}
      >
        {linkCitations(text)}
      </ReactMarkdown>
    </div>
  );
});

function extractText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) return extractText((node as { props: { children?: ReactNode } }).props.children);
  return "";
}

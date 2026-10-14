import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Brain, Compass, Lightbulb, PenLine, Pin, PinOff, Archive, Trash2, MoreHorizontal, Sparkles, Upload, ChevronDown, ChevronUp } from "lucide-react";
import { del, get, patch, post, postStream } from "../lib/api";
import { queryClient, refreshAfterActivity, useMe, useModules } from "../lib/queries";
import type { Conversation, DocumentSummary, Message } from "../lib/types";
import { moduleLabel, MODULE_COLORS } from "../lib/format";
import { Composer, type ComposerHandle, type SendPayload } from "../components/Composer";
import { MessageItem } from "../components/MessageItem";
import { DeadlineModal, SaveMemoryModal, TaskModal } from "../components/QuickModals";
import { Button, IconButton, Select, Spinner, cx } from "../components/ui";
import { useToast } from "../components/toast";

type Live = { user?: Message; assistant?: Message; context?: { sources: number; memories: number; writingProfile: boolean; pending: string[] } };

const SUGGESTIONS = [
  { icon: Compass, text: "What should I focus on this week?" },
  { icon: BookOpen, text: "Explain the key ideas from my latest lecture slides in plain English." },
  { icon: Lightbulb, text: "Help me get started on my next assignment — one small step at a time." },
  { icon: PenLine, text: "Check this paragraph and keep it sounding like me:\n\n" },
];

export function ChatPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: me } = useMe();
  const { data: modules = [] } = useModules();
  const composerRef = useRef<ComposerHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [newModuleId, setNewModuleId] = useState<string>(params.get("module") ?? "");
  const [memoryModal, setMemoryModal] = useState<{ text: string; messageId?: string } | null>(null);
  const [taskModal, setTaskModal] = useState<{ text: string; messageId?: string } | null>(null);
  const [deadlineOpen, setDeadlineOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(true);

  const convQuery = useQuery({
    queryKey: ["conversation", id],
    enabled: !!id,
    queryFn: () => get<{ conversation: Conversation; messages: Message[]; documents: Pick<DocumentSummary, "id" | "filename" | "status">[] }>(`/conversations/${id}`),
  });
  const conversation = convQuery.data?.conversation;
  const messages = convQuery.data?.messages ?? [];
  const attachmentNames = useMemo(() => new Map((convQuery.data?.documents ?? []).map((d) => [d.id, d.filename])), [convQuery.data]);
  const moduleId = conversation?.moduleId ?? (newModuleId || null);
  const currentModule = modules.find((m) => m.id === moduleId);

  // Merge persisted messages with the in-flight turn.
  const shown = useMemo(() => {
    if (!live) return messages;
    const base = messages.filter((m) => m.id !== live.user?.id && m.id !== live.assistant?.id);
    return [...base, ...(live.user ? [live.user] : []), ...(live.assistant ? [live.assistant] : [])];
  }, [messages, live]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [shown, live?.assistant?.content]);

  // When we create a conversation ourselves mid-send, keep the in-flight stream state.
  const justCreated = useRef<string | null>(null);
  useEffect(() => {
    stickToBottom.current = true;
    setContextOpen(true);
    if (id && justCreated.current === id) {
      justCreated.current = null;
      return;
    }
    setLive(null);
  }, [id]);

  const runTurn = useCallback(
    async (conversationId: string, body: Record<string, unknown>) => {
      const abort = new AbortController();
      abortRef.current = abort;
      setStreaming(true);
      stickToBottom.current = true;
      setLive({});
      try {
        await postStream(
          `/conversations/${conversationId}/messages`,
          body,
          (event, data) => {
            if (event === "user_message") setLive((l) => ({ ...l, user: data.message }));
            else if (event === "context") setLive((l) => ({ ...l, context: data }));
            else if (event === "assistant_start")
              setLive((l) => ({
                ...l,
                assistant: { id: data.id, conversationId, role: "assistant", content: "", attachments: [], citations: [], status: "streaming", error: null, model: null, inputMode: "text", createdAt: new Date().toISOString() },
              }));
            else if (event === "delta") setLive((l) => (l?.assistant ? { ...l, assistant: { ...l.assistant, content: l.assistant.content + data.text } } : l));
            else if (event === "done") setLive((l) => ({ ...l, assistant: data.message }));
            else if (event === "error") {
              if (data.message) setLive((l) => ({ ...l, assistant: data.message }));
              else toast(data.error ?? "Something went wrong", { tone: "error" });
            }
          },
          abort.signal,
        );
      } catch (err) {
        if (!abort.signal.aborted) toast(err instanceof Error ? err.message : "Connection lost", { tone: "error" });
      } finally {
        setStreaming(false);
        abortRef.current = null;
        // Give the server a moment to persist a stopped turn, then sync.
        setTimeout(async () => {
          await queryClient.invalidateQueries({ queryKey: ["conversation", conversationId] });
          setLive(null);
          refreshAfterActivity();
        }, abort.signal.aborted ? 400 : 0);
      }
    },
    [toast],
  );

  const send = useCallback(
    async (p: SendPayload): Promise<boolean> => {
      let convId = id;
      if (!convId) {
        try {
          const { conversation: c } = await post<{ conversation: Conversation }>("/conversations", { moduleId: newModuleId || null });
          convId = c.id;
          justCreated.current = c.id;
          queryClient.setQueryData(["conversation", convId], { conversation: c, messages: [], documents: [] });
          navigate(`/chat/${convId}`, { replace: true });
        } catch (err) {
          toast(err instanceof Error ? err.message : "Couldn't start a conversation", { tone: "error" });
          return false;
        }
      }
      void runTurn(convId, { content: p.text, attachmentIds: p.attachmentIds, inputMode: p.inputMode });
      return true;
    },
    [id, newModuleId, navigate, runTurn, toast],
  );

  // Dashboard "Help me get started" etc.: /chat?prompt=…&autosend=1
  const autoSent = useRef(false);
  useEffect(() => {
    const prompt = params.get("prompt");
    if (!prompt || id || autoSent.current || !me) return;
    autoSent.current = true;
    if (params.get("autosend") === "1") void send({ text: prompt, attachmentIds: [], inputMode: params.get("voice") === "1" ? "voice" : "text" });
    else composerRef.current?.setText(prompt);
    for (const k of ["prompt", "autosend", "voice", "module"]) params.delete(k);
    setParams(params, { replace: true });
  }, [params, id, me, send, setParams]);

  const stop = () => abortRef.current?.abort();

  const updateConversation = async (patchBody: Partial<Conversation>) => {
    if (!conversation) return;
    await patch(`/conversations/${conversation.id}`, patchBody);
    void queryClient.invalidateQueries({ queryKey: ["conversation", conversation.id] });
    void queryClient.invalidateQueries({ queryKey: ["conversations"] });
  };

  const remove = async () => {
    if (!conversation || !confirm("Delete this conversation? This can't be undone.")) return;
    await del(`/conversations/${conversation.id}`);
    void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    navigate("/chat");
  };

  const lastAssistantId = [...shown].reverse().find((m) => m.role === "assistant")?.id;
  const wc = conversation?.workingContext;

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        composerRef.current?.addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-3xl border-2 border-dashed border-accent bg-accent-soft/80">
          <p className="flex items-center gap-2 font-medium text-accent-text">
            <Upload className="size-5" /> Drop files to attach them
          </p>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 sm:px-6">
        {conversation ? (
          <>
            <input
              key={conversation.id + conversation.title}
              defaultValue={conversation.title}
              onBlur={(e) => e.target.value.trim() && e.target.value !== conversation.title && void updateConversation({ title: e.target.value.trim() })}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              aria-label="Conversation title"
              className="min-w-0 flex-1 truncate rounded-lg bg-transparent px-1.5 py-1 font-medium hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
            />
            <Select
              value={conversation.moduleId ?? ""}
              onChange={(e) => void updateConversation({ moduleId: e.target.value || null })}
              className="h-8 max-w-[8.5rem] rounded-lg py-0 text-xs sm:max-w-[12rem]"
              aria-label="Module for this conversation"
            >
              <option value="">No module</option>
              {modules.map((m) => (
                <option key={m.id} value={m.id}>
                  {moduleLabel(m)}
                </option>
              ))}
            </Select>
            <div className="relative">
              <IconButton label="Conversation options" size="sm" onClick={() => setMenuOpen((o) => !o)}>
                <MoreHorizontal className="size-4" />
              </IconButton>
              {menuOpen && (
                <div className="absolute right-0 top-9 z-30 w-44 rounded-xl border border-line bg-surface p-1 shadow-soft" onMouseLeave={() => setMenuOpen(false)}>
                  <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-surface-2" onClick={() => (setMenuOpen(false), void updateConversation({ pinned: !conversation.pinned }))}>
                    {conversation.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />} {conversation.pinned ? "Unpin" : "Pin"}
                  </button>
                  <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-surface-2" onClick={() => (setMenuOpen(false), void updateConversation({ archived: !conversation.archived }))}>
                    <Archive className="size-4" /> {conversation.archived ? "Unarchive" : "Archive"}
                  </button>
                  <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-danger hover:bg-danger-soft" onClick={() => (setMenuOpen(false), void remove())}>
                    <Trash2 className="size-4" /> Delete
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <span className="flex-1 px-1.5 font-medium text-muted">New conversation</span>
            <Select value={newModuleId} onChange={(e) => setNewModuleId(e.target.value)} className="h-8 max-w-[8.5rem] rounded-lg py-0 text-xs sm:max-w-[12rem]" aria-label="Module for this conversation">
              <option value="">No module</option>
              {modules.map((m) => (
                <option key={m.id} value={m.id}>
                  {moduleLabel(m)}
                </option>
              ))}
            </Select>
          </>
        )}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
          {wc && (wc.goal || wc.next) && shown.length > 0 && (
            <div className="mb-6 rounded-2xl border border-line bg-surface-2/60 px-4 py-3 text-sm">
              <button className="flex w-full items-center justify-between gap-2 text-left font-medium" onClick={() => setContextOpen((o) => !o)} aria-expanded={contextOpen}>
                <span>Where we left off</span>
                {contextOpen ? <ChevronUp className="size-4 text-faint" /> : <ChevronDown className="size-4 text-faint" />}
              </button>
              {contextOpen && (
                <div className="mt-2 space-y-1 text-muted">
                  {wc.goal && <p><span className="text-ink">Goal:</span> {wc.goal}</p>}
                  {wc.done?.length ? <p><span className="text-ink">Done:</span> {wc.done.join("; ")}</p> : null}
                  {wc.remaining?.length ? <p><span className="text-ink">Still to do:</span> {wc.remaining.join("; ")}</p> : null}
                  {wc.next && (
                    <p className="font-medium text-accent-text">
                      Next step: {wc.next}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {id && convQuery.isLoading ? (
            <div className="flex justify-center py-20">
              <Spinner />
            </div>
          ) : shown.length === 0 ? (
            <div className="py-10 sm:py-16">
              <div className="mb-8 text-center">
                <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-text">
                  <Sparkles className="size-6" />
                </div>
                <h2 className="font-display text-2xl font-semibold">What are you working on?</h2>
                <p className="mx-auto mt-2 max-w-md text-sm text-muted">
                  {currentModule ? (
                    <>
                      I'll prioritise your <span style={{ color: MODULE_COLORS[currentModule.color]?.dot }}>{moduleLabel(currentModule)}</span> material, and bring in anything else that's relevant.
                    </>
                  ) : (
                    "Ask anything — I'll look through your modules, documents and what you've told me before."
                  )}
                </p>
                {me && !me.capabilities.ai && (
                  <p className="mx-auto mt-3 max-w-md rounded-xl bg-warn-soft px-3 py-2 text-xs text-warn">
                    No AI model is connected yet, so answers will show matching passages from your library only. Add <code>ANTHROPIC_API_KEY</code> to <code>.env</code> to enable full answers.
                  </p>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.text}
                    onClick={() => (composerRef.current?.setText(s.text), composerRef.current?.focus())}
                    className="flex items-start gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left text-sm text-muted transition-colors hover:border-line-strong hover:text-ink"
                  >
                    <s.icon className="mt-0.5 size-4 shrink-0 text-accent" />
                    {s.text.trim()}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-7">
              {shown.map((m) => (
                <MessageItem
                  key={m.id}
                  message={m}
                  isLast={m.id === lastAssistantId}
                  streaming={streaming}
                  attachmentNames={attachmentNames}
                  actions={{
                    onRegenerate: !streaming && id ? () => void runTurn(id, { regenerate: true }) : undefined,
                    onEdit: !streaming && id ? (msg, text) => void runTurn(id, { content: text, editMessageId: msg.id }) : undefined,
                    onRemember: (text, msg) => setMemoryModal({ text, messageId: msg.id }),
                    onTask: (text, msg) => setTaskModal({ text, messageId: msg.id }),
                    onDeadline: () => setDeadlineOpen(true),
                  }}
                />
              ))}
              {streaming && live?.context && (
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint" aria-live="polite">
                  <span>Using {live.context.sources} passage{live.context.sources === 1 ? "" : "s"} from your library</span>
                  {live.context.memories > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Brain className="size-3" /> {live.context.memories} memories
                    </span>
                  )}
                  {live.context.writingProfile && (
                    <span className="inline-flex items-center gap-1">
                      <PenLine className="size-3" /> your writing profile
                    </span>
                  )}
                  {live.context.pending.length > 0 && <span className="text-warn">Not ready yet: {live.context.pending.join(", ")}</span>}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="safe-bottom border-t border-line/60 bg-bg/90 px-3 pt-3 backdrop-blur sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <Composer
            ref={composerRef}
            draftKey={id ?? "new"}
            streaming={streaming}
            moduleId={moduleId}
            conversationId={id ?? null}
            serverTranscription={!!me?.capabilities.serverTranscription}
            onSend={send}
            onStop={stop}
          />
          <p className={cx("py-2 text-center text-[0.7rem] text-faint")}>Margin can make mistakes. Check important details against your sources.</p>
        </div>
      </div>

      <SaveMemoryModal open={!!memoryModal} onClose={() => setMemoryModal(null)} initial={memoryModal?.text ?? ""} moduleId={moduleId} sourceMessageId={memoryModal?.messageId} conversationId={id} />
      <TaskModal open={!!taskModal} onClose={() => setTaskModal(null)} initialTitle={taskModal?.text ?? ""} moduleId={moduleId} sourceMessageId={taskModal?.messageId} />
      <DeadlineModal open={deadlineOpen} onClose={() => setDeadlineOpen(false)} moduleId={moduleId} />
      {!conversation && id && convQuery.isError && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg">
          <div className="text-center">
            <p className="font-medium">This conversation couldn't be found.</p>
            <Button className="mt-3" onClick={() => navigate("/chat")}>
              Start a new one
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

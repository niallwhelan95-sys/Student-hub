import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Home,
  MessageSquarePlus,
  BookMarked,
  CalendarCheck,
  Library,
  Brain,
  PenLine,
  Search,
  Settings,
  Menu,
  X,
  Pin,
  Archive,
  Timer,
} from "lucide-react";
import { useConversations, useDashboard, useMe, useModules } from "../lib/queries";
import { MODULE_COLORS, timeAgo } from "../lib/format";
import { cx, IconButton } from "./ui";
import { FocusTimer } from "./FocusTimer";

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5 px-2 py-1" aria-label="Margin home">
      <img src="/icons/icon.svg" alt="" className="size-7 rounded-lg" />
      <span className="font-display text-[1.35rem] font-semibold tracking-tight">Margin</span>
    </Link>
  );
}

function NavItem({ to, icon: Icon, children, badge, end }: { to: string; icon: typeof Home; children: ReactNode; badge?: number; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cx(
          "flex items-center gap-3 rounded-xl px-3 py-2 text-[0.9rem] transition-colors",
          isActive ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:bg-surface/70 hover:text-ink",
        )
      }
    >
      <Icon className="size-[1.1rem] shrink-0" />
      <span className="flex-1 truncate">{children}</span>
      {!!badge && <span className="rounded-full bg-accent-soft px-1.5 text-[0.7rem] font-semibold text-accent-text">{badge}</span>}
    </NavLink>
  );
}

function ConversationList({ onNavigate }: { onNavigate: () => void }) {
  const [showArchived, setShowArchived] = useState(false);
  const [filter, setFilter] = useState("");
  const { data: convs = [] } = useConversations(showArchived);
  const { data: modules = [] } = useModules();
  const moduleById = useMemo(() => new Map(modules.map((m) => [m.id, m])), [modules]);
  const filtered = convs.filter((c) => !filter || c.title.toLowerCase().includes(filter.toLowerCase()));
  const pinned = filtered.filter((c) => c.pinned);
  const rest = filtered.filter((c) => !c.pinned);

  const item = (c: (typeof convs)[number]) => {
    const mod = c.moduleId ? moduleById.get(c.moduleId) : undefined;
    return (
      <NavLink
        key={c.id}
        to={`/chat/${c.id}`}
        onClick={onNavigate}
        className={({ isActive }) =>
          cx("group flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors", isActive ? "bg-surface text-ink ring-1 ring-line" : "text-muted hover:bg-surface/70 hover:text-ink")
        }
      >
        <span className="size-1.5 shrink-0 rounded-full" style={{ background: mod ? MODULE_COLORS[mod.color]?.dot : "transparent" }} aria-hidden />
        <span className="min-w-0 flex-1 truncate">{c.title}</span>
        <span className="hidden shrink-0 text-[0.65rem] text-faint group-hover:inline">{timeAgo(c.updatedAt)}</span>
      </NavLink>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pb-1.5 pt-4">
        <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-faint">{showArchived ? "Archived" : "Conversations"}</span>
        <IconButton label={showArchived ? "Show active conversations" : "Show archived conversations"} size="sm" active={showArchived} onClick={() => setShowArchived((s) => !s)}>
          <Archive className="size-3.5" />
        </IconButton>
      </div>
      {convs.length > 6 && (
        <div className="px-2 pb-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter conversations"
            aria-label="Filter conversations"
            className="h-8 w-full rounded-lg border border-line bg-surface px-2.5 text-xs placeholder:text-faint focus:border-accent focus:outline-none"
          />
        </div>
      )}
      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3" aria-label="Conversations">
        {pinned.length > 0 && (
          <>
            <p className="flex items-center gap-1 px-2.5 pb-0.5 pt-1 text-[0.7rem] text-faint">
              <Pin className="size-3" /> Pinned
            </p>
            {pinned.map(item)}
            <div className="h-2" />
          </>
        )}
        {rest.map(item)}
        {!filtered.length && <p className="px-2.5 py-2 text-xs text-faint">{filter ? "No matches." : showArchived ? "Nothing archived." : "No conversations yet."}</p>}
      </nav>
    </div>
  );
}

function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const { data: dash } = useDashboard();
  const { data: me } = useMe();
  const navigate = useNavigate();
  const [timerOpen, setTimerOpen] = useState(false);
  return (
    <div className="flex h-full flex-col bg-surface-2/70">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <Logo />
      </div>
      <div className="px-3 pb-3">
        <button
          onClick={() => (navigate("/chat"), onNavigate())}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-3 py-2.5 text-sm font-medium text-accent-ink shadow-sm transition-colors hover:bg-accent-hover"
        >
          <MessageSquarePlus className="size-4" /> New conversation
        </button>
      </div>
      <nav className="space-y-0.5 px-3" aria-label="Main" onClick={onNavigate}>
        <NavItem to="/" end icon={Home}>
          Today
        </NavItem>
        <NavItem to="/modules" icon={BookMarked}>
          Modules
        </NavItem>
        <NavItem to="/planner" icon={CalendarCheck} badge={dash?.counts.suggestedDeadlines}>
          Planner
        </NavItem>
        <NavItem to="/library" icon={Library}>
          Library
        </NavItem>
        <NavItem to="/memory" icon={Brain} badge={dash?.counts.proposedMemories}>
          Memory
        </NavItem>
        <NavItem to="/writing" icon={PenLine}>
          Writing voice
        </NavItem>
        <NavItem to="/search" icon={Search}>
          Search
        </NavItem>
      </nav>
      <ConversationList onNavigate={onNavigate} />
      <div className="border-t border-line px-3 py-2">
        {timerOpen && <FocusTimer onClose={() => setTimerOpen(false)} />}
        <div className="flex items-center gap-1">
          <NavLink
            to="/settings"
            onClick={onNavigate}
            className={({ isActive }) => cx("flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-2 text-sm", isActive ? "bg-surface ring-1 ring-line" : "hover:bg-surface/70")}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-text">
              {me?.user?.displayName.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate text-muted">{me?.user?.displayName}</span>
            <Settings className="size-4 text-faint" />
          </NavLink>
          <IconButton label="Focus timer" size="sm" active={timerOpen} onClick={() => setTimerOpen((o) => !o)}>
            <Timer className="size-4" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

export function AppShell() {
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  useEffect(() => {
    setDrawer(false);
  }, [location.pathname]);
  const isChat = location.pathname.startsWith("/chat");

  return (
    <div className="flex h-dvh overflow-hidden">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="hidden w-[17rem] shrink-0 border-r border-line lg:block">
        <Sidebar onNavigate={() => {}} />
      </aside>
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-[min(19rem,86vw)] border-r border-line bg-bg shadow-2xl">
            <div className="absolute right-2 top-3 z-10">
              <IconButton label="Close menu" onClick={() => setDrawer(false)}>
                <X className="size-5" />
              </IconButton>
            </div>
            <Sidebar onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-line px-2 py-1.5 lg:hidden">
          <IconButton label="Open menu" onClick={() => setDrawer(true)}>
            <Menu className="size-5" />
          </IconButton>
          <Logo />
          <Link to="/chat" className="ml-auto" aria-label="New conversation">
            <span className="inline-flex size-10 items-center justify-center rounded-lg text-muted hover:bg-surface-2">
              <MessageSquarePlus className="size-5" />
            </span>
          </Link>
        </header>
        <main id="main" className={cx("min-h-0 flex-1", isChat ? "overflow-hidden" : "overflow-y-auto")}>
          {isChat ? (
            <Outlet />
          ) : (
            <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
              <Outlet />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

import { useEffect } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { queryClient, useDashboard, useMe } from "./lib/queries";
import { AppShell } from "./components/AppShell";
import { Spinner } from "./components/ui";
import { AuthPage } from "./pages/AuthPage";
import { Dashboard } from "./pages/Dashboard";
import { ChatPage } from "./pages/ChatPage";
import { ModulesPage } from "./pages/ModulesPage";
import { ModulePage } from "./pages/ModulePage";
import { LibraryPage } from "./pages/LibraryPage";
import { DocumentPage } from "./pages/DocumentPage";
import { PlannerPage } from "./pages/PlannerPage";
import { MemoryPage } from "./pages/MemoryPage";
import { WritingPage } from "./pages/WritingPage";
import { SearchPage } from "./pages/SearchPage";
import { SettingsPage } from "./pages/SettingsPage";
import { WelcomePage } from "./pages/WelcomePage";

/** First visit with nothing set up → onboarding. Never blocks: skipping is always possible. */
function Home() {
  const { data } = useDashboard();
  if (!data) return <Dashboard />;
  const ob = data.onboarding;
  const untouched = !ob.dismissed && ob.completedSteps.length === 0 && ob.skippedSteps.length === 0;
  if (untouched && data.modules.length === 0) return <Navigate to="/welcome" replace />;
  return <Dashboard />;
}

function NotFound() {
  return (
    <div className="py-20 text-center">
      <h1 className="font-display text-2xl font-semibold">Page not found</h1>
      <Link to="/" className="mt-3 inline-block text-accent-text hover:underline">
        Back to Today
      </Link>
    </div>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.getElementById("main")?.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export function App() {
  const { data: me, isLoading, isError, refetch } = useMe();

  useEffect(() => {
    const onUnauthorized = () => void queryClient.invalidateQueries({ queryKey: ["me"] });
    window.addEventListener("margin:unauthorized", onUnauthorized);
    return () => window.removeEventListener("margin:unauthorized", onUnauthorized);
  }, []);

  if (isLoading)
    return (
      <div className="flex h-dvh items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  if (isError || !me)
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-medium">Can't reach the Margin server.</p>
        <p className="text-sm text-muted">If you're running it locally, check that <code>npm run dev</code> is still going.</p>
        <button className="text-sm font-medium text-accent-text hover:underline" onClick={() => void refetch()}>
          Try again
        </button>
      </div>
    );
  if (!me.user) return <AuthPage />;

  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="welcome" element={<WelcomePage />} />
          <Route path="chat/:id?" element={<ChatPage />} />
          <Route path="modules" element={<ModulesPage />} />
          <Route path="modules/:id" element={<ModulePage />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="library/:id" element={<DocumentPage />} />
          <Route path="planner" element={<PlannerPage />} />
          <Route path="memory" element={<MemoryPage />} />
          <Route path="writing" element={<WritingPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

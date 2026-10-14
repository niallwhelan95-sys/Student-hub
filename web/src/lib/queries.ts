import { QueryClient, useQuery } from "@tanstack/react-query";
import { get } from "./api";
import type { ConversationSummary, Dashboard, Me, ModuleSummary } from "./types";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true },
  },
});

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => get<Me>("/auth/me"), staleTime: 60_000 });

export const useModules = () =>
  useQuery({ queryKey: ["modules"], queryFn: async () => (await get<{ modules: ModuleSummary[] }>("/modules")).modules });

export const useConversations = (archived = false) =>
  useQuery({
    queryKey: ["conversations", { archived }],
    queryFn: async () => (await get<{ conversations: ConversationSummary[] }>(`/conversations?archived=${archived}`)).conversations,
  });

export const useDashboard = () => useQuery({ queryKey: ["dashboard"], queryFn: () => get<Dashboard>("/dashboard") });

/** Invalidate everything a chat turn or upload can affect. */
export function refreshAfterActivity() {
  for (const key of ["conversations", "dashboard", "documents", "memory", "modules", "planner"]) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}

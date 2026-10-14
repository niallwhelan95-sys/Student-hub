import { Hono } from "hono";
import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { conversations, deadlines, documents, modules, studentProfiles, tasks } from "../db/schema";
import type { AppVariables } from "../auth/middleware";

export const dashboardRoutes = new Hono<{ Variables: AppVariables }>();

export type NextStep = {
  title: string;
  reason: string;
  action: { label: string; href?: string; prompt?: string; moduleId?: string | null };
};

const days = (d: Date, now: Date) => Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
const when = (d: Date, now: Date) => {
  const n = days(d, now);
  if (n < 0) return `${-n} day${n === -1 ? "" : "s"} overdue`;
  if (n === 0) return "due today";
  if (n === 1) return "due tomorrow";
  return `due in ${n} days`;
};

/**
 * One clear next step, chosen deterministically from stored data so it's instant, free and
 * explainable ("why this?"). The AI is offered as the follow-up action, not the decision-maker.
 */
export function chooseNextStep(input: {
  now: Date;
  moduleCount: number;
  documentCount: number;
  suggestedDeadlines: number;
  proposedMemories: number;
  deadlines: { title: string; dueAt: Date; moduleId: string | null }[];
  tasks: { title: string; status: string; priority: string; dueAt: Date | null; moduleId: string | null }[];
  onboardingDone: boolean;
}): NextStep {
  const { now } = input;
  if (!input.moduleCount) {
    return {
      title: "Add your modules",
      reason: "Margin organises everything around your modules — it takes about a minute.",
      action: { label: input.onboardingDone ? "Add a module" : "Set up Margin", href: input.onboardingDone ? "/modules" : "/welcome" },
    };
  }
  const doing = input.tasks.find((t) => t.status === "doing");
  const urgentDeadline = input.deadlines.find((d) => days(d.dueAt, now) <= 7);
  const urgentTask = input.tasks
    .filter((t) => t.priority === "essential" && t.dueAt && days(t.dueAt, now) <= 3)
    .sort((a, b) => a.dueAt!.getTime() - b.dueAt!.getTime())[0];

  if (urgentTask && (!urgentDeadline || urgentTask.dueAt! <= urgentDeadline.dueAt)) {
    return {
      title: urgentTask.title,
      reason: `Essential task, ${when(urgentTask.dueAt!, now)}.`,
      action: { label: "Help me get started", prompt: `Help me get started on this task: "${urgentTask.title}". Give me one small first step I can do in 15 minutes.`, moduleId: urgentTask.moduleId },
    };
  }
  if (urgentDeadline) {
    return {
      title: urgentDeadline.title,
      reason: `${when(urgentDeadline.dueAt, now)[0].toUpperCase()}${when(urgentDeadline.dueAt, now).slice(1)}.`,
      action: {
        label: "Plan my next session",
        prompt: `"${urgentDeadline.title}" is ${when(urgentDeadline.dueAt, now)}. Look at what you know about it and help me plan my next 25-minute work session.`,
        moduleId: urgentDeadline.moduleId,
      },
    };
  }
  if (doing) {
    return { title: `Continue: ${doing.title}`, reason: "You marked this as in progress.", action: { label: "Pick up where I left off", prompt: `I'm continuing "${doing.title}". Remind me where I was and what to do next.`, moduleId: doing.moduleId } };
  }
  if (input.suggestedDeadlines) {
    return {
      title: `Confirm ${input.suggestedDeadlines} date${input.suggestedDeadlines === 1 ? "" : "s"} found in your documents`,
      reason: "Dates read from documents aren't treated as real until you check them.",
      action: { label: "Review dates", href: "/planner" },
    };
  }
  if (!input.documentCount) {
    return {
      title: "Upload a module handbook or assignment brief",
      reason: "Answers get much better once Margin can read your actual course material.",
      action: { label: "Go to modules", href: "/modules" },
    };
  }
  if (input.proposedMemories) {
    return {
      title: `Check ${input.proposedMemories} thing${input.proposedMemories === 1 ? "" : "s"} Margin wants to remember`,
      reason: "Unconfirmed memories aren't used until you approve them.",
      action: { label: "Review memory", href: "/memory" },
    };
  }
  const nextTask = input.tasks.find((t) => t.priority === "essential");
  if (nextTask) {
    return { title: nextTask.title, reason: "Your next essential task.", action: { label: "Help me get started", prompt: `Help me get started on: "${nextTask.title}".`, moduleId: nextTask.moduleId } };
  }
  return {
    title: "Nothing urgent right now",
    reason: "A good moment to review this week's lecture material or plan ahead.",
    action: { label: "Run a weekly check-in", prompt: "Let's do a quick weekly check-in across my modules. Use what you know and ask me about anything that's out of date — one question at a time." },
  };
}

dashboardRoutes.get("/", async (c) => {
  const user = c.get("user");
  const db = getDb();
  const now = new Date();
  const [profileRows, mods, upcoming, openTasks, recent, processing, counts] = await Promise.all([
    db.select().from(studentProfiles).where(eq(studentProfiles.userId, user.id)),
    db
      .select({
        id: modules.id,
        code: modules.code,
        name: modules.name,
        color: modules.color,
        documentCount: sql<number>`(SELECT count(*)::int FROM documents d WHERE d.module_id = ${modules.id})`,
      })
      .from(modules)
      .where(and(eq(modules.userId, user.id), eq(modules.archived, false)))
      .orderBy(asc(modules.code), asc(modules.name)),
    db
      .select()
      .from(deadlines)
      .where(and(eq(deadlines.userId, user.id), eq(deadlines.status, "confirmed"), gte(deadlines.dueAt, new Date(now.getTime() - 7 * 86_400_000)), lte(deadlines.dueAt, new Date(now.getTime() + 60 * 86_400_000))))
      .orderBy(asc(deadlines.dueAt))
      .limit(8),
    db.select().from(tasks).where(and(eq(tasks.userId, user.id), ne(tasks.status, "done"))).orderBy(asc(tasks.dueAt), asc(tasks.createdAt)).limit(20),
    db
      .select({ id: conversations.id, title: conversations.title, updatedAt: conversations.updatedAt, moduleId: conversations.moduleId })
      .from(conversations)
      .where(and(eq(conversations.userId, user.id), eq(conversations.archived, false)))
      .orderBy(desc(conversations.updatedAt))
      .limit(5),
    db
      .select({ id: documents.id, filename: documents.filename, status: documents.status, statusDetail: documents.statusDetail })
      .from(documents)
      .where(and(eq(documents.userId, user.id), inArray(documents.status, ["queued", "processing"]))),
    db
      .select({
        documents: sql<number>`(SELECT count(*)::int FROM documents WHERE user_id = ${user.id})`,
        suggested: sql<number>`(SELECT count(*)::int FROM deadlines WHERE user_id = ${user.id} AND status = 'suggested')`,
        proposed: sql<number>`(SELECT count(*)::int FROM memories WHERE user_id = ${user.id} AND status = 'proposed')`,
      })
      .from(sql`(SELECT 1) AS one`),
  ]);
  const profile = profileRows[0];
  const ct = counts[0];
  const nextStep = chooseNextStep({
    now,
    moduleCount: mods.length,
    documentCount: Number(ct.documents),
    suggestedDeadlines: Number(ct.suggested),
    proposedMemories: Number(ct.proposed),
    deadlines: upcoming.filter((d) => d.dueAt >= new Date(now.getTime() - 86_400_000)),
    tasks: openTasks,
    onboardingDone: !!profile && (profile.onboarding.dismissed || profile.onboarding.completedSteps.includes("modules")),
  });
  return c.json({
    nextStep,
    modules: mods,
    deadlines: upcoming,
    tasks: openTasks.slice(0, 6),
    recentConversations: recent,
    processing,
    counts: { documents: Number(ct.documents), suggestedDeadlines: Number(ct.suggested), proposedMemories: Number(ct.proposed) },
    onboarding: profile?.onboarding ?? { completedSteps: [], skippedSteps: [] },
  });
});

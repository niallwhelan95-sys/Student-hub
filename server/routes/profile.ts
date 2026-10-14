import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { studentProfiles, users } from "../db/schema";
import type { AppVariables } from "../auth/middleware";
import { parseBody } from "../lib/validate";
import { saveMemory } from "../memory/service";

export const profileRoutes = new Hono<{ Variables: AppVariables }>();

async function load(userId: string) {
  const db = getDb();
  let [p] = await db.select().from(studentProfiles).where(eq(studentProfiles.userId, userId));
  if (!p) [p] = await db.insert(studentProfiles).values({ userId }).returning();
  return p;
}

profileRoutes.get("/", async (c) => c.json({ profile: await load(c.get("user").id) }));

const ProfileBody = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  university: z.string().trim().max(160).nullable().optional(),
  programme: z.string().trim().max(160).nullable().optional(),
  yearOfStudy: z.string().trim().max(40).nullable().optional(),
  semester: z.string().trim().max(40).nullable().optional(),
  assistanceLevel: z.enum(["guided", "collaborative", "drafting"]).optional(),
  accessibilityNotes: z.string().trim().max(2000).nullable().optional(),
  learningPrefs: z
    .object({
      explanationStyle: z.string().max(300).optional(),
      detailLevel: z.enum(["brief", "balanced", "detailed"]).optional(),
      supports: z.array(z.string().max(60)).max(12).optional(),
      notes: z.string().max(2000).optional(),
    })
    .optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

profileRoutes.patch("/", async (c) => {
  const user = c.get("user");
  const body = await parseBody(c, ProfileBody);
  const { displayName, ...rest } = body;
  const db = getDb();
  const current = await load(user.id);
  if (displayName) await db.update(users).set({ displayName }).where(eq(users.id, user.id));
  const [profile] = await db
    .update(studentProfiles)
    .set({
      ...rest,
      learningPrefs: rest.learningPrefs ? { ...current.learningPrefs, ...rest.learningPrefs } : undefined,
      settings: rest.settings ? { ...current.settings, ...rest.settings } : undefined,
      updatedAt: new Date(),
    })
    .where(eq(studentProfiles.userId, user.id))
    .returning();
  return c.json({ profile });
});

/** Record onboarding progress; free-text answers worth remembering become profile memories. */
profileRoutes.post("/onboarding", async (c) => {
  const user = c.get("user");
  const body = await parseBody(
    c,
    z.object({
      step: z.string().max(40),
      action: z.enum(["complete", "skip", "dismiss"]),
      remember: z.array(z.string().trim().min(3).max(500)).max(5).optional(),
    }),
  );
  const current = await load(user.id);
  const ob = current.onboarding;
  const next = {
    completedSteps: body.action === "complete" ? [...new Set([...ob.completedSteps, body.step])] : ob.completedSteps,
    skippedSteps: body.action === "skip" ? [...new Set([...ob.skippedSteps, body.step])] : ob.skippedSteps,
    dismissed: body.action === "dismiss" ? true : ob.dismissed,
  };
  for (const content of body.remember ?? []) {
    await saveMemory({ userId: user.id, content, category: "profile", origin: "onboarding", status: "active", confidence: 1 });
  }
  const [profile] = await getDb().update(studentProfiles).set({ onboarding: next, updatedAt: new Date() }).where(eq(studentProfiles.userId, user.id)).returning();
  return c.json({ profile });
});

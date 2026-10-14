import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { writingProfiles, writingSamples } from "../db/schema";
import type { AppVariables } from "../auth/middleware";
import { parseBody, isUuid } from "../lib/validate";
import { badRequest, notFound } from "../lib/errors";
import { enqueue } from "../jobs/queue";
import { wordCount } from "../lib/text";
import { describeStats } from "../writing/stylometry";
import { addWritingSample, deleteWritingSample, WRITING_CONTEXTS } from "../writing/service";

export const writingRoutes = new Hono<{ Variables: AppVariables }>();

/** Prompts for the optional calibration exercise — short, low-pressure, in the student's own words. */
export const CALIBRATION_PROMPTS = [
  "Explain a concept from one of your modules to a friend who's never studied it. Write it the way you'd naturally explain it.",
  "Describe how you'd approach your next assignment — where you'd start, and what you think the tricky part will be.",
  "Pick something you've learned this year that changed how you think about a topic. What was it, and why did it stick?",
];

writingRoutes.get("/", async (c) => {
  const user = c.get("user");
  const db = getDb();
  const [profiles, samples] = await Promise.all([
    db.select().from(writingProfiles).where(eq(writingProfiles.userId, user.id)),
    db
      .select({
        id: writingSamples.id,
        title: writingSamples.title,
        context: writingSamples.context,
        origin: writingSamples.origin,
        isSpoken: writingSamples.isSpoken,
        wordCount: writingSamples.wordCount,
        exclusionNotes: writingSamples.exclusionNotes,
        documentId: writingSamples.documentId,
        createdAt: writingSamples.createdAt,
      })
      .from(writingSamples)
      .where(eq(writingSamples.userId, user.id))
      .orderBy(desc(writingSamples.createdAt)),
  ]);
  return c.json({
    profiles: profiles.map((p) => ({ ...p, statsDescription: p.stats ? describeStats(p.stats) : [] })),
    samples,
    calibrationPrompts: CALIBRATION_PROMPTS,
  });
});

writingRoutes.post("/samples", async (c) => {
  const user = c.get("user");
  const body = await parseBody(
    c,
    z.object({
      title: z.string().trim().min(1).max(200),
      text: z.string().min(1).max(200_000),
      context: z.enum(WRITING_CONTEXTS),
      origin: z.enum(["paste", "calibration", "dictation"]),
      isSpoken: z.boolean().optional(),
      confirmedOwnWork: z.literal(true),
    }),
  );
  if (wordCount(body.text) < 40) throw badRequest("Please provide at least 40 words so there's enough to learn from.");
  const sample = await addWritingSample({ ...body, userId: user.id });
  return c.json({ sample: { id: sample.id, wordCount: sample.wordCount, exclusionNotes: sample.exclusionNotes } }, 201);
});

writingRoutes.get("/samples/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!isUuid(id)) throw notFound("Sample");
  const [s] = await getDb().select().from(writingSamples).where(and(eq(writingSamples.id, id), eq(writingSamples.userId, user.id)));
  if (!s) throw notFound("Sample");
  return c.json({ sample: s });
});

writingRoutes.delete("/samples/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!isUuid(id) || !(await deleteWritingSample(user.id, id))) throw notFound("Sample");
  return c.json({ ok: true });
});

/** The student's corrections to their profile, enable/disable, or a manual rebuild. */
writingRoutes.patch("/profiles/:context", async (c) => {
  const user = c.get("user");
  const context = z.enum(WRITING_CONTEXTS).parse(c.req.param("context"));
  const body = await parseBody(c, z.object({ userNotes: z.string().max(4000).nullable().optional(), enabled: z.boolean().optional() }));
  const db = getDb();
  const [existing] = await db.select().from(writingProfiles).where(and(eq(writingProfiles.userId, user.id), eq(writingProfiles.context, context)));
  let profile;
  if (existing) {
    [profile] = await db.update(writingProfiles).set({ ...body, updatedAt: new Date() }).where(eq(writingProfiles.id, existing.id)).returning();
  } else {
    [profile] = await db.insert(writingProfiles).values({ userId: user.id, context, ...body }).returning();
  }
  if (body.userNotes !== undefined) await enqueue("writing.rebuild", { userId: user.id, context }, { userId: user.id });
  return c.json({ profile });
});

writingRoutes.post("/profiles/:context/rebuild", async (c) => {
  const user = c.get("user");
  const context = z.enum(WRITING_CONTEXTS).parse(c.req.param("context"));
  await enqueue("writing.rebuild", { userId: user.id, context }, { userId: user.id });
  return c.json({ ok: true });
});

/** Reset: remove the learned profile (samples are kept unless deleted separately). */
writingRoutes.delete("/profiles/:context", async (c) => {
  const user = c.get("user");
  const context = z.enum(WRITING_CONTEXTS).parse(c.req.param("context"));
  await getDb()
    .update(writingProfiles)
    .set({ profile: null, userNotes: null, version: 0, updatedAt: new Date() })
    .where(and(eq(writingProfiles.userId, user.id), eq(writingProfiles.context, context)));
  return c.json({ ok: true });
});

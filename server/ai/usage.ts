import { getDb } from "../db/client";
import { aiUsage, type Usage } from "../db/schema";

export async function recordUsage(userId: string | null, purpose: string, model: string, usage: Usage): Promise<void> {
  try {
    await getDb().insert(aiUsage).values({
      userId,
      purpose,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens ?? 0,
      cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    });
  } catch (err) {
    // Usage tracking must never break a user-facing request.
    console.warn("[ai] failed to record usage", err);
  }
}

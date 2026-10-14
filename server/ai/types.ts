import type { ZodType } from "zod";
import type { Usage } from "../db/schema";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: ImageMediaType; base64: string }
  | { type: "pdf"; base64: string };

/** `cache: true` places a prompt-cache breakpoint at the end of this turn (use on the last stable history turn). */
export type Turn = { role: "user" | "assistant"; content: string | ContentPart[]; cache?: boolean };

/** A system prompt segment. Mark stable leading segments `cache: true` so they are prompt-cached. */
export type SystemPart = { text: string; cache?: boolean };

export type Tier = "chat" | "background";

export interface AICall {
  /** Short label recorded in usage tracking, e.g. "chat", "memory.extract". */
  purpose: string;
  userId?: string | null;
  tier?: Tier;
  system: SystemPart[];
  messages: Turn[];
  maxTokens?: number;
  effort?: Effort;
  signal?: AbortSignal;
}

export interface AIResult {
  text: string;
  model: string;
  stopReason: string | null;
  usage: Usage;
  /** True when the model (and any fallback) declined the request. */
  refused: boolean;
  aborted: boolean;
}

export interface AIProvider {
  readonly id: string;
  /** False when no credentials are configured — callers must degrade gracefully. */
  readonly configured: boolean;
  stream(call: AICall, onText: (delta: string) => void): Promise<AIResult>;
  complete(call: AICall): Promise<AIResult>;
  /** Returns schema-validated JSON, or null if the model could not produce it. */
  structured<T>(call: AICall, schema: ZodType<T>): Promise<T | null>;
}

export class AIUnavailableError extends Error {
  constructor(message = "No AI provider is configured. Add ANTHROPIC_API_KEY to .env to enable AI features.") {
    super(message);
  }
}

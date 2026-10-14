import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { ZodType } from "zod";
import { env } from "../env";
import type { AICall, AIProvider, AIResult, ContentPart, Turn } from "./types";
import { recordUsage } from "./usage";

type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type BetaContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;
type BetaTextBlockParam = Anthropic.Beta.Messages.BetaTextBlockParam;
type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

/** Models that accept server-side refusal fallbacks in the `"default"` form. Haiku has no fallback. */
function supportsDefaultFallback(model: string): boolean {
  return /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);
}

/** `output_config.effort` is accepted by current-generation models; older ones reject it. */
function supportsEffort(model: string): boolean {
  return /^claude-(opus-(4-[5-9]|5)|fable|mythos|sonnet-(4-6|5)|haiku-5)/.test(model);
}

function toBlocks(content: string | ContentPart[]): string | BetaContentBlockParam[] {
  if (typeof content === "string") return content;
  return content.map((part): BetaContentBlockParam => {
    switch (part.type) {
      case "text":
        return { type: "text", text: part.text };
      case "image":
        return { type: "image", source: { type: "base64", media_type: part.mediaType, data: part.base64 } };
      case "pdf":
        return { type: "document", source: { type: "base64", media_type: "application/pdf", data: part.base64 } };
    }
  });
}

function toMessages(turns: Turn[]): BetaMessageParam[] {
  return turns.map((t) => {
    if (!t.cache) return { role: t.role, content: toBlocks(t.content) };
    const blocks = toBlocks(t.content);
    const list: BetaContentBlockParam[] = typeof blocks === "string" ? [{ type: "text", text: blocks }] : [...blocks];
    const last = list[list.length - 1] as BetaContentBlockParam & { cache_control?: { type: "ephemeral" } };
    list[list.length - 1] = { ...last, cache_control: { type: "ephemeral" } } as BetaContentBlockParam;
    return { role: t.role, content: list };
  });
}

function toSystem(call: AICall): BetaTextBlockParam[] {
  return call.system
    .filter((s) => s.text.trim().length > 0)
    .map((s) => (s.cache ? { type: "text", text: s.text, cache_control: { type: "ephemeral" } } : { type: "text", text: s.text }));
}

function textOf(message: BetaMessage): string {
  return message.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic";
  readonly configured = true;
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY ?? null,
      authToken: env.ANTHROPIC_AUTH_TOKEN ?? null,
      maxRetries: 3,
    });
  }

  private params(call: AICall, defaultMaxTokens: number) {
    const model = call.tier === "background" ? env.AI_BACKGROUND_MODEL : env.AI_CHAT_MODEL;
    const effort = call.effort ?? (call.tier === "background" ? env.AI_BACKGROUND_EFFORT : env.AI_CHAT_EFFORT);
    const fallback = supportsDefaultFallback(model);
    return {
      model,
      max_tokens: call.maxTokens ?? defaultMaxTokens,
      system: toSystem(call),
      messages: toMessages(call.messages),
      ...(supportsEffort(model) ? { output_config: { effort } } : {}),
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    };
  }

  private async finish(call: AICall, message: BetaMessage, aborted = false): Promise<AIResult> {
    const usage = {
      inputTokens: message.usage.input_tokens ?? 0,
      outputTokens: message.usage.output_tokens ?? 0,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    };
    await recordUsage(call.userId ?? null, call.purpose, message.model, usage);
    return {
      text: textOf(message),
      model: message.model,
      stopReason: message.stop_reason ?? null,
      usage,
      refused: message.stop_reason === "refusal",
      aborted,
    };
  }

  async stream(call: AICall, onText: (delta: string) => void): Promise<AIResult> {
    const params = this.params(call, 32000);
    const stream = this.client.beta.messages.stream(params, { signal: call.signal });
    let partial = "";
    stream.on("text", (delta) => {
      partial += delta;
      onText(delta);
    });
    try {
      const message = await stream.finalMessage();
      return await this.finish(call, message);
    } catch (err) {
      if (err instanceof Anthropic.APIUserAbortError || call.signal?.aborted) {
        return {
          text: partial,
          model: params.model,
          stopReason: "aborted",
          usage: { inputTokens: 0, outputTokens: 0 },
          refused: false,
          aborted: true,
        };
      }
      throw err;
    }
  }

  async complete(call: AICall): Promise<AIResult> {
    // Streaming under the hood avoids HTTP timeouts on long outputs.
    return this.stream(call, () => {});
  }

  async structured<T>(call: AICall, schema: ZodType<T>): Promise<T | null> {
    const base = this.params(call, 16000);
    const response = await this.client.beta.messages.parse(
      {
        ...base,
        output_config: {
          ...(base.output_config ?? {}),
          format: betaZodOutputFormat(schema as never),
        },
      },
      { signal: call.signal },
    );
    await this.finish(call, response as unknown as BetaMessage);
    if (response.stop_reason === "refusal") return null;
    return (response.parsed_output as T | null) ?? null;
  }
}

/** Translate SDK errors into a short, user-facing explanation. */
export function describeAIError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "The AI provider rejected the API key. Check ANTHROPIC_API_KEY.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key isn't allowed to use the configured model.";
  if (err instanceof Anthropic.NotFoundError) return "The configured AI model wasn't found. Check AI_CHAT_MODEL / AI_BACKGROUND_MODEL.";
  if (err instanceof Anthropic.RateLimitError) return "The AI provider is rate-limiting requests. Wait a moment and retry.";
  if (err instanceof Anthropic.BadRequestError) return `The AI provider rejected the request: ${err.message}`;
  if (err instanceof Anthropic.InternalServerError) return "The AI provider had a temporary problem. Please retry.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the AI provider. Check your internet connection.";
  if (err instanceof Anthropic.APIError) return `AI provider error (${err.status ?? "unknown"}): ${err.message}`;
  return err instanceof Error ? err.message : "Unknown AI error";
}

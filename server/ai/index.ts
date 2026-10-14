import { env } from "../env";
import { AnthropicProvider } from "./anthropic";
import { AIUnavailableError, type AIProvider } from "./types";

export * from "./types";
export { describeAIError } from "./anthropic";

/** Used when no credentials exist. Every call throws; services check `configured` first. */
class OfflineProvider implements AIProvider {
  readonly id = "offline";
  readonly configured = false;
  async stream(): Promise<never> {
    throw new AIUnavailableError();
  }
  async complete(): Promise<never> {
    throw new AIUnavailableError();
  }
  async structured(): Promise<never> {
    throw new AIUnavailableError();
  }
}

let provider: AIProvider | null = null;

export function getAI(): AIProvider {
  if (!provider) {
    provider = env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN ? new AnthropicProvider() : new OfflineProvider();
  }
  return provider;
}

/** Swap the provider (used by tests to inject a scripted fake). */
export function setAIProvider(p: AIProvider | null): void {
  provider = p;
}

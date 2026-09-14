import type { ModelInfo, Provider, ProviderResponse } from "../core/contracts/types.js";

export type ProviderId =
  | "openai"
  | "gemini"
  | "anthropic"
  | "deepseek"
  | "xai"
  | "qwen"
  | "kimi"
  | "minimax"
  | "perplexity"
  | "manus"
  | "groq"
  | "cohere"
  | "huggingface";

export type ProviderStatus = "online" | "offline" | "quota" | "unconfigured" | "error";

export interface ProviderCredentials {
  apiKey?: string;
  apiKeys?: string[];
}

export interface ProviderDefinition {
  id: ProviderId;
  name: string;
  baseUrl: string;
  defaultModel: string;
  priority: number;
  enabledByDefault: boolean;
  protocol: "openai-compatible" | "gemini" | "anthropic";
}

export interface ProviderRuntime {
  definition: ProviderDefinition;
  status: ProviderStatus;
  lastError?: string;
  lastLatencyMs?: number;
  consecutiveFailures: number;
}

export interface ProviderFactory {
  create(definition: ProviderDefinition, credentials: ProviderCredentials): Provider;
}

export interface ModelRouteRequest {
  prompt: string;
  preferredProvider?: ProviderId;
  preferredModel?: string;
  taskType?: "conversation" | "reasoning" | "coding" | "research" | "vision" | "fast";
  maxLatencyMs?: number;
  requiresTools?: boolean;
}

export interface ProviderCallResult {
  response: ProviderResponse;
  attempts: number;
  failedProviders: ProviderId[];
}

export interface ProviderCatalog {
  providers: ProviderDefinition[];
  models: ModelInfo[];
}

export interface ProviderManagerOptions {
  definitions?: ProviderDefinition[];
  credentials?: Partial<Record<ProviderId, ProviderCredentials>>;
  factories?: Partial<Record<ProviderDefinition["protocol"], ProviderFactory>>;
}

export interface RoutedProvider {
  providerId: ProviderId;
  definition: ProviderDefinition;
  model: string;
  score: number;
}

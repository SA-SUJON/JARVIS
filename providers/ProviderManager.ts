import type { ModelInfo, Provider, ProviderRequest } from "../core/contracts/types.js";
import { AnthropicProvider } from "./adapters/AnthropicProvider.js";
import { GeminiProvider } from "./adapters/GeminiProvider.js";
import { OpenAICompatibleProvider } from "./adapters/OpenAICompatibleProvider.js";
import { DEFAULT_PROVIDER_DEFINITIONS } from "./definitions.js";
import type { ProviderCredentials, ProviderDefinition, ProviderManagerOptions, ProviderRuntime } from "./types.js";

export class ProviderManager {
  private readonly definitions: ProviderDefinition[];
  private readonly runtimes = new Map<string, ProviderRuntime>();
  private readonly providers = new Map<string, Provider>();
  private readonly credentials: Partial<Record<string, ProviderCredentials>>;

  constructor(options: ProviderManagerOptions = {}) {
    this.definitions = options.definitions ?? DEFAULT_PROVIDER_DEFINITIONS;
    this.credentials = options.credentials ?? {};

    for (const definition of this.definitions) {
      this.runtimes.set(definition.id, {
        definition,
        status: this.credentials[definition.id]?.apiKey || this.credentials[definition.id]?.apiKeys?.length
          ? "offline"
          : "unconfigured",
        consecutiveFailures: 0,
      });
      this.providers.set(definition.id, this.createProvider(definition));
    }
  }

  private createProvider(definition: ProviderDefinition): Provider {
    const credentials = this.credentials[definition.id] ?? {};

    switch (definition.protocol) {
      case "gemini":
        return new GeminiProvider(definition, credentials);
      case "anthropic":
        return new AnthropicProvider(definition, credentials);
      case "openai-compatible":
        return new OpenAICompatibleProvider(definition, credentials);
    }
  }

  get(providerId: string): Provider | undefined {
    return this.providers.get(providerId);
  }

  getRuntime(providerId: string): ProviderRuntime | undefined {
    return this.runtimes.get(providerId);
  }

  getDefinitions(): ProviderDefinition[] {
    return [...this.definitions];
  }

  getRuntimes(): ProviderRuntime[] {
    return [...this.runtimes.values()];
  }

  async healthCheck(providerId: string): Promise<boolean> {
    const provider = this.providers.get(providerId);
    const runtime = this.runtimes.get(providerId);
    if (!provider || !runtime) return false;

    const started = Date.now();
    try {
      const healthy = await provider.isAvailable();
      runtime.lastLatencyMs = Date.now() - started;
      runtime.status = healthy ? "online" : "offline";
      if (healthy) runtime.consecutiveFailures = 0;
      return healthy;
    } catch (error) {
      runtime.status = "error";
      runtime.lastError = error instanceof Error ? error.message : String(error);
      runtime.lastLatencyMs = Date.now() - started;
      return false;
    }
  }

  async healthCheckAll(): Promise<ProviderRuntime[]> {
    await Promise.all(this.definitions.map((definition) => this.healthCheck(definition.id)));
    return this.getRuntimes();
  }

  async generate(providerId: string, request: ProviderRequest): Promise<ReturnType<Provider["generate"]> extends Promise<infer R> ? R : never> {
    const provider = this.providers.get(providerId);
    const runtime = this.runtimes.get(providerId);
    if (!provider || !runtime) throw new Error(`Unknown provider: ${providerId}`);

    const started = Date.now();
    try {
      const response = await provider.generate(request);
      runtime.status = "online";
      runtime.consecutiveFailures = 0;
      runtime.lastError = undefined;
      runtime.lastLatencyMs = response.latencyMs ?? Date.now() - started;
      return response;
    } catch (error) {
      runtime.consecutiveFailures += 1;
      runtime.lastError = error instanceof Error ? error.message : String(error);
      runtime.lastLatencyMs = Date.now() - started;
      const text = runtime.lastError;
      runtime.status = /401|402|403|408|409|425|429|500|502|503|504/.test(text) ? "quota" : "error";
      throw error;
    }
  }

  async listModels(providerId: string): Promise<ModelInfo[]> {
    const definition = this.definitions.find((item) => item.id === providerId);
    const provider = this.providers.get(providerId);
    if (!definition || !provider) throw new Error(`Unknown provider: ${providerId}`);

    const models = provider.listModels ? await provider.listModels() : [definition.defaultModel];
    return models.map((id) => ({
      id,
      label: id,
      provider: definition.id,
    }));
  }
}

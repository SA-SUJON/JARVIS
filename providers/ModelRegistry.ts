import type { ModelInfo } from "../core/contracts/types.js";
import type { ProviderId } from "./types.js";
import { ProviderManager } from "./ProviderManager.js";

export class ModelRegistry {
  private readonly models = new Map<string, ModelInfo>();

  constructor(private readonly providerManager: ProviderManager) {}

  private key(provider: string, model: string): string {
    return `${provider}:${model}`;
  }

  register(model: ModelInfo): void {
    this.models.set(this.key(model.provider, model.id), model);
  }

  registerMany(models: ModelInfo[]): void {
    models.forEach((model) => this.register(model));
  }

  async refresh(providerIds?: ProviderId[]): Promise<ModelInfo[]> {
    const ids = providerIds ?? this.providerManager.getDefinitions().map((item) => item.id);
    for (const providerId of ids) {
      try {
        this.registerMany(await this.providerManager.listModels(providerId));
      } catch {
        // One provider failing discovery must not stop the global registry refresh.
      }
    }
    return this.list();
  }

  get(provider: string, model: string): ModelInfo | undefined {
    return this.models.get(this.key(provider, model));
  }

  find(model: string): ModelInfo | undefined {
    return [...this.models.values()].find((entry) => entry.id === model);
  }

  list(provider?: string): ModelInfo[] {
    const values = [...this.models.values()];
    return provider ? values.filter((entry) => entry.provider === provider) : values;
  }

  clear(): void {
    this.models.clear();
  }
}

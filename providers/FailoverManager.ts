import type { ProviderRequest, ProviderResponse } from "../core/contracts/types.js";
import { ModelRouter } from "./ModelRouter.js";
import { ProviderManager } from "./ProviderManager.js";
import type { ModelRouteRequest, ProviderCallResult, ProviderId } from "./types.js";

export class FailoverManager {
  constructor(
    private readonly providerManager: ProviderManager,
    private readonly modelRouter = new ModelRouter(),
  ) {}

  async generate(
    request: ProviderRequest,
    route: ModelRouteRequest = {}
  ): Promise<ProviderCallResult> {
    const runtimes = this.providerManager.getRuntimes();
    const ranked = this.modelRouter.rank(route, runtimes);
    const failedProviders: ProviderId[] = [];
    let attempts = 0;
    let lastError: unknown = new Error("No configured providers are available");

    for (const candidate of ranked) {
      const provider = this.providerManager.get(candidate.definition.id);
      if (!provider) continue;

      attempts += 1;
      try {
        const response: ProviderResponse = await this.providerManager.generate(candidate.definition.id, {
          ...request,
          model: route.preferredModel ?? candidate.model,
        });
        return { response, attempts, failedProviders };
      } catch (error) {
        lastError = error;
        failedProviders.push(candidate.definition.id);
      }
    }

    throw new Error(
      `JARVIS provider failover exhausted after ${attempts} attempt(s): ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }
}

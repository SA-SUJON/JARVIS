import type { ProviderRequest, ProviderResponse } from "../core/contracts/types.js";
import { EventBus } from "../core/events/EventBus.js";
import { ModelRouter } from "./ModelRouter.js";
import { ProviderManager } from "./ProviderManager.js";
import type { ModelRouteRequest, ProviderCallResult, ProviderId } from "./types.js";

export class FailoverManager {
  constructor(
    private readonly providerManager: ProviderManager,
    private readonly modelRouter = new ModelRouter(),
    private readonly events?: EventBus,
  ) {}

  async generate(
    request: ProviderRequest,
    route: Omit<ModelRouteRequest, "prompt"> = {},
  ): Promise<ProviderCallResult> {
    const routingRequest: ModelRouteRequest = {
      ...route,
      prompt: request.prompt,
    };

    const runtimes = this.providerManager.getRuntimes();
    const ranked = this.modelRouter.rank(routingRequest, runtimes);
    const failedProviders: ProviderId[] = [];
    let attempts = 0;
    let lastError: unknown = new Error("No configured providers are available");

    for (const candidate of ranked) {
      const provider = this.providerManager.get(candidate.providerId);
      if (!provider) continue;

      attempts += 1;
      try {
        const response: ProviderResponse = await this.providerManager.generate(candidate.providerId, {
          ...request,
          model: candidate.model,
        });
        await this.events?.emit("provider.switched", {
          providerId: candidate.providerId,
          model: candidate.model,
          attempts,
        }, {
          requestId: request.requestId,
        });
        return { response, attempts, failedProviders };
      } catch (error) {
        lastError = error;
        failedProviders.push(candidate.providerId);
        await this.events?.emit("provider.failed", {
          providerId: candidate.providerId,
          model: candidate.model,
          attempt: attempts,
          error: error instanceof Error ? error.message : String(error),
        }, {
          requestId: request.requestId,
        });
      }
    }

    throw new Error(
      `JARVIS provider failover exhausted after ${attempts} attempt(s): ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }

  async execute(
    request: ProviderRequest,
    route: Omit<ModelRouteRequest, "prompt"> = {},
  ): Promise<ProviderCallResult> {
    return this.generate(request, route);
  }
}

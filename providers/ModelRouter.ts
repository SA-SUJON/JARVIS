import type { ModelInfo } from "../core/contracts/types.js";
import type { ModelRouteRequest, ProviderRuntime, RoutedProvider } from "./types.js";

const taskWeights: Record<NonNullable<ModelRouteRequest["taskType"]>, Record<string, number>> = {
  conversation: { gemini: 10, openai: 9, anthropic: 9, deepseek: 7, groq: 8 },
  reasoning: { openai: 10, anthropic: 10, deepseek: 9, gemini: 8, xai: 8 },
  coding: { anthropic: 10, openai: 9, deepseek: 9, gemini: 8, qwen: 8 },
  research: { perplexity: 10, gemini: 9, openai: 8, xai: 8 },
  vision: { gemini: 10, openai: 9, anthropic: 8 },
  fast: { groq: 10, gemini: 9, openai: 8, deepseek: 8 },
};

export class ModelRouter {
  rank(
    request: ModelRouteRequest,
    runtimes: Iterable<ProviderRuntime>,
    models: Iterable<ModelInfo> = []
  ): RoutedProvider[] {
    const modelList = [...models];
    const ranked = [...runtimes]
      .filter((runtime) => runtime.definition.enabledByDefault && runtime.status !== "offline" && runtime.status !== "unconfigured")
      .map((runtime) => {
        const definition = runtime.definition;
        const model = request.preferredModel
          ?? (modelList.find((item) => item.provider === definition.id && item.id === request.preferredModel)?.id)
          ?? definition.defaultModel;

        let score = 100 - definition.priority;

        if (request.preferredProvider === definition.id) score += 50;
        if (request.taskType) score += taskWeights[request.taskType]?.[definition.id] ?? 0;
        if (request.maxLatencyMs !== undefined && runtime.lastLatencyMs !== undefined) {
          score += runtime.lastLatencyMs <= request.maxLatencyMs ? 10 : -20;
        }
        if (runtime.consecutiveFailures > 0) score -= runtime.consecutiveFailures * 15;
        if (runtime.status === "quota") score -= 100;

        return {
          provider: null as never,
          definition,
          model,
          score,
        } satisfies RoutedProvider;
      })
      .sort((a, b) => b.score - a.score);

    return ranked;
  }
}

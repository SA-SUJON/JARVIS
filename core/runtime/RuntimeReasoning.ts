import type { ProviderResponse, Task } from "../contracts/types.js";
import type { ModelRouteRequest, ProviderId } from "../../providers/types.js";
import { FailoverManager } from "../../providers/FailoverManager.js";
import { TaskReasoningEngine, type ReasoningProposal } from "./TaskReasoningEngine.js";

export interface RuntimeReasoningRequest {
  requestId: string;
  preferredProvider?: ProviderId;
  preferredModel?: string;
  maxTokens?: number;
}

/** Runs bounded model reasoning over verified task state without executing the proposal. */
export class RuntimeReasoning {
  readonly engine: TaskReasoningEngine;

  constructor(private readonly failover: FailoverManager) {
    this.engine = new TaskReasoningEngine({
      generate: async (prompt): Promise<ProviderResponse> => {
        const result = await this.failover.execute(
          { requestId: crypto.randomUUID(), prompt, maxTokens: 1000 },
          {
            preferredProvider: undefined,
            preferredModel: undefined,
            taskType: "reasoning",
          },
        );
        return result.response;
      },
    });
  }

  async proposeNextAction(task: Task, request: RuntimeReasoningRequest): Promise<ReasoningProposal> {
    const result = await this.failover.execute(
      {
        requestId: request.requestId,
        prompt: this.enginePrompt(task),
        maxTokens: request.maxTokens ?? 1000,
      },
      {
        preferredProvider: request.preferredProvider,
        preferredModel: request.preferredModel,
        taskType: "reasoning",
      } satisfies Omit<ModelRouteRequest, "prompt">,
    );

    return this.engine.parseReasoningResponse(result.response.content);
  }

  private enginePrompt(task: Task): string {
    const context = JSON.stringify(this.engine.buildContext(task));
    return [
      "You are JARVIS's bounded task-reasoning component.",
      "Inspect the verified task state and propose at most ONE next action.",
      "Do not execute tools. Do not invent tool ids or dependencies.",
      "Return JSON only with action, rationale, and when executing toolId, arguments, and optional dependsOn.",
      "Task context:",
      context,
    ].join("\n");
  }
}

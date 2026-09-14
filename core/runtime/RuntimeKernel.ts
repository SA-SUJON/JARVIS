import type {
  ChatMessage,
  ProviderResponse,
  Task,
  ToolContext,
} from "../contracts/types.js";
import { EventBus } from "../events/EventBus.js";
import { Orchestrator, type OrchestratorRequest } from "../orchestrator/Orchestrator.js";
import { ApprovalManager, type ApprovalRequest } from "../policy/ApprovalManager.js";
import { PolicyEngine } from "../policy/PolicyEngine.js";
import { Planner } from "../planner/Planner.js";
import type { ModelRouteRequest, ProviderId, ProviderManagerOptions } from "../../providers/types.js";
import { FailoverManager } from "../../providers/FailoverManager.js";
import { ModelRegistry } from "../../providers/ModelRegistry.js";
import { ModelRouter } from "../../providers/ModelRouter.js";
import { ProviderManager } from "../../providers/ProviderManager.js";
import { ToolExecutor } from "../../tools/ToolExecutor.js";
import { ToolRegistry } from "../../tools/ToolRegistry.js";

export interface RuntimeKernelOptions {
  providers?: ProviderManagerOptions;
  tools?: ToolRegistry;
  events?: EventBus;
  approvals?: ApprovalManager;
}

export interface RuntimeExecutionRequest extends OrchestratorRequest {
  temperature?: number;
  maxTokens?: number;
  preferredProvider?: ProviderId;
  preferredModel?: string;
  taskType?: ModelRouteRequest["taskType"];
}

export interface RuntimeExecutionResult {
  requestId: string;
  task: Task;
  response?: ProviderResponse;
  status: "completed" | "awaiting_approval" | "failed";
  providerId?: ProviderId;
  model?: string;
  approval?: ApprovalRequest;
  error?: string;
}

export class RuntimeKernel {
  readonly events: EventBus;
  readonly planner: Planner;
  readonly policy: PolicyEngine;
  readonly approvals: ApprovalManager;
  readonly orchestrator: Orchestrator;
  readonly providers: ProviderManager;
  readonly modelRouter: ModelRouter;
  readonly modelRegistry: ModelRegistry;
  readonly failover: FailoverManager;
  readonly tools: ToolRegistry;
  readonly toolExecutor: ToolExecutor;

  constructor(options: RuntimeKernelOptions = {}) {
    this.events = options.events ?? new EventBus();
    this.planner = new Planner();
    this.policy = new PolicyEngine();
    this.approvals = options.approvals ?? new ApprovalManager();
    this.providers = new ProviderManager(options.providers);
    this.modelRouter = new ModelRouter();
    this.modelRegistry = new ModelRegistry(this.providers);
    this.failover = new FailoverManager(this.providers, this.modelRouter);
    this.tools = options.tools ?? new ToolRegistry();
    this.toolExecutor = new ToolExecutor(this.tools, this.events);
    this.orchestrator = new Orchestrator({
      events: this.events,
      planner: this.planner,
      policy: this.policy,
    });
  }

  async execute(request: RuntimeExecutionRequest): Promise<RuntimeExecutionResult> {
    const orchestration = await this.orchestrator.execute(request);

    if (orchestration.status === "awaiting_approval") {
      const approval = this.approvals.create(orchestration.task);
      return {
        requestId: orchestration.requestId,
        task: orchestration.task,
        status: "awaiting_approval",
        approval,
        error: orchestration.error,
      };
    }

    if (orchestration.status !== "completed") {
      return {
        requestId: orchestration.requestId,
        task: orchestration.task,
        status: orchestration.status,
        error: orchestration.error,
      };
    }

    orchestration.task.status = "running";
    orchestration.task.updatedAt = new Date().toISOString();

    const routeRequest: Omit<ModelRouteRequest, "prompt"> = {
      preferredProvider: request.preferredProvider,
      preferredModel: request.preferredModel,
      taskType: request.taskType ?? "conversation",
    };

    try {
      const result = await this.failover.execute(
        {
          requestId: orchestration.requestId,
          prompt: request.input,
          systemPrompt: request.systemPrompt,
          history: request.history as ChatMessage[] | undefined,
          temperature: request.temperature,
          maxTokens: request.maxTokens,
        },
        routeRequest,
      );

      orchestration.task.status = "completed";
      orchestration.task.result = result.response;
      orchestration.task.updatedAt = new Date().toISOString();

      await this.events.emit("assistant.responding", result.response, {
        requestId: orchestration.requestId,
        taskId: orchestration.task.id,
      });

      return {
        requestId: orchestration.requestId,
        task: orchestration.task,
        response: result.response,
        providerId: result.response.providerId as ProviderId,
        model: result.response.model,
        status: "completed",
      };
    } catch (error) {
      orchestration.task.status = "failed";
      orchestration.task.error = error instanceof Error ? error.message : String(error);
      orchestration.task.updatedAt = new Date().toISOString();

      return {
        requestId: orchestration.requestId,
        task: orchestration.task,
        status: "failed",
        error: orchestration.task.error,
      };
    }
  }

  listApprovals(): ApprovalRequest[] {
    return this.approvals.list();
  }

  approve(id: string): ApprovalRequest {
    const decision = this.approvals.approve(id);
    if (!decision.allowed || !decision.request) throw new Error(decision.reason || "Approval could not be granted.");
    return decision.request;
  }

  reject(id: string): boolean {
    const decision = this.approvals.reject(id);
    if (!decision.request && !decision.reason) return false;
    return Boolean(decision.request);
  }

  consumeApproval(id: string): ApprovalRequest {
    const decision = this.approvals.consumeApproved(id);
    if (!decision.allowed || !decision.request) throw new Error(decision.reason || "Approval is not valid.");
    return decision.request;
  }

  async executeTool(
    toolId: string,
    input: Record<string, unknown>,
    context: ToolContext,
  ) {
    return this.toolExecutor.execute({ toolId, input, context });
  }

  async healthCheck(): Promise<void> {
    await this.providers.healthCheckAll();
  }
}

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
import { VerificationEngine, type VerificationResult } from "../verification/index.js";
import type { ModelRouteRequest, ProviderId, ProviderManagerOptions } from "../../providers/types.js";
import { FailoverManager } from "../../providers/FailoverManager.js";
import { ModelRegistry } from "../../providers/ModelRegistry.js";
import { ModelRouter } from "../../providers/ModelRouter.js";
import { ProviderManager } from "../../providers/ProviderManager.js";
import { createBuiltinTools } from "../../tools/builtin/index.js";
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
  toolResult?: unknown;
  verification?: VerificationResult;
}

type PendingApprovalExecution = {
  request: RuntimeExecutionRequest;
  task: Task;
};

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
  readonly verification: VerificationEngine;

  private readonly pendingExecutions = new Map<string, PendingApprovalExecution>();

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
    if (!options.tools) this.tools.registerMany(createBuiltinTools());
    this.toolExecutor = new ToolExecutor(this.tools, this.events);
    this.verification = new VerificationEngine(this.events);
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
      this.pendingExecutions.set(approval.id, {
        request: {
          ...request,
          history: request.history?.map((message) => ({ ...message })),
          policyContext: request.policyContext ? { ...request.policyContext } : undefined,
        },
        task: orchestration.task,
      });
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

    return this.executeTask(request, orchestration.task, orchestration.requestId);
  }

  async executeApproved(id: string): Promise<RuntimeExecutionResult> {
    const approval = this.consumeApproval(id);
    const pending = this.pendingExecutions.get(id);
    if (!pending) {
      throw new Error("Approved execution payload is no longer available. The action must be requested again.");
    }

    if (pending.task.id !== approval.taskId || pending.task.requestId !== approval.requestId) {
      this.pendingExecutions.delete(id);
      throw new Error("Approval does not match the pending task and has been invalidated.");
    }

    this.pendingExecutions.delete(id);
    const authorizedRequest: RuntimeExecutionRequest = {
      ...pending.request,
      policyContext: {
        ...(pending.request.policyContext || {}),
        explicitApproval: true,
      },
    };

    return this.executeTask(authorizedRequest, pending.task, approval.requestId);
  }

  listApprovals(): ApprovalRequest[] {
    const active = new Set(this.approvals.list().map((approval) => approval.id));
    for (const id of this.pendingExecutions.keys()) {
      if (!active.has(id)) this.pendingExecutions.delete(id);
    }
    return this.approvals.list();
  }

  approve(id: string): ApprovalRequest {
    const decision = this.approvals.approve(id);
    if (!decision.allowed || !decision.request) throw new Error(decision.reason || "Approval could not be granted.");
    return decision.request;
  }

  reject(id: string): boolean {
    const decision = this.approvals.reject(id);
    this.pendingExecutions.delete(id);
    if (!decision.request && !decision.reason) return false;
    return Boolean(decision.request);
  }

  consumeApproval(id: string): ApprovalRequest {
    const decision = this.approvals.consumeApproved(id);
    if (!decision.allowed || !decision.request) throw new Error(decision.reason || "Approval is not valid.");
    return decision.request;
  }

  async executeTool(toolId: string, input: Record<string, unknown>, context: ToolContext) {
    return this.toolExecutor.execute({ toolId, input, context });
  }

  async healthCheck(): Promise<void> {
    await this.providers.healthCheckAll();
  }

  private async executeTask(request: RuntimeExecutionRequest, task: Task, requestId: string): Promise<RuntimeExecutionResult> {
    task.status = "running";
    task.updatedAt = new Date().toISOString();
    const step = task.steps[0];

    if (step?.toolId) {
      if (!step.arguments) {
        step.status = "failed";
        step.error = "Planned tool has no structured arguments.";
        task.status = "failed";
        task.error = step.error;
        task.updatedAt = new Date().toISOString();
        return { requestId, task, status: "failed", error: task.error };
      }

      const context: ToolContext = {
        requestId,
        taskId: task.id,
        authority: task.authority,
        approved: Boolean(request.policyContext?.explicitApproval),
        metadata: { goal: task.goal },
      };
      const toolInput = step.arguments;
      const toolResult = await this.executeTool(step.toolId, toolInput, context);
      if (!toolResult.ok) {
        step.status = "failed";
        step.error = toolResult.error;
        task.status = "failed";
        task.error = toolResult.error;
        task.updatedAt = new Date().toISOString();
        return { requestId, task, status: "failed", error: task.error, toolResult };
      }

      step.status = "verifying";
      task.status = "verifying";
      task.updatedAt = new Date().toISOString();

      const verification = await this.verification.verify({
        requestId,
        taskId: task.id,
        toolId: step.toolId,
        input: toolInput,
        result: toolResult,
        step,
      });
      step.verification = verification;

      if (!verification.verified) {
        step.status = "failed";
        step.error = verification.reason;
        task.status = "failed";
        task.error = `Verification failed: ${verification.reason}`;
        task.updatedAt = new Date().toISOString();
        return { requestId, task, status: "failed", error: task.error, toolResult: toolResult.value, verification };
      }

      step.status = "completed";
      step.result = toolResult.value;
      task.status = "completed";
      task.result = toolResult.value;
      task.updatedAt = new Date().toISOString();
      return { requestId, task, status: "completed", toolResult: toolResult.value, verification };
    }

    if (task.authority >= 3) {
      task.status = "failed";
      task.error = "Approval granted, but no state-changing execution tool is bound to this task yet.";
      task.updatedAt = new Date().toISOString();
      return { requestId, task, status: "failed", error: task.error };
    }

    const routeRequest: Omit<ModelRouteRequest, "prompt"> = {
      preferredProvider: request.preferredProvider,
      preferredModel: request.preferredModel,
      taskType: request.taskType ?? "conversation",
    };

    try {
      const result = await this.failover.execute(
        {
          requestId,
          prompt: request.input,
          systemPrompt: request.systemPrompt,
          history: request.history as ChatMessage[] | undefined,
          temperature: request.temperature,
          maxTokens: request.maxTokens,
        },
        routeRequest,
      );

      task.status = "completed";
      task.result = result.response;
      task.updatedAt = new Date().toISOString();
      await this.events.emit("assistant.responding", result.response, { requestId, taskId: task.id });

      return {
        requestId,
        task,
        response: result.response,
        providerId: result.response.providerId as ProviderId,
        model: result.response.model,
        status: "completed",
      };
    } catch (error) {
      task.status = "failed";
      task.error = error instanceof Error ? error.message : String(error);
      task.updatedAt = new Date().toISOString();
      return { requestId, task, status: "failed", error: task.error };
    }
  }
}

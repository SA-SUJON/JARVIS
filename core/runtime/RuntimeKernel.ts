import type {
  ChatMessage,
  ProviderResponse,
  Task,
  TaskExecutionReceipt,
  TaskStep,
  ToolContext,
} from "../contracts/types.js";
import { EventBus } from "../events/EventBus.js";
import { ExecutionStateMachine } from "./ExecutionStateMachine.js";
import { RecoveryEngine } from "./RecoveryEngine.js";
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
import { PlanValidationEngine } from "./PlanValidationEngine.js";
import { TaskContextStore, resolveToolArguments } from "./TaskContext.js";

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
  readonly executionState: ExecutionStateMachine;
  readonly taskContext: TaskContextStore;
  readonly recovery: RecoveryEngine;
  readonly planValidation: PlanValidationEngine;

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
    this.executionState = new ExecutionStateMachine();
    this.taskContext = new TaskContextStore();
    this.recovery = new RecoveryEngine();
    this.planValidation = new PlanValidationEngine(this.tools);
    this.orchestrator = new Orchestrator({
      events: this.events,
      planner: this.planner,
      policy: this.policy,
    });
  }

  async execute(request: RuntimeExecutionRequest): Promise<RuntimeExecutionResult> {
    const orchestration = await this.orchestrator.execute(request);

    const validation = this.planValidation.validate(orchestration.task);
    if (!validation.valid) {
      const reason = validation.issues.map((issue) => issue.stepId ? `${issue.stepId}: ${issue.reason}` : issue.reason).join("; ");
      if (this.executionState.canTransition(orchestration.task.status, "failed")) {
        this.executionState.transition(orchestration.task, "failed");
      }
      orchestration.task.error = `Plan validation failed: ${reason}`;
      return {
        requestId: orchestration.requestId,
        task: orchestration.task,
        status: "failed",
        error: orchestration.task.error,
      };
    }

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

  private recordExecution(task: Task, receipt: Omit<TaskExecutionReceipt, "id">): void {
    task.executionHistory ??= [];
    task.executionHistory.push({ id: crypto.randomUUID(), ...receipt });
  }

  private nextAttempt(task: Task, stepId: string): number {
    return (task.executionHistory ?? []).filter((entry) => entry.stepId === stepId).length + 1;
  }

  private failTask(task: Task, error: string): RuntimeExecutionResult {
    if (!this.executionState.canTransition(task.status, "failed")) throw new Error(`Cannot fail task from state: ${task.status}`);
    this.executionState.transition(task, "failed");
    task.error = error;
    return { requestId: task.requestId, task, status: "failed", error };
  }

  private retryStep(task: Task, step: TaskStep, reason: string): boolean {
    const decision = this.recovery.decide(task, step, reason);
    if (decision.action !== "retry_step") return false;

    this.executionState.transition(step, "replanning");
    if (task.status !== "replanning") this.executionState.transition(task, "replanning");
    this.executionState.transition(task, "running");
    this.executionState.transition(step, "running");
    step.error = undefined;
    step.verification = undefined;
    return true;
  }

  private async executeToolStep(
    request: RuntimeExecutionRequest,
    task: Task,
    requestId: string,
    step: TaskStep,
  ): Promise<RuntimeExecutionResult | undefined> {
    if (!step.toolId) return undefined;

    if (!step.arguments) {
      step.status = "failed";
      step.error = "Planned tool has no structured arguments.";
      return this.failTask(task, step.error);
    }

    const unmetDependencies = (step.dependsOn || []).filter((dependencyId) =>
      task.steps.find((candidate) => candidate.id === dependencyId)?.status !== "completed",
    );
    if (unmetDependencies.length) {
      step.status = "failed";
      step.error = `Step dependencies are not complete: ${unmetDependencies.join(", ")}`;
      return this.failTask(task, step.error);
    }

    if (step.status !== "running") this.executionState.transition(step, "running");
    if (task.status !== "running") this.executionState.transition(task, "running");

    let toolInput: Record<string, unknown>;
    try {
      toolInput = resolveToolArguments(task, step.arguments, this.taskContext);
    } catch (error) {
      this.executionState.transition(step, "failed");
      step.error = error instanceof Error ? error.message : String(error);
      return this.failTask(task, `Argument reference resolution failed: ${step.error}`);
    }

    const context: ToolContext = {
      requestId,
      taskId: task.id,
      authority: task.authority,
      approved: Boolean(request.policyContext?.explicitApproval),
      metadata: { goal: task.goal, stepId: step.id },
    };
    const toolResult = await this.executeTool(step.toolId, toolInput, context);
    const attempt = this.nextAttempt(task, step.id);

    if (!toolResult.ok) {
      this.recordExecution(task, {
        stepId: step.id,
        toolId: step.toolId,
        attempt,
        outcome: "tool_failure",
        executionId: toolResult.executionId,
        startedAt: toolResult.metadata.startedAt,
        completedAt: toolResult.metadata.completedAt,
        error: toolResult.error || "Tool execution failed.",
      });

      if (this.retryStep(task, step, toolResult.error || "Tool execution failed.")) {
        return this.executeToolStep(request, task, requestId, step);
      }
      this.executionState.transition(step, "failed");
      step.error = toolResult.error || "Tool execution failed.";
      return this.failTask(task, step.error);
    }

    this.executionState.transition(step, "verifying");
    this.executionState.transition(task, "verifying");

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
      this.recordExecution(task, {
        stepId: step.id,
        toolId: step.toolId,
        attempt,
        outcome: "verification_failure",
        executionId: toolResult.executionId,
        startedAt: toolResult.metadata.startedAt,
        completedAt: toolResult.metadata.completedAt,
        error: `Verification failed: ${verification.reason}`,
      });

      if (this.retryStep(task, step, `Verification failed: ${verification.reason}`)) {
        return this.executeToolStep(request, task, requestId, step);
      }
      this.executionState.transition(step, "failed");
      step.error = verification.reason;
      return this.failTask(task, `Verification failed: ${verification.reason}`);
    }

    this.recordExecution(task, {
      stepId: step.id,
      toolId: step.toolId,
      attempt,
      outcome: "success",
      executionId: toolResult.executionId,
      startedAt: toolResult.metadata.startedAt,
      completedAt: toolResult.metadata.completedAt,
    });

    this.executionState.transition(step, "completed");
    step.result = toolResult.data;
    this.taskContext.publish(task, step.id, {
      executionId: toolResult.executionId,
      data: toolResult.data,
      metadata: toolResult.metadata,
    });
    return undefined;
  }

  private async executeTask(request: RuntimeExecutionRequest, task: Task, requestId: string): Promise<RuntimeExecutionResult> {
    if (task.status === "planning") this.executionState.transition(task, "running");

    if (task.steps.some((step) => step.toolId)) {
      let lastToolResult: unknown;
      let lastVerification: VerificationResult | undefined;

      for (const step of task.steps) {
        if (task.status === "verifying") this.executionState.transition(task, "running");
        if (task.status === "replanning") this.executionState.transition(task, "running");
        const result = await this.executeToolStep(request, task, requestId, step);
        if (result) return { ...result, requestId };
        if (step.toolId) {
          lastToolResult = step.result;
          lastVerification = step.verification as VerificationResult | undefined;
        }
      }

      this.executionState.transition(task, "completed");
      task.result = lastToolResult;
      return {
        requestId,
        task,
        status: "completed",
        toolResult: lastToolResult,
        verification: lastVerification,
      };
    }

    if (task.authority >= 3) {
      return this.failTask(task, "Approval granted, but no state-changing execution tool is bound to this task yet.");
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

      this.executionState.transition(task, "completed");
      task.result = result.response;
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
      return this.failTask(task, error instanceof Error ? error.message : String(error));
    }
  }
}

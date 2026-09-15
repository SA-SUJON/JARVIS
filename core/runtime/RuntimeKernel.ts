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
import { RuntimeReasoning, type RuntimeReasoningRequest } from "./RuntimeReasoning.js";
import { promoteReasoningProposal, type ReasoningProposal } from "./TaskReasoningEngine.js";
import { TaskContextStore } from "./TaskContext.js";
import { ReasoningCycleEngine, type ReasoningCycleRequest, type ReasoningCycleResult } from "./ReasoningCycleEngine.js";
import { ExecutionBoundary } from "./ExecutionBoundary.js";

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
  reasoningEnabled?: boolean;
  maxReasoningCycles?: number;
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
  readonly reasoning: RuntimeReasoning;
  readonly reasoningCycle: ReasoningCycleEngine;
  readonly executionBoundary: ExecutionBoundary;

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
    this.planValidation = new PlanValidationEngine(this.tools, this.verification);
    this.executionBoundary = new ExecutionBoundary(this.toolExecutor, this.verification, this.taskContext);
    this.reasoning = new RuntimeReasoning(this.failover);
    this.reasoningCycle = new ReasoningCycleEngine();
    this.orchestrator = new Orchestrator({ events: this.events, planner: this.planner, policy: this.policy });
  }

  async execute(request: RuntimeExecutionRequest): Promise<RuntimeExecutionResult> {
    const orchestration = await this.orchestrator.execute(request);
    return this.continueOrchestration(request, orchestration);
  }

  async executeApproved(id: string): Promise<RuntimeExecutionResult> {
    const approval = this.consumeApproval(id);
    const pending = this.pendingExecutions.get(id);
    if (!pending) throw new Error("Approved execution payload is no longer available. The action must be requested again.");
    if (pending.task.id !== approval.taskId || pending.task.requestId !== approval.requestId) {
      this.pendingExecutions.delete(id);
      throw new Error("Approval does not match the pending task and has been invalidated.");
    }
    this.pendingExecutions.delete(id);
    return this.executeTask({
      ...pending.request,
      policyContext: { ...(pending.request.policyContext || {}), explicitApproval: true },
    }, pending.task, approval.requestId);
  }

  listApprovals(): ApprovalRequest[] {
    const active = new Set(this.approvals.list().map((approval) => approval.id));
    for (const id of this.pendingExecutions.keys()) if (!active.has(id)) this.pendingExecutions.delete(id);
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

  async healthCheck(): Promise<void> {
    await this.providers.healthCheckAll();
  }

  async reasonNextAction(task: Task, request: RuntimeReasoningRequest): Promise<{ proposal: ReasoningProposal; step?: TaskStep }> {
    const proposal = await this.reasoning.proposeNextAction(task, request);
    if (proposal.action === "stop") return { proposal };
    const step = promoteReasoningProposal(task, proposal);
    const validation = this.planValidation.validate(task);
    if (!validation.valid) {
      task.steps.pop();
      const reason = validation.issues.map((issue) => issue.stepId ? `${issue.stepId}: ${issue.reason}` : issue.reason).join("; ");
      throw new Error(`Reasoning proposal failed plan validation: ${reason}`);
    }
    return { proposal, step };
  }

  async runReasoningCycle(task: Task, request: ReasoningCycleRequest = {}): Promise<ReasoningCycleResult> {
    return this.reasoningCycle.run(task, async () => this.reasonNextAction(task, {
      requestId: task.requestId,
      preferredProvider: request.preferredProvider,
      preferredModel: request.preferredModel,
      maxTokens: request.maxTokens,
    }), request);
  }

  private async continueOrchestration(
    request: RuntimeExecutionRequest,
    orchestration: Awaited<ReturnType<Orchestrator["execute"]>>,
  ): Promise<RuntimeExecutionResult> {
    const validation = this.planValidation.validate(orchestration.task);
    if (!validation.valid) {
      const reason = validation.issues.map((issue) => issue.stepId ? `${issue.stepId}: ${issue.reason}` : issue.reason).join("; ");
      if (this.executionState.canTransition(orchestration.task.status, "failed")) this.executionState.transition(orchestration.task, "failed");
      orchestration.task.error = `Plan validation failed: ${reason}`;
      return { requestId: orchestration.requestId, task: orchestration.task, status: "failed", error: orchestration.task.error };
    }
    if (orchestration.status === "awaiting_approval") return this.createApproval(request, orchestration.task, orchestration.requestId, orchestration.error);
    if (orchestration.status !== "completed") return { requestId: orchestration.requestId, task: orchestration.task, status: orchestration.status, error: orchestration.error };
    return this.executeTask(request, orchestration.task, orchestration.requestId);
  }

  private createApproval(request: RuntimeExecutionRequest, task: Task, requestId: string, error?: string): RuntimeExecutionResult {
    const approval = this.approvals.create(task);
    this.pendingExecutions.set(approval.id, {
      request: { ...request, history: request.history?.map((message) => ({ ...message })), policyContext: request.policyContext ? { ...request.policyContext } : undefined },
      task,
    });
    return { requestId, task, status: "awaiting_approval", approval, error };
  }

  private async continueWithReasoning(request: RuntimeExecutionRequest, task: Task, requestId: string): Promise<RuntimeExecutionResult | undefined> {
    if (!request.reasoningEnabled) return undefined;
    const cycle = await this.runReasoningCycle(task, {
      maxCycles: request.maxReasoningCycles,
      preferredProvider: request.preferredProvider,
      preferredModel: request.preferredModel,
      maxTokens: request.maxTokens,
    });
    if (cycle.status === "stopped") return undefined;

    if (task.status === "verifying") this.executionState.transition(task, "replanning");
    const decision = await this.policy.evaluate(task.authority, task.risk, {
      operatorAuthenticated: request.policyContext?.operatorAuthenticated,
      explicitApproval: false,
    });
    if (!decision.allowed) {
      if (task.status !== "replanning") throw new Error(`Cannot queue reasoning approval from state: ${task.status}`);
      return this.createApproval(request, task, requestId, decision.reason);
    }
    return this.executeTask(request, task, requestId);
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

  private async executeToolStep(request: RuntimeExecutionRequest, task: Task, requestId: string, step: TaskStep): Promise<RuntimeExecutionResult | undefined> {
    if (!step.toolId) return undefined;
    if (this.executionBoundary.isVerifiedCompletion(step)) return undefined;
    if (step.status === "completed") {
      this.executionState.transition(step, "failed");
      step.error = `Completed step has no authoritative verification: ${step.id}`;
      return this.failTask(task, step.error);
    }
    if (!step.arguments) {
      step.status = "failed";
      step.error = "Planned tool has no structured arguments.";
      return this.failTask(task, step.error);
    }
    const unmetDependencies = (step.dependsOn || []).filter((dependencyId) => task.steps.find((candidate) => candidate.id === dependencyId)?.status !== "completed");
    if (unmetDependencies.length) {
      step.status = "failed";
      step.error = `Step dependencies are not complete: ${unmetDependencies.join(", ")}`;
      return this.failTask(task, step.error);
    }
    if (step.status !== "running") this.executionState.transition(step, "running");
    if (task.status !== "running") this.executionState.transition(task, "running");

    const attempt = this.nextAttempt(task, step.id);
    try {
      this.executionState.transition(step, "verifying");
      this.executionState.transition(task, "verifying");
      const result = await this.executionBoundary.executeStep(task, requestId, step, Boolean(request.policyContext?.explicitApproval));
      this.recordExecution(task, { stepId: step.id, toolId: step.toolId, attempt, outcome: "success", executionId: result.toolResult.executionId, startedAt: result.toolResult.metadata.startedAt, completedAt: result.toolResult.metadata.completedAt });
      this.executionState.transition(step, "completed");
      this.taskContext.publish(task, step.id, { executionId: result.toolResult.executionId, data: result.toolResult.data, metadata: result.toolResult.metadata });
      return undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedExecution = message.startsWith("Verification failed:") ? "verification_failure" : "tool_failure";
      this.recordExecution(task, { stepId: step.id, toolId: step.toolId, attempt, outcome: failedExecution, executionId: crypto.randomUUID(), startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), error: message });
      if (this.retryStep(task, step, message)) return this.executeToolStep(request, task, requestId, step);
      step.status = "failed";
      step.error = message;
      return this.failTask(task, message);
    }
  }

  private async executeTask(request: RuntimeExecutionRequest, task: Task, requestId: string): Promise<RuntimeExecutionResult> {
    if (task.status === "planning") this.executionState.transition(task, "running");
    if (task.steps.some((step) => step.toolId)) {
      let lastToolResult: unknown;
      let lastVerification: VerificationResult | undefined;
      for (const step of task.steps) {
        if (this.executionBoundary.isVerifiedCompletion(step)) {
          if (step.toolId) { lastToolResult = step.result; lastVerification = step.verification as VerificationResult | undefined; }
          continue;
        }
        if (step.status === "completed") {
          return this.failTask(task, `Completed step has no authoritative verification: ${step.id}`);
        }
        if (task.status === "verifying") this.executionState.transition(task, "running");
        if (task.status === "replanning") this.executionState.transition(task, "running");
        const result = await this.executeToolStep(request, task, requestId, step);
        if (result) return { ...result, requestId };
        if (step.toolId) { lastToolResult = step.result; lastVerification = step.verification as VerificationResult | undefined; }
      }
      if (request.reasoningEnabled) {
        const continued = await this.continueWithReasoning(request, task, requestId);
        if (continued) return continued;
      }
      this.executionState.transition(task, "completed");
      task.result = lastToolResult;
      return { requestId, task, status: "completed", toolResult: lastToolResult, verification: lastVerification };
    }

    if (task.authority >= 3) return this.failTask(task, "Approval granted, but no state-changing execution tool is bound to this task yet.");

    const routeRequest: Omit<ModelRouteRequest, "prompt"> = { preferredProvider: request.preferredProvider, preferredModel: request.preferredModel, taskType: request.taskType ?? "conversation" };
    try {
      const result = await this.failover.execute({ requestId, prompt: request.input, systemPrompt: request.systemPrompt, history: request.history as ChatMessage[] | undefined, temperature: request.temperature, maxTokens: request.maxTokens }, routeRequest);
      this.executionState.transition(task, "completed");
      task.result = result.response;
      await this.events.emit("assistant.responding", result.response, { requestId, taskId: task.id });
      return { requestId, task, response: result.response, providerId: result.response.providerId as ProviderId, model: result.response.model, status: "completed" };
    } catch (error) {
      return this.failTask(task, error instanceof Error ? error.message : String(error));
    }
  }
}

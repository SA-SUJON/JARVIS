import type { Task, TaskStep, ToolContext } from "../contracts/types.js";
import type { VerificationResult } from "../verification/index.js";
import type { ToolExecutionResult } from "../../tools/types.js";
import { ToolExecutor } from "../../tools/ToolExecutor.js";
import { VerificationEngine } from "../verification/VerificationEngine.js";
import { TaskContextStore, resolveToolArguments } from "./TaskContext.js";

export interface ExecutionBoundaryResult {
  toolResult: ToolExecutionResult;
  verification: VerificationResult;
}

/**
 * Single execution contract for MARK_05: resolve arguments, execute a tool,
 * then require an explicit verified result before a step can be considered complete.
 */
export class ExecutionBoundary {
  constructor(
    private readonly executor: ToolExecutor,
    private readonly verification: VerificationEngine,
    private readonly taskContext: TaskContextStore,
  ) {}

  isVerifiedCompletion(step: TaskStep): boolean {
    const verification = step.verification as VerificationResult | undefined;
    return step.status === "completed" && verification?.verified === true && verification.status === "verified";
  }

  assertVerifiableCompletion(step: TaskStep): void {
    if (!this.isVerifiedCompletion(step)) {
      throw new Error(`Cannot treat step as completed without verified execution: ${step.id}`);
    }
  }

  async executeStep(task: Task, requestId: string, step: TaskStep, approved: boolean): Promise<ExecutionBoundaryResult> {
    if (!step.toolId) throw new Error(`Execution boundary requires a tool-backed step: ${step.id}`);
    if (!step.arguments) throw new Error(`Execution boundary requires structured arguments: ${step.id}`);

    const input = resolveToolArguments(task, step.arguments, this.taskContext);
    const context: ToolContext = {
      requestId,
      taskId: task.id,
      authority: task.authority,
      approved,
      metadata: { goal: task.goal, stepId: step.id },
    };

    const toolResult = await this.executor.execute({ toolId: step.toolId, input, context });
    const verification = await this.verification.verify({
      requestId,
      taskId: task.id,
      toolId: step.toolId,
      input,
      result: toolResult,
      step,
    });

    if (!toolResult.ok) throw new Error(toolResult.error || `Tool execution failed: ${step.toolId}`);
    if (!verification.verified) throw new Error(`Verification failed: ${verification.reason}`);

    step.result = toolResult.data;
    step.verification = verification;
    return { toolResult, verification };
  }
}

import type { Task, TaskStep, TaskStatus } from "../contracts/types.js";

type StatefulExecution = Pick<Task, "status" | "updatedAt"> | Pick<TaskStep, "status">;

const ALLOWED_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ["planning", "running", "cancelled", "failed"],
  planning: ["awaiting_approval", "running", "replanning", "failed", "cancelled"],
  awaiting_approval: ["running", "failed", "cancelled"],
  running: ["verifying", "completed", "replanning", "failed", "cancelled"],
  verifying: ["running", "completed", "replanning", "failed", "cancelled"],
  replanning: ["running", "awaiting_approval", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export class ExecutionStateMachine {
  canTransition(from: TaskStatus, to: TaskStatus): boolean {
    return ALLOWED_TRANSITIONS[from].includes(to);
  }

  transition(target: StatefulExecution, to: TaskStatus): void {
    const from = target.status;
    if (!this.canTransition(from, to)) {
      throw new Error(`Invalid execution state transition: ${from} -> ${to}`);
    }
    target.status = to;
    if ("updatedAt" in target) target.updatedAt = new Date().toISOString();
  }
}

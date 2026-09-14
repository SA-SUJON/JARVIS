import type { Task, TaskStatus } from "../contracts/types.js";

const ALLOWED_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ["planning", "cancelled", "failed"],
  planning: ["awaiting_approval", "running", "failed", "cancelled"],
  awaiting_approval: ["running", "failed", "cancelled"],
  running: ["verifying", "completed", "failed", "cancelled"],
  verifying: ["running", "completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export class ExecutionStateMachine {
  canTransition(from: TaskStatus, to: TaskStatus): boolean {
    return ALLOWED_TRANSITIONS[from].includes(to);
  }

  transition(task: Task, to: TaskStatus): void {
    const from = task.status;
    if (!this.canTransition(from, to)) {
      throw new Error(`Invalid task state transition: ${from} -> ${to}`);
    }
    task.status = to;
    task.updatedAt = new Date().toISOString();
  }
}

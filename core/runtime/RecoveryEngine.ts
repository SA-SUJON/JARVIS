import type { RecoveryAction, Task, TaskStep } from "../contracts/types.js";

export interface RecoveryDecision {
  action: RecoveryAction;
  attempt: number;
  reason: string;
}

/** Deterministic, bounded recovery policy. */
export class RecoveryEngine {
  constructor(private readonly defaultMaxAttemptsPerStep = 1) {}

  decide(task: Task, step: TaskStep, reason: string): RecoveryDecision {
    task.recovery ??= {
      maxAttemptsPerStep: this.defaultMaxAttemptsPerStep,
      attemptsByStep: {},
    };

    const current = task.recovery.attemptsByStep[step.id] ?? 0;
    const nextAttempt = current + 1;
    const maxAttempts = task.recovery.maxAttemptsPerStep;
    const retryable = Boolean(step.toolId) && nextAttempt <= maxAttempts;

    task.recovery.attemptsByStep[step.id] = nextAttempt;
    task.recovery.lastFailure = { stepId: step.id, reason };

    return retryable
      ? {
          action: "retry_step",
          attempt: nextAttempt,
          reason: `Retrying step after recoverable failure (attempt ${nextAttempt}/${maxAttempts}).`,
        }
      : {
          action: "abort",
          attempt: nextAttempt,
          reason: `Recovery budget exhausted for step ${step.id}.`,
        };
  }
}

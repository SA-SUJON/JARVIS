import type { Task, TaskStep } from "../contracts/types.js";
import type { ProviderId } from "../../providers/types.js";
import type { ReasoningProposal } from "./TaskReasoningEngine.js";

export interface ReasoningCycleRequest {
  maxCycles?: number;
  preferredProvider?: ProviderId;
  preferredModel?: string;
  maxTokens?: number;
}

export interface ReasoningCycleResult {
  status: "stopped" | "awaiting_approval" | "bounded";
  cycles: number;
  proposal: ReasoningProposal;
  step?: TaskStep;
}

export type ReasoningCycleRunner = () => Promise<{ proposal: ReasoningProposal; step?: TaskStep }>;

/** Bounds iterative reasoning. Each promoted action is a fresh pending step and must be separately authorized. */
export class ReasoningCycleEngine {
  private readonly cyclesByTask = new WeakMap<Task, number>();

  constructor(private readonly defaultMaxCycles = 3) {}

  async run(task: Task, runner: ReasoningCycleRunner, request: ReasoningCycleRequest = {}): Promise<ReasoningCycleResult> {
    const maxCycles = request.maxCycles ?? this.defaultMaxCycles;
    if (!Number.isInteger(maxCycles) || maxCycles < 1 || maxCycles > 10) {
      throw new Error("Reasoning cycle maxCycles must be an integer from 1 to 10.");
    }

    const completedCycles = this.cyclesByTask.get(task) ?? 0;
    if (completedCycles >= maxCycles) {
      return {
        status: "stopped",
        cycles: completedCycles,
        proposal: { action: "stop", rationale: "Reasoning cycle budget exhausted for this task." },
      };
    }

    const result = await runner();
    const cycles = completedCycles + 1;
    this.cyclesByTask.set(task, cycles);

    if (result.proposal.action === "stop") {
      return { status: "stopped", cycles, proposal: result.proposal };
    }

    if (!result.step) throw new Error("Reasoning execution proposal did not produce a task step.");

    result.step.status = "pending";
    task.updatedAt = new Date().toISOString();
    return {
      status: cycles >= maxCycles ? "bounded" : "awaiting_approval",
      cycles,
      proposal: result.proposal,
      step: result.step,
    };
  }
}

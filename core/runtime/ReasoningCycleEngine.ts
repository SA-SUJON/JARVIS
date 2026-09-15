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
  status: "stopped" | "proposed" | "bounded";
  cycles: number;
  proposal?: ReasoningProposal;
  step?: TaskStep;
}

export type ReasoningCycleRunner = () => Promise<{ proposal: ReasoningProposal; step?: TaskStep }>;

/** Bounds iterative reasoning so model output can never create an unbounded execution loop. */
export class ReasoningCycleEngine {
  constructor(private readonly defaultMaxCycles = 3) {}

  async run(task: Task, runner: ReasoningCycleRunner, request: ReasoningCycleRequest = {}): Promise<ReasoningCycleResult> {
    const maxCycles = request.maxCycles ?? this.defaultMaxCycles;
    if (!Number.isInteger(maxCycles) || maxCycles < 1 || maxCycles > 10) {
      throw new Error("Reasoning cycle maxCycles must be an integer from 1 to 10.");
    }

    for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
      const result = await runner();
      if (result.proposal.action === "stop") {
        return { status: "stopped", cycles: cycle, proposal: result.proposal };
      }

      if (result.step) {
        result.step.status = "pending";
        task.updatedAt = new Date().toISOString();
      }

      if (cycle === maxCycles) {
        return { status: "bounded", cycles: cycle, proposal: result.proposal, step: result.step };
      }
    }

    throw new Error("Reasoning cycle terminated unexpectedly.");
  }
}

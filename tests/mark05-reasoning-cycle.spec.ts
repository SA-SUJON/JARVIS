import { test, expect } from "@playwright/test";
import { ReasoningCycleEngine } from "../core/runtime/ReasoningCycleEngine.js";
import type { Task } from "../core/contracts/types.js";

function task(): Task {
  return {
    id: "task-cycle",
    requestId: "request-cycle",
    status: "verifying",
    goal: "Inspect and then act only after authorization.",
    authority: 3,
    risk: "medium",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    steps: [],
  };
}

test.describe("MARK_05 reasoning cycle", () => {
  test("stops without creating an execution step", async () => {
    const engine = new ReasoningCycleEngine();
    const result = await engine.run(task(), async () => ({
      proposal: { action: "stop", rationale: "The observed state is sufficient." },
    }));

    expect(result.status).toBe("stopped");
    expect(result.cycles).toBe(1);
    expect(result.step).toBeUndefined();
  });

  test("promotes one action and leaves it pending for fresh approval", async () => {
    const currentTask = task();
    const engine = new ReasoningCycleEngine();
    const result = await engine.run(currentTask, async () => {
      const step = {
        id: "step-next",
        description: "Write the observed content.",
        toolId: "filesystem.write_text",
        arguments: {
          path: "tests/out.txt",
          content: { $ref: "step:step-read.data.content" },
        },
        dependsOn: ["step-read"],
        status: "pending" as const,
      };
      return {
        proposal: {
          action: "execute" as const,
          rationale: "Use the verified observation.",
          toolId: step.toolId,
          arguments: step.arguments,
          dependsOn: step.dependsOn,
        },
        step,
      };
    });

    expect(result.status).toBe("awaiting_approval");
    expect(result.cycles).toBe(1);
    expect(result.step?.status).toBe("pending");
    expect(currentTask.steps).toHaveLength(0);
  });

  test("enforces the max cycle budget across repeated runs for one task", async () => {
    const currentTask = task();
    const engine = new ReasoningCycleEngine();
    let calls = 0;
    const runner = async () => {
      calls += 1;
      return {
        proposal: { action: "stop" as const, rationale: `cycle-${calls}` },
      };
    };

    const first = await engine.run(currentTask, runner, { maxCycles: 2 });
    const second = await engine.run(currentTask, runner, { maxCycles: 2 });
    const third = await engine.run(currentTask, runner, { maxCycles: 2 });

    expect(first.cycles).toBe(1);
    expect(second.cycles).toBe(2);
    expect(third.status).toBe("stopped");
    expect(third.proposal.rationale).toBe("Reasoning cycle budget exhausted for this task.");
    expect(calls).toBe(2);
  });

  test("reports the final cycle as bounded while still returning its proposed step", async () => {
    const currentTask = task();
    const engine = new ReasoningCycleEngine();
    const result = await engine.run(currentTask, async () => ({
      proposal: {
        action: "execute" as const,
        rationale: "Take the final bounded action.",
        toolId: "filesystem.read_text",
        arguments: { path: "tests/fixture.txt" },
      },
      step: {
        id: "step-final",
        description: "Read the fixture.",
        toolId: "filesystem.read_text",
        arguments: { path: "tests/fixture.txt" },
        status: "pending" as const,
      },
    }), { maxCycles: 1 });

    expect(result.status).toBe("bounded");
    expect(result.cycles).toBe(1);
    expect(result.step?.status).toBe("pending");
  });

  test("rejects invalid cycle bounds", async () => {
    const engine = new ReasoningCycleEngine();
    await expect(engine.run(task(), async () => ({
      proposal: { action: "stop", rationale: "done" },
    }), { maxCycles: 0 })).rejects.toThrow("maxCycles must be an integer from 1 to 10");
  });
});

import { test, expect } from "@playwright/test";
import { ExecutionBoundary } from "../core/runtime/ExecutionBoundary.js";
import { TaskContextStore } from "../core/runtime/TaskContext.js";
import { VerificationEngine } from "../core/verification/VerificationEngine.js";
import { ToolExecutor } from "../tools/ToolExecutor.js";
import { ToolRegistry } from "../tools/ToolRegistry.js";
import type { Task, Tool } from "../core/contracts/types.js";

function makeTask(stepStatus: Task["status"], toolStepStatus: Task["steps"][number]["status"], verification?: Task["steps"][number]["verification"]): Task {
  const step = {
    id: "step-1",
    description: "Boundary test",
    toolId: "test.boundary",
    arguments: { value: "ok" },
    status: toolStepStatus,
    verification,
  };
  return {
    id: "task-1",
    requestId: "request-1",
    goal: "Boundary test",
    authority: 0,
    risk: "low",
    status: stepStatus,
    steps: [step],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

test.describe("MARK_05 execution boundary", () => {
  test("accepts only explicitly verified completion", () => {
    const registry = new ToolRegistry();
    const executor = new ToolExecutor(registry);
    const verification = new VerificationEngine();
    const boundary = new ExecutionBoundary(executor, verification, new TaskContextStore());
    const verified = { status: "verified", verified: true, reason: "confirmed" } as const;
    const valid = makeTask("completed", "completed", verified);
    const invalid = makeTask("completed", "completed", { status: "failed", verified: false, reason: "not confirmed" });

    expect(boundary.isVerifiedCompletion(valid.steps[0]!)).toBe(true);
    expect(boundary.isVerifiedCompletion(invalid.steps[0]!)).toBe(false);
    expect(() => boundary.assertVerifiableCompletion(valid.steps[0]!)).not.toThrow();
    expect(() => boundary.assertVerifiableCompletion(invalid.steps[0]!)).toThrow(/without verified execution/);
  });

  test("executes and verifies through one boundary contract", async () => {
    const registry = new ToolRegistry();
    const tool: Tool = {
      definition: {
        id: "test.boundary",
        name: "Boundary test tool",
        description: "Test-only boundary tool.",
        authority: 0,
        risk: "low",
        argumentSchema: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
          additionalProperties: false,
        },
      },
      async execute(input) {
        return { value: input.value, operation: "boundary-test" };
      },
    };
    registry.register(tool);

    const boundary = new ExecutionBoundary(
      new ToolExecutor(registry),
      new VerificationEngine(undefined, [{
        supports: (toolId) => toolId === "test.boundary",
        async verify(request) {
          return {
            status: request.result.ok && request.result.data?.operation === "boundary-test" ? "verified" : "failed",
            verified: request.result.ok && request.result.data?.operation === "boundary-test",
            reason: "Deterministic boundary verification",
          };
        },
      }]),
      new TaskContextStore(),
    );

    const task = makeTask("running", "running");
    const result = await boundary.executeStep(task, task.requestId, task.steps[0]!, true);

    expect(result.toolResult.ok).toBe(true);
    expect(result.verification.verified).toBe(true);
    expect(task.steps[0]?.result).toEqual({ value: "ok", operation: "boundary-test" });
    expect(task.steps[0]?.verification?.verified).toBe(true);
  });
});

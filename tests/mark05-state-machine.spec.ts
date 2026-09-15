import { test, expect } from "@playwright/test";
import type { Task, TaskStep } from "../core/contracts/types.js";
import { ExecutionStateMachine } from "../core/runtime/ExecutionStateMachine.js";

function task(status: Task["status"]): Task {
  return {
    id: "task-1",
    requestId: "request-1",
    status,
    goal: "test",
    authority: 0,
    risk: "low",
    steps: [],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

function step(status: TaskStep["status"]): TaskStep {
  return {
    id: "step-1",
    description: "test step",
    status,
  };
}

test.describe("MARK_05 execution state machine", () => {
  test("allows the normal task lifecycle", () => {
    const machine = new ExecutionStateMachine();
    const current = task("planning");

    machine.transition(current, "running");
    machine.transition(current, "verifying");
    machine.transition(current, "completed");

    expect(current.status).toBe("completed");
    expect(current.updatedAt).not.toBe(new Date(0).toISOString());
  });

  test("rejects terminal-state resurrection", () => {
    const machine = new ExecutionStateMachine();
    const current = task("completed");

    expect(machine.canTransition("completed", "running")).toBe(false);
    expect(() => machine.transition(current, "running")).toThrow("Invalid execution state transition");
  });

  test("allows replanning to request a fresh approval", () => {
    const machine = new ExecutionStateMachine();
    const current = task("replanning");

    expect(machine.canTransition("replanning", "awaiting_approval")).toBe(true);
    machine.transition(current, "awaiting_approval");
    expect(current.status).toBe("awaiting_approval");
  });

  test("governs step lifecycle independently", () => {
    const machine = new ExecutionStateMachine();
    const current = step("pending");

    machine.transition(current, "running");
    machine.transition(current, "verifying");
    machine.transition(current, "completed");

    expect(current.status).toBe("completed");
  });

  test("allows active execution to fail from running or verifying", () => {
    const machine = new ExecutionStateMachine();

    const running = task("running");
    machine.transition(running, "failed");
    expect(running.status).toBe("failed");

    const verifying = task("verifying");
    machine.transition(verifying, "failed");
    expect(verifying.status).toBe("failed");
  });
});

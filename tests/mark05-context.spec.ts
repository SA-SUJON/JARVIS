import { test, expect } from "@playwright/test";
import type { Task } from "../core/contracts/types.js";
import { TaskContextStore, resolveToolArguments } from "../core/runtime/TaskContext.js";

const makeTask = (): Task => ({
  id: "task-context-test",
  requestId: "request-context-test",
  status: "running",
  goal: "test task context",
  authority: 3,
  risk: "medium",
  steps: [
    { id: "step-1", description: "produce data", status: "completed" },
    { id: "step-2", description: "consume data", status: "pending", dependsOn: ["step-1"] },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

test.describe("MARK_05 task working context", () => {
  test("publishes completed tool data with execution metadata", () => {
    const task = makeTask();
    const context = new TaskContextStore();

    context.publish(task, "step-1", {
      executionId: "exec-1",
      data: { path: "tests/output.txt", bytes: 21, nested: { checksum: "abc123" } },
      metadata: {
        durationMs: 4,
        startedAt: "2026-09-15T12:00:00.000Z",
        completedAt: "2026-09-15T12:00:00.004Z",
      },
    });

    expect(task.workingContext?.steps["step-1"]).toMatchObject({
      executionId: "exec-1",
      data: { path: "tests/output.txt", bytes: 21 },
    });
  });

  test("resolves a whole prior result and nested result properties", () => {
    const task = makeTask();
    const context = new TaskContextStore();
    context.publish(task, "step-1", {
      executionId: "exec-1",
      data: { path: "tests/output.txt", nested: { checksum: "abc123" } },
      metadata: { durationMs: 1, startedAt: "2026-09-15T12:00:00.000Z", completedAt: "2026-09-15T12:00:00.001Z" },
    });

    const resolved = resolveToolArguments(task, {
      path: { $ref: "step:step-1.data.path" },
      checksum: { $ref: "step:step-1.data.nested.checksum" },
    }, context);

    expect(resolved).toEqual({ path: "tests/output.txt", checksum: "abc123" });
  });

  test("rejects references to unavailable steps before tool execution", () => {
    const task = makeTask();

    expect(() =>
      resolveToolArguments(task, { path: { $ref: "step:step-3.data.path" } }),
    ).toThrow("unavailable step: step-3");
  });

  test("rejects malformed references rather than interpreting arbitrary expressions", () => {
    const task = makeTask();

    expect(() =>
      resolveToolArguments(task, { path: { $ref: "step:step-1.data['path']" } }),
    ).toThrow("Invalid task result reference path");
  });
});

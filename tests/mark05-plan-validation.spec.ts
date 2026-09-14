import { test, expect } from "@playwright/test";
import type { Task } from "../core/contracts/types.js";
import { PlanValidationEngine } from "../core/runtime/PlanValidationEngine.js";
import { createBuiltinTools } from "../tools/builtin/index.js";
import { ToolRegistry } from "../tools/ToolRegistry.js";

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    requestId: "request-1",
    status: "planning",
    goal: "test",
    authority: 3,
    risk: "medium",
    steps: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test.describe("MARK_05 plan validation", () => {
  function createValidator(): PlanValidationEngine {
    const registry = new ToolRegistry();
    registry.registerMany(createBuiltinTools());
    return new PlanValidationEngine(registry);
  }

  test("accepts a valid controlled tool plan", () => {
    const task = createTask({
      steps: [
        {
          id: "read-1",
          description: "Read fixture",
          toolId: "filesystem.read_text",
          arguments: { path: "tests/fixture.txt" },
          status: "pending",
        },
      ],
    });

    const result = createValidator().validate(task);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test("rejects unknown tools and invalid arguments before execution", () => {
    const task = createTask({
      steps: [
        {
          id: "bad-1",
          description: "Invalid step",
          toolId: "missing.tool",
          arguments: {},
          status: "pending",
        },
        {
          id: "bad-2",
          description: "Missing path",
          toolId: "filesystem.read_text",
          arguments: {},
          status: "pending",
        },
      ],
    });

    const result = createValidator().validate(task);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.reason)).toEqual(
      expect.arrayContaining([
        "Unknown planned tool: missing.tool",
        "Missing required tool argument: path",
      ]),
    );
  });

  test("rejects malformed dependencies and cycles", () => {
    const task = createTask({
      steps: [
        {
          id: "step-a",
          description: "A",
          toolId: "filesystem.read_text",
          arguments: { path: "tests/fixture.txt" },
          dependsOn: ["step-b", "step-b"],
          status: "pending",
        },
        {
          id: "step-b",
          description: "B",
          toolId: "filesystem.read_text",
          arguments: { path: "tests/fixture.txt" },
          dependsOn: ["step-a"],
          status: "pending",
        },
      ],
    });

    const result = createValidator().validate(task);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.reason)).toEqual(
      expect.arrayContaining([
        "Duplicate dependency: step-b",
        "Task step dependencies contain a cycle.",
      ]),
    );
  });

  test("requires a result reference to declare its source step as a dependency", () => {
    const task = createTask({
      steps: [
        {
          id: "read-1",
          description: "Read fixture",
          toolId: "filesystem.read_text",
          arguments: { path: "tests/fixture.txt" },
          status: "pending",
        },
        {
          id: "read-2",
          description: "Reuse read result",
          toolId: "filesystem.read_text",
          arguments: { path: { $ref: "step:read-1.data.path" } },
          status: "pending",
        },
      ],
    });

    const result = createValidator().validate(task);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.reason)).toContain(
      "Task result reference requires dependency on step: read-1",
    );
  });
});

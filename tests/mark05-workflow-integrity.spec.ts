import { test, expect } from "@playwright/test";
import { Planner } from "../core/planner/Planner.js";
import { PlanValidationEngine } from "../core/runtime/PlanValidationEngine.js";
import { VerificationEngine } from "../core/verification/VerificationEngine.js";
import { RuntimeKernel } from "../core/runtime/RuntimeKernel.js";
import { classifyIntent } from "../core/orchestrator/Intent.js";
import { ToolRegistry } from "../tools/ToolRegistry.js";
import type { Task, Tool } from "../core/contracts/types.js";
import { DEFAULT_PROVIDERS } from "../electron/providers.js";

test.describe("MARK_05 workflow integrity", () => {
  test("rejects a planned tool without verifier coverage before execution", () => {
    const tool: Tool = {
      definition: {
        id: "test.unverified",
        name: "Unverified test tool",
        description: "A deliberately unverified executable tool.",
        authority: 1,
        risk: "low",
        argumentSchema: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
          additionalProperties: false,
        },
      },
      async execute() {
        throw new Error("This tool must never execute.");
      },
    };

    const registry = new ToolRegistry();
    registry.register(tool);
    const task: Task = {
      id: "task-unverified",
      requestId: "request-unverified",
      status: "planning",
      goal: "test unverified tool",
      authority: 1,
      risk: "low",
      steps: [{ id: "step-unverified", description: "run test tool", status: "pending", toolId: tool.definition.id, arguments: { value: "test" } }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const validation = new PlanValidationEngine(registry).validate(task);
    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ stepId: "step-unverified", reason: "No post-execution verifier is registered for tool: test.unverified" }),
    ]));
  });

  test("verifies the executable media result contract", async () => {
    const verification = new VerificationEngine();
    const result = await verification.verify({
      requestId: "media-verify",
      taskId: "task-media",
      toolId: "media.youtube_play",
      input: { query: "Royalty song" },
      result: {
        ok: true,
        toolId: "media.youtube_play",
        executionId: "exec-media",
        metadata: {
          startedAt: new Date(0).toISOString(),
          completedAt: new Date(1).toISOString(),
          durationMs: 1,
        },
        data: {
          query: "Royalty song",
          title: "Royalty - Example",
          url: "https://www.youtube.com/watch?v=example123",
          launched: true,
          operation: "youtube_play",
        },
      },
    });

    expect(verification.supports("media.youtube_play")).toBe(true);
    expect(result).toMatchObject({ status: "verified", verified: true });
  });

  test("executes and verifies a media workflow through the runtime state machine", async () => {
    const mediaTool: Tool = {
      definition: {
        id: "media.youtube_play",
        name: "Play YouTube media",
        description: "Test double for the executable YouTube workflow.",
        authority: 1,
        risk: "low",
        argumentSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
          additionalProperties: false,
        },
      },
      async execute(input) {
        return {
          query: String(input.query),
          title: "Royalty - Example",
          url: "https://www.youtube.com/watch?v=example123",
          launched: true,
          operation: "youtube_play",
        };
      },
    };

    const tools = new ToolRegistry();
    tools.register(mediaTool);
    const runtime = new RuntimeKernel({ providers: DEFAULT_PROVIDERS, tools });
    const result = await runtime.execute({ input: "play Royalty song on youtube" });

    expect(result.status).toBe("completed");
    expect(result.task.status).toBe("completed");
    expect(result.task.steps[0]?.toolId).toBe("media.youtube_play");
    expect(result.task.steps[0]?.status).toBe("completed");
    expect(result.task.steps[0]?.verification).toMatchObject({ status: "verified", verified: true });
    expect(result.task.executionHistory).toHaveLength(1);
    expect(result.task.executionHistory?.[0]).toMatchObject({ toolId: "media.youtube_play", outcome: "success", attempt: 1 });
    expect(result.toolResult).toMatchObject({ operation: "youtube_play", launched: true });
  });

  test("keeps media commands atomic at planning time", () => {
    const planner = new Planner();
    const input = "open youtube and play Royalty song";
    const intent = classifyIntent(input);
    const task = planner.createPlan(input, intent, "atomic-media");

    expect(task.steps).toHaveLength(1);
    expect(task.steps[0]?.toolId).toBe("media.youtube_play");
    expect(task.steps[0]?.arguments).toEqual({ query: "Royalty song" });
  });
});

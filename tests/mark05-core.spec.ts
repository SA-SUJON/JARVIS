import { test, expect } from "@playwright/test";
import { EventBus } from "../core/events/EventBus.js";
import { Orchestrator } from "../core/orchestrator/Orchestrator.js";
import { classifyIntent } from "../core/orchestrator/Intent.js";
import { PolicyEngine } from "../core/policy/PolicyEngine.js";
import { ToolExecutor } from "../tools/ToolExecutor.js";
import { ToolRegistry } from "../tools/ToolRegistry.js";
import type { Tool } from "../core/contracts/types.js";

test.describe("MARK_05 core", () => {
  const makeTool = (authority: Tool["definition"]["authority"]): Tool => ({
    definition: {
      id: "test.tool",
      name: "Test Tool",
      description: "Deterministic test tool",
      authority,
      risk: authority >= 3 ? "medium" : "low",
    },
    async execute(input) {
      return { echoed: input.value ?? null };
    },
  });

  test("policy allows low-risk conversation and gates state-changing actions", async () => {
    const policy = new PolicyEngine();
    await expect(policy.evaluate(0, "low")).resolves.toMatchObject({ allowed: true, requiresApproval: false });
    await expect(policy.evaluate(3, "medium")).resolves.toMatchObject({ allowed: false, requiresApproval: true });
    await expect(policy.evaluate(4, "high", { explicitApproval: true })).resolves.toMatchObject({ allowed: true, requiresApproval: true });
    await expect(policy.evaluate(5, "critical", { explicitApproval: true })).resolves.toMatchObject({ allowed: false, requiresApproval: true });
    await expect(policy.evaluate(5, "critical", { operatorAuthenticated: true, explicitApproval: true })).resolves.toMatchObject({ allowed: true, requiresApproval: true });
  });

  test("orchestrator classifies and gates a file operation", async () => {
    const events = new EventBus();
    const seen: string[] = [];
    events.on("assistant.started", () => seen.push("started"));
    events.on("assistant.thinking", () => seen.push("thinking"));
    events.on("security.blocked", () => seen.push("blocked"));
    const orchestrator = new Orchestrator({ events });
    const result = await orchestrator.execute({ requestId: "test-request", input: "delete a file named notes.txt" });
    expect(result.requestId).toBe("test-request");
    expect(result.intent.kind).toBe("file_operation");
    expect(result.status).toBe("awaiting_approval");
    expect(result.task.authority).toBeGreaterThanOrEqual(3);
    expect(seen).toEqual(["started", "thinking", "blocked"]);
  });

  test("orchestrator rejects an empty request", async () => {
    const result = await new Orchestrator().execute({ input: "   " });
    expect(result.status).toBe("failed");
    expect(result.error).toBe("Request cannot be empty.");
  });

  test("tool executor runs approved tools and blocks insufficient authority", async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool(1));
    const executor = new ToolExecutor(registry);
    const success = await executor.execute({ toolId: "test.tool", input: { value: "hello" }, context: { requestId: "tool-1", authority: 1, approved: false } });
    expect(success.ok).toBe(true);
    expect(success.data).toEqual({ echoed: "hello" });
    expect(success.executionId).toBeTruthy();
    expect(success.metadata.durationMs).toBeGreaterThanOrEqual(0);
    const blockedRegistry = new ToolRegistry();
    blockedRegistry.register(makeTool(3));
    const blocked = await new ToolExecutor(blockedRegistry).execute({ toolId: "test.tool", input: { value: "should not run" }, context: { requestId: "tool-2", authority: 2, approved: true } });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain("Insufficient authority");
  });

  test("event bus supports subscription and unsubscribe", async () => {
    const events = new EventBus();
    let count = 0;
    const unsubscribe = events.on("tool.executed", () => { count += 1; });
    await events.emit("tool.executed", { ok: true }, { requestId: "event-1" });
    unsubscribe();
    await events.emit("tool.executed", { ok: true }, { requestId: "event-2" });
    expect(count).toBe(1);
  });

  test("plans local file reads into a controlled read tool", async () => {
    const result = await new Orchestrator().execute({ input: "read file notes.txt" });
    expect(result.status).toBe("awaiting_approval");
    expect(result.task.authority).toBe(3);
    expect(result.task.steps[0]?.toolId).toBe("filesystem.read_text");
    expect(result.task.steps[0]?.arguments).toEqual({ path: "notes.txt" });
  });

  test("classifies and plans YouTube playback as an executable action", async () => {
    const intent = classifyIntent("open youtube and play Royalty song");
    expect(intent.kind).toBe("media_playback");
    expect(intent.requiresPlanning).toBe(true);

    const result = await new Orchestrator().execute({ input: "open youtube and play Royalty song" });
    expect(result.status).toBe("completed");
    expect(result.intent.kind).toBe("media_playback");
    expect(result.task.steps).toHaveLength(1);
    expect(result.task.steps[0]?.toolId).toBe("media.youtube_play");
    expect(result.task.steps[0]?.arguments).toEqual({ query: "Royalty song" });
  });
});

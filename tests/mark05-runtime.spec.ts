import { test, expect } from "@playwright/test";
import { rm } from "node:fs/promises";
import path from "node:path";
import { createMark05Runtime } from "../electron/mark05Runtime.js";
import { DEFAULT_PROVIDERS } from "../electron/providers.js";
import { createBuiltinTools } from "../tools/builtin/index.js";
import type { Tool } from "../core/contracts/types.js";
import { ToolRegistry } from "../tools/ToolRegistry.js";
import { ToolExecutor } from "../tools/ToolExecutor.js";

test.describe("MARK_05 runtime adapter", () => {
  test("maps Electron provider settings into the MARK_05 provider catalog", () => {
    const runtime = createMark05Runtime({
      providers: DEFAULT_PROVIDERS.map((provider) =>
        provider.id === "gemini"
          ? { ...provider, key: "test-gemini-key", keys: ["test-gemini-key"], model: "test-model" }
          : provider,
      ),
    });

    const gemini = runtime.providers.getRuntime("gemini");
    expect(gemini?.definition.defaultModel).toBe("test-model");
    expect(gemini?.status).toBe("offline");
  });

  test("does not configure providers without credentials", () => {
    const runtime = createMark05Runtime({ providers: DEFAULT_PROVIDERS });
    expect(runtime.providers.getRuntime("gemini")?.status).toBe("unconfigured");
    expect(runtime.providers.getRuntime("openai")?.status).toBe("unconfigured");
  });

  test("preserves disabled provider state from Electron settings", () => {
    const runtime = createMark05Runtime({
      providers: DEFAULT_PROVIDERS.map((provider) =>
        provider.id === "openai" ? { ...provider, enabled: false } : provider,
      ),
    });

    expect(runtime.providers.getRuntime("openai")?.definition.enabledByDefault).toBe(false);
  });

  test("blocks state-changing requests before provider execution", async () => {
    const runtime = createMark05Runtime({ providers: DEFAULT_PROVIDERS });
    const result = await runtime.execute({ input: "delete the old project files" });

    expect(result.status).toBe("awaiting_approval");
    expect(result.error).toContain("explicit approval");
  });

  test("compiles application-control requests into structured arguments", async () => {
    const runtime = createMark05Runtime({ providers: DEFAULT_PROVIDERS });
    const result = await runtime.execute({ input: "open notepad" });

    expect(result.status).toBe("awaiting_approval");
    expect(result.task.steps[0]?.toolId).toBe("system.open_app");
    expect(result.task.steps[0]?.arguments).toEqual({ app: "notepad" });
  });

  test("compiles controlled read requests into structured arguments", async () => {
    const runtime = createMark05Runtime({ providers: DEFAULT_PROVIDERS });
    const result = await runtime.execute({ input: "read file tests/fixture.txt" });

    expect(result.status).toBe("awaiting_approval");
    expect(result.task.steps[0]?.toolId).toBe("filesystem.read_text");
    expect(result.task.steps[0]?.arguments).toEqual({ path: "tests/fixture.txt" });
  });

  test("registers controlled tools in the default runtime", () => {
    const toolIds = createBuiltinTools().map((tool) => tool.definition.id);
    expect(toolIds).toContain("system.open_app");
    expect(toolIds).toContain("filesystem.read_text");
    expect(toolIds).toContain("filesystem.write_text");
    expect(toolIds).toContain("filesystem.delete_file");
  });

  test("declares schemas for controlled tool arguments", () => {
    const tools = createBuiltinTools();
    const openApp = tools.find((tool) => tool.definition.id === "system.open_app");
    const readText = tools.find((tool) => tool.definition.id === "filesystem.read_text");
    const writeText = tools.find((tool) => tool.definition.id === "filesystem.write_text");
    const deleteFile = tools.find((tool) => tool.definition.id === "filesystem.delete_file");

    expect(openApp?.definition.argumentSchema?.required).toEqual(["app"]);
    expect(readText?.definition.argumentSchema?.required).toEqual(["path"]);
    expect(writeText?.definition.argumentSchema?.required).toEqual(["path", "content"]);
    expect(deleteFile?.definition.argumentSchema?.required).toEqual(["path"]);
  });

  test("rejects invalid tool arguments before invoking implementation", async () => {
    let invoked = false;
    const tool: Tool = {
      definition: {
        id: "test.contract",
        name: "Contract test",
        description: "Test-only tool contract.",
        authority: 0,
        risk: "low",
        argumentSchema: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
          additionalProperties: false,
        },
      },
      async execute() {
        invoked = true;
        return { ok: true };
      },
    };

    const registry = new ToolRegistry();
    registry.register(tool);
    const executor = new ToolExecutor(registry);
    const result = await executor.execute({
      toolId: tool.definition.id,
      input: { value: 42, extra: true },
      context: { requestId: "contract-test", authority: 0, approved: true },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Unexpected tool argument: extra");
    expect(invoked).toBe(false);
    expect(result.executionId).toBeTruthy();
    expect(result.metadata.startedAt).toBeTruthy();
    expect(result.metadata.completedAt).toBeTruthy();
    expect(result.metadata.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("returns structured tool data and execution metadata", async () => {
    const tool: Tool = {
      definition: {
        id: "test.result-envelope",
        name: "Result envelope test",
        description: "Test-only result envelope tool.",
        authority: 0,
        risk: "low",
        argumentSchema: {
          type: "object",
          properties: { message: { type: "string" } },
          required: ["message"],
          additionalProperties: false,
        },
      },
      async execute(input) {
        return { echoed: String(input.message), operation: "test" };
      },
    };

    const registry = new ToolRegistry();
    registry.register(tool);
    const executor = new ToolExecutor(registry);
    const result = await executor.execute({
      toolId: tool.definition.id,
      input: { message: "MARK_05" },
      context: { requestId: "result-envelope-test", authority: 0, approved: true },
    });

    expect(result.ok).toBe(true);
    expect(result.toolId).toBe(tool.definition.id);
    expect(result.data).toEqual({ echoed: "MARK_05", operation: "test" });
    expect(result.executionId).toBeTruthy();
    expect(result.metadata.durationMs).toBeGreaterThanOrEqual(0);
    expect(new Date(result.metadata.completedAt).getTime()).toBeGreaterThanOrEqual(new Date(result.metadata.startedAt).getTime());
  });

  test("executes an approved workspace file write through structured arguments", async () => {
    const runtime = createMark05Runtime({ providers: DEFAULT_PROVIDERS });
    const relativePath = path.join("tests", ".mark05-runtime-write-check.txt");
    const target = path.resolve(process.env.JARVIS_WORKSPACE || process.cwd(), relativePath);

    try {
      const pending = await runtime.execute({ input: `create file ${relativePath} with content: MARK_05 tool execution verified` });
      expect(pending.status).toBe("awaiting_approval");
      expect(pending.approval?.id).toBeTruthy();
      expect(pending.task.steps[0]?.arguments).toEqual({
        path: relativePath,
        content: "MARK_05 tool execution verified",
      });

      const approvalId = pending.approval!.id;
      runtime.approve(approvalId);
      const completed = await runtime.executeApproved(approvalId);

      expect(completed.status).toBe("completed");
      expect(completed.task.steps[0]?.status).toBe("completed");
      expect(completed.task.steps[0]?.verification).toMatchObject({ verified: true, status: "verified" });
      expect(completed.toolResult).toMatchObject({ operation: "write" });
      expect(completed.task.steps[0]?.result).toMatchObject({ operation: "write" });
      expect(completed.task.executionHistory).toHaveLength(1);
      expect(completed.task.executionHistory?.[0]).toMatchObject({
        stepId: completed.task.steps[0]?.id,
        toolId: "filesystem.write_text",
        attempt: 1,
        outcome: "success",
      });
      expect(completed.task.executionHistory?.[0]?.executionId).toBeTruthy();
      expect(completed.task.executionHistory?.[0]?.startedAt).toBeTruthy();
      expect(completed.task.executionHistory?.[0]?.completedAt).toBeTruthy();
    } finally {
      await rm(target, { force: true });
    }
  });

  test("fails an empty request without touching provider execution", async () => {
    const runtime = createMark05Runtime({ providers: DEFAULT_PROVIDERS });
    const result = await runtime.execute({ input: "   " });

    expect(result.status).toBe("failed");
    expect(result.error).toBe("Request cannot be empty.");
  });
});

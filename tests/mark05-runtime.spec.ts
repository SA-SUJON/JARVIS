import { test, expect } from "@playwright/test";
import { rm } from "node:fs/promises";
import path from "node:path";
import { createMark05Runtime } from "../electron/mark05Runtime.js";
import { DEFAULT_PROVIDERS } from "../electron/providers.js";
import { createBuiltinTools } from "../tools/builtin/index.js";

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

  test("requires approval for application control", async () => {
    const runtime = createMark05Runtime({ providers: DEFAULT_PROVIDERS });
    const result = await runtime.execute({ input: "open notepad" });

    expect(result.status).toBe("awaiting_approval");
    expect(result.task.steps[0]?.toolId).toBe("system.open_app");
  });

  test("registers controlled tools in the default runtime", () => {
    const toolIds = createBuiltinTools().map((tool) => tool.definition.id);
    expect(toolIds).toContain("system.open_app");
    expect(toolIds).toContain("filesystem.write_text");
    expect(toolIds).toContain("filesystem.delete_file");
  });

  test("executes an approved workspace file write through the tool boundary", async () => {
    const runtime = createMark05Runtime({ providers: DEFAULT_PROVIDERS });
    const relativePath = path.join("tests", ".mark05-runtime-write-check.txt");
    const target = path.resolve(process.env.JARVIS_WORKSPACE || process.cwd(), relativePath);

    try {
      const pending = await runtime.execute({ input: `create file ${relativePath} with content: MARK_05 tool execution verified` });
      expect(pending.status).toBe("awaiting_approval");
      expect(pending.approval?.id).toBeTruthy();

      const approvalId = pending.approval!.id;
      runtime.approve(approvalId);
      const completed = await runtime.executeApproved(approvalId);

      expect(completed.status).toBe("completed");
      expect(completed.task.steps[0]?.status).toBe("completed");
      expect(completed.toolResult).toMatchObject({ operation: "write" });
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

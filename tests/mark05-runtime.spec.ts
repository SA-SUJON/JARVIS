import { test, expect } from "@playwright/test";
import { rm, access } from "node:fs/promises";
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

  test("compiles application-control requests into structured arguments", async () => {
    const runtime = createMark05Runtime({ providers: DEFAULT_PROVIDERS });
    const result = await runtime.execute({ input: "open notepad" });

    expect(result.status).toBe("awaiting_approval");
    expect(result.task.steps[0]?.toolId).toBe("system.open_app");
    expect(result.task.steps[0]?.arguments).toEqual({ app: "notepad" });
  });

  test("plans compound requests as ordered dependent steps", async () => {
    const runtime = createMark05Runtime({ providers: DEFAULT_PROVIDERS });
    const first = path.join("tests", ".mark05-step-one.txt");
    const second = path.join("tests", ".mark05-step-two.txt");

    try {
      const pending = await runtime.execute({
        input: `create file ${first} with content: first then create file ${second} with content: second`,
      });

      expect(pending.status).toBe("awaiting_approval");
      expect(pending.task.steps).toHaveLength(2);
      expect(pending.task.steps[0]?.arguments).toEqual({ path: first, content: "first" });
      expect(pending.task.steps[1]?.arguments).toEqual({ path: second, content: "second" });
      expect(pending.task.steps[1]?.dependsOn).toEqual([pending.task.steps[0]!.id]);

      const approvalId = pending.approval!.id;
      runtime.approve(approvalId);
      const completed = await runtime.executeApproved(approvalId);

      expect(completed.status).toBe("completed");
      expect(completed.task.steps.map((step) => step.status)).toEqual(["completed", "completed"]);
      expect(completed.task.steps.every((step) => (step.verification as { verified?: boolean })?.verified)).toBe(true);
      await access(path.resolve(process.env.JARVIS_WORKSPACE || process.cwd(), first));
      await access(path.resolve(process.env.JARVIS_WORKSPACE || process.cwd(), second));
    } finally {
      await rm(path.resolve(process.env.JARVIS_WORKSPACE || process.cwd(), first), { force: true });
      await rm(path.resolve(process.env.JARVIS_WORKSPACE || process.cwd(), second), { force: true });
    }
  });

  test("stops the ordered plan after the first step fails", async () => {
    const runtime = createMark05Runtime({ providers: DEFAULT_PROVIDERS });
    const blocked = path.join("tests", ".mark05-should-not-run.txt");
    const targetRoot = process.env.JARVIS_WORKSPACE || process.cwd();

    try {
      const pending = await runtime.execute({
        input: `create file ../outside-mark05-check.txt with content: blocked then create file ${blocked} with content: should-not-run`,
      });

      expect(pending.status).toBe("awaiting_approval");
      expect(pending.task.steps).toHaveLength(2);

      const approvalId = pending.approval!.id;
      runtime.approve(approvalId);
      const failed = await runtime.executeApproved(approvalId);

      expect(failed.status).toBe("failed");
      expect(failed.task.steps[0]?.status).toBe("failed");
      expect(failed.task.steps[1]?.status).toBe("pending");
      await expect(access(path.resolve(targetRoot, blocked))).rejects.toThrow();
    } finally {
      await rm(path.resolve(targetRoot, blocked), { force: true });
      await rm(path.resolve(targetRoot, "..", "outside-mark05-check.txt"), { force: true });
    }
  });

  test("registers controlled tools in the default runtime", () => {
    const toolIds = createBuiltinTools().map((tool) => tool.definition.id);
    expect(toolIds).toContain("system.open_app");
    expect(toolIds).toContain("filesystem.write_text");
    expect(toolIds).toContain("filesystem.delete_file");
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

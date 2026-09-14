import { test, expect } from "@playwright/test";
import { ApprovalManager } from "../core/policy/ApprovalManager.js";
import { RuntimeKernel } from "../core/runtime/RuntimeKernel.js";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";

const task = (overrides: Partial<Parameters<ApprovalManager["create"]>[0]> = {}) => ({
  id: "task-approval-test",
  requestId: "request-approval-test",
  status: "awaiting_approval" as const,
  goal: "delete the old project files",
  authority: 3 as const,
  risk: "medium" as const,
  steps: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

test.describe("MARK_05 approval lifecycle", () => {
  test("creates a short-lived pending approval", () => {
    const manager = new ApprovalManager(60_000);
    const approval = manager.create(task());

    expect(approval.status).toBe("pending");
    expect(approval.requestId).toBe("request-approval-test");
    expect(approval.taskId).toBe("task-approval-test");
    expect(manager.list()).toHaveLength(1);
  });

  test("approves and consumes exactly once", () => {
    const manager = new ApprovalManager();
    const approval = manager.create(task());

    expect(manager.approve(approval.id).allowed).toBe(true);
    expect(manager.consumeApproved(approval.id).allowed).toBe(true);
    expect(manager.consumeApproved(approval.id).allowed).toBe(false);
  });

  test("rejection cannot be consumed as approval", () => {
    const manager = new ApprovalManager();
    const approval = manager.create(task());

    expect(manager.reject(approval.id).allowed).toBe(false);
    expect(manager.consumeApproved(approval.id).allowed).toBe(false);
  });

  test("runtime exposes approval requests for blocked state changes", async () => {
    const runtime = new RuntimeKernel();
    const result = await runtime.execute({ input: "delete the old project files" });

    expect(result.status).toBe("awaiting_approval");
    expect(result.approval?.status).toBe("pending");
    expect(runtime.listApprovals()).toHaveLength(1);
  });

  test("approved execution runs the exact pending task through its bound tool", async () => {
    const runtime = new RuntimeKernel();
    const relativePath = path.join("tests", ".mark05-approval-delete-check.txt");
    const target = path.resolve(process.env.JARVIS_WORKSPACE || process.cwd(), relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "MARK_05 approval execution test", "utf8");

    try {
      const initial = await runtime.execute({ input: `delete file ${relativePath}` });
      const approvalId = initial.approval?.id;

      expect(initial.status).toBe("awaiting_approval");
      expect(approvalId).toBeTruthy();
      expect(initial.task.steps[0]?.toolId).toBe("filesystem.delete_file");

      const approved = runtime.approve(approvalId!);
      expect(approved.status).toBe("approved");

      const resumed = await runtime.executeApproved(approvalId!);
      expect(resumed.requestId).toBe(initial.requestId);
      expect(resumed.task.id).toBe(initial.task.id);
      expect(resumed.task.goal).toBe(initial.task.goal);
      expect(resumed.status).toBe("completed");
      expect(resumed.toolResult).toMatchObject({ operation: "delete" });
      expect(runtime.listApprovals()).toHaveLength(0);
    } finally {
      await rm(target, { force: true });
    }
  });
});

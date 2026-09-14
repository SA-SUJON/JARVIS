import { test, expect } from "@playwright/test";
import { ApprovalManager } from "../core/policy/ApprovalManager.js";
import { RuntimeKernel } from "../core/runtime/RuntimeKernel.js";

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
});

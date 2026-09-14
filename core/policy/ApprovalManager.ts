import type { Task } from "../contracts/types.js";

export interface ApprovalRequest {
  id: string;
  requestId: string;
  taskId: string;
  summary: string;
  authority: Task["authority"];
  risk: Task["risk"];
  createdAt: string;
  expiresAt: string;
  status: "pending" | "approved" | "rejected" | "expired";
}

export interface ApprovalDecision {
  allowed: boolean;
  request?: ApprovalRequest;
  reason?: string;
}

/**
 * In-memory approval authority for MARK_05.
 * Approvals are short-lived, single-use, and never persisted with secrets.
 */
export class ApprovalManager {
  private readonly pending = new Map<string, ApprovalRequest>();

  constructor(private readonly ttlMs = 5 * 60 * 1000) {}

  create(task: Task): ApprovalRequest {
    this.expire();
    const now = Date.now();
    const request: ApprovalRequest = {
      id: `approval-${crypto.randomUUID()}`,
      requestId: task.requestId,
      taskId: task.id,
      summary: task.goal,
      authority: task.authority,
      risk: task.risk,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.ttlMs).toISOString(),
      status: "pending",
    };
    this.pending.set(request.id, request);
    return request;
  }

  list(): ApprovalRequest[] {
    this.expire();
    return [...this.pending.values()].map((request) => ({ ...request }));
  }

  get(id: string): ApprovalRequest | undefined {
    this.expire();
    const request = this.pending.get(id);
    return request ? { ...request } : undefined;
  }

  approve(id: string): ApprovalDecision {
    return this.resolve(id, "approved");
  }

  reject(id: string): ApprovalDecision {
    return this.resolve(id, "rejected");
  }

  consumeApproved(id: string): ApprovalDecision {
    this.expire();
    const request = this.pending.get(id);
    if (!request) return { allowed: false, reason: "Approval request not found or expired." };
    if (request.status !== "approved") return { allowed: false, reason: "Approval has not been granted." };
    this.pending.delete(id);
    return { allowed: true, request: { ...request } };
  }

  clear(): void {
    this.pending.clear();
  }

  private resolve(id: string, status: "approved" | "rejected"): ApprovalDecision {
    this.expire();
    const request = this.pending.get(id);
    if (!request) return { allowed: false, reason: "Approval request not found or expired." };
    if (request.status !== "pending") return { allowed: false, request: { ...request }, reason: `Approval is already ${request.status}.` };
    request.status = status;
    return { allowed: status === "approved", request: { ...request } };
  }

  private expire(): void {
    const now = Date.now();
    for (const [id, request] of this.pending) {
      if (request.status === "pending" && Date.parse(request.expiresAt) <= now) {
        request.status = "expired";
      }
      if (request.status === "expired" || request.status === "rejected") {
        this.pending.delete(id);
      }
    }
  }
}

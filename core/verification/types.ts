import type { TaskStep, ToolExecutionResult } from "../../tools/types.js";

export type VerificationStatus = "verified" | "failed" | "unsupported";

export interface VerificationRequest {
  requestId?: string;
  taskId?: string;
  toolId: string;
  input: Record<string, unknown>;
  result: ToolExecutionResult;
  step?: TaskStep;
}

export interface VerificationResult {
  status: VerificationStatus;
  verified: boolean;
  reason: string;
  details?: Record<string, unknown>;
}

export interface Verifier {
  supports(toolId: string): boolean;
  verify(request: VerificationRequest): Promise<VerificationResult>;
}

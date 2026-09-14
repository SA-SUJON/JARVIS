import type { AuthorityLevel, RiskLevel, Tool, ToolArguments, ToolContext } from "../core/contracts/types.js";

export interface ToolExecutionRequest {
  toolId: string;
  input: ToolArguments;
  context: ToolContext;
}

export interface ToolExecutionResult<T = unknown> {
  executionId: string;
  toolId: string;
  ok: boolean;
  data?: T;
  error?: string;
  metadata: {
    durationMs: number;
    startedAt: string;
    completedAt: string;
  };
}

export interface ToolRegistration extends ToolDefinition {
  implementation: Tool;
}

export interface ToolQuery {
  minAuthority?: AuthorityLevel;
  maxRisk?: RiskLevel;
}

import type { AuthorityLevel, RiskLevel, Tool, ToolContext, ToolDefinition } from "../core/contracts/types.js";

export interface ToolExecutionRequest {
  toolId: string;
  input: Record<string, unknown>;
  context: ToolContext;
}

export interface ToolExecutionResult<T = unknown> {
  toolId: string;
  ok: boolean;
  value?: T;
  error?: string;
  durationMs: number;
}

export interface ToolRegistration extends ToolDefinition {
  implementation: Tool;
}

export interface ToolQuery {
  minAuthority?: AuthorityLevel;
  maxRisk?: RiskLevel;
}

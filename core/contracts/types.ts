export type AuthorityLevel =
  | 0 // Conversation
  | 1 // Search / information retrieval
  | 2 // Application control
  | 3 // File modification
  | 4 // System command execution
  | 5; // Administrative / security operations

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type TaskStatus =
  | "pending"
  | "planning"
  | "awaiting_approval"
  | "running"
  | "verifying"
  | "replanning"
  | "completed"
  | "failed"
  | "cancelled";

export type EventName =
  | "assistant.started"
  | "assistant.thinking"
  | "assistant.responding"
  | "assistant.spoke"
  | "provider.failed"
  | "provider.switched"
  | "tool.requested"
  | "tool.approved"
  | "tool.executed"
  | "tool.failed"
  | "tool.verified"
  | "verification.failed"
  | "agent.started"
  | "agent.finished"
  | "memory.created"
  | "identity.detected"
  | "security.blocked";

export type ChatRole = "system" | "user" | "assistant";
export type ToolArguments = Record<string, unknown>;

export type ToolArgumentType = "string" | "number" | "boolean";

export interface ToolArgumentProperty {
  type: ToolArgumentType;
  description?: string;
}

export interface ToolArgumentSchema {
  type: "object";
  properties: Record<string, ToolArgumentProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ModelInfo {
  id: string;
  label: string;
  provider: string;
  tier?: "free" | "paid";
  context?: number;
  capabilities?: string[];
  created?: number | string;
}

export interface ProviderRequest {
  requestId: string;
  prompt: string;
  systemPrompt?: string;
  history?: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  metadata?: Record<string, unknown>;
}

export interface ProviderResponse {
  requestId: string;
  providerId: string;
  model: string;
  content: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  latencyMs?: number;
  finishReason?: string;
}

export interface Provider {
  readonly id: string;
  readonly name: string;
  isAvailable(): Promise<boolean>;
  generate(request: ProviderRequest): Promise<ProviderResponse>;
  listModels?(): Promise<string[]>;
}

export interface ToolContext {
  requestId: string;
  taskId?: string;
  authority: AuthorityLevel;
  approved: boolean;
  metadata?: Record<string, unknown>;
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  authority: AuthorityLevel;
  risk: RiskLevel;
  argumentSchema?: ToolArgumentSchema;
}

export interface ToolCall {
  toolId: string;
  arguments: ToolArguments;
}

export interface Tool {
  readonly definition: ToolDefinition;
  execute(input: ToolArguments, context: ToolContext): Promise<unknown>;
}

export interface Agent {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  canHandle(intent: string): boolean;
  execute(input: Record<string, unknown>, context: ToolContext): Promise<unknown>;
}

export interface TaskStep {
  id: string;
  description: string;
  toolId?: string;
  arguments?: ToolArguments;
  dependsOn?: string[];
  status: TaskStatus;
  result?: unknown;
  verification?: unknown;
  error?: string;
}

export interface TaskStepContext {
  executionId: string;
  data: unknown;
  metadata: {
    durationMs: number;
    startedAt: string;
    completedAt: string;
  };
}

export interface TaskWorkingContext {
  steps: Record<string, TaskStepContext>;
}

export interface TaskResultReference {
  $ref: string;
}

export type RecoveryAction = "retry_step" | "abort";

export interface TaskRecoveryState {
  maxAttemptsPerStep: number;
  attemptsByStep: Record<string, number>;
  lastFailure?: {
    stepId: string;
    reason: string;
  };
}

export type TaskExecutionOutcome = "success" | "tool_failure" | "verification_failure";

export interface TaskExecutionReceipt {
  id: string;
  stepId: string;
  toolId: string;
  attempt: number;
  outcome: TaskExecutionOutcome;
  executionId?: string;
  startedAt: string;
  completedAt: string;
  error?: string;
}

export interface Task {
  id: string;
  requestId: string;
  status: TaskStatus;
  goal: string;
  authority: AuthorityLevel;
  risk: RiskLevel;
  steps: TaskStep[];
  createdAt: string;
  updatedAt: string;
  workingContext?: TaskWorkingContext;
  recovery?: TaskRecoveryState;
  executionHistory?: TaskExecutionReceipt[];
  result?: unknown;
  error?: string;
}

export interface PolicyDecision {
  allowed: boolean;
  requiresApproval: boolean;
  authority: AuthorityLevel;
  reason: string;
}

export interface Policy {
  evaluate(authority: AuthorityLevel, risk: RiskLevel, context?: Record<string, unknown>): Promise<PolicyDecision>;
}

export interface JarvisEvent<T = unknown> {
  id: string;
  name: EventName;
  timestamp: string;
  requestId?: string;
  taskId?: string;
  payload?: T;
}

export interface MemoryRecord {
  id: string;
  type: "working" | "episodic" | "semantic" | "procedural";
  content: string;
  importance: number;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryStore {
  create(record: MemoryRecord): Promise<void>;
  get(id: string): Promise<MemoryRecord | null>;
  search(query: string, limit?: number): Promise<MemoryRecord[]>;
  delete(id: string): Promise<void>;
}

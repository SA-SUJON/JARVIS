import type { EventBus } from "../core/events/EventBus.js";
import type { Tool, ToolArguments, ToolArgumentSchema, ToolContext } from "../core/contracts/types.js";
import type { ToolExecutionRequest, ToolExecutionResult } from "./types.js";

export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistryLike,
    private readonly events?: EventBus,
  ) {}

  async execute<T = unknown>(request: ToolExecutionRequest): Promise<ToolExecutionResult<T>> {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const executionId = crypto.randomUUID();
    const tool = this.registry.get(request.toolId);

    if (!tool) {
      const result = this.result<T>(executionId, request.toolId, startedAt, started, {
        ok: false,
        error: `Unknown tool: ${request.toolId}`,
      });
      await this.events?.emit("tool.failed", result, {
        requestId: request.context.requestId,
        taskId: request.context.taskId,
      });
      return result;
    }

    await this.events?.emit("tool.requested", {
      toolId: request.toolId,
      executionId,
      authority: request.context.authority,
      approved: request.context.approved,
    }, {
      requestId: request.context.requestId,
      taskId: request.context.taskId,
    });

    try {
      validateToolArguments(tool.definition.argumentSchema, request.input);
      this.assertAuthorized(tool, request.context);
      const data = await tool.execute(request.input, request.context) as T;
      const result = this.result<T>(executionId, request.toolId, startedAt, started, {
        ok: true,
        data,
      });
      await this.events?.emit("tool.executed", result, {
        requestId: request.context.requestId,
        taskId: request.context.taskId,
      });
      return result;
    } catch (error) {
      const result = this.result<T>(executionId, request.toolId, startedAt, started, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.events?.emit("tool.failed", result, {
        requestId: request.context.requestId,
        taskId: request.context.taskId,
      });
      return result;
    }
  }

  private result<T>(
    executionId: string,
    toolId: string,
    startedAt: string,
    started: number,
    outcome: { ok: true; data: T } | { ok: false; error: string },
  ): ToolExecutionResult<T> {
    return {
      executionId,
      toolId,
      ...outcome,
      metadata: {
        durationMs: Date.now() - started,
        startedAt,
        completedAt: new Date().toISOString(),
      },
    };
  }

  private assertAuthorized(tool: Tool, context: ToolContext): void {
    const required = tool.definition.authority;

    if (context.authority < required) {
      throw new Error(`Insufficient authority: tool requires level ${required}, request has level ${context.authority}`);
    }

    if (required >= 2 && !context.approved) {
      throw new Error(`Approval required before executing tool: ${tool.definition.id}`);
    }
  }
}

export function validateToolArguments(schema: ToolArgumentSchema | undefined, input: ToolArguments): void {
  if (!schema) return;

  for (const key of schema.required ?? []) {
    if (!(key in input) || input[key] === undefined || input[key] === null) {
      throw new Error(`Missing required tool argument: ${key}`);
    }
  }

  const allowed = new Set(Object.keys(schema.properties));
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(input)) {
      if (!allowed.has(key)) throw new Error(`Unexpected tool argument: ${key}`);
    }
  }

  for (const [key, property] of Object.entries(schema.properties)) {
    if (!(key in input) || input[key] === undefined || input[key] === null) continue;
    if (typeof input[key] !== property.type) {
      throw new Error(`Invalid tool argument '${key}': expected ${property.type}, received ${typeof input[key]}`);
    }
  }
}

interface ToolRegistryLike {
  get(id: string): Tool | undefined;
}

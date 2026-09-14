import type { EventBus } from "../core/events/EventBus.js";
import type { Tool, ToolContext } from "../core/contracts/types.js";
import type { ToolExecutionRequest, ToolExecutionResult } from "./types.js";

export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistryLike,
    private readonly events?: EventBus,
  ) {}

  async execute<T = unknown>(request: ToolExecutionRequest): Promise<ToolExecutionResult<T>> {
    const started = Date.now();
    const tool = this.registry.get(request.toolId);

    if (!tool) {
      const result: ToolExecutionResult<T> = {
        toolId: request.toolId,
        ok: false,
        error: `Unknown tool: ${request.toolId}`,
        durationMs: Date.now() - started,
      };
      await this.events?.emit("tool.failed", result, {
        requestId: request.context.requestId,
        taskId: request.context.taskId,
      });
      return result;
    }

    await this.events?.emit("tool.requested", {
      toolId: request.toolId,
      authority: request.context.authority,
      approved: request.context.approved,
    }, {
      requestId: request.context.requestId,
      taskId: request.context.taskId,
    });

    try {
      this.assertAuthorized(tool, request.context);
      const value = await tool.execute(request.input, request.context) as T;
      const result: ToolExecutionResult<T> = {
        toolId: request.toolId,
        ok: true,
        value,
        durationMs: Date.now() - started,
      };
      await this.events?.emit("tool.executed", result, {
        requestId: request.context.requestId,
        taskId: request.context.taskId,
      });
      return result;
    } catch (error) {
      const result: ToolExecutionResult<T> = {
        toolId: request.toolId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started,
      };
      await this.events?.emit("tool.failed", result, {
        requestId: request.context.requestId,
        taskId: request.context.taskId,
      });
      return result;
    }
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

interface ToolRegistryLike {
  get(id: string): Tool | undefined;
}

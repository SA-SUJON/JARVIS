import type { AuthorityLevel, RiskLevel, Task, TaskStep, ToolCall } from "../contracts/types.js";
import type { Intent } from "../orchestrator/Intent.js";

export interface Plan {
  goal: string;
  authority: AuthorityLevel;
  risk: RiskLevel;
  steps: TaskStep[];
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export class Planner {
  createPlan(input: string, intent: Intent, requestId: string): Task {
    const now = new Date().toISOString();
    const toolCall = this.toolCallFor(intent, input);
    const step: TaskStep = {
      id: crypto.randomUUID(),
      description: this.describeStep(intent, input),
      status: "pending",
      toolId: toolCall?.toolId,
      arguments: toolCall?.arguments,
    };

    return {
      id: crypto.randomUUID(),
      requestId,
      status: "planning",
      goal: input,
      authority: intent.authority,
      risk: intent.risk,
      steps: [step],
      createdAt: now,
      updatedAt: now,
    };
  }

  private toolCallFor(intent: Intent, input: string): ToolCall | undefined {
    switch (intent.kind) {
      case "application_control": {
        const match = input.match(/^\s*(?:open|launch|start)\s+(?:the\s+)?(?:app(?:lication)?|program)?\s*["']?(.+?)["']?\s*$/i);
        const app = match ? stripQuotes(match[1]) : "";
        return app ? { toolId: "system.open_app", arguments: { app } } : undefined;
      }
      case "file_operation": {
        const deleteMatch = input.match(/^\s*delete\s+(?:the\s+)?(?:file\s+)?["']?([^"'\n]+?)["']?\s*$/i);
        if (deleteMatch) {
          const filePath = stripQuotes(deleteMatch[1]);
          return filePath ? { toolId: "filesystem.delete_file", arguments: { path: filePath } } : undefined;
        }
        const writeMatch = input.match(/^\s*(?:create|write|edit|modify)\s+(?:the\s+)?(?:file\s+)?(.+?)\s+with\s+(?:the\s+)?content\s*[:=]\s*([\s\S]*)\s*$/i);
        if (writeMatch) {
          const filePath = stripQuotes(writeMatch[1]);
          const content = stripQuotes(writeMatch[2]);
          return filePath ? { toolId: "filesystem.write_text", arguments: { path: filePath, content } } : undefined;
        }
        return undefined;
      }
      default:
        return undefined;
    }
  }

  private describeStep(intent: Intent, input: string): string {
    switch (intent.kind) {
      case "search":
        return `Research and answer: ${input}`;
      case "application_control":
        return `Control the requested application: ${input}`;
      case "file_operation":
        return `Perform and verify the requested file operation: ${input}`;
      case "system_command":
        return `Validate, authorize, execute, and verify the requested system command: ${input}`;
      case "administrative":
        return `Require explicit authorization before any administrative action: ${input}`;
      case "conversation":
      case "unknown":
      default:
        return `Generate a conversational response: ${input}`;
    }
  }
}

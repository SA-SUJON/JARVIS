import type { AuthorityLevel, RiskLevel, Task, TaskStep } from "../contracts/types.js";
import type { Intent } from "../orchestrator/Intent.js";

export interface Plan {
  goal: string;
  authority: AuthorityLevel;
  risk: RiskLevel;
  steps: TaskStep[];
}

export class Planner {
  createPlan(input: string, intent: Intent, requestId: string): Task {
    const now = new Date().toISOString();
    const toolId = this.toolIdFor(intent, input);
    const step: TaskStep = {
      id: crypto.randomUUID(),
      description: this.describeStep(intent, input),
      status: "pending",
      toolId,
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

  private toolIdFor(intent: Intent, input: string): string | undefined {
    switch (intent.kind) {
      case "application_control":
        return "system.open_app";
      case "file_operation":
        if (/\bdelete\s+(?:the\s+)?(?:file\s+)?/i.test(input)) return "filesystem.delete_file";
        if (/\b(?:create|write|edit|modify)\s+(?:the\s+)?(?:file\s+)?/i.test(input)) return "filesystem.write_text";
        return undefined;
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

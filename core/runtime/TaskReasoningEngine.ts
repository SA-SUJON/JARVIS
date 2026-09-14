import type { Task, TaskResultReference, TaskStep, ToolArguments } from "../contracts/types.js";
import type { ProviderResponse } from "../contracts/types.js";

export interface ReasoningContextStep {
  stepId: string;
  description: string;
  toolId?: string;
  status: TaskStep["status"];
  result?: unknown;
  verification?: unknown;
}

export interface TaskReasoningContext {
  goal: string;
  steps: ReasoningContextStep[];
}

export interface ReasoningProposal {
  action: "execute" | "stop";
  rationale: string;
  toolId?: string;
  arguments?: ToolArguments;
  dependsOn?: string[];
}

export interface TaskReasoningGenerator {
  generate(prompt: string): Promise<ProviderResponse>;
}

/** Bounded reasoning boundary: models may propose one structured next action, never execute it. */
export class TaskReasoningEngine {
  constructor(
    private readonly generator: TaskReasoningGenerator,
    private readonly maxContextChars = 12000,
    private readonly maxProposalChars = 8000,
  ) {}

  buildContext(task: Task): TaskReasoningContext {
    return {
      goal: task.goal,
      steps: task.steps.map((step) => ({
        stepId: step.id,
        description: step.description,
        toolId: step.toolId,
        status: step.status,
        result: step.result,
        verification: step.verification,
      })),
    };
  }

  async proposeNextAction(task: Task): Promise<ReasoningProposal> {
    const context = JSON.stringify(this.buildContext(task));
    const boundedContext = context.length > this.maxContextChars
      ? `${context.slice(0, this.maxContextChars)}…`
      : context;

    const response = await this.generator.generate([
      "You are JARVIS's bounded task-reasoning component.",
      "Inspect the supplied task state and propose at most ONE next action.",
      "Do not execute tools. Do not invent tool ids or dependencies.",
      "Return JSON only with this shape:",
      '{"action":"execute"|"stop","rationale":"string","toolId":"string","arguments":{},"dependsOn":["step-id"]}',
      "For stop, omit toolId, arguments, and dependsOn.",
      "For execute, toolId and arguments are required.",
      "Task context:",
      boundedContext,
    ].join("\n"));

    return parseReasoningProposal(response.content, this.maxProposalChars);
  }
}

export function parseReasoningProposal(content: string, maxChars = 8000): ReasoningProposal {
  const bounded = content.trim();
  if (!bounded) throw new Error("Reasoning provider returned an empty proposal.");
  if (bounded.length > maxChars) throw new Error("Reasoning proposal exceeds the safety size limit.");

  const normalized = bounded.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error("Reasoning provider returned invalid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Reasoning proposal must be a JSON object.");
  }

  const value = parsed as Record<string, unknown>;
  const action = value.action;
  const rationale = value.rationale;

  if (action !== "execute" && action !== "stop") throw new Error("Reasoning proposal action must be 'execute' or 'stop'.");
  if (typeof rationale !== "string" || !rationale.trim()) throw new Error("Reasoning proposal requires a rationale.");

  if (action === "stop") return { action, rationale: rationale.trim() };

  if (typeof value.toolId !== "string" || !value.toolId.trim()) throw new Error("Execution proposal requires a toolId.");
  if (!value.arguments || typeof value.arguments !== "object" || Array.isArray(value.arguments)) {
    throw new Error("Execution proposal requires structured arguments.");
  }

  if (value.dependsOn !== undefined) {
    if (!Array.isArray(value.dependsOn) || value.dependsOn.some((entry) => typeof entry !== "string" || !entry.trim())) {
      throw new Error("Execution proposal dependsOn must be an array of step ids.");
    }
  }

  for (const key of Object.keys(value)) {
    if (!["action", "rationale", "toolId", "arguments", "dependsOn"].includes(key)) {
      throw new Error(`Unexpected reasoning proposal field: ${key}`);
    }
  }

  const references = collectReferences(value.arguments as ToolArguments);
  for (const reference of references) {
    if (!/^step:[^\.\s]+\.data(?:\.(.+))?$/.test(reference.$ref)) {
      throw new Error(`Invalid task result reference: ${reference.$ref}`);
    }
  }

  return {
    action,
    rationale: rationale.trim(),
    toolId: value.toolId.trim(),
    arguments: value.arguments as ToolArguments,
    dependsOn: value.dependsOn as string[] | undefined,
  };
}

function collectReferences(value: ToolArguments): TaskResultReference[] {
  const references: TaskResultReference[] = [];
  const visit = (entry: unknown): void => {
    if (entry && typeof entry === "object" && !Array.isArray(entry) && Object.keys(entry).length === 1 && typeof (entry as TaskResultReference).$ref === "string") {
      references.push(entry as TaskResultReference);
      return;
    }
    if (Array.isArray(entry)) {
      for (const item of entry) visit(item);
      return;
    }
    if (!entry || typeof entry !== "object") return;
    for (const child of Object.values(entry)) visit(child);
  };
  visit(value);
  return references;
}

import type { Task, TaskResultReference, ToolArguments } from "../contracts/types.js";
import { isTaskResultReference } from "./TaskContext.js";
import { validateToolArguments } from "../../tools/ToolExecutor.js";
import type { ToolRegistry } from "../../tools/ToolRegistry.js";

export interface PlanValidationIssue {
  stepId?: string;
  reason: string;
}

export interface PlanValidationResult {
  valid: boolean;
  issues: PlanValidationIssue[];
}

export interface VerificationSupport {
  supports(toolId: string): boolean;
}

/** Validates that a planned task is structurally executable before approval or execution. */
export class PlanValidationEngine {
  constructor(
    private readonly tools: Pick<ToolRegistry, "get">,
    private readonly verification?: VerificationSupport,
  ) {}

  validate(task: Task): PlanValidationResult {
    const issues: PlanValidationIssue[] = [];
    const stepIds = new Set<string>();

    for (const step of task.steps) {
      if (!step.id.trim()) {
        issues.push({ reason: "Task step id cannot be empty." });
        continue;
      }
      if (stepIds.has(step.id)) {
        issues.push({ stepId: step.id, reason: `Duplicate task step id: ${step.id}` });
      }
      stepIds.add(step.id);
    }

    for (const step of task.steps) {
      const dependencies = step.dependsOn ?? [];
      const dependencySet = new Set<string>();

      for (const dependencyId of dependencies) {
        if (dependencySet.has(dependencyId)) {
          issues.push({ stepId: step.id, reason: `Duplicate dependency: ${dependencyId}` });
        }
        dependencySet.add(dependencyId);

        if (!stepIds.has(dependencyId)) {
          issues.push({ stepId: step.id, reason: `Unknown step dependency: ${dependencyId}` });
        }
        if (dependencyId === step.id) {
          issues.push({ stepId: step.id, reason: "A task step cannot depend on itself." });
        }
      }

      if (step.toolId) {
        const tool = this.tools.get(step.toolId);
        if (!tool) {
          issues.push({ stepId: step.id, reason: `Unknown planned tool: ${step.toolId}` });
        } else {
          if (!step.arguments) {
            issues.push({ stepId: step.id, reason: "Planned tool has no structured arguments." });
          } else {
            try {
              validateToolArguments(tool.definition.argumentSchema, step.arguments);
            } catch (error) {
              issues.push({
                stepId: step.id,
                reason: error instanceof Error ? error.message : String(error),
              });
            }

            for (const reference of collectReferences(step.arguments)) {
              const targetStepId = reference.$ref.match(/^step:([^\.\s]+)\.data(?:\.(.+))?$/)?.[1];
              if (!targetStepId) {
                issues.push({ stepId: step.id, reason: `Invalid task result reference: ${reference.$ref}` });
                continue;
              }
              if (!stepIds.has(targetStepId)) {
                issues.push({ stepId: step.id, reason: `Task result reference points to unknown step: ${targetStepId}` });
              } else if (!dependencies.includes(targetStepId)) {
                issues.push({
                  stepId: step.id,
                  reason: `Task result reference requires dependency on step: ${targetStepId}`,
                });
              }
            }
          }

          if (task.authority < tool.definition.authority) {
            issues.push({
              stepId: step.id,
              reason: `Insufficient task authority for tool ${step.toolId}: requires level ${tool.definition.authority}, task has level ${task.authority}`,
            });
          }

          if (this.verification && !this.verification.supports(step.toolId)) {
            issues.push({
              stepId: step.id,
              reason: `No post-execution verifier is registered for tool: ${step.toolId}`,
            });
          }
        }
      } else if (step.arguments) {
        issues.push({ stepId: step.id, reason: "Structured arguments cannot be attached to a step without a tool." });
      }
    }

    if (this.hasDependencyCycle(task)) {
      issues.push({ reason: "Task step dependencies contain a cycle." });
    }

    return { valid: issues.length === 0, issues };
  }

  private hasDependencyCycle(task: Task): boolean {
    const states = new Map<string, "unvisited" | "visiting" | "visited">();
    const steps = new Map(task.steps.map((step) => [step.id, step]));

    for (const step of task.steps) states.set(step.id, "unvisited");

    const visit = (stepId: string): boolean => {
      const state = states.get(stepId);
      if (state === "visiting") return true;
      if (state === "visited" || state === undefined) return false;

      states.set(stepId, "visiting");
      for (const dependencyId of steps.get(stepId)?.dependsOn ?? []) {
        if (visit(dependencyId)) return true;
      }
      states.set(stepId, "visited");
      return false;
    };

    return task.steps.some((step) => visit(step.id));
  }
}

function collectReferences(value: ToolArguments): TaskResultReference[] {
  const references: TaskResultReference[] = [];

  const visit = (entry: unknown): void => {
    if (isTaskResultReference(entry)) {
      references.push(entry);
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

import type {
  Task,
  TaskResultReference,
  TaskStepContext,
  TaskWorkingContext,
  ToolArguments,
} from "../contracts/types.js";

const REFERENCE_PATTERN = /^step:([^\.\s]+)\.data(?:\.(.+))?$/;

export class TaskContextStore {
  ensure(task: Task): TaskWorkingContext {
    task.workingContext ??= { steps: {} };
    return task.workingContext;
  }

  publish(task: Task, stepId: string, context: TaskStepContext): void {
    this.ensure(task).steps[stepId] = context;
  }

  get(task: Task, stepId: string): TaskStepContext | undefined {
    return task.workingContext?.steps[stepId];
  }
}

export function isTaskResultReference(value: unknown): value is TaskResultReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).length === 1 && typeof (value as TaskResultReference).$ref === "string";
}

export function resolveToolArguments(
  task: Task,
  input: ToolArguments,
  contextStore = new TaskContextStore(),
): ToolArguments {
  return resolveValue(task, input, contextStore) as ToolArguments;
}

function resolveValue(task: Task, value: unknown, contextStore: TaskContextStore): unknown {
  if (isTaskResultReference(value)) return resolveReference(task, value.$ref, contextStore);
  if (Array.isArray(value)) return value.map((entry) => resolveValue(task, entry, contextStore));
  if (!value || typeof value !== "object") return value;

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = resolveValue(task, entry, contextStore);
  }
  return output;
}

function resolveReference(task: Task, reference: string, contextStore: TaskContextStore): unknown {
  const match = REFERENCE_PATTERN.exec(reference);
  if (!match) {
    throw new Error(`Invalid task result reference: ${reference}`);
  }

  const stepId = match[1];
  const path = match[2]?.split(".") ?? [];
  const stepContext = contextStore.get(task, stepId);
  if (!stepContext) {
    throw new Error(`Task result reference points to an unavailable step: ${stepId}`);
  }

  let current: unknown = stepContext.data;
  for (const segment of path) {
    if (!segment || !/^[$A-Za-z_][\w$-]*$/.test(segment)) {
      throw new Error(`Invalid task result reference path: ${reference}`);
    }
    if (!current || typeof current !== "object" || !(segment in current)) {
      throw new Error(`Task result reference path does not exist: ${reference}`);
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

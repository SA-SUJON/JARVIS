import type {
  Agent,
  JarvisEvent,
  Policy,
  Provider,
  ProviderResponse,
  Task,
} from "../contracts/types.js";
import { EventBus } from "../events/EventBus.js";
import { Planner } from "../planner/Planner.js";
import { PolicyEngine, type PolicyContext } from "../policy/PolicyEngine.js";
import { Router } from "../router/Router.js";
import { classifyIntent, type Intent } from "./Intent.js";

export interface OrchestratorRequest {
  requestId?: string;
  input: string;
  policyContext?: PolicyContext;
  systemPrompt?: string;
  history?: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
}

export interface OrchestratorResult {
  requestId: string;
  intent: Intent;
  task: Task;
  route: ReturnType<Router["route"]>;
  response?: ProviderResponse;
  status: "completed" | "awaiting_approval" | "failed";
  error?: string;
}

export class Orchestrator {
  readonly events: EventBus;
  readonly planner: Planner;
  readonly policy: Policy;
  readonly router: Router;

  constructor(
    options: {
      events?: EventBus;
      planner?: Planner;
      policy?: Policy;
      agents?: Agent[];
      providers?: Provider[];
    } = {},
  ) {
    this.events = options.events ?? new EventBus();
    this.planner = options.planner ?? new Planner();
    this.policy = options.policy ?? new PolicyEngine();
    this.router = new Router(options.agents ?? [], options.providers ?? []);
  }

  async execute(request: OrchestratorRequest): Promise<OrchestratorResult> {
    const requestId = request.requestId ?? crypto.randomUUID();
    const input = request.input.trim();

    await this.events.emit("assistant.started", { input }, { requestId });
    await this.events.emit("assistant.thinking", undefined, { requestId });

    if (!input) {
      const intent = classifyIntent(input);
      const task = this.planner.createPlan(input, intent, requestId);
      return {
        requestId,
        intent,
        task,
        route: { kind: "conversation" },
        status: "failed",
        error: "Request cannot be empty.",
      };
    }

    const intent = classifyIntent(input);
    const task = this.planner.createPlan(input, intent, requestId);

    const decision = await this.policy.evaluate(
      task.authority,
      task.risk,
      request.policyContext,
    );

    if (!decision.allowed) {
      task.status = decision.requiresApproval ? "awaiting_approval" : "failed";
      task.error = decision.reason;
      task.updatedAt = new Date().toISOString();

      await this.events.emit(
        "security.blocked",
        { reason: decision.reason, authority: task.authority, risk: task.risk },
        { requestId, taskId: task.id },
      );

      return {
        requestId,
        intent,
        task,
        route: this.router.route(intent),
        status: decision.requiresApproval ? "awaiting_approval" : "failed",
        error: decision.reason,
      };
    }

    const route = this.router.route(intent);
    return {
      requestId,
      intent,
      task,
      route,
      status: "completed",
    };
  }
}

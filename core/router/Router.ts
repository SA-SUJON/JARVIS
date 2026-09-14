import type { Agent, Provider } from "../contracts/types.js";
import type { Intent } from "../orchestrator/Intent.js";

export type RouteTarget =
  | { kind: "agent"; id: string }
  | { kind: "provider"; id: string }
  | { kind: "conversation" };

export class Router {
  constructor(
    private readonly agents: Agent[] = [],
    private readonly providers: Provider[] = [],
  ) {}

  route(intent: Intent): RouteTarget {
    const agent = this.agents.find((candidate) => candidate.canHandle(intent.kind));
    if (agent) {
      return { kind: "agent", id: agent.id };
    }

    if (intent.kind === "conversation" || intent.kind === "unknown") {
      return { kind: "conversation" };
    }

    const availableProvider = this.providers[0];
    if (availableProvider) {
      return { kind: "provider", id: availableProvider.id };
    }

    return { kind: "conversation" };
  }
}

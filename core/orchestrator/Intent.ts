import type { AuthorityLevel, RiskLevel } from "../contracts/types.js";

export type IntentKind =
  | "conversation"
  | "search"
  | "application_control"
  | "file_operation"
  | "system_command"
  | "administrative"
  | "unknown";

export interface Intent {
  kind: IntentKind;
  input: string;
  authority: AuthorityLevel;
  risk: RiskLevel;
  confidence: number;
  requiresPlanning: boolean;
}

const RULES: Array<{
  kind: IntentKind;
  authority: AuthorityLevel;
  risk: RiskLevel;
  requiresPlanning: boolean;
  patterns: RegExp[];
}> = [
  {
    kind: "administrative",
    authority: 5,
    risk: "critical",
    requiresPlanning: true,
    patterns: [/administrator/i, /admin rights?/i, /security settings?/i, /disable defender/i],
  },
  {
    kind: "system_command",
    authority: 4,
    risk: "high",
    requiresPlanning: true,
    patterns: [/\b(run|execute)\b.+\b(command|powershell|cmd|script)\b/i, /shutdown|restart|format|registry/i],
  },
  {
    kind: "file_operation",
    authority: 3,
    risk: "medium",
    requiresPlanning: true,
    patterns: [/\b(create|write|edit|modify|delete|rename|move)\b.+\b(file|folder|directory|document)\b/i],
  },
  {
    kind: "application_control",
    authority: 2,
    risk: "low",
    requiresPlanning: true,
    patterns: [/\b(open|close|launch|start|quit)\b.+\b(app|application|program|browser|chrome|notepad|explorer)\b/i],
  },
  {
    kind: "search",
    authority: 1,
    risk: "low",
    requiresPlanning: false,
    patterns: [/\b(search|look up|find|latest|news|research)\b/i, /what happened today/i],
  },
  {
    kind: "conversation",
    authority: 0,
    risk: "low",
    requiresPlanning: false,
    patterns: [],
  },
];

export function classifyIntent(input: string): Intent {
  const normalized = input.trim();

  if (!normalized) {
    return {
      kind: "unknown",
      input: normalized,
      authority: 0,
      risk: "low",
      confidence: 0,
      requiresPlanning: false,
    };
  }

  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      return {
        kind: rule.kind,
        input: normalized,
        authority: rule.authority,
        risk: rule.risk,
        confidence: rule.kind === "conversation" ? 0.55 : 0.82,
        requiresPlanning: rule.requiresPlanning,
      };
    }
  }

  return {
    kind: "unknown",
    input: normalized,
    authority: 0,
    risk: "low",
    confidence: 0.35,
    requiresPlanning: false,
  };
}

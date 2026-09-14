import type { AuthorityLevel, Policy, PolicyDecision, RiskLevel } from "../contracts/types.js";

export interface PolicyContext {
  operatorAuthenticated?: boolean;
  explicitApproval?: boolean;
}

/**
 * Conservative default policy for MARK_05.
 * Higher-risk capabilities are never silently authorized.
 */
export class PolicyEngine implements Policy {
  async evaluate(
    authority: AuthorityLevel,
    risk: RiskLevel,
    context: PolicyContext = {},
  ): Promise<PolicyDecision> {
    if (authority >= 5 || risk === "critical") {
      return {
        allowed: Boolean(context.operatorAuthenticated && context.explicitApproval),
        requiresApproval: true,
        authority,
        reason: "Administrative or critical-risk actions require authenticated operator approval.",
      };
    }

    if (authority >= 4 || risk === "high") {
      return {
        allowed: Boolean(context.explicitApproval),
        requiresApproval: true,
        authority,
        reason: "High-impact system actions require explicit approval.",
      };
    }

    if (authority >= 3 || risk === "medium") {
      return {
        allowed: Boolean(context.explicitApproval),
        requiresApproval: true,
        authority,
        reason: "State-changing file operations require explicit approval until tool-level policy is configured.",
      };
    }

    return {
      allowed: true,
      requiresApproval: false,
      authority,
      reason: "Low-risk request is permitted by the default policy.",
    };
  }
}

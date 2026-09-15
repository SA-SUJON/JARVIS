import { test, expect } from "@playwright/test";
import { parseReasoningProposal, promoteReasoningProposal, TaskReasoningEngine } from "../core/runtime/TaskReasoningEngine.js";
import type { ProviderResponse, Task } from "../core/contracts/types.js";

function response(content: string): ProviderResponse {
  return {
    requestId: "reasoning-test",
    providerId: "test",
    model: "test-model",
    content,
  };
}

function task(): Task {
  return {
    id: "task-1",
    requestId: "request-1",
    status: "verifying",
    goal: "Inspect the file and decide the next action.",
    authority: 3,
    risk: "medium",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    steps: [
      {
        id: "step-read",
        description: "Read the requested file.",
        toolId: "filesystem.read_text",
        arguments: { path: "tests/fixture.txt" },
        status: "completed",
        result: { path: "tests/fixture.txt", content: "hello", bytes: 5 },
        verification: { verified: true, status: "verified" },
      },
    ],
  };
}

test.describe("MARK_05 bounded task reasoning", () => {
  test("builds a bounded reasoning context from task state", async () => {
    const engine = new TaskReasoningEngine({
      async generate() {
        return response('{"action":"stop","rationale":"Observation is sufficient."}');
      },
    });

    expect(engine.buildContext(task())).toEqual({
      goal: "Inspect the file and decide the next action.",
      steps: [
        {
          stepId: "step-read",
          description: "Read the requested file.",
          toolId: "filesystem.read_text",
          status: "completed",
          result: { path: "tests/fixture.txt", content: "hello", bytes: 5 },
          verification: { verified: true, status: "verified" },
        },
      ],
    });
  });

  test("parses a single structured execute proposal", () => {
    expect(parseReasoningProposal(
      '{"action":"execute","rationale":"Use the observed file contents.","toolId":"filesystem.write_text","arguments":{"path":"tests/out.txt","content":{"$ref":"step:step-read.data.content"}},"dependsOn":["step-read"]}',
    )).toEqual({
      action: "execute",
      rationale: "Use the observed file contents.",
      toolId: "filesystem.write_text",
      arguments: { path: "tests/out.txt", content: { $ref: "step:step-read.data.content" } },
      dependsOn: ["step-read"],
    });
  });

  test("promotes an execute proposal into a pending task step", () => {
    const current = task();
    const step = promoteReasoningProposal(current, {
      action: "execute",
      rationale: "Write the observed content to the output file.",
      toolId: "filesystem.write_text",
      arguments: {
        path: "tests/out.txt",
        content: { $ref: "step:step-read.data.content" },
      },
      dependsOn: ["step-read", "step-read"],
    });

    expect(step.id).toBeTruthy();
    expect(step.status).toBe("pending");
    expect(step.toolId).toBe("filesystem.write_text");
    expect(step.arguments).toEqual({
      path: "tests/out.txt",
      content: { $ref: "step:step-read.data.content" },
    });
    expect(step.dependsOn).toEqual(["step-read"]);
    expect(current.steps).toHaveLength(2);
  });

  test("rejects promotion when a dependency is not part of the task", () => {
    expect(() => promoteReasoningProposal(task(), {
      action: "execute",
      rationale: "Attempt an unrelated action.",
      toolId: "filesystem.write_text",
      arguments: { path: "tests/out.txt", content: "x" },
      dependsOn: ["missing-step"],
    })).toThrow("unknown dependency");
  });

  test("accepts a stop proposal without an action payload", () => {
    expect(parseReasoningProposal('{"action":"stop","rationale":"The goal is complete."}')).toEqual({
      action: "stop",
      rationale: "The goal is complete.",
    });
  });

  test("rejects malformed or unsafe proposal shapes", () => {
    expect(() => parseReasoningProposal("not-json")).toThrow("invalid JSON");
    expect(() => parseReasoningProposal('{"action":"execute","rationale":"x","toolId":"tool"}')).toThrow("structured arguments");
    expect(() => parseReasoningProposal('{"action":"execute","rationale":"x","toolId":"tool","arguments":{},"unexpected":true}')).toThrow("Unexpected reasoning proposal field");
    expect(() => parseReasoningProposal('{"action":"execute","rationale":"x","toolId":"tool","arguments":{"ref":{"$ref":"bad"}}}')).toThrow("Invalid task result reference");
  });

  test("keeps provider reasoning separate from execution", async () => {
    let receivedPrompt = "";
    const engine = new TaskReasoningEngine({
      async generate(prompt) {
        receivedPrompt = prompt;
        return response('{"action":"stop","rationale":"No further action is required."}');
      },
    });

    const proposal = await engine.proposeNextAction(task());
    expect(proposal.action).toBe("stop");
    expect(receivedPrompt).toContain("Do not execute tools.");
    expect(receivedPrompt).toContain("filesystem.read_text");
  });
});

import { test, expect } from "@playwright/test";
import { RecoveryEngine } from "../core/runtime/RecoveryEngine.js";
import { ExecutionStateMachine } from "../core/runtime/ExecutionStateMachine.js";
import { RuntimeKernel } from "../core/runtime/RuntimeKernel.js";
import { ToolRegistry } from "../tools/ToolRegistry.js";
import type { Task, TaskStep, Tool } from "../core/contracts/types.js";

const makeTask = (): Task => ({
  id: "task-recovery",
  requestId: "request-recovery",
  status: "running",
  goal: "recovery test",
  authority: 1,
  risk: "low",
  steps: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const makeStep = (): TaskStep => ({
  id: "step-1",
  description: "recoverable step",
  toolId: "test.tool",
  arguments: { value: "x" },
  status: "running",
});

test.describe("MARK_05 recovery", () => {
  test("allows exactly one bounded retry per step", () => {
    const engine = new RecoveryEngine(1);
    const task = makeTask();
    const step = makeStep();

    const first = engine.decide(task, step, "temporary tool failure");
    expect(first.action).toBe("retry_step");
    expect(first.attempt).toBe(1);

    const second = engine.decide(task, step, "temporary tool failure again");
    expect(second.action).toBe("abort");
    expect(second.attempt).toBe(2);
    expect(task.recovery?.attemptsByStep[step.id]).toBe(2);
  });

  test("replanning is a valid bounded state transition", () => {
    const machine = new ExecutionStateMachine();
    const task = makeTask();
    const step = makeStep();

    machine.transition(task, "replanning");
    machine.transition(task, "running");
    machine.transition(step, "replanning");
    machine.transition(step, "running");

    expect(task.status).toBe("running");
    expect(step.status).toBe("running");
  });

  test("recovery state records the last failure without changing execution authority", () => {
    const engine = new RecoveryEngine(1);
    const task = makeTask();
    const step = makeStep();

    engine.decide(task, step, "verification failed");

    expect(task.recovery?.lastFailure).toEqual({
      stepId: step.id,
      reason: "verification failed",
    });
    expect(task.authority).toBe(1);
    expect(step.arguments).toEqual({ value: "x" });
  });

  test("runtime retries a failed verification without illegal running-to-running transition", async () => {
    let executions = 0;
    const tool: Tool = {
      definition: {
        id: "test.unverified",
        name: "Unverified test tool",
        description: "Test-only tool with no registered verifier.",
        authority: 0,
        risk: "low",
      },
      async execute() {
        executions += 1;
        return { attempt: executions };
      },
    };

    const tools = new ToolRegistry();
    tools.register(tool);
    const runtime = new RuntimeKernel({ tools });
    const requestId = "runtime-recovery-test";
    const task: Task = {
      id: "task-runtime-recovery",
      requestId,
      status: "planning",
      goal: "retry unverified test tool",
      authority: 0,
      risk: "low",
      steps: [
        {
          id: "step-runtime-recovery",
          description: "run unverified test tool",
          toolId: tool.definition.id,
          arguments: {},
          status: "pending",
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    runtime.orchestrator.execute = async () => ({
      requestId,
      intent: { kind: "conversation", authority: 0, risk: "low" } as never,
      task,
      route: { kind: "conversation" } as never,
      status: "completed",
    });

    const result = await runtime.execute({ requestId, input: task.goal });

    expect(result.status).toBe("failed");
    expect(task.status).toBe("failed");
    expect(executions).toBe(2);
    expect(task.executionHistory).toHaveLength(2);
    expect(task.executionHistory?.map((receipt) => receipt.attempt)).toEqual([1, 2]);
    expect(task.executionHistory?.every((receipt) => receipt.outcome === "verification_failure")).toBe(true);
    expect(task.recovery?.attemptsByStep["step-runtime-recovery"]).toBe(2);
  });
});

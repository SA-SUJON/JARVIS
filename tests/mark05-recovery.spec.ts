import { test, expect } from "@playwright/test";
import { RecoveryEngine } from "../core/runtime/RecoveryEngine.js";
import { ExecutionStateMachine } from "../core/runtime/ExecutionStateMachine.js";
import type { Task, TaskStep } from "../core/contracts/types.js";

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
});

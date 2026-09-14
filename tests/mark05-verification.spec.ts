import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { VerificationEngine } from "../core/verification/VerificationEngine.js";

test.describe("MARK_05 verification engine", () => {
  test("verifies a written file by existence, size, and SHA-256", async () => {
    const relativePath = path.join("tests", ".mark05-verification-write.txt");
    const target = path.resolve(process.env.JARVIS_WORKSPACE || process.cwd(), relativePath);
    const content = "MARK_05 verification test";
    const bytes = Buffer.byteLength(content, "utf8");
    const sha256 = createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex");

    try {
      await writeFile(target, content, "utf8");
      const engine = new VerificationEngine();
      const result = await engine.verify({
        requestId: "request-test",
        taskId: "task-test",
        toolId: "filesystem.write_text",
        input: { goal: `create file ${relativePath} with content: ${content}` },
        result: { toolId: "filesystem.write_text", ok: true, value: { path: relativePath, bytes, sha256, operation: "write" }, durationMs: 1 },
      });

      expect(result.verified).toBe(true);
      expect(result.status).toBe("verified");
    } finally {
      await rm(target, { force: true });
    }
  });

  test("fails write verification when the on-disk file hash changes", async () => {
    const relativePath = path.join("tests", ".mark05-verification-mismatch.txt");
    const target = path.resolve(process.env.JARVIS_WORKSPACE || process.cwd(), relativePath);
    const expected = "expected";

    try {
      await writeFile(target, "tampered", "utf8");
      const engine = new VerificationEngine();
      const result = await engine.verify({
        requestId: "request-test",
        taskId: "task-test",
        toolId: "filesystem.write_text",
        input: { goal: `create file ${relativePath} with content: ${expected}` },
        result: {
          toolId: "filesystem.write_text",
          ok: true,
          value: {
            path: relativePath,
            bytes: Buffer.byteLength(expected, "utf8"),
            sha256: createHash("sha256").update(expected).digest("hex"),
            operation: "write",
          },
          durationMs: 1,
        },
      });

      expect(result.verified).toBe(false);
      expect(result.status).toBe("failed");
    } finally {
      await rm(target, { force: true });
    }
  });

  test("verifies deletion when the target file is gone", async () => {
    const relativePath = path.join("tests", ".mark05-verification-delete.txt");
    const target = path.resolve(process.env.JARVIS_WORKSPACE || process.cwd(), relativePath);
    await rm(target, { force: true });

    const engine = new VerificationEngine();
    const result = await engine.verify({
      requestId: "request-test",
      taskId: "task-test",
      toolId: "filesystem.delete_file",
      input: { path: relativePath },
      result: { toolId: "filesystem.delete_file", ok: true, value: { path: relativePath, operation: "delete" }, durationMs: 1 },
    });

    expect(result.verified).toBe(true);
    expect(result.status).toBe("verified");
  });
});

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import type { EventBus } from "../events/EventBus.js";
import type { ToolExecutionResult } from "../../tools/types.js";
import type { VerificationRequest, VerificationResult, Verifier } from "./types.js";

const execFileAsync = promisify(execFile);

const WORKSPACE_ROOT = path.resolve(process.env.JARVIS_WORKSPACE || process.cwd());

function workspaceTarget(relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error("Verifier received an invalid workspace-relative path.");
  }

  const resolved = path.resolve(WORKSPACE_ROOT, relativePath);
  if (resolved !== WORKSPACE_ROOT && !resolved.startsWith(`${WORKSPACE_ROOT}${path.sep}`)) {
    throw new Error("Verifier path escapes the configured JARVIS workspace.");
  }
  return resolved;
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(target: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const content = await readFile(target);
  return createHash("sha256").update(content).digest("hex");
}

async function verifyApplication(command: string): Promise<boolean> {
  if (!command) return false;

  if (process.platform === "win32") {
    try {
      const imageName = path.basename(command);
      const { stdout } = await execFileAsync(
        "tasklist.exe",
        ["/FI", `IMAGENAME eq ${imageName}`, "/FO", "CSV", "/NH"],
        { windowsHide: true, timeout: 3000, maxBuffer: 128 * 1024 },
      );
      return stdout.toLowerCase().includes(`"${imageName.toLowerCase()}"`);
    } catch {
      return false;
    }
  }

  try {
    const processName = path.basename(command);
    await execFileAsync("pgrep", ["-x", processName], {
      timeout: 3000,
      maxBuffer: 16 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

class ControlledToolVerifier implements Verifier {
  constructor(private readonly events?: EventBus) {}

  supports(toolId: string): boolean {
    return [
      "filesystem.write_text",
      "filesystem.delete_file",
      "system.open_app",
    ].includes(toolId);
  }

  async verify(request: VerificationRequest): Promise<VerificationResult> {
    if (!request.result.ok) {
      return {
        status: "failed",
        verified: false,
        reason: "Tool execution did not succeed, so post-execution verification cannot pass.",
      };
    }

    switch (request.toolId) {
      case "filesystem.write_text":
        return this.verifyWrite(request);
      case "filesystem.delete_file":
        return this.verifyDelete(request);
      case "system.open_app":
        return this.verifyOpenApp(request);
      default:
        return {
          status: "unsupported",
          verified: false,
          reason: `No verifier is registered for tool: ${request.toolId}`,
        };
    }
  }

  private async verifyWrite(request: VerificationRequest): Promise<VerificationResult> {
    const value = (request.result.value ?? {}) as Record<string, unknown>;
    const relativePath = String(value.path ?? "");
    if (!relativePath) {
      return { status: "failed", verified: false, reason: "Write tool returned no target path." };
    }

    try {
      const target = workspaceTarget(relativePath);
      const exists = await fileExists(target);
      if (!exists) {
        return {
          status: "failed",
          verified: false,
          reason: "Expected written file does not exist after tool execution.",
          details: { path: relativePath, exists: false },
        };
      }

      const metadata = await stat(target);
      const actualBytes = metadata.size;
      const expectedBytes = Number(value.bytes);
      const actualHash = await sha256File(target);
      const expectedHash = String(value.sha256 ?? "");

      const bytesMatch = Number.isFinite(expectedBytes) && actualBytes === expectedBytes;
      const hashMatch = Boolean(expectedHash) && actualHash === expectedHash;

      if (!bytesMatch || !hashMatch) {
        return {
          status: "failed",
          verified: false,
          reason: "Written file exists, but its size or SHA-256 hash does not match the tool result.",
          details: {
            path: relativePath,
            expectedBytes,
            actualBytes,
            expectedSha256: expectedHash,
            actualSha256: actualHash,
          },
        };
      }

      return {
        status: "verified",
        verified: true,
        reason: "Written file exists and matches the expected byte count and SHA-256 hash.",
        details: { path: relativePath, bytes: actualBytes, sha256: actualHash },
      };
    } catch (error) {
      return {
        status: "failed",
        verified: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async verifyDelete(request: VerificationRequest): Promise<VerificationResult> {
    const value = (request.result.value ?? {}) as Record<string, unknown>;
    const relativePath = String(value.path ?? "");
    if (!relativePath) {
      return { status: "failed", verified: false, reason: "Delete tool returned no target path." };
    }

    try {
      const target = workspaceTarget(relativePath);
      const exists = await fileExists(target);
      return exists
        ? {
            status: "failed",
            verified: false,
            reason: "Target file still exists after deletion.",
            details: { path: relativePath, exists: true },
          }
        : {
            status: "verified",
            verified: true,
            reason: "Target file no longer exists after deletion.",
            details: { path: relativePath, exists: false },
          };
    } catch (error) {
      return {
        status: "failed",
        verified: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async verifyOpenApp(request: VerificationRequest): Promise<VerificationResult> {
    const value = (request.result.value ?? {}) as Record<string, unknown>;
    const application = String(value.application ?? "");
    const command = String(value.command ?? "");
    const running = await verifyApplication(command);

    return running
      ? {
          status: "verified",
          verified: true,
          reason: `Approved application ${application || command} is running after launch.`,
          details: { application, command, running: true },
        }
      : {
          status: "failed",
          verified: false,
          reason: `Approved application ${application || command} could not be detected after launch.`,
          details: { application, command, running: false },
        };
  }
}

export class VerificationEngine {
  private readonly verifiers: Verifier[];

  constructor(private readonly events?: EventBus, verifiers?: Verifier[]) {
    this.verifiers = verifiers ?? [new ControlledToolVerifier(events)];
  }

  supports(toolId: string): boolean {
    return this.verifiers.some((verifier) => verifier.supports(toolId));
  }

  async verify(request: VerificationRequest): Promise<VerificationResult> {
    const verifier = this.verifiers.find((candidate) => candidate.supports(request.toolId));
    if (!verifier) {
      return {
        status: "unsupported",
        verified: false,
        reason: `No verifier registered for tool: ${request.toolId}`,
      };
    }

    const started = Date.now();
    try {
      const result = await verifier.verify(request);
      await this.events?.emit("tool.verified", {
        toolId: request.toolId,
        ...result,
        durationMs: Date.now() - started,
      }, {
        requestId: request.step?.id ? undefined : undefined,
      });
      return result;
    } catch (error) {
      const result: VerificationResult = {
        status: "failed",
        verified: false,
        reason: error instanceof Error ? error.message : String(error),
      };
      await this.events?.emit("verification.failed", {
        toolId: request.toolId,
        ...result,
        durationMs: Date.now() - started,
      });
      return result;
    }
  }
}

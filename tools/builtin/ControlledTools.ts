import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { Tool, ToolContext } from "../../core/contracts/types.js";

const MAX_TEXT_BYTES = 256 * 1024;
const WORKSPACE_ROOT = path.resolve(process.env.JARVIS_WORKSPACE || process.cwd());

function workspacePath(input: unknown): string {
  const candidate = String(input ?? "").trim();
  if (!candidate) throw new Error("A workspace-relative path is required.");
  if (path.isAbsolute(candidate)) throw new Error("Only workspace-relative paths are allowed.");
  const resolved = path.resolve(WORKSPACE_ROOT, candidate);
  if (resolved !== WORKSPACE_ROOT && !resolved.startsWith(`${WORKSPACE_ROOT}${path.sep}`)) {
    throw new Error("Path escapes the configured JARVIS workspace.");
  }
  return resolved;
}

export const openAppTool: Tool = {
  definition: {
    id: "system.open_app",
    name: "Open application",
    description: "Open one approved desktop application from the built-in allowlist.",
    authority: 2,
    risk: "low",
    argumentSchema: {
      type: "object",
      properties: { app: { type: "string", description: "Allowlisted application name." } },
      required: ["app"],
      additionalProperties: false,
    },
  },
  async execute(input, _context: ToolContext) {
    const requested = String(input.app ?? "").trim().toLowerCase();
    if (!requested) throw new Error("An application name is required.");

    const apps: Record<string, { windows: string; linux?: string; macos?: string }> = {
      notepad: { windows: "notepad.exe", linux: "gedit", macos: "TextEdit" },
      calculator: { windows: "calc.exe", linux: "gnome-calculator", macos: "Calculator" },
      calc: { windows: "calc.exe", linux: "gnome-calculator", macos: "Calculator" },
      paint: { windows: "mspaint.exe", linux: "pinta", macos: "Preview" },
      explorer: { windows: "explorer.exe", linux: "xdg-open", macos: "Finder" },
    };
    const target = apps[requested];
    if (!target) throw new Error(`Application is not on the JARVIS allowlist: ${requested}`);

    const command = process.platform === "win32" ? target.windows : process.platform === "darwin" ? target.macos : target.linux;
    if (!command) throw new Error(`Application is not supported on ${process.platform}.`);
    if (process.platform !== "win32" && !existsSync(command) && command !== "xdg-open") {
      throw new Error(`Approved application is unavailable: ${command}`);
    }

    const child = spawn(command, [], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    return { application: requested, command, launched: true };
  },
};

export const writeTextFileTool: Tool = {
  definition: {
    id: "filesystem.write_text",
    name: "Write text file",
    description: "Create or overwrite a UTF-8 text file inside the configured JARVIS workspace.",
    authority: 3,
    risk: "medium",
    argumentSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative target path." },
        content: { type: "string", description: "UTF-8 text to write." },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  async execute(input, _context: ToolContext) {
    const relativePath = String(input.path ?? "").trim();
    if (!relativePath) throw new Error("A workspace-relative file path is required.");
    const target = workspacePath(relativePath);
    const content = String(input.content ?? "");
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > MAX_TEXT_BYTES) throw new Error(`Text payload exceeds the ${MAX_TEXT_BYTES} byte safety limit.`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, { encoding: "utf8" });
    const sha256 = createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex");
    return { path: path.relative(WORKSPACE_ROOT, target), bytes, sha256, operation: "write" };
  },
};

export const deleteFileTool: Tool = {
  definition: {
    id: "filesystem.delete_file",
    name: "Delete file",
    description: "Delete one file inside the configured JARVIS workspace.",
    authority: 3,
    risk: "medium",
    argumentSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Workspace-relative target path." } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  async execute(input, _context: ToolContext) {
    const relativePath = String(input.path ?? "").trim();
    if (!relativePath) throw new Error("A workspace-relative file path is required.");
    const target = workspacePath(relativePath);
    await rm(target, { force: false, recursive: false });
    return { path: path.relative(WORKSPACE_ROOT, target), operation: "delete" };
  },
};

export const controlledTools: Tool[] = [openAppTool, writeTextFileTool, deleteFileTool];

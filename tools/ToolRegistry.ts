import type { Tool } from "../core/contracts/types.js";
import type { ToolRegistration } from "./types.js";

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    const id = tool.definition.id.trim();
    if (!id) throw new Error("Tool id cannot be empty");
    if (this.tools.has(id)) throw new Error(`Tool already registered: ${id}`);
    this.tools.set(id, tool);
  }

  registerMany(tools: Tool[]): void {
    for (const tool of tools) this.register(tool);
  }

  replace(tool: Tool): void {
    this.tools.set(tool.definition.id, tool);
  }

  get(id: string): Tool | undefined {
    return this.tools.get(id);
  }

  has(id: string): boolean {
    return this.tools.has(id);
  }

  list(): ToolRegistration[] {
    return [...this.tools.values()].map((implementation) => ({
      ...implementation.definition,
      implementation,
    }));
  }

  clear(): void {
    this.tools.clear();
  }
}

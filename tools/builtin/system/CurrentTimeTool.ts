import type { Tool, ToolContext } from "../../../core/contracts/types.js";

export class CurrentTimeTool implements Tool {
  readonly definition = {
    id: "system.currentTime",
    name: "Current Time",
    description: "Return the current local time and UTC time from the JARVIS runtime.",
    authority: 0 as const,
    risk: "low" as const,
  };

  async execute(_input: Record<string, unknown>, _context: ToolContext): Promise<{
    iso: string;
    local: string;
    utc: string;
    timezoneOffsetMinutes: number;
  }> {
    const now = new Date();
    return {
      iso: now.toISOString(),
      local: now.toString(),
      utc: now.toUTCString(),
      timezoneOffsetMinutes: now.getTimezoneOffset(),
    };
  }
}

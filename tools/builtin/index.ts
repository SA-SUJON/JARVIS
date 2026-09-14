export { SearchTool } from "./browser/SearchTool.js";
export { CurrentTimeTool } from "./system/CurrentTimeTool.js";

import type { Tool } from "../../core/contracts/types.js";
import { SearchTool } from "./browser/SearchTool.js";
import { CurrentTimeTool } from "./system/CurrentTimeTool.js";

export function createBuiltinTools(): Tool[] {
  return [new SearchTool(), new CurrentTimeTool()];
}

export { SearchTool } from "./browser/SearchTool.js";
export { CurrentTimeTool } from "./system/CurrentTimeTool.js";
export { controlledTools, deleteFileTool, openAppTool, readTextFileTool, writeTextFileTool } from "./ControlledTools.js";

import type { Tool } from "../../core/contracts/types.js";
import { SearchTool } from "./browser/SearchTool.js";
import { CurrentTimeTool } from "./system/CurrentTimeTool.js";
import { controlledTools } from "./ControlledTools.js";

export function createBuiltinTools(): Tool[] {
  return [new SearchTool(), new CurrentTimeTool(), ...controlledTools];
}

export { SearchTool } from "./browser/SearchTool.js";
export { youtubePlayTool } from "./browser/MediaTools.js";
export { CurrentTimeTool } from "./system/CurrentTimeTool.js";
export { controlledTools, deleteFileTool, openAppTool, readTextFileTool, writeTextFileTool } from "./ControlledTools.js";

import type { Tool } from "../../core/contracts/types.js";
import { SearchTool } from "./browser/SearchTool.js";
import { youtubePlayTool } from "./browser/MediaTools.js";
import { CurrentTimeTool } from "./system/CurrentTimeTool.js";
import { controlledTools } from "./ControlledTools.js";

export function createBuiltinTools(): Tool[] {
  return [new SearchTool(), youtubePlayTool, new CurrentTimeTool(), ...controlledTools];
}

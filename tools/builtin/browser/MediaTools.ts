import { spawn } from "node:child_process";
import type { Tool, ToolContext } from "../../../core/contracts/types.js";

interface SearchHit {
  title: string;
  url: string;
}

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function openUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Only HTTP(S) URLs can be opened.");
  }

  let command: string;
  let args: string[];
  if (process.platform === "win32") {
    command = "explorer.exe";
    args = [url];
  } else if (process.platform === "darwin") {
    command = "open";
    args = [url];
  } else {
    command = "xdg-open";
    args = [url];
  }

  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}

async function findYoutubeVideo(query: string): Promise<SearchHit> {
  const response = await fetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`site:youtube.com/watch ${query}`)}`,
    { headers: { "User-Agent": "JARVIS-MARK05/1.0" } },
  );

  if (!response.ok) throw new Error(`YouTube search failed: ${response.status} ${response.statusText}`);

  const html = await response.text();
  const pattern = /class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    let url = decodeHtml(match[1]);
    try {
      const parsed = new URL(url, "https://html.duckduckgo.com");
      url = parsed.searchParams.get("uddg") || url;
    } catch {
      continue;
    }

    if (!/^https?:\/\/(?:www\.)?youtube\.com\/watch\?/i.test(url)) continue;
    return { title: decodeHtml(match[2]), url };
  }

  throw new Error(`No YouTube video was found for: ${query}`);
}

export const youtubePlayTool: Tool = {
  definition: {
    id: "media.youtube_play",
    name: "Play YouTube media",
    description: "Find a requested YouTube video and open it in the default desktop browser.",
    authority: 1,
    risk: "low",
    argumentSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Song, video, or media title to play." } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  async execute(input, _context: ToolContext) {
    const query = typeof input.query === "string" ? input.query.trim() : "";
    if (!query) throw new Error("A YouTube search query is required.");
    if (query.length > 300) throw new Error("YouTube search query is too long.");

    const video = await findYoutubeVideo(query);
    openUrl(video.url);
    return { query, title: video.title, url: video.url, launched: true, operation: "youtube_play" };
  },
};

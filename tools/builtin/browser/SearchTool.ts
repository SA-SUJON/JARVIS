import type { Tool, ToolContext } from "../../../core/contracts/types.js";

interface SearchHit {
  title: string;
  url: string;
  snippet: string;
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

export class SearchTool implements Tool {
  readonly definition = {
    id: "browser.search",
    name: "Web Search",
    description: "Search the public web and return a small set of current search results.",
    authority: 1 as const,
    risk: "low" as const,
  };

  async execute(input: Record<string, unknown>, _context: ToolContext): Promise<SearchHit[]> {
    const query = typeof input.query === "string" ? input.query.trim() : "";
    if (!query) throw new Error("Search query is required");
    if (query.length > 500) throw new Error("Search query is too long");

    const response = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      { headers: { "User-Agent": "JARVIS-MARK05/1.0" } },
    );

    if (!response.ok) {
      throw new Error(`Search failed: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const hits: SearchHit[] = [];
    const pattern = /class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) && hits.length < 8) {
      let url = decodeHtml(match[1]);
      try {
        const parsed = new URL(url, "https://html.duckduckgo.com");
        url = parsed.searchParams.get("uddg") || url;
      } catch {
        continue;
      }

      if (!/^https?:\/\//i.test(url)) continue;

      const title = decodeHtml(match[2]);
      const body = html.slice(match.index, match.index + 2200);
      const snippetMatch = body.match(
        /class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i,
      );
      const snippet = decodeHtml(snippetMatch?.[1] || "");

      if (title && !hits.some((hit) => hit.url === url)) {
        hits.push({ title, url, snippet });
      }
    }

    return hits;
  }
}

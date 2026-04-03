import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Wikipedia API base
const WIKI_API = "https://en.wikipedia.org/w/api.php";

async function wikiSearch(
  query: string,
  limit = 5
): Promise<{ title: string; snippet: string; pageid: number }[]> {
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query,
    srlimit: String(limit),
    format: "json",
    origin: "*",
  });
  const res = await fetch(`${WIKI_API}?${params}`);
  const data = (await res.json()) as any;
  return (data.query?.search || []).map((r: any) => ({
    title: r.title,
    snippet: r.snippet.replace(/<[^>]*>/g, ""),
    pageid: r.pageid,
  }));
}

async function wikiGetPage(
  title: string
): Promise<{
  title: string;
  extract: string;
  pageid: number;
  description?: string;
}> {
  const params = new URLSearchParams({
    action: "query",
    titles: title,
    prop: "extracts|description",
    exintro: "1",
    explaintext: "1",
    format: "json",
    origin: "*",
  });
  const res = await fetch(`${WIKI_API}?${params}`);
  const data = (await res.json()) as any;
  const pages = data.query?.pages || {};
  const page = Object.values(pages)[0] as any;
  if (!page || page.missing !== undefined) {
    throw new Error(`Page "${title}" not found`);
  }
  return {
    title: page.title,
    extract: page.extract || "",
    pageid: page.pageid,
    description: page.description,
  };
}

async function wikiGetFullContent(title: string): Promise<string> {
  const params = new URLSearchParams({
    action: "query",
    titles: title,
    prop: "extracts",
    explaintext: "1",
    format: "json",
    origin: "*",
  });
  const res = await fetch(`${WIKI_API}?${params}`);
  const data = (await res.json()) as any;
  const pages = data.query?.pages || {};
  const page = Object.values(pages)[0] as any;
  if (!page || page.missing !== undefined) {
    throw new Error(`Page "${title}" not found`);
  }
  // Truncate to ~4000 chars to stay within reasonable token limits
  const content = page.extract || "";
  return content.length > 4000 ? content.slice(0, 4000) + "..." : content;
}

async function wikiGetRelated(
  title: string,
  limit = 5
): Promise<{ title: string }[]> {
  const params = new URLSearchParams({
    action: "query",
    titles: title,
    prop: "links",
    pllimit: String(limit),
    plnamespace: "0",
    format: "json",
    origin: "*",
  });
  const res = await fetch(`${WIKI_API}?${params}`);
  const data = (await res.json()) as any;
  const pages = data.query?.pages || {};
  const page = Object.values(pages)[0] as any;
  return (page?.links || []).map((l: any) => ({ title: l.title }));
}

// ─── MCP Server ────────────────────────────────────────────────────

export class GrokipediaMCP extends McpAgent {
  server = new McpServer({
    name: "grokipedia",
    version: "1.0.0",
  });

  async init() {
    this.server.tool(
      "search",
      "Search Grokipedia articles by keyword",
      { query: z.string().describe("Search query"), limit: z.number().optional().describe("Max results (default 5)") },
      async ({ query, limit }) => {
        const results = await wikiSearch(query, limit || 5);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      }
    );

    this.server.tool(
      "get_page",
      "Get a Grokipedia page overview (metadata and content preview)",
      { title: z.string().describe("Article title") },
      async ({ title }) => {
        const page = await wikiGetPage(title);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(page, null, 2),
            },
          ],
        };
      }
    );

    this.server.tool(
      "get_page_content",
      "Get the full article content from Grokipedia",
      { title: z.string().describe("Article title") },
      async ({ title }) => {
        const content = await wikiGetFullContent(title);
        return {
          content: [
            {
              type: "text" as const,
              text: content,
            },
          ],
        };
      }
    );

    this.server.tool(
      "get_related_pages",
      "Get related/linked pages from a Grokipedia article",
      {
        title: z.string().describe("Article title"),
        limit: z.number().optional().describe("Max results (default 5)"),
      },
      async ({ title, limit }) => {
        const related = await wikiGetRelated(title, limit || 5);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(related, null, 2),
            },
          ],
        };
      }
    );
  }
}

export default {
  fetch(request: Request, env: any, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      return GrokipediaMCP.serveSSE("/sse").fetch(request, env, ctx);
    }

    if (url.pathname === "/mcp" || url.pathname === "/mcp/message") {
      return GrokipediaMCP.serve("/mcp").fetch(request, env, ctx);
    }

    // Health check
    if (url.pathname === "/") {
      return new Response(
        JSON.stringify({ name: "grokipedia-mcp", status: "ok" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response("Not Found", { status: 404 });
  },
};

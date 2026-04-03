import { eq, and } from "drizzle-orm";
import { db, schema } from "../../db";
import { decrypt } from "../../db/crypto";
import type {
  PluginAdapter,
  ToolSchema,
  ToolResult,
  AppRegistration,
} from "../adapter";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

export class NotionAdapter implements PluginAdapter {
  type = "rest" as const;
  appId: string;
  appName: string;
  private toolSchemas: ToolSchema[] = [];

  constructor(appId: string, appName: string) {
    this.appId = appId;
    this.appName = appName;
  }

  async initialize(config: AppRegistration): Promise<void> {
    const cfg = config.config as { tools?: ToolSchema[] };
    this.toolSchemas = cfg.tools || [];
  }

  async getTools(): Promise<ToolSchema[]> {
    return this.toolSchemas;
  }

  /**
   * Resolve the Notion API key for a given user.
   * Priority: user's OAuth token from DB > global NOTION_API_KEY env var.
   */
  async getApiKey(userId?: string): Promise<string> {
    if (userId) {
      try {
        const [token] = await db
          .select()
          .from(schema.userAppTokens)
          .where(
            and(
              eq(schema.userAppTokens.userId, userId),
              eq(schema.userAppTokens.appId, this.appId)
            )
          );

        if (token) {
          return decrypt(token.accessToken);
        }
      } catch (e) {
        console.error("[notion] Failed to retrieve user token:", e);
      }
    }

    // Fallback to global env var
    return process.env.NOTION_API_KEY || "";
  }

  async invokeTool(
    name: string,
    params: Record<string, unknown>,
    userId?: string
  ): Promise<ToolResult> {
    const apiKey = await this.getApiKey(userId);

    if (!apiKey) {
      return {
        error:
          "Notion is not connected. Please set NOTION_API_KEY or connect via OAuth.",
        auth_required: true,
      };
    }

    switch (name) {
      case "search_pages":
        return this.searchPages(apiKey, params.query as string);
      case "create_page":
        return this.createPage(
          apiKey,
          params.title as string,
          params.content as string
        );
      case "append_to_page":
        return this.appendToPage(
          apiKey,
          params.pageId as string,
          params.content as string
        );
      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  async shutdown(): Promise<void> {}

  // ─── Notion API Methods ──────────────────────────────────────────

  private async notionFetch(
    apiKey: string,
    path: string,
    options: RequestInit = {}
  ) {
    return fetch(`${NOTION_API}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  }

  private async searchPages(
    apiKey: string,
    query: string
  ): Promise<ToolResult> {
    const res = await this.notionFetch(apiKey, "/search", {
      method: "POST",
      body: JSON.stringify({
        query,
        filter: { value: "page", property: "object" },
        page_size: 5,
      }),
    });
    if (!res.ok) {
      return { error: `Notion API error: ${res.status} ${await res.text()}` };
    }
    const data = (await res.json()) as any;
    const pages = (data.results || []).map((p: any) => ({
      id: p.id,
      title:
        p.properties?.title?.title?.[0]?.plain_text ||
        p.properties?.Name?.title?.[0]?.plain_text ||
        "Untitled",
      url: p.url,
      lastEdited: p.last_edited_time,
    }));
    return { pages, count: pages.length };
  }

  private async createPage(
    apiKey: string,
    title: string,
    content: string
  ): Promise<ToolResult> {
    // Create page in the first available workspace page as parent
    // For a proper implementation, we'd let the user select a parent
    const searchRes = await this.notionFetch(apiKey, "/search", {
      method: "POST",
      body: JSON.stringify({
        filter: { value: "page", property: "object" },
        page_size: 1,
      }),
    });

    let parentId: string | null = null;
    if (searchRes.ok) {
      const searchData = (await searchRes.json()) as any;
      if (searchData.results?.length > 0) {
        parentId = searchData.results[0].id;
      }
    }

    // Convert markdown content to Notion blocks (simple paragraph conversion)
    const blocks = content.split("\n\n").map((paragraph) => ({
      object: "block" as const,
      type: "paragraph" as const,
      paragraph: {
        rich_text: [
          {
            type: "text" as const,
            text: { content: paragraph },
          },
        ],
      },
    }));

    const body: any = {
      properties: {
        title: {
          title: [{ type: "text", text: { content: title } }],
        },
      },
      children: blocks.slice(0, 100), // Notion limit
    };

    if (parentId) {
      body.parent = { page_id: parentId };
    } else {
      // Fallback: create in workspace root (requires workspace-level integration)
      body.parent = { type: "workspace", workspace: true };
    }

    const res = await this.notionFetch(apiKey, "/pages", {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { error: `Failed to create page: ${res.status} ${errText}` };
    }

    const page = (await res.json()) as any;
    return {
      pageId: page.id,
      url: page.url,
      title,
      message: `Page "${title}" created successfully.`,
    };
  }

  private async appendToPage(
    apiKey: string,
    pageId: string,
    content: string
  ): Promise<ToolResult> {
    const blocks = content.split("\n\n").map((paragraph) => ({
      object: "block" as const,
      type: "paragraph" as const,
      paragraph: {
        rich_text: [
          {
            type: "text" as const,
            text: { content: paragraph },
          },
        ],
      },
    }));

    const res = await this.notionFetch(
      apiKey,
      `/blocks/${pageId}/children`,
      {
        method: "PATCH",
        body: JSON.stringify({ children: blocks }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      return { error: `Failed to append: ${res.status} ${errText}` };
    }

    return {
      pageId,
      message: "Content appended successfully.",
      blocksAdded: blocks.length,
    };
  }
}

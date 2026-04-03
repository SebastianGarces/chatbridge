import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type {
  PluginAdapter,
  ToolSchema,
  ToolResult,
  AppRegistration,
} from "./adapter";

export class MCPAdapter implements PluginAdapter {
  type = "mcp" as const;
  appId: string;
  appName: string;
  private client: Client | null = null;
  private mcpUrl: string = "";

  constructor(appId: string, appName: string) {
    this.appId = appId;
    this.appName = appName;
  }

  async initialize(config: AppRegistration): Promise<void> {
    const cfg = config.config as { url?: string; sseUrl?: string };
    this.mcpUrl = cfg.sseUrl || cfg.url || "";

    if (!this.mcpUrl) {
      throw new Error(`MCP adapter for ${config.name}: no URL configured`);
    }

    this.client = new Client({
      name: `chatbridge-${config.name}`,
      version: "1.0.0",
    });

    const transport = new SSEClientTransport(new URL(this.mcpUrl));
    // Timeout connection after 5 seconds
    await Promise.race([
      this.client.connect(transport),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`MCP connection timeout for ${config.name}`)), 5000)
      ),
    ]);
  }

  async getTools(): Promise<ToolSchema[]> {
    if (!this.client) throw new Error("MCP client not initialized");

    const result = await this.client.listTools();
    return (result.tools || []).map((t) => ({
      name: t.name,
      description: t.description || "",
      parameters: (t.inputSchema as Record<string, unknown>) || {
        type: "object",
        properties: {},
      },
    }));
  }

  async invokeTool(
    name: string,
    params: Record<string, unknown>
  ): Promise<ToolResult> {
    if (!this.client) throw new Error("MCP client not initialized");

    const result = await this.client.callTool({ name, arguments: params });
    // Extract text content from MCP response
    const textContent = (result.content as any[])
      ?.filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");

    try {
      return JSON.parse(textContent);
    } catch {
      return { text: textContent };
    }
  }

  async shutdown(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }
}

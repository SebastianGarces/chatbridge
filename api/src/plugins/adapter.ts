// Plugin adapter interface — all app integrations implement this

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolResult {
  [key: string]: unknown;
}

export interface AppRegistration {
  id: string;
  name: string;
  description: string | null;
  type: "iframe" | "mcp" | "rest";
  authType: "none" | "api_key" | "oauth2";
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface PluginAdapter {
  type: "iframe" | "mcp" | "rest";
  appId: string;
  appName: string;
  getTools(): Promise<ToolSchema[]>;
  invokeTool(
    name: string,
    params: Record<string, unknown>,
    userId?: string
  ): Promise<ToolResult>;
  initialize(config: AppRegistration): Promise<void>;
  shutdown(): Promise<void>;
}

// ChatBridge postMessage protocol types

// ─── Platform → App ────────────────────────────────────────────────

export interface AppInitMessage {
  type: "app:init";
  sessionId: string;
  config: Record<string, unknown>;
}

export interface ToolInvokeMessage {
  type: "tool:invoke";
  id: string;
  tool: string;
  params: Record<string, unknown>;
}

export interface AppDestroyMessage {
  type: "app:destroy";
}

export type PlatformToAppMessage =
  | AppInitMessage
  | ToolInvokeMessage
  | AppDestroyMessage;

// ─── App → Platform ────────────────────────────────────────────────

export interface AppReadyMessage {
  type: "app:ready";
}

export interface ToolResultMessage {
  type: "tool:result";
  id: string;
  result: unknown;
}

export interface StateUpdateMessage {
  type: "state:update";
  state: Record<string, unknown>;
}

export interface AppCompleteMessage {
  type: "app:complete";
  summary: string;
}

export interface AppErrorMessage {
  type: "app:error";
  error: string;
}

export interface UIResizeMessage {
  type: "ui:resize";
  height: number;
}

export interface HeartbeatMessage {
  type: "heartbeat";
}

export type AppToPlatformMessage =
  | AppReadyMessage
  | ToolResultMessage
  | StateUpdateMessage
  | AppCompleteMessage
  | AppErrorMessage
  | UIResizeMessage
  | HeartbeatMessage;

// ─── Combined ──────────────────────────────────────────────────────

export type ChatBridgeMessage = PlatformToAppMessage | AppToPlatformMessage;

export function isChatBridgeMessage(data: unknown): data is ChatBridgeMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    typeof (data as any).type === "string"
  );
}

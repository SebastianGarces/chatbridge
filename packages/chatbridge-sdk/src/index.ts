/**
 * ChatBridge SDK — lightweight SDK for iframe apps to communicate with the ChatBridge platform.
 *
 * Usage:
 *   const app = ChatBridgeApp.init();
 *   app.onToolInvoke('start_game', (params) => { return { board: '...' }; });
 *   app.updateState({ fen: '...', turn: 'white' });
 *   app.complete('Game over!');
 */

type ToolHandler = (params: Record<string, unknown>) => unknown | Promise<unknown>;

export class ChatBridgeApp {
  private handlers = new Map<string, ToolHandler>();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private parentOrigin: string = "*";
  private ready = false;

  private constructor() {
    window.addEventListener("message", this.handleMessage.bind(this));
    this.startHeartbeat();
  }

  static init(): ChatBridgeApp {
    const app = new ChatBridgeApp();
    // Announce ready to platform
    window.parent.postMessage({ type: "app:ready" }, "*");
    app.ready = true;
    return app;
  }

  onToolInvoke(toolName: string, handler: ToolHandler): void {
    this.handlers.set(toolName, handler);
  }

  updateState(state: Record<string, unknown>): void {
    window.parent.postMessage({ type: "state:update", state }, this.parentOrigin);
  }

  complete(summary: string): void {
    window.parent.postMessage({ type: "app:complete", summary }, this.parentOrigin);
  }

  error(message: string): void {
    window.parent.postMessage({ type: "app:error", error: message }, this.parentOrigin);
  }

  destroy(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    window.removeEventListener("message", this.handleMessage.bind(this));
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    const data = event.data;
    if (!data || typeof data !== "object" || !data.type) return;

    // Track parent origin from init message
    if (data.type === "app:init") {
      this.parentOrigin = event.origin;
      return;
    }

    if (data.type === "tool:invoke") {
      const { id, tool, params } = data;
      const handler = this.handlers.get(tool);
      if (!handler) {
        window.parent.postMessage(
          {
            type: "tool:result",
            id,
            result: { error: `No handler registered for tool: ${tool}` },
          },
          this.parentOrigin
        );
        return;
      }
      try {
        const result = await handler(params || {});
        window.parent.postMessage(
          { type: "tool:result", id, result },
          this.parentOrigin
        );
      } catch (e: any) {
        window.parent.postMessage(
          {
            type: "tool:result",
            id,
            result: { error: e.message || String(e) },
          },
          this.parentOrigin
        );
      }
    }

    if (data.type === "app:destroy") {
      this.destroy();
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      window.parent.postMessage({ type: "heartbeat" }, this.parentOrigin);
    }, 5000);
  }
}

export default ChatBridgeApp;

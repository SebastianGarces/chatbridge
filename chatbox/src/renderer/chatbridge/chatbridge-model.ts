import type { ModelMessage, TextStreamPart, ToolSet } from "ai";
import type {
  CallChatCompletionOptions,
  ChatStreamOptions,
  ModelInterface,
  ModelStreamPart,
} from "@shared/models/types";
import type {
  MessageContentParts,
  MessageTextPart,
  MessageToolCallPart,
  StreamTextResult,
} from "@shared/types";
import { getApiBase } from "./api-client";
import { useAppContextStore } from "./app-context-store";

/**
 * ChatBridge model that proxies all LLM calls through our Elysia backend.
 * Uses the AI SDK data stream protocol for SSE communication.
 */
export class ChatBridgeModel implements ModelInterface {
  public name = "ChatBridge AI";
  public modelId = "chatbridge-default";

  private conversationId: string | null = null;

  public isSupportVision() {
    return false;
  }
  public isSupportToolUse() {
    return true;
  }
  public isSupportSystemMessage() {
    return true;
  }

  public setConversationId(id: string | null) {
    this.conversationId = id;
  }

  public getConversationId() {
    return this.conversationId;
  }

  public async chat(
    messages: ModelMessage[],
    options: CallChatCompletionOptions
  ): Promise<StreamTextResult> {
    const contentParts: MessageContentParts = [];
    let currentTextPart: MessageTextPart | null = null;

    // Convert ModelMessage[] to simple format for our backend
    const simpleMessages = messages
      .filter((m) => {
        const role = (m as any).role;
        return role === "user" || role === "assistant";
      })
      .map((m) => ({
        role: (m as any).role as string,
        content: extractTextContent(m),
      }));

    // Include active app context (e.g. chess board FEN) so server can sync state
    const appContext = useAppContextStore.getState().getContexts();

    const response = await fetch(`${getApiBase()}/api/chat/stream`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: this.conversationId,
        messages: simpleMessages,
        appContext: Object.keys(appContext).length > 0 ? appContext : undefined,
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Chat request failed: ${response.status} ${errText}`);
    }

    // Capture conversation ID from response header
    const newConvoId = response.headers.get("X-Conversation-Id");
    if (newConvoId) {
      this.conversationId = newConvoId;
      // Store for side panel apps (chess) that call the API directly
      try { sessionStorage.setItem("chatbridge-conversation-id", newConvoId); } catch {}
    }

    // Parse the AI SDK data stream format
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;

          // AI SDK data stream format: TYPE_CODE:JSON_DATA
          const colonIdx = line.indexOf(":");
          if (colonIdx === -1) continue;

          const typeCode = line.slice(0, colonIdx);
          const data = line.slice(colonIdx + 1);

          switch (typeCode) {
            case "0": {
              // Text delta
              const text = JSON.parse(data) as string;
              if (!currentTextPart) {
                currentTextPart = { type: "text", text: "" };
                contentParts.push(currentTextPart);
              }
              currentTextPart.text += text;
              options.onResultChange?.({ contentParts: [...contentParts] });
              break;
            }
            case "9": {
              // Tool call
              const toolCall = JSON.parse(data);
              currentTextPart = null;
              const toolCallPart: MessageToolCallPart = {
                type: "tool-call",
                state: "call",
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                args: toolCall.args,
              };
              contentParts.push(toolCallPart);
              options.onResultChange?.({ contentParts: [...contentParts] });
              break;
            }
            case "a": {
              // Tool result
              const toolResult = JSON.parse(data);
              const existingPart = contentParts.find(
                (p) =>
                  p.type === "tool-call" &&
                  (p as MessageToolCallPart).toolCallId ===
                    toolResult.toolCallId
              ) as MessageToolCallPart | undefined;
              if (existingPart) {
                existingPart.state = "result";
                existingPart.result = toolResult.result;
              }
              options.onResultChange?.({ contentParts: [...contentParts] });
              break;
            }
            case "e": {
              // Finish with usage
              const finish = JSON.parse(data);
              break;
            }
            case "d": {
              // Done
              break;
            }
            // Ignore other types (2=data, 3/g=error, etc.)
          }
        }
      }
    } catch (e: any) {
      if (e.name === "AbortError") {
        // Cancellation — return what we have
      } else {
        throw e;
      }
    }

    return { contentParts };
  }

  public async *chatStream(
    messages: ModelMessage[],
    options: ChatStreamOptions
  ): AsyncGenerator<ModelStreamPart> {
    // Not used — chat() handles everything
    throw new Error("chatStream not implemented — use chat()");
  }

  public async paint(): Promise<string[]> {
    throw new Error("Image generation not supported");
  }
}

function extractTextContent(message: ModelMessage): string {
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter((p: any) => p.type === "text")
      .map((p: any) => p.text)
      .join("");
  }
  return "";
}

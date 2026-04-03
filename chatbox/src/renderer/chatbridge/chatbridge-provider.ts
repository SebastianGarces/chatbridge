import { defineProvider } from "@shared/providers/registry";
import { ModelProviderType } from "@shared/types/provider";
import { ChatBridgeModel } from "./chatbridge-model";

defineProvider({
  id: "chatbridge",
  name: "ChatBridge",
  type: ModelProviderType.OpenAI,
  description: "ChatBridge AI — routes through the ChatBridge backend",
  defaultSettings: {
    apiHost:
      typeof window !== "undefined" &&
      !["1212", "5173"].includes(window.location.port)
        ? window.location.origin
        : "http://localhost:3001",
    models: [
      {
        modelId: "chatbridge-default",
        nickname: "ChatBridge AI",
        capabilities: ["tool_use"],
      },
    ],
  },
  createModel: () => {
    return new ChatBridgeModel();
  },
});

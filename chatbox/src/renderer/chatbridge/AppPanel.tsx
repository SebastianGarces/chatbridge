import { ActionIcon, Box, Group, Loader, Text } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState, type FC } from "react";
import { useAppPanelStore } from "./app-panel-store";
import { useAppContextStore } from "./app-context-store";
import { getApiBase } from "./api-client";

interface AiMoveResult {
  move: string | null;
  commentary: string;
}

async function requestAiChessMove(
  conversationId: string | null,
  userMoveText: string,
  appContext: Record<string, Record<string, unknown>>
): Promise<AiMoveResult> {
  const messages = [{ role: "user", content: userMoveText }];

  try {
    const response = await fetch(`${getApiBase()}/api/chat/stream`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId,
        messages,
        appContext: Object.keys(appContext).length > 0 ? appContext : undefined,
      }),
    });

    if (!response.ok) return { move: null, commentary: "" };

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let aiMove: string | null = null;
    let commentary = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const colonIdx = line.indexOf(":");
        if (colonIdx === -1) continue;

        const typeCode = line.slice(0, colonIdx);
        const data = line.slice(colonIdx + 1);

        if (typeCode === "0") {
          try { commentary += JSON.parse(data); } catch { /* ignore */ }
        } else if (typeCode === "9") {
          try {
            const toolCall = JSON.parse(data);
            if (toolCall.toolName === "chess_make_move" && toolCall.args?.move) {
              aiMove = toolCall.args.move;
            }
          } catch { /* ignore */ }
        }
      }
    }

    return { move: aiMove, commentary };
  } catch {
    return { move: null, commentary: "" };
  }
}

const AppPanel: FC = () => {
  const activeApp = useAppPanelStore((s) => s.activeApp);
  const closeApp = useAppPanelStore((s) => s.closeApp);
  const setPendingChatMessages = useAppPanelStore((s) => s.setPendingChatMessages);
  const updateContext = useAppContextStore((s) => s.updateContext);
  const getContexts = useAppContextStore((s) => s.getContexts);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastMoveRef = useRef<string>("");
  const requestingAiMoveRef = useRef(false);
  const conversationIdRef = useRef<string | null>(null);
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const iframeReadyRef = useRef(false);

  useEffect(() => {
    const stored = sessionStorage.getItem("chatbridge-conversation-id");
    if (stored) conversationIdRef.current = stored;
    iframeReadyRef.current = false; // Reset when app changes
  }, [activeApp]);

  // Forward queued tool invocations to the iframe as they arrive
  const pendingToolCount = useAppPanelStore((s) => s.pendingToolInvocations.length);
  useEffect(() => {
    if (!iframeReadyRef.current || pendingToolCount === 0) return;
    const pending = useAppPanelStore.getState().clearPendingToolInvocations();
    console.debug("[app-panel] Forwarding tool invocations to iframe:", pending.map(p => p.toolName));
    for (const inv of pending) {
      iframeRef.current?.contentWindow?.postMessage(
        { type: "tool:invoke", id: inv.toolCallId, tool: inv.toolName, params: inv.params },
        "*"
      );
    }
  }, [pendingToolCount]);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== "object" || !data.type || !activeApp) return;

      switch (data.type) {
        case "app:ready":
          iframeRef.current?.contentWindow?.postMessage(
            { type: "app:init", sessionId: activeApp.toolCallId, config: { appId: activeApp.appId, appName: activeApp.appName } },
            "*"
          );
          // Restore last known state so the app can recover after iframe reload
          {
            const ctx = getContexts()[activeApp.appId];
            if (ctx) {
              iframeRef.current?.contentWindow?.postMessage(
                { type: "state:restore", state: ctx },
                "*"
              );
            }
          }
          iframeReadyRef.current = true;
          // Drain any pending tool invocations and forward to iframe
          {
            const pending = useAppPanelStore.getState().clearPendingToolInvocations();
            console.debug("[app-panel] app:ready, draining queue:", pending.map(p => p.toolName));
            for (const inv of pending) {
              iframeRef.current?.contentWindow?.postMessage(
                { type: "tool:invoke", id: inv.toolCallId, tool: inv.toolName, params: inv.params },
                "*"
              );
            }
          }
          break;

        case "state:update":
          if (data.state) updateContext(activeApp.appId, data.state);

          if (data.state?.moveHistory) {
            const moves = data.state.moveHistory as string[];
            const lastMove = moves[moves.length - 1];
            const isUserMove = moves.length % 2 === 1;
            const isNewMove = lastMove && lastMove !== lastMoveRef.current;

            if (lastMove && isNewMove && isUserMove && !requestingAiMoveRef.current) {
              lastMoveRef.current = lastMove;
              requestingAiMoveRef.current = true;
              setAiStatus("AI is thinking...");

              const storedId = sessionStorage.getItem("chatbridge-conversation-id");
              if (storedId) conversationIdRef.current = storedId;

              const userText = `I played ${lastMove}.`;
              const appContext = getContexts();

              requestAiChessMove(
                conversationIdRef.current,
                `${userText} Your turn! Make your move using the make_move tool.`,
                appContext
              )
                .then(({ move, commentary }) => {
                  // Relay move to the board
                  if (move && iframeRef.current?.contentWindow) {
                    iframeRef.current.contentWindow.postMessage(
                      { type: "tool:invoke", id: `ai-move-${Date.now()}`, tool: "make_move", params: { move } },
                      "*"
                    );
                  }
                  // Push commentary to the main chat
                  if (commentary) {
                    setPendingChatMessages({
                      userText: `[Chess] ${userText}`,
                      assistantText: commentary,
                    });
                  }
                  setAiStatus(null);
                })
                .finally(() => {
                  requestingAiMoveRef.current = false;
                });
            }
          }
          break;

        case "tool:result":
          break;
        case "app:complete":
          break;
      }
    },
    [activeApp, updateContext, getContexts, setPendingChatMessages]
  );

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  if (!activeApp) return null;

  return (
    <Box
      style={{
        width: 420, minWidth: 420, height: "100%",
        borderLeft: "1px solid var(--chatbox-border-primary, #e0e0e0)",
        display: "flex", flexDirection: "column",
        background: "var(--chatbox-background-primary)",
      }}
    >
      <Group
        justify="space-between" px="sm" py="xs"
        style={{ borderBottom: "1px solid var(--chatbox-border-primary, #e0e0e0)" }}
      >
        <Text size="sm" fw={600}>{activeApp.appName}</Text>
        <ActionIcon size="sm" variant="subtle" onClick={closeApp}>
          <IconX size={14} />
        </ActionIcon>
      </Group>

      {aiStatus && (
        <Group px="sm" py={4} gap={6} style={{ background: "var(--chatbox-background-secondary, #f5f5f5)" }}>
          <Loader size={12} />
          <Text size="xs" c="dimmed">{aiStatus}</Text>
        </Group>
      )}

      <Box style={{ flex: 1, overflow: "hidden" }}>
        <iframe
          ref={iframeRef}
          src={activeApp.appUrl}
          sandbox="allow-scripts allow-same-origin allow-forms"
          style={{ width: "100%", height: "100%", border: "none" }}
          title={activeApp.appName}
        />
      </Box>
    </Box>
  );
};

export default AppPanel;

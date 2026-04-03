import { Box, Center, Loader, Text, ActionIcon, Stack } from "@mantine/core";
import { IconRefresh, IconAlertTriangle } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState, type FC } from "react";

interface IframeBridgeProps {
  appUrl: string;
  appId: string;
  appName: string;
  toolName: string;
  toolCallId: string;
  params: Record<string, unknown>;
  onToolResult: (result: unknown) => void;
  onStateUpdate?: (state: Record<string, unknown>) => void;
  onComplete?: (summary: string) => void;
}

type Status = "loading" | "ready" | "invoking" | "done" | "error" | "unresponsive";

const IframeBridge: FC<IframeBridgeProps> = ({
  appUrl,
  appId,
  appName,
  toolName,
  toolCallId,
  params,
  onToolResult,
  onStateUpdate,
  onComplete,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [height, setHeight] = useState(550);
  const lastHeartbeat = useRef(Date.now());
  const heartbeatCheck = useRef<ReturnType<typeof setInterval>>();

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== "object" || !data.type) return;

      // Only accept messages from our iframe's origin
      const iframeOrigin = new URL(appUrl).origin;
      if (event.origin !== iframeOrigin) return;

      switch (data.type) {
        case "app:ready":
          setStatus("ready");
          lastHeartbeat.current = Date.now();
          // Send init message
          iframeRef.current?.contentWindow?.postMessage(
            {
              type: "app:init",
              sessionId: toolCallId,
              config: { appId, appName },
            },
            iframeOrigin
          );
          // Now invoke the tool
          iframeRef.current?.contentWindow?.postMessage(
            {
              type: "tool:invoke",
              id: toolCallId,
              tool: toolName,
              params,
            },
            iframeOrigin
          );
          setStatus("invoking");
          break;

        case "tool:result":
          if (data.id === toolCallId) {
            onToolResult(data.result);
            setStatus("done");
          }
          break;

        case "state:update":
          lastHeartbeat.current = Date.now();
          onStateUpdate?.(data.state);
          break;

        case "app:complete":
          onComplete?.(data.summary);
          break;

        case "app:error":
          setStatus("error");
          onToolResult({ error: data.error });
          break;

        case "ui:resize":
          if (typeof data.height === "number" && data.height > 0) {
            setHeight(Math.min(data.height, 1200));
          }
          break;

        case "heartbeat":
          lastHeartbeat.current = Date.now();
          if (status === "unresponsive") {
            setStatus("done");
          }
          break;
      }
    },
    [appUrl, appId, appName, toolName, toolCallId, params, onToolResult, onStateUpdate, onComplete, status]
  );

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  // Heartbeat monitoring
  useEffect(() => {
    heartbeatCheck.current = setInterval(() => {
      if (Date.now() - lastHeartbeat.current > 15000 && status === "invoking") {
        setStatus("unresponsive");
      }
    }, 5000);
    return () => {
      if (heartbeatCheck.current) clearInterval(heartbeatCheck.current);
    };
  }, [status]);

  const retry = () => {
    setStatus("loading");
    if (iframeRef.current) {
      iframeRef.current.src = appUrl;
    }
  };

  return (
    <Box
      style={{
        border: "1px solid var(--chatbox-border-primary, #e0e0e0)",
        borderRadius: 8,
        overflow: "hidden",
        position: "relative",
      }}
    >
      {(status === "loading") && (
        <Center
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1,
            background: "var(--chatbox-background-primary, white)",
          }}
        >
          <Stack align="center" gap="xs">
            <Loader size="sm" />
            <Text size="xs" c="dimmed">Loading {appName}...</Text>
          </Stack>
        </Center>
      )}

      {status === "error" && (
        <Center
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1,
            background: "var(--chatbox-background-primary, white)",
          }}
        >
          <Stack align="center" gap="xs">
            <IconAlertTriangle size={24} color="var(--chatbox-tint-error, red)" />
            <Text size="xs" c="red">App failed to respond</Text>
            <ActionIcon size="sm" variant="light" onClick={retry}>
              <IconRefresh size={14} />
            </ActionIcon>
          </Stack>
        </Center>
      )}

      {status === "unresponsive" && (
        <Center
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 1,
            padding: 4,
            background: "rgba(255, 200, 0, 0.15)",
          }}
        >
          <Text size="xs" c="yellow.8">App not responding</Text>
        </Center>
      )}

      <iframe
        ref={iframeRef}
        src={appUrl}
        sandbox="allow-scripts allow-same-origin allow-forms"
        style={{
          width: "100%",
          height,
          border: "none",
          display: "block",
        }}
        onError={() => setStatus("error")}
        title={appName}
      />
    </Box>
  );
};

export default IframeBridge;

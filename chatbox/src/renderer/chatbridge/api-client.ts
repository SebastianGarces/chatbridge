// In production the frontend is served from the same origin as the API
const DEV_PORTS = ["1212", "5173"];
const isDevServer =
  typeof window !== "undefined" && DEV_PORTS.includes(window.location.port);
const API_BASE = isDevServer ? "http://localhost:3001" : "";

export function getApiBase() {
  return API_BASE;
}

export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${API_BASE}${path}`;
  return fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

// Notion OAuth helpers
export async function getNotionStatus(): Promise<{
  connected: boolean;
  method: "oauth" | "api_key" | "none";
  workspaceName?: string;
}> {
  const res = await apiFetch("/api/apps/notion/oauth/status");
  if (!res.ok) return { connected: false, method: "none" };
  return res.json();
}

export async function getNotionConnectUrl(): Promise<{ authUrl: string } | null> {
  const res = await apiFetch("/api/apps/notion/oauth/connect");
  if (!res.ok) return null;
  return res.json();
}

export async function disconnectNotion(): Promise<boolean> {
  const res = await apiFetch("/api/apps/notion/oauth/disconnect", {
    method: "POST",
  });
  return res.ok;
}

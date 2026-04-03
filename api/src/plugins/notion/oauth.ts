import { Elysia } from "elysia";
import { randomBytes } from "crypto";
import { eq, and } from "drizzle-orm";
import { getSessionUser } from "../../chat/middleware";
import { db, schema } from "../../db";
import { encrypt } from "../../db/crypto";

// Notion OAuth configuration
const NOTION_CLIENT_ID = process.env.NOTION_CLIENT_ID || "";
const NOTION_CLIENT_SECRET = process.env.NOTION_CLIENT_SECRET || "";
const NOTION_REDIRECT_URI = `${process.env.BETTER_AUTH_URL || "http://localhost:3001"}/api/apps/notion/oauth/callback`;

// In-memory state store for CSRF protection
// Maps state -> { userId, timestamp }
const pendingStates = new Map<string, { userId: string; timestamp: number }>();
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Clean up expired states periodically
function cleanupStates() {
  const now = Date.now();
  for (const [state, { timestamp }] of pendingStates) {
    if (now - timestamp > STATE_TTL_MS) {
      pendingStates.delete(state);
    }
  }
}

export const notionOAuthRoutes = new Elysia({ prefix: "/api/apps/notion/oauth" })
  // Get OAuth status
  .get("/status", async ({ request }) => {
    const user = await getSessionUser(request);
    if (!user) return new Response("Unauthorized", { status: 401 });

    // Look up Notion app registration
    const [notionApp] = await db
      .select()
      .from(schema.appRegistrations)
      .where(eq(schema.appRegistrations.name, "notion"));

    if (notionApp) {
      // Check if user has an OAuth token stored
      const [token] = await db
        .select()
        .from(schema.userAppTokens)
        .where(
          and(
            eq(schema.userAppTokens.userId, user.id),
            eq(schema.userAppTokens.appId, notionApp.id)
          )
        );

      if (token) {
        const meta = token.metadata as { workspaceName?: string } | null;
        return {
          connected: true,
          method: "oauth" as const,
          workspaceName: meta?.workspaceName,
        };
      }
    }

    // Fallback: check if global API key is set
    const hasApiKey = !!process.env.NOTION_API_KEY;
    return {
      connected: hasApiKey,
      method: hasApiKey ? ("api_key" as const) : ("none" as const),
    };
  })

  // Start OAuth flow
  .get("/connect", async ({ request }) => {
    const user = await getSessionUser(request);
    if (!user) return new Response("Unauthorized", { status: 401 });

    if (!NOTION_CLIENT_ID) {
      return new Response(
        JSON.stringify({
          error: "Notion OAuth not configured. Using API key mode.",
        }),
        { status: 501, headers: { "Content-Type": "application/json" } }
      );
    }

    // Generate random state for CSRF protection
    const state = randomBytes(32).toString("hex");
    pendingStates.set(state, { userId: user.id, timestamp: Date.now() });

    // Clean up old states
    cleanupStates();

    const authUrl =
      `https://api.notion.com/v1/oauth/authorize` +
      `?client_id=${NOTION_CLIENT_ID}` +
      `&response_type=code` +
      `&owner=user` +
      `&state=${state}` +
      `&redirect_uri=${encodeURIComponent(NOTION_REDIRECT_URI)}`;

    return { authUrl };
  })

  // OAuth callback
  .get("/callback", async ({ request, query }) => {
    const { code, state } = query as { code?: string; state?: string };

    if (!code) {
      return new Response("Missing code parameter", { status: 400 });
    }
    if (!state) {
      return new Response("Missing state parameter", { status: 400 });
    }

    // Validate state and retrieve userId
    const pending = pendingStates.get(state);
    if (!pending) {
      return new Response("Invalid or expired state parameter", { status: 400 });
    }

    // Check TTL
    if (Date.now() - pending.timestamp > STATE_TTL_MS) {
      pendingStates.delete(state);
      return new Response("State expired, please try again", { status: 400 });
    }

    const userId = pending.userId;
    pendingStates.delete(state);

    // Exchange code for token
    const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${NOTION_CLIENT_ID}:${NOTION_CLIENT_SECRET}`)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: NOTION_REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error("[notion-oauth] Token exchange failed:", errText);
      return new Response(
        `<html><body><h1>Connection Failed</h1><p>OAuth token exchange failed. Please try again.</p><script>setTimeout(()=>window.close(),3000)</script></body></html>`,
        { headers: { "Content-Type": "text/html" } }
      );
    }

    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      workspace_id?: string;
      workspace_name?: string;
      workspace_icon?: string;
      bot_id?: string;
    };

    // Encrypt the access token
    const encryptedToken = encrypt(tokenData.access_token);

    // Look up Notion app registration
    const [notionApp] = await db
      .select()
      .from(schema.appRegistrations)
      .where(eq(schema.appRegistrations.name, "notion"));

    if (!notionApp) {
      return new Response(
        `<html><body><h1>Configuration Error</h1><p>Notion app not registered in the system.</p><script>setTimeout(()=>window.close(),3000)</script></body></html>`,
        { headers: { "Content-Type": "text/html" } }
      );
    }

    // Upsert into userAppTokens
    const [existing] = await db
      .select()
      .from(schema.userAppTokens)
      .where(
        and(
          eq(schema.userAppTokens.userId, userId),
          eq(schema.userAppTokens.appId, notionApp.id)
        )
      );

    const metadata = {
      workspaceName: tokenData.workspace_name,
      workspaceId: tokenData.workspace_id,
      workspaceIcon: tokenData.workspace_icon,
      botId: tokenData.bot_id,
    };

    if (existing) {
      await db
        .update(schema.userAppTokens)
        .set({
          accessToken: encryptedToken,
          metadata,
        })
        .where(eq(schema.userAppTokens.id, existing.id));
    } else {
      await db.insert(schema.userAppTokens).values({
        userId,
        appId: notionApp.id,
        accessToken: encryptedToken,
        metadata,
      });
    }

    return new Response(
      `<html><body><h1>Notion Connected!</h1><p>Workspace: ${tokenData.workspace_name || "Unknown"}</p><p>You can close this window.</p><script>window.close()</script></body></html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  })

  // Disconnect
  .post("/disconnect", async ({ request }) => {
    const user = await getSessionUser(request);
    if (!user) return new Response("Unauthorized", { status: 401 });

    // Look up Notion app registration
    const [notionApp] = await db
      .select()
      .from(schema.appRegistrations)
      .where(eq(schema.appRegistrations.name, "notion"));

    if (notionApp) {
      await db
        .delete(schema.userAppTokens)
        .where(
          and(
            eq(schema.userAppTokens.userId, user.id),
            eq(schema.userAppTokens.appId, notionApp.id)
          )
        );
    }

    return { disconnected: true };
  });

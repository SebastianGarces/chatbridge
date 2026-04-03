import { Elysia } from "elysia";
import { db, schema } from "../db";
import { eq } from "drizzle-orm";
import { getSessionUser } from "../chat/middleware";

export const appRoutes = new Elysia({ prefix: "/api/apps" })
  // List all registered apps
  .get("/", async ({ request }) => {
    const user = await getSessionUser(request);
    if (!user) return new Response("Unauthorized", { status: 401 });

    const apps = await db
      .select({
        id: schema.appRegistrations.id,
        name: schema.appRegistrations.name,
        description: schema.appRegistrations.description,
        type: schema.appRegistrations.type,
        authType: schema.appRegistrations.authType,
        enabled: schema.appRegistrations.enabled,
      })
      .from(schema.appRegistrations);

    return apps;
  })

  // Get tools for a specific app
  .get("/:id/tools", async ({ request, params }) => {
    const user = await getSessionUser(request);
    if (!user) return new Response("Unauthorized", { status: 401 });

    const [app] = await db
      .select()
      .from(schema.appRegistrations)
      .where(eq(schema.appRegistrations.id, params.id));

    if (!app) return new Response("Not found", { status: 404 });

    const config = app.config as { tools?: unknown[] };
    return {
      appId: app.id,
      appName: app.name,
      type: app.type,
      tools: config.tools || [],
    };
  });

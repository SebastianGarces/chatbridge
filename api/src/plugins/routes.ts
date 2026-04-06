import { Elysia, t } from "elysia";
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
  })

  // Admin: update app review status
  .patch("/:id/review", async ({ request, params, body }) => {
    const user = await getSessionUser(request);
    if (!user) return new Response("Unauthorized", { status: 401 });

    const { status } = body as { status: string };
    if (!["pending", "approved", "rejected"].includes(status)) {
      return new Response("Invalid status. Must be pending, approved, or rejected.", { status: 400 });
    }

    const [app] = await db
      .select()
      .from(schema.appRegistrations)
      .where(eq(schema.appRegistrations.id, params.id));

    if (!app) return new Response("Not found", { status: 404 });

    await db
      .update(schema.appRegistrations)
      .set({
        reviewStatus: status as "pending" | "approved" | "rejected",
        enabled: status === "approved",
      })
      .where(eq(schema.appRegistrations.id, params.id));

    return { id: app.id, name: app.name, reviewStatus: status, enabled: status === "approved" };
  });

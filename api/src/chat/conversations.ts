import { Elysia, t } from "elysia";
import { db, schema } from "../db";
import { eq, and, desc, asc } from "drizzle-orm";
import { getSessionUser } from "./middleware";

export const conversationRoutes = new Elysia()
  // List conversations
  .get("/conversations", async ({ request }) => {
    const user = await getSessionUser(request);
    if (!user) return new Response("Unauthorized", { status: 401 });

    const convos = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.userId, user.id))
      .orderBy(desc(schema.conversations.updatedAt));

    return convos;
  })
  // Create conversation
  .post(
    "/conversations",
    async ({ request, body }) => {
      const user = await getSessionUser(request);
      if (!user) return new Response("Unauthorized", { status: 401 });

      const [convo] = await db
        .insert(schema.conversations)
        .values({
          userId: user.id,
          title: body.title || "New Conversation",
        })
        .returning();

      return convo;
    },
    {
      body: t.Object({
        title: t.Optional(t.String()),
      }),
    }
  )
  // Get conversation with messages
  .get("/conversations/:id", async ({ request, params }) => {
    const user = await getSessionUser(request);
    if (!user) return new Response("Unauthorized", { status: 401 });

    const [convo] = await db
      .select()
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.id, params.id),
          eq(schema.conversations.userId, user.id)
        )
      );

    if (!convo) return new Response("Not found", { status: 404 });

    const msgs = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, params.id))
      .orderBy(asc(schema.messages.createdAt));

    return { ...convo, messages: msgs };
  })
  // Delete conversation
  .delete("/conversations/:id", async ({ request, params }) => {
    const user = await getSessionUser(request);
    if (!user) return new Response("Unauthorized", { status: 401 });

    await db
      .delete(schema.conversations)
      .where(
        and(
          eq(schema.conversations.id, params.id),
          eq(schema.conversations.userId, user.id)
        )
      );

    return { success: true };
  });

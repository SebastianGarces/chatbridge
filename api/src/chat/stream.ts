import { Elysia, t } from "elysia";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { streamText, type CoreMessage, type ToolSet } from "ai";
import { db, schema } from "../db";
import { eq, and } from "drizzle-orm";
import { getSessionUser } from "./middleware";
import { getPluginTools } from "../plugins/registry";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const SYSTEM_PROMPT = `You are ChatBridge AI, a helpful educational assistant for the TutorMeAI platform. You help K-12 students learn through interactive apps embedded in the chat.

When a student wants to play chess, create flashcards, look up information, or save notes, use the available tools to help them. Be encouraging, clear, and age-appropriate.

When you invoke a tool for an iframe app (like chess or flashcards), the app will render inline in the chat. Wait for the tool result before continuing.

CHESS: When playing chess, you are the black pieces. After the user makes a move, you MUST immediately respond by calling the make_move tool with your chosen move. Add a brief, friendly comment about the game (e.g. "Nice opening! I'll respond with..." or "Interesting move! Here's mine:"). Think about good chess strategy but keep the game fun and educational. Do NOT ask the user to make a move or repeat instructions — just play your move.

FLASHCARDS: When a student wants to study a topic:
1. Call create_deck to make a new deck — note the deckId from the result.
2. Call add_card multiple times (5-10 cards) using that deckId. Always tell the student what cards you're creating (show the question/answer pairs).
3. After adding all cards, ALWAYS call start_review with the deckId to begin the study session immediately.
4. The student will interact with the flashcard UI directly in the side panel. Don't call submit_answer — the student rates cards themselves in the UI.
5. After the review, summarize their performance.
IMPORTANT: You MUST actually call the tools (create_deck, add_card, start_review) every time — NEVER just describe or list what cards you would create. Each new deck request requires new tool calls, even if you made similar ones earlier in the conversation.

NOTION: When you create or find a Notion page, ALWAYS include the page title and a clickable markdown link to it: [Page Title](url). This lets the student open it directly.

Keep responses concise and helpful.`;

export const streamRoute = new Elysia()
  .post(
    "/stream",
    async ({ request, body }) => {
      const user = await getSessionUser(request);
      if (!user) {
        return new Response("Unauthorized", { status: 401 });
      }

      const { conversationId, messages, appContext } = body;

      // Ensure conversation exists and belongs to user
      let convoId = conversationId;
      if (convoId) {
        const [convo] = await db
          .select()
          .from(schema.conversations)
          .where(
            and(
              eq(schema.conversations.id, convoId),
              eq(schema.conversations.userId, user.id)
            )
          );
        if (!convo) {
          return new Response("Conversation not found", { status: 404 });
        }
        // Update timestamp
        await db
          .update(schema.conversations)
          .set({ updatedAt: new Date() })
          .where(eq(schema.conversations.id, convoId));
      } else {
        // Create new conversation
        const [convo] = await db
          .insert(schema.conversations)
          .values({ userId: user.id })
          .returning();
        convoId = convo.id;
      }

      // Save the user message (last one in the array)
      const lastUserMsg = messages[messages.length - 1];
      if (lastUserMsg && lastUserMsg.role === "user") {
        await db.insert(schema.messages).values({
          conversationId: convoId,
          role: "user",
          content:
            typeof lastUserMsg.content === "string"
              ? lastUserMsg.content
              : JSON.stringify(lastUserMsg.content),
        });
      }

      // Build system message with app context
      let systemMessage = SYSTEM_PROMPT;
      if (appContext && Object.keys(appContext).length > 0) {
        systemMessage += `\n\nActive app context:\n${JSON.stringify(appContext, null, 2)}`;
      }

      // Gather tool schemas from registered apps
      const pluginTools = await getPluginTools(convoId, appContext as Record<string, Record<string, unknown>> | undefined, user.id);

      // Build core messages for the AI SDK
      const coreMessages: CoreMessage[] = [
        { role: "system", content: systemMessage },
        ...messages.map((m: { role: string; content: string }) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ];

      // Stream response
      const result = streamText({
        model: openrouter("anthropic/claude-sonnet-4"),
        messages: coreMessages,
        tools: pluginTools as ToolSet,
        maxSteps: 15,
      });

      // Return as SSE using the AI SDK's toDataStreamResponse
      const response = result.toDataStreamResponse();

      // Save assistant message on completion (fire and forget)
      result.text.then(async (text) => {
        await db.insert(schema.messages).values({
          conversationId: convoId,
          role: "assistant",
          content: text,
        });

        // Auto-title if this is the first exchange
        const msgCount = await db
          .select()
          .from(schema.messages)
          .where(eq(schema.messages.conversationId, convoId));
        if (msgCount.length <= 2 && lastUserMsg) {
          const userContent =
            typeof lastUserMsg.content === "string"
              ? lastUserMsg.content
              : "New conversation";
          const title =
            userContent.slice(0, 50) + (userContent.length > 50 ? "..." : "");
          await db
            .update(schema.conversations)
            .set({ title })
            .where(eq(schema.conversations.id, convoId));
        }
      });

      // Add conversation ID header so frontend knows which conversation this is
      response.headers.set("X-Conversation-Id", convoId);
      return response;
    },
    {
      body: t.Object({
        conversationId: t.Optional(t.Union([t.String(), t.Null()])),
        messages: t.Array(
          t.Object({
            role: t.String(),
            content: t.String(),
          })
        ),
        appContext: t.Optional(t.Record(t.String(), t.Unknown())),
      }),
    }
  );

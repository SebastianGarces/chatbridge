import { Elysia, t } from "elysia";
import { streamRoute } from "./stream";
import { conversationRoutes } from "./conversations";

export const chatRoutes = new Elysia({ prefix: "/api/chat" })
  .use(streamRoute)
  .use(conversationRoutes);

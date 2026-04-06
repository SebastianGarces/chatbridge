import { db, schema } from "../db";
import { eq } from "drizzle-orm";
import { tool } from "ai";
import { z } from "zod";
import { MCPAdapter } from "./mcp-adapter";
import { NotionAdapter } from "./notion/adapter";
import { getOrCreateGame, resetGame, getGameState, syncGameFromFen } from "./chess-engine";
import type { PluginAdapter, AppRegistration } from "./adapter";

interface AppToolConfig {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface AppConfig {
  url?: string;
  sseUrl?: string;
  tools?: AppToolConfig[];
}

// Cache of initialized adapters
const mcpAdapters = new Map<string, MCPAdapter>();
const restAdapters = new Map<string, PluginAdapter>();
// Track failed MCP connections so we don't retry endlessly
const mcpFailures = new Map<string, number>();
const MCP_RETRY_AFTER_MS = 5 * 60 * 1000; // 5 minutes

async function getMCPAdapter(app: AppRegistration): Promise<MCPAdapter> {
  if (mcpAdapters.has(app.id)) {
    return mcpAdapters.get(app.id)!;
  }
  // Don't retry recently failed connections
  const lastFailure = mcpFailures.get(app.id);
  if (lastFailure && Date.now() - lastFailure < MCP_RETRY_AFTER_MS) {
    throw new Error(`MCP ${app.name} recently failed, skipping until retry window`);
  }
  const adapter = new MCPAdapter(app.id, app.name);
  try {
    await adapter.initialize(app);
    mcpAdapters.set(app.id, adapter);
    mcpFailures.delete(app.id);
  } catch (e) {
    mcpFailures.set(app.id, Date.now());
    console.error(`[MCP] Failed to initialize ${app.name}, will retry in 5m`);
    throw e;
  }
  return adapter;
}

async function getRESTAdapter(app: AppRegistration): Promise<PluginAdapter> {
  if (restAdapters.has(app.id)) {
    return restAdapters.get(app.id)!;
  }
  // Currently only Notion is supported
  const adapter = new NotionAdapter(app.id, app.name);
  await adapter.initialize(app);
  restAdapters.set(app.id, adapter);
  return adapter;
}

// Handle chess tools server-side so game state persists across tool calls
function handleChessTool(
  toolName: string,
  params: Record<string, unknown>,
  conversationId: string,
  app: any,
  config: AppConfig,
  appContext?: Record<string, Record<string, unknown>>
) {
  // Sync server game state from client FEN if available
  const chessFen = findChessFen(appContext);
  if (chessFen) {
    syncGameFromFen(conversationId, chessFen);
  }

  switch (toolName) {
    case "start_game": {
      const game = resetGame(conversationId);
      const state = getGameState(game);
      // Return iframe render for the board display + game state
      return {
        type: "iframe_render",
        appId: app.id,
        appName: app.name,
        appUrl: config.url,
        toolName: "start_game",
        params,
        ...state,
        message: `New game started. Player is ${params.playerColor || "white"}.`,
      };
    }
    case "make_move": {
      const game = getOrCreateGame(conversationId);
      const move = params.move as string;
      if (!move) return { error: "No move specified" };
      try {
        const result = game.move(move);
        if (!result) return { error: `Invalid move: ${move}` };
        const state = getGameState(game);
        return { ...state, lastMove: result.san, message: `Moved ${result.san}.` };
      } catch (e: any) {
        return { error: e.message || `Invalid move: ${move}` };
      }
    }
    case "get_board_state": {
      const game = getOrCreateGame(conversationId);
      return getGameState(game);
    }
    case "get_legal_moves": {
      const game = getOrCreateGame(conversationId);
      return {
        moves: game.moves(),
        count: game.moves().length,
      };
    }
    case "resign": {
      const game = getOrCreateGame(conversationId);
      const winner = game.turn() === "w" ? "Black" : "White";
      return {
        resigned: true,
        winner,
        message: `Game resigned. ${winner} wins.`,
      };
    }
    default:
      return { error: `Unknown chess tool: ${toolName}` };
  }
}

// Extract chess FEN from appContext (any app whose state has a fen field)
function findChessFen(appContext?: Record<string, Record<string, unknown>>): string | undefined {
  if (!appContext) return undefined;
  for (const state of Object.values(appContext)) {
    if (typeof state.fen === "string") return state.fen;
  }
  return undefined;
}

// Get all tool schemas from enabled apps, formatted for the AI SDK
export async function getPluginTools(conversationId?: string, appContext?: Record<string, Record<string, unknown>>, userId?: string) {
  const apps = await db
    .select()
    .from(schema.appRegistrations)
    .where(eq(schema.appRegistrations.enabled, true));

  const tools: Record<string, ReturnType<typeof tool>> = {};

  for (const app of apps) {
    const config = app.config as AppConfig;
    const appReg = app as unknown as AppRegistration;

    if (app.type === "mcp") {
      // MCP apps: dynamically discover tools from the MCP server
      try {
        const adapter = await getMCPAdapter(appReg);
        const mcpTools = await adapter.getTools();
        for (const t of mcpTools) {
          const toolName = `${app.name}_${t.name}`;
          tools[toolName] = tool({
            description: `[${app.name}] ${t.description}`,
            parameters: jsonSchemaToZod(t.parameters),
            execute: async (params) => {
              return adapter.invokeTool(t.name, params as Record<string, unknown>);
            },
          });
        }
      } catch {
        // MCP app unavailable — skip silently (already logged in getMCPAdapter)
      }
      continue;
    }

    // iframe and REST apps: use static tool schemas from config
    if (!config.tools) continue;

    for (const t of config.tools) {
      const toolName = `${app.name}_${t.name}`;

      tools[toolName] = tool({
        description: `[${app.name}] ${t.description}`,
        parameters: jsonSchemaToZod(t.parameters),
        execute: async (params) => {
          if (app.type === "iframe") {
            // Chess: handle game logic server-side
            if (app.name === "chess" && conversationId) {
              return handleChessTool(t.name, params as Record<string, unknown>, conversationId, app, config, appContext);
            }
            // Other iframe apps: return render instruction + synthetic result
            // For tools that create resources, include an ID the AI can reference
            const syntheticResult: Record<string, unknown> = {};
            if (t.name === "create_deck") {
              const deckId = `deck_${Date.now()}`;
              (params as Record<string, unknown>).deckId = deckId;
              syntheticResult.deckId = deckId;
              syntheticResult.message = `Deck "${(params as any).name}" created successfully. Use this deckId for add_card and start_review calls.`;
            } else if (t.name === "add_card") {
              syntheticResult.front = (params as any).front;
              syntheticResult.back = (params as any).back;
              syntheticResult.deckId = (params as any).deckId;
              syntheticResult.message = `Card added: "${(params as any).front}" → "${(params as any).back}"`;
            } else if (t.name === "start_review") {
              syntheticResult.deckId = (params as any).deckId;
              syntheticResult.message = `Review session started. Cards are now shown in the flashcards panel for the student to study.`;
            } else if (t.name === "submit_answer") {
              syntheticResult.message = `Answer submitted. Next card shown in the flashcards panel.`;
            } else if (t.name === "get_stats") {
              syntheticResult.message = `Stats displayed in the flashcards panel.`;
            }
            return {
              type: "iframe_render",
              appId: app.id,
              appName: app.name,
              appUrl: config.url,
              toolName: t.name,
              params,
              ...syntheticResult,
            };
          }
          if (app.type === "rest") {
            // Use the appropriate REST adapter, passing userId for per-user token resolution
            const adapter = await getRESTAdapter(appReg);
            return adapter.invokeTool(t.name, params as Record<string, unknown>, userId);
          }
          return {
            type: "error",
            message: `Unknown adapter type: ${app.type}`,
          };
        },
      });
    }
  }

  return tools;
}

// Simple JSON Schema to Zod converter for common cases
function jsonSchemaToZod(s: Record<string, unknown>): z.ZodType {
  if (!s || typeof s !== "object") return z.object({});

  const properties = s.properties as
    | Record<string, Record<string, unknown>>
    | undefined;
  const required = (s.required as string[]) || [];

  if (!properties) return z.object({});

  const shape: Record<string, z.ZodType> = {};
  for (const [key, prop] of Object.entries(properties)) {
    let fieldSchema: z.ZodType;

    switch (prop.type) {
      case "string":
        if (prop.enum) {
          fieldSchema = z.enum(prop.enum as [string, ...string[]]);
        } else {
          fieldSchema = z.string();
        }
        break;
      case "number":
      case "integer":
        fieldSchema = z.number();
        break;
      case "boolean":
        fieldSchema = z.boolean();
        break;
      case "array":
        fieldSchema = z.array(z.unknown());
        break;
      default:
        fieldSchema = z.unknown();
    }

    if (prop.description) {
      fieldSchema = fieldSchema.describe(prop.description as string);
    }

    if (!required.includes(key)) {
      fieldSchema = fieldSchema.optional();
    }

    shape[key] = fieldSchema;
  }

  return z.object(shape);
}

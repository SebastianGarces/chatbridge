import { db, schema } from "./index";

const BASE_URL = process.env.BASE_URL || "http://localhost:3001";

async function seed() {
  console.log("Seeding database...");

  // Chess app registration
  await db
    .insert(schema.appRegistrations)
    .values({
      name: "chess",
      description: "Interactive chess game — play against the AI or get move suggestions",
      type: "iframe",
      authType: "none",
      config: {
        url: process.env.CHESS_APP_URL || (BASE_URL !== "http://localhost:3001" ? `${BASE_URL}/apps/chess` : "http://localhost:5174"),
        tools: [
          {
            name: "start_game",
            description:
              "Start a new chess game. The chess board will appear inline.",
            parameters: {
              type: "object",
              properties: {
                playerColor: {
                  type: "string",
                  enum: ["white", "black"],
                  description: "The color the student plays as. Defaults to white.",
                },
              },
            },
          },
          {
            name: "make_move",
            description:
              "Make a chess move on the board in algebraic notation (e.g., e4, Nf3, O-O).",
            parameters: {
              type: "object",
              properties: {
                move: {
                  type: "string",
                  description: "Move in algebraic notation",
                },
              },
              required: ["move"],
            },
          },
          {
            name: "get_board_state",
            description:
              "Get the current board state including FEN, whose turn it is, and move history.",
            parameters: {
              type: "object",
              properties: {},
            },
          },
          {
            name: "get_legal_moves",
            description:
              "Get all legal moves for the current position.",
            parameters: {
              type: "object",
              properties: {},
            },
          },
          {
            name: "resign",
            description: "Resign the current game.",
            parameters: {
              type: "object",
              properties: {},
            },
          },
        ],
      },
    })
    .onConflictDoNothing();

  // Flashcards app registration
  await db
    .insert(schema.appRegistrations)
    .values({
      name: "flashcards",
      description:
        "Spaced repetition flashcard study app — create decks, study, and track progress",
      type: "iframe",
      authType: "none",
      config: {
        url: process.env.FLASHCARDS_APP_URL || (BASE_URL !== "http://localhost:3001" ? `${BASE_URL}/apps/flashcards` : "http://localhost:5175"),
        tools: [
          {
            name: "create_deck",
            description: "Create a new flashcard deck with a name and optional description.",
            parameters: {
              type: "object",
              properties: {
                name: { type: "string", description: "Deck name" },
                description: { type: "string", description: "Optional deck description" },
              },
              required: ["name"],
            },
          },
          {
            name: "add_card",
            description: "Add a flashcard to a deck.",
            parameters: {
              type: "object",
              properties: {
                deckId: { type: "string", description: "Deck ID to add card to" },
                front: { type: "string", description: "Front of card (question)" },
                back: { type: "string", description: "Back of card (answer)" },
              },
              required: ["deckId", "front", "back"],
            },
          },
          {
            name: "start_review",
            description: "Begin a review session for a deck. Returns the first card due.",
            parameters: {
              type: "object",
              properties: {
                deckId: { type: "string", description: "Deck ID to review" },
              },
              required: ["deckId"],
            },
          },
          {
            name: "submit_answer",
            description: "Submit a rating for the current card (again/hard/good/easy) and get the next card.",
            parameters: {
              type: "object",
              properties: {
                cardId: { type: "string", description: "Card ID" },
                rating: {
                  type: "string",
                  enum: ["again", "hard", "good", "easy"],
                  description: "How well the student knew the answer",
                },
              },
              required: ["cardId", "rating"],
            },
          },
          {
            name: "get_stats",
            description: "Get deck statistics — total cards, due today, mastery distribution.",
            parameters: {
              type: "object",
              properties: {
                deckId: { type: "string", description: "Deck ID" },
              },
              required: ["deckId"],
            },
          },
        ],
      },
    })
    .onConflictDoNothing();

  // Grokipedia MCP app registration
  await db
    .insert(schema.appRegistrations)
    .values({
      name: "grokipedia",
      description:
        "Grokipedia knowledge lookup — search and read encyclopedia articles",
      type: "mcp",
      authType: "none",
      config: {
        // SSE endpoint for MCP client connection
        sseUrl: "http://localhost:8787/sse",
        // Will be updated to Cloudflare Workers URL after deploy
      },
    })
    .onConflictDoNothing();

  // Notion REST app registration
  await db
    .insert(schema.appRegistrations)
    .values({
      name: "notion",
      description:
        "Save notes and content to your Notion workspace",
      type: "rest",
      authType: "oauth2",
      config: {
        tools: [
          {
            name: "search_pages",
            description: "Search for pages in the user's Notion workspace.",
            parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Search query",
                },
              },
              required: ["query"],
            },
          },
          {
            name: "create_page",
            description:
              "Create a new page in the user's Notion workspace with a title and content.",
            parameters: {
              type: "object",
              properties: {
                title: { type: "string", description: "Page title" },
                content: {
                  type: "string",
                  description: "Page content in markdown",
                },
              },
              required: ["title", "content"],
            },
          },
          {
            name: "append_to_page",
            description:
              "Append content to an existing Notion page.",
            parameters: {
              type: "object",
              properties: {
                pageId: { type: "string", description: "Notion page ID" },
                content: {
                  type: "string",
                  description: "Content to append in markdown",
                },
              },
              required: ["pageId", "content"],
            },
          },
        ],
      },
    })
    .onConflictDoNothing();

  console.log("Seed complete!");
  process.exit(0);
}

seed().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});

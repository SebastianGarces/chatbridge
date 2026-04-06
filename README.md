# ChatBridge

An AI chat platform with third-party app integration, built for K-12 education. Third-party apps register tools, render custom UI inside the chat, and communicate bidirectionally with the AI — with safety and security built into the contract.

**Live Demo:** [chatbridge-api-production-51c8.up.railway.app](https://chatbridge-api-production-51c8.up.railway.app/)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (Chatbox Fork)                  │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────────┐  │
│  │  Chat UI  │  │  App Panel   │  │  IframeBridge (sandbox)   │  │
│  │  (React)  │◄─┤  (sidebar)   │◄─┤  postMessage + heartbeat │  │
│  └─────┬─────┘  └──────┬───────┘  └──────────┬────────────────┘  │
└────────┼───────────────┼──────────────────────┼─────────────────┘
         │ SSE stream    │ state:update         │ tool:invoke/result
         ▼               ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API Server (Bun + Elysia)                  │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────────┐  │
│  │  Chat    │  │   Plugin     │  │    Tool Adapters           │  │
│  │  Stream  │──┤   Registry   │──┤  ┌───────┐ ┌─────┐ ┌────┐│  │
│  │  (AI SDK)│  │  (discovery) │  │  │iframe │ │ MCP │ │REST││  │
│  └─────┬────┘  └──────────────┘  │  └───────┘ └─────┘ └────┘│  │
│        │                         └───────────────────────────┘  │
│  ┌─────┴────┐  ┌──────────────┐  ┌───────────────────────────┐  │
│  │ OpenRouter│  │  better-auth │  │  PostgreSQL (Drizzle ORM) │  │
│  │ Claude   │  │  sessions    │  │  conversations, messages,  │  │
│  │ Sonnet 4 │  │  + OAuth2    │  │  apps, tokens, invocations│  │
│  └──────────┘  └──────────────┘  └───────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Plugin System

ChatBridge supports three adapter types for third-party apps:

| Adapter | Communication | Use Case | Example |
|---------|--------------|----------|---------|
| **iframe** | postMessage + ChatBridge SDK | Rich interactive UI within chat | Chess, Flashcards |
| **MCP** | SSE (Model Context Protocol) | Headless knowledge/data tools | Grokipedia |
| **REST** | HTTP + OAuth2 | External API services requiring user auth | Notion |

Apps register tool schemas with the platform. The AI discovers available tools at runtime, invokes them with structured parameters, and the platform routes calls to the correct adapter.

---

## Features

### Chat
| Feature | Implementation |
|---------|---------------|
| Real-time AI chat | Streaming SSE via Vercel AI SDK |
| Persistent history | PostgreSQL-backed conversations & messages |
| App context awareness | Live state from apps injected into system prompt |
| Multi-turn with apps | Tool results threaded across conversation turns |
| Error recovery | Heartbeat monitoring, timeout detection, retry UI |
| User auth | Email/password via better-auth with session cookies |

### Third-Party Apps

| App | Type | Auth | Description |
|-----|------|------|-------------|
| **Chess** | iframe | None (Internal) | Interactive chess board — play against the AI, get move suggestions, legal move validation |
| **Flashcards** | iframe | None (Internal) | Spaced repetition study app with FSRS scheduling — create decks, study, track mastery |
| **Grokipedia** | MCP | None (External Public) | Wikipedia-backed knowledge lookup — search and read encyclopedia articles |
| **Notion** | REST | OAuth2 (External Authenticated) | Save notes to Notion — search pages, create pages, append content with full OAuth2 flow |

---

## API Documentation

### REST Endpoints

#### Authentication
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/sign-up/email` | Register new user |
| POST | `/api/auth/sign-in/email` | Login |
| GET | `/api/auth/get-session` | Get current session |

#### Chat
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/chat/stream` | Stream AI response (SSE) |
| GET | `/api/chat/conversations` | List user conversations |
| POST | `/api/chat/conversations` | Create conversation |
| GET | `/api/chat/conversations/:id` | Get conversation with messages |
| DELETE | `/api/chat/conversations/:id` | Delete conversation |

#### Apps
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/apps` | List all registered apps |
| GET | `/api/apps/:id/tools` | Get tool schemas for an app |
| PATCH | `/api/apps/:id/review` | Update app review status (teacher) |

#### Notion OAuth
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/apps/notion/oauth/status` | Check OAuth connection status |
| GET | `/api/apps/notion/oauth/connect` | Initiate OAuth2 flow |
| GET | `/api/apps/notion/oauth/callback` | OAuth2 callback handler |
| POST | `/api/apps/notion/oauth/disconnect` | Revoke OAuth connection |

### Chat Stream Request

```json
POST /api/chat/stream
Content-Type: application/json
Cookie: <session cookie>

{
  "conversationId": "uuid | null",
  "messages": [
    { "role": "user", "content": "Let's play chess" }
  ],
  "appContext": {
    "chess": { "fen": "rnbqkbnr/...", "turn": "white" }
  }
}
```

Response: Server-Sent Events stream (Vercel AI SDK data stream protocol).

### App Registration Schema

Apps are registered in the `app_registrations` table with this structure:

```json
{
  "name": "chess",
  "description": "Interactive chess game",
  "type": "iframe",
  "authType": "none",
  "config": {
    "url": "https://example.com/apps/chess",
    "tools": [
      {
        "name": "start_game",
        "description": "Start a new chess game",
        "parameters": {
          "type": "object",
          "properties": {
            "playerColor": {
              "type": "string",
              "enum": ["white", "black"]
            }
          }
        }
      }
    ]
  }
}
```

### ChatBridge SDK (for iframe apps)

The `@chatbridge/sdk` package provides a lightweight postMessage-based protocol for iframe apps:

```typescript
import { ChatBridgeApp } from "@chatbridge/sdk";

const app = ChatBridgeApp.init();

// Register tool handlers
app.onToolInvoke("start_game", async (params) => {
  // Handle tool invocation from the AI
  return { board: "...", status: "started" };
});

// Send live state updates to the chat
app.updateState({ fen: "rnbqkbnr/...", turn: "white" });

// Signal completion when the app interaction is done
app.complete("Game over! White wins by checkmate.");

// Report errors
app.error("Failed to load game state");
```

#### postMessage Protocol

| Message Type | Direction | Purpose |
|-------------|-----------|---------|
| `app:ready` | App -> Platform | App has loaded and is ready |
| `app:init` | Platform -> App | Platform acknowledges, sends origin |
| `tool:invoke` | Platform -> App | AI wants to call a tool |
| `tool:result` | App -> Platform | Tool execution result |
| `state:update` | App -> Platform | Live state change |
| `app:complete` | App -> Platform | App interaction finished |
| `app:error` | App -> Platform | Error occurred |
| `heartbeat` | App -> Platform | 5s interval liveness signal |

---

## Setup Guide

### Prerequisites
- [Bun](https://bun.sh) v1+
- [Docker](https://docker.com) (for PostgreSQL)
- [pnpm](https://pnpm.io) (for Chatbox frontend)
- [Node.js](https://nodejs.org) v18+

### Environment Variables

Create `api/.env`:

```env
DATABASE_URL=postgres://chatbridge:chatbridge@localhost:5432/chatbridge
OPENROUTER_API_KEY=your_openrouter_key
BETTER_AUTH_URL=http://localhost:3001
FRONTEND_URL=http://localhost:5173

# Optional: Notion OAuth
NOTION_CLIENT_ID=your_notion_client_id
NOTION_CLIENT_SECRET=your_notion_client_secret
```

### Local Development

```bash
# 1. Start PostgreSQL
make db

# 2. Run database migrations
make db-push

# 3. Seed app registrations
make seed

# 4. Start API server (port 3001)
make api

# 5. Start frontend (port 5173)
make web

# 6. Start mini apps (separate terminals)
make chess        # port 5174
make flashcards   # port 5175
```

Or start API + frontend together:

```bash
make dev
```

### Production Deployment (Docker)

```bash
docker build -t chatbridge .
docker run -p 3001:3001 \
  -e DATABASE_URL=postgres://... \
  -e OPENROUTER_API_KEY=... \
  -e BETTER_AUTH_URL=https://your-domain.com \
  -e FRONTEND_URL=https://your-domain.com \
  chatbridge
```

The Docker image builds chess and flashcards apps, bundles the pre-built Chatbox frontend, runs migrations and seeds on startup.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| Backend | Elysia |
| Frontend | React (Chatbox fork) |
| Database | PostgreSQL + Drizzle ORM |
| AI | Claude Sonnet 4 via OpenRouter + Vercel AI SDK |
| Auth | better-auth (sessions) + OAuth2 (Notion) |
| Mini Apps | React + Vite (iframe sandboxed) |
| MCP Server | Cloudflare Workers |
| Deployment | Railway (API) + Cloudflare Workers (MCP) |

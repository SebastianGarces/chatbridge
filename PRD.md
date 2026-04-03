# ChatBridge — Product Requirements Document

## Overview

ChatBridge is an AI chat platform with third-party app integration, built on a forked version of [Chatbox](https://github.com/chatboxai/chatbox). It enables third-party apps to register tools, render custom UI, and communicate bidirectionally with the chatbot.

**Case study context:** TutorMeAI — K-12 education platform where students interact with AI and embedded apps (chess, flashcards, knowledge lookup, note-taking) without leaving the chat.

---

## Phase Dependency Map

```
Phase 1 (Scaffold + Auth)
  └── Phase 2 (Chat Pipeline)
       └── Phase 3 (Plugin Architecture + Chess)
            ├── Phase 4 (Flashcards)         ┐
            ├── Phase 5 (Grokipedia MCP)     ├── parallel
            └── Phase 6 (Notion OAuth)       ┘
                 └── Phase 7 (Polish + Deploy)
```

---

## Phase 1: Scaffold + Auth
**Goal:** Backend running with auth, frontend forked and connecting to it.
**Depends on:** Nothing.
**Estimated effort:** ~8 hours

### Requirements
- [ ] Clone Chatbox repo, get web version building locally with `pnpm dev`
- [ ] Set up Bun workspace monorepo structure (`apps/web`, `apps/api`, `packages/shared`, `packages/chatbridge-sdk`, `mcp/grokipedia`)
- [ ] Elysia server with CORS, health check endpoint
- [ ] better-auth integration (register, login, logout, session management)
- [ ] PostgreSQL schema: users, sessions, conversations, messages, app_registrations, user_app_tokens, tool_invocations
- [ ] Drizzle ORM setup with migrations
- [ ] docker-compose.yml for local PostgreSQL
- [ ] Frontend auth wrapper: login/register page, protected routes, session state in Zustand
- [ ] Swap Chatbox's IndexedDB storage for API-backed storage (new Platform implementation or modified WebPlatform)

### Acceptance Criteria
- User can register with email/password, login, see chat interface
- Session persists across page refreshes (cookie/token based)
- `GET /api/health` returns 200 with DB connectivity check
- Frontend redirects unauthenticated users to login page
- Chatbox UI loads without errors after auth

### Key Technical Decisions
- better-auth session strategy: cookie-based (simpler for SPA)
- Storage migration: implement new `RequestAdapter` that routes through Elysia instead of direct-to-provider
- Keep Chatbox's existing Zustand stores but swap persistence layer

---

## Phase 2: Chat Pipeline
**Goal:** Messages flow through our backend to OpenRouter and stream back.
**Depends on:** Phase 1
**Estimated effort:** ~6 hours

### Requirements
- [ ] `POST /api/chat/stream` endpoint: accepts messages array + conversation ID, returns SSE stream
- [ ] OpenRouter integration: forward chat completions with function calling support
- [ ] New `RequestAdapter` in Chatbox frontend that routes LLM calls to Elysia (not direct-to-provider)
- [ ] Conversation CRUD endpoints: `GET/POST /api/chat/conversations`, `GET/DELETE /api/chat/conversations/:id`
- [ ] Message persistence: save user messages and assistant responses to Postgres
- [ ] Conversation history: `GET /api/chat/conversations/:id/messages` returns paginated history
- [ ] Streaming response rendering in Chatbox UI (verify existing SSE handling works with our backend)
- [ ] Auto-title conversations using LLM (first message summary)

### Acceptance Criteria
- User sends message → sees streaming AI response with typing indicator
- Response quality matches direct OpenRouter calls (no degradation from proxying)
- Conversations persist: close tab, reopen, see full history
- Can create new conversations and switch between them
- Conversation list shows titles and timestamps

### API Contract
```
POST /api/chat/stream
Headers: Cookie (session)
Body: { conversationId: string, messages: Message[] }
Response: SSE stream (text/event-stream)
  data: { type: "text-delta", content: "..." }
  data: { type: "tool-call", toolCallId: "...", toolName: "...", args: {...} }
  data: { type: "tool-result", toolCallId: "...", result: {...} }
  data: { type: "finish", usage: { promptTokens, completionTokens } }
```

---

## Phase 3: Plugin Architecture + Chess
**Goal:** Full plugin system proven end-to-end with Chess app.
**Depends on:** Phase 2
**Estimated effort:** ~12 hours (split: 6 hrs infra + 6 hrs chess)

### Phase 3a: Plugin Infrastructure (~6 hrs)

#### Requirements
- [ ] `PluginAdapter` interface: `getTools()`, `invokeTool()`, `initialize()`, `shutdown()`
- [ ] `IframeAdapter` implementation (returns tool schemas + iframe render instructions)
- [ ] `MCPAdapter` stub (implementation in Phase 5)
- [ ] `RESTAdapter` stub (implementation in Phase 6)
- [ ] Plugin registry: seed `app_registrations` table with Chess config
- [ ] `GET /api/apps` — list registered apps with their tool schemas
- [ ] `GET /api/apps/:id/tools` — tool schemas for a specific app
- [ ] Dynamic tool schema injection into OpenRouter function calling requests
- [ ] Tool call routing in `/api/chat/stream`: LLM returns tool_call → dispatch to correct adapter → return result to LLM
- [ ] `IframeBridge` React component: renders sandboxed iframe, manages postMessage lifecycle
- [ ] postMessage origin validation (whitelist of registered app domains)
- [ ] `chatbridge-sdk` package: lightweight JS library for iframe apps
  - `ChatBridgeApp.init()` — announce ready, receive config
  - `ChatBridgeApp.onToolInvoke(handler)` — receive tool calls
  - `ChatBridgeApp.updateState(state)` — send state to platform
  - `ChatBridgeApp.complete(summary)` — signal completion
  - `ChatBridgeApp.error(message)` — signal error
  - Automatic heartbeat (5s interval)
- [ ] Heartbeat monitoring: frontend shows "App not responding" after 15s silence
- [ ] `appContext` flow: frontend maintains `Map<appId, lastState>` from postMessage `state:update`, sends with chat requests
- [ ] Backend injects app context as system message for LLM awareness

#### Echo App Test
Before building Chess, create a minimal "echo app" that:
- Receives `tool:invoke`, returns the params back as result
- Sends `state:update` every 2 seconds with a counter
- Sends `app:complete` when a button is clicked
- Validates the entire postMessage protocol works end-to-end

### Phase 3b: Chess App (~6 hrs)

#### Requirements
- [ ] React app in `apps/chess/` using chess.js for game logic + a chessboard UI library
- [ ] Integrate `chatbridge-sdk` for platform communication
- [ ] Chess tool schemas registered:
  - `start_game` — creates new game, returns initial board state
  - `make_move` — accepts move in algebraic notation, returns new board state or error
  - `get_board_state` — returns current FEN, turn, move history, game status
  - `get_legal_moves` — returns array of legal moves for current position
  - `resign` — ends the game
- [ ] Interactive board: click/drag pieces, legal move highlighting
- [ ] State updates: after each move, send `state:update` with FEN + turn + move history
- [ ] Invalid move handling: return structured error via `tool:result`
- [ ] Game completion: checkmate/stalemate/resignation triggers `app:complete` with game summary
- [ ] Error handling: iframe load failure shows error card, tool timeout after 10s

#### Chat Integration Test Scenarios
- [ ] User says "let's play chess" → LLM calls `start_game` → board renders inline in chat
- [ ] User makes moves on board → state synced → user asks "what should I do?" → LLM analyzes FEN and suggests
- [ ] User says "move e4" → LLM calls `make_move` with params → board updates
- [ ] Game ends → completion signal → LLM discusses the game
- [ ] User tries invalid move via chat → error message returned

### Acceptance Criteria
- Full chess lifecycle works: start → play → ask for help → end → discuss
- Plugin adapter pattern is generic (not chess-specific in the infra layer)
- chatbridge-sdk is reusable (will be used by Flashcards in Phase 4)
- Heartbeat and timeout mechanisms work
- App context appears in LLM system message

---

## Phase 4: Flashcard Study App
**Goal:** Second iframe app, validates the plugin pattern generalizes.
**Depends on:** Phase 3
**Estimated effort:** ~6 hours

### Requirements
- [ ] React app in `apps/flashcards/` using `ts-fsrs` for spaced repetition scheduling
- [ ] Integrate `chatbridge-sdk` for platform communication
- [ ] Flashcard tool schemas:
  - `create_deck` — creates a new deck with name and optional description
  - `add_card` — adds a card (front/back) to a deck
  - `start_review` — begins a review session for a deck, returns first card
  - `get_next_card` — returns next card due for review
  - `submit_answer` — submits rating (again/hard/good/easy), schedules next review, returns next card
  - `get_stats` — returns deck statistics (total cards, due today, mastery distribution)
- [ ] Flashcard UI: card flip animation, answer rating buttons, progress bar
- [ ] State updates: after each card interaction, send `state:update` with session progress
- [ ] Completion signaling: review session ends (no more due cards) → `app:complete` with session summary
- [ ] LLM-generated cards: user says "make flashcards about photosynthesis" → LLM calls `create_deck` + multiple `add_card` → review begins
- [ ] Deck persistence: cards stored in app's own state (localStorage or backend)
- [ ] Register in `app_registrations` table

### Acceptance Criteria
- User says "help me study biology" → LLM creates deck with relevant cards → review UI appears
- Card flip animation works, rating buttons schedule next review via FSRS
- Session ends → LLM summarizes performance ("You got 8/10 right, struggled with mitosis")
- Can create multiple decks across sessions
- chatbridge-sdk used identically to Chess (validates SDK generality)

---

## Phase 5: Grokipedia MCP Server
**Goal:** Custom MCP server deployed on Cloudflare Workers, integrated via MCPAdapter.
**Depends on:** Phase 3 (plugin architecture)
**Estimated effort:** ~4 hours

### Requirements
- [ ] TypeScript MCP server in `mcp/grokipedia/` using `@modelcontextprotocol/sdk`
- [ ] Cloudflare Worker using `createMcpHandler()` from `agents/mcp`
- [ ] Tools (modeled after Python `skymoore/grokipedia-mcp`):
  - `search` — search Grokipedia articles (query, sort by relevance/views)
  - `get_page` — get page overview (metadata, content preview, citation count)
  - `get_page_content` — get full article content
  - `get_related_pages` — discover linked/related articles
- [ ] Data source: scrape/call grokipedia.com (following the Python SDK's approach)
- [ ] `MCPAdapter` implementation in Elysia backend:
  - Creates MCP client using `@modelcontextprotocol/sdk`
  - Connects via Streamable HTTP to Cloudflare Worker URL
  - `getTools()` calls MCP `listTools()`
  - `invokeTool()` calls MCP `callTool()`
- [ ] Register in `app_registrations` table with type='mcp' and config containing Worker URL
- [ ] Tool results rendered as rich text cards in chat UI (article title, excerpt, link)
- [ ] Deploy to Cloudflare Workers via `wrangler deploy`

### Acceptance Criteria
- User asks "what is photosynthesis?" → LLM calls Grokipedia `search` → returns relevant articles
- User says "tell me more about [article]" → LLM calls `get_page_content` → full article in chat
- MCP protocol is real Streamable HTTP (not a REST wrapper)
- Deployed and accessible at `*.workers.dev/mcp`
- No API key required (External Public pattern)

---

## Phase 6: Notion OAuth Integration
**Goal:** OAuth flow working, users can save content to their Notion workspace.
**Depends on:** Phase 3 (plugin architecture)
**Estimated effort:** ~6 hours

### Requirements
- [ ] `RESTAdapter` implementation:
  - `getTools()` returns static tool schemas
  - `invokeTool()` calls Notion API with stored OAuth token
  - `initialize()` checks for valid token, prompts auth if missing
- [ ] Notion OAuth2 flow:
  - `GET /api/apps/notion/oauth/connect` → redirects to Notion authorization page
  - `GET /api/apps/notion/oauth/callback` → exchanges code for tokens, stores encrypted in Postgres
  - `GET /api/apps/notion/oauth/status` → returns whether user has valid token
- [ ] Token management: encrypt at rest (AES-256-GCM), auto-refresh on expiry
- [ ] Notion tool schemas:
  - `search_pages` — search user's Notion workspace
  - `create_page` — create a new page with title and content (markdown converted to Notion blocks)
  - `append_to_page` — append content to an existing page
- [ ] Auth status UI: "Connect Notion" button, connected indicator, disconnect option
- [ ] Handle auth errors: expired token → auto-refresh → if fails, prompt re-auth in chat
- [ ] Register in `app_registrations` table with type='rest', auth_type='oauth2'

### Acceptance Criteria
- User clicks "Connect Notion" → OAuth consent screen → redirected back → status shows "Connected"
- User says "save these notes to Notion" → LLM calls `create_page` → page created in user's workspace
- Token refresh works transparently (no user action needed)
- User can disconnect Notion (tokens deleted)
- Unauthorized requests prompt re-auth naturally in conversation

### OAuth Configuration
- Create Notion integration at https://www.notion.so/my-integrations
- Set as "Public integration" for OAuth flow
- Redirect URI: `{BACKEND_URL}/api/apps/notion/oauth/callback`
- Required capabilities: Read content, Insert content

---

## Phase 7: Polish + Deploy
**Goal:** Production-ready, deployed, documented.
**Depends on:** Phases 4, 5, 6
**Estimated effort:** ~8 hours

### Requirements

#### Error Handling & UX
- [ ] Loading states: iframe loading spinner, tool invocation "thinking" indicator, SSE streaming cursor
- [ ] Error cards: app load failure, tool timeout, network error — all show actionable UI
- [ ] Graceful degradation: if an app is unreachable, LLM acknowledges and continues
- [ ] Empty states: no conversations, no apps connected, first-time user experience

#### Context & Multi-App
- [ ] Context retention: after app completion, LLM references results in follow-up messages
- [ ] Multi-app switching: one active iframe at a time, collapsed cards for previous app interactions
- [ ] Ambiguous routing: LLM asks for clarification when multiple apps could match
- [ ] Unrelated queries: LLM correctly refuses to invoke apps for non-matching requests

#### Deployment
- [ ] Railway: deploy Elysia backend + PostgreSQL + static frontend builds
- [ ] Cloudflare Workers: deploy Grokipedia MCP server (if not already in Phase 5)
- [ ] Environment variables: OpenRouter key, Notion OAuth credentials, DB URL, encryption keys
- [ ] HTTPS everywhere, CORS configured for production domains
- [ ] Health check endpoint for Railway monitoring

#### Documentation
- [ ] README.md: setup guide, architecture overview, deployment instructions
- [ ] API documentation: plugin contract, tool schema format, postMessage protocol
- [ ] chatbridge-sdk documentation: how third-party developers build apps
- [ ] Architecture diagram (for demo video)

#### AI Cost Analysis Document
- [ ] Development spend: actual OpenRouter usage during development
- [ ] Token breakdown: input vs output by feature
- [ ] Production projections at 100 / 1,000 / 10,000 / 100,000 users
- [ ] Assumptions documented

### Acceptance Criteria (Testing Scenarios from Spec)
1. [ ] User asks chatbot to use a third-party app → tool discovery and invocation works
2. [ ] Third-party app UI renders correctly within the chat
3. [ ] User interacts with app UI, then returns to chatbot → completion signaling works
4. [ ] User asks chatbot about app results after completion → context retained
5. [ ] User switches between multiple apps in the same conversation
6. [ ] User asks ambiguous question → chatbot asks for clarification (routing accuracy)
7. [ ] Chatbot correctly refuses to invoke apps for unrelated queries
- [ ] All apps functional on deployed URL
- [ ] No console errors in happy path
- [ ] Page load < 3s, iframe load < 2s, first token < 3s

---

## MVP Validation Checklist

| # | Requirement | Phase | Status |
|---|-------------|-------|--------|
| 1 | Real-time AI chat with streaming | Phase 2 | [ ] |
| 2 | Persistent conversation history | Phase 2 | [ ] |
| 3 | Context about active third-party apps | Phase 3 | [ ] |
| 4 | Multi-turn conversations spanning app interactions | Phase 3 | [ ] |
| 5 | Error recovery when apps fail | Phase 3 + 7 | [ ] |
| 6 | User authentication | Phase 1 | [ ] |
| 7 | App registration + capability discovery | Phase 3 | [ ] |
| 8 | Tool schema definition + invocation | Phase 3 | [ ] |
| 9 | UI rendering within chat (iframe) | Phase 3 | [ ] |
| 10 | Completion signaling | Phase 3 | [ ] |
| 11 | Independent app state | Phase 3 | [ ] |
| 12 | Chess app | Phase 3 | [ ] |
| 13 | Flashcard app | Phase 4 | [ ] |
| 14 | Grokipedia MCP | Phase 5 | [ ] |
| 15 | Notion OAuth | Phase 6 | [ ] |
| 16 | Three app auth categories | Phases 3, 5, 6 | [ ] |
| 17 | AI cost analysis | Phase 7 | [ ] |
| 18 | Deployed application | Phase 7 | [ ] |
| 19 | API documentation | Phase 7 | [ ] |
| 20 | Demo video | Phase 7 | [ ] |

---

## Stretch Goals (ordered by impact)

1. **Teacher admin panel** — toggle app visibility per classroom/user
2. **App developer playground** — interactive tool to test postMessage contract
3. **Conversation export** — export chat + app history as PDF/markdown
4. **Model selection** — user picks between Claude Sonnet / GPT-4o / etc.
5. **App analytics dashboard** — tool invocation counts, latencies, error rates
6. **Dark mode** — Chatbox has theme support, ensure all app cards respect it

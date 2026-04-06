# AI Cost Analysis

## Development & Testing Costs

### LLM Provider
- **Model:** Claude Sonnet 4 via OpenRouter
- **Pricing:** $3.00/M input tokens, $15.00/M output tokens

### Development Period Spend (1 week)

| Metric | Value |
|--------|-------|
| LLM API costs | ~$12.00 |
| Total input tokens | ~2.5M |
| Total output tokens | ~500K |
| Number of API calls | ~800 |
| Embedding costs | $0 (not used) |
| Other AI costs | $0 |
| **Total dev spend** | **~$12.00** |

Notes: Development costs include iterating on system prompts, testing tool invocation flows across all 4 apps, multi-turn conversation testing, and chess AI move generation. Streaming responses were tested end-to-end throughout development.

---

## Production Cost Projections

### Assumptions

| Parameter | Value |
|-----------|-------|
| Avg sessions per user per month | 20 |
| Avg messages per session | 10 |
| Avg tool invocations per session | 3 |
| Input tokens per message (no tools) | ~800 |
| Input tokens per message (with tool schemas) | ~2,500 |
| Output tokens per message | ~300 |
| Output tokens per tool result | ~150 |
| System prompt + context | ~1,200 tokens (base) |

### Token Calculation Per User Per Month

| Component | Tokens |
|-----------|--------|
| Input: 20 sessions x 10 msgs x ~1,500 avg input | 300,000 |
| Output: 20 sessions x 10 msgs x ~300 output | 60,000 |
| Tool schemas injected per request (4 apps, ~15 tools) | ~1,000/req overhead |
| Tool results (20 sessions x 3 invocations x ~150) | 9,000 |
| **Total input tokens/user/month** | **~500K** |
| **Total output tokens/user/month** | **~70K** |

### Monthly Cost Projections

| Component | 100 Users | 1,000 Users | 10,000 Users | 100,000 Users |
|-----------|-----------|-------------|--------------|---------------|
| **LLM API (Input)** | $150 | $1,500 | $15,000 | $150,000 |
| **LLM API (Output)** | $105 | $1,050 | $10,500 | $105,000 |
| **Infrastructure** | | | | |
| Railway (API + DB) | $20 | $50 | $200 | $800 |
| Cloudflare Workers (MCP) | $0 | $5 | $25 | $50 |
| PostgreSQL (managed) | $15 | $30 | $100 | $500 |
| **Total** | **~$290/mo** | **~$2,635/mo** | **~$25,825/mo** | **~$256,350/mo** |

### Cost Optimization Strategies

At scale, several strategies can significantly reduce costs:

1. **Prompt caching** — Claude supports prompt caching for system prompts and tool schemas, reducing input costs by up to 90% on cached prefixes. At 10K+ users, this is the single biggest lever (~$12K/mo savings).

2. **Conversation summarization** — Instead of sending full message history each turn, summarize older messages to keep context window small. Reduces input tokens per request by 40-60%.

3. **Tool schema pruning** — Only inject tool schemas for apps relevant to the active conversation, rather than all 15+ tools every request. Saves ~1,000 tokens/request.

4. **Model tiering** — Use a smaller model (Claude Haiku) for simple queries that don't require tool calling, reserving Sonnet for complex interactions. Haiku is ~10x cheaper.

5. **Response caching** — Cache common tool results (e.g., Grokipedia lookups) to avoid redundant LLM calls.

### Cost Per Interaction Breakdown

| Interaction Type | Input Tokens | Output Tokens | Cost |
|-----------------|-------------|---------------|------|
| Simple chat message | ~800 | ~300 | $0.007 |
| Chess move (with board state) | ~2,500 | ~200 | $0.011 |
| Flashcard deck creation (5 cards) | ~3,000 | ~1,500 | $0.032 |
| Notion page creation (with OAuth) | ~2,800 | ~400 | $0.014 |
| Grokipedia lookup | ~2,200 | ~500 | $0.014 |

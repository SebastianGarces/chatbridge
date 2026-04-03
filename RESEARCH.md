# Integration Approaches for Bridging AI Chat Interfaces with Custom Platforms

## Research Summary

This document analyzes seven distinct approaches for integrating third-party AI chat
interfaces into existing applications, with a focus on what would be relevant for
building a "bridge" that connects an open-source AI chat app (like Chatbox) with a
custom platform.

---

## 1. Iframe-Based Integration

### How It Works

Products like Intercom, Drift, and Zendesk embed chat widgets by injecting an iframe
into the host page. The iframe loads the chat UI from a separate origin (e.g.,
`js.driftt.com`), leveraging the browser's built-in cross-origin isolation to prevent
the widget from accessing the host page's DOM, cookies, or localStorage.

**Intercom's pattern**: A small JavaScript snippet is added to the host page. This
snippet creates a script element that loads from `https://widget.intercom.io/widget/{APP_ID}`.
It uses a queue-based initialization pattern -- API calls made before the widget script
loads are queued and replayed once loaded. The widget's outer container lives in the
host page's DOM, but the chat content itself renders inside an iframe.

**ChatGPT Apps (double-iframe pattern)**: OpenAI uses a sophisticated two-layer iframe
architecture:
- **Outer proxy layer**: A static HTML page hosted on an allowlisted domain (different
  from the host origin) that acts as a security boundary
- **Inner app layer**: The actual untrusted application rendered within the proxy

This avoids whitelisting every possible app domain in the host's CSP -- the host only
trusts one proxy domain, which then manages per-app constraints internally via
metadata-driven CSP (`connectDomains`, `resourceDomains`, `frameDomains`, `baseUriDomains`).

### Security Considerations

**Sandbox attributes** (from Drift's implementation):
- `allow-scripts` -- execute JavaScript
- `allow-same-origin` -- operate with correct origin for API calls
- `allow-popups` -- open links in new tabs
- `allow-popups-to-escape-sandbox` -- linked pages render without sandbox constraints
- `allow-forms` -- collect user input

**Critical security rule**: Never combine `allow-scripts` and `allow-same-origin` on
untrusted content -- this combination defeats the sandbox entirely. For trusted first-party
widgets (like Drift's own code) the combination is acceptable because you control the code.

**CSP headers**: Use `frame-src` to allowlist which domains can be embedded. A production
secure widget system provides:
- Complete DOM isolation (widgets cannot access page DOM)
- Storage isolation (widgets cannot read localStorage/cookies)
- Per-widget CSP policies
- Secure messaging through postMessage only

### Pros
- Strong security boundary via browser-enforced origin isolation
- No CSS/JS conflicts with host page
- Widget can be independently deployed and updated
- Well-understood pattern with decades of browser support
- Host page CSP can be minimal (just allow the widget origin)

### Cons
- Communication between host and widget is limited to postMessage
- Performance overhead from additional browsing context
- Responsive design challenges (iframe cannot auto-size to content easily)
- Some CSP configurations on host pages may block iframes entirely
- Cookie/auth sharing requires explicit coordination
- Mobile viewport issues (especially devices with notches)

### Relevance to Chatbox Bridge
An iframe approach could embed a custom-built chat UI (or a stripped-down Chatbox web
build) inside a host platform. The host platform would communicate session context,
auth tokens, and configuration via postMessage. This is the most isolation-preserving
approach but requires building or adapting a web-based chat UI specifically for iframe
embedding.

---

## 2. postMessage API Patterns

### How It Works

`window.postMessage()` is the standard mechanism for cross-origin communication between
windows, iframes, and popups. It is the backbone of every iframe-based widget integration.

**Typical message flow** (from Drift):
- **Host to iframe**: Passes context via typed messages like `driftSetContext` (location,
  navigator, dimensions) and `driftUpdateContext`
- **Iframe to host**: Sends events like `driftIframeResize` to adjust widget positioning
- **Validation**: Host checks `event.source === iframe.contentWindow` before processing

**ChatBotKit SDK pattern**: Provides a `postMessage()` method that sends messages to
widget frames. Events include `ready` (widget operational), `send` (user sends message),
and `receive` (bot responds). The host can call `sendMessage()`, `restartConversation()`,
`show()`, and `hide()` programmatically.

**MCP postMessage Transport** (proposed July 2025): A formal specification for using
postMessage as transport for the Model Context Protocol, featuring:
- Two-phase connection model: **Setup phase** (`#setup` hash) for one-time configuration
  and auth, and **Transport phase** for ongoing MCP communication
- 8 message types with `MCP_` prefixes: SetupHandshake, SetupHandshakeReply, SetupComplete,
  TransportHandshake, TransportHandshakeReply, TransportAccepted, MCPMessage, SetupRequired
- Session IDs for data isolation and continuity
- Origin validation via browser's `event.origin` with explicit allowlists

**OpenAI Apps SDK**: Uses JSON-RPC 2.0 over postMessage implementing the MCP Apps standard.
Key message types: `ui/notifications/tool-result`, `tools/call`, `ui/message`,
`ui/update-model-context`.

### Security Best Practices

1. **Always validate `event.origin`** -- never use wildcard `*` as targetOrigin in production
2. **Never validate only `event.source`** -- attackers can replace iframe src and gain
   control of the window object while source remains "trusted"
3. **Sanitize all incoming message data** -- prevent injection attacks
4. **Use HTTPS exclusively** -- prevent MITM attacks on message content
5. **Align CSP/CORS** with expected communication origins
6. **Rate-limit incoming messages** -- prevent DoS via message flooding
7. **Never `eval()` message content** -- treat all messages as untrusted data
8. **Use specific origin allowlists** -- avoid broad patterns like `*.domain.com`

**Microsoft's 2025 findings**: Overly broad origin validation (e.g., service-level
`*.domain.com` instead of app-specific) led to token theft, XSS, and privilege escalation
across Microsoft 365, Azure, and Dynamics 365.

### Typed Message Protocol Pattern

Best practice is to define a typed message schema:

```typescript
type BridgeMessage =
  | { type: 'INIT'; payload: { sessionId: string; config: Config } }
  | { type: 'SEND_MESSAGE'; payload: { content: string; metadata?: any } }
  | { type: 'RECEIVE_CHUNK'; payload: { delta: string; messageId: string } }
  | { type: 'STREAM_END'; payload: { messageId: string } }
  | { type: 'ERROR'; payload: { code: string; message: string } }
  | { type: 'RESIZE'; payload: { width: number; height: number } };
```

### Pros
- Native browser API, no dependencies
- Works cross-origin by design
- Supports structured data (anything serializable via structured clone)
- Can be wrapped in higher-level protocols (JSON-RPC, MCP)

### Cons
- Low-level -- requires building protocol layer on top
- No built-in delivery guarantees or ordering
- Debugging is difficult (messages are fire-and-forget)
- Security is entirely the developer's responsibility

### Relevance to Chatbox Bridge
postMessage is essential regardless of which integration approach is chosen. If using
iframes, it is the sole communication channel. The MCP postMessage transport proposal
is particularly relevant -- it provides a formal, security-conscious protocol that could
serve as the bridge protocol between a host platform and an embedded Chatbox instance.

---

## 3. OAuth-Based Integration

### How It Works

OAuth enables AI tools to authenticate users across platforms without sharing credentials.
The pattern varies significantly between providers.

**Claude Connectors** (launched July 2025): Anthropic's official integration system
featuring 50+ curated integrations (Jira, Confluence, Zapier, Intercom, Asana, etc.)
using a managed OAuth flow. Users click to authorize, and Claude can then access tools
on their behalf.

**OpenAI Apps SDK**: Uses OAuth/token-based flows for authentication, with apps running
in sandboxed iframes that receive authorized file IDs and capabilities.

**Third-party harness controversy** (February 2026): Anthropic banned the use of
consumer Claude Pro/Max OAuth tokens by third-party tools (like OpenClaw). This was a
deliberate policy decision to prevent flat-rate consumer plans from being exploited by
external automation. Google followed with similar restrictions. OpenAI notably did NOT
restrict this, and tools like OpenCode quickly added OpenAI support.

### Key Patterns

1. **Provider-managed OAuth** (Claude Connectors, ChatGPT plugins): The AI platform
   manages the OAuth flow, grants scoped tokens, and provides SDK/APIs for integration
2. **User-credential relay** (what Anthropic banned): Third-party tools use the user's
   own OAuth session tokens to drive the AI platform's web interface programmatically
3. **API key authentication**: Simpler alternative where users provide API keys directly
   to the client application (how Chatbox works today)
4. **Custom OAuth server**: Build your own OAuth provider that sits between the chat
   app and your platform, issuing scoped tokens for specific capabilities

### Pros
- Industry-standard security model
- Fine-grained permission scoping
- Token revocation and expiry built in
- Users control what access to grant

### Cons
- Complex implementation (authorization server, token management, refresh flows)
- Provider policy risk (Anthropic and Google banning third-party token use)
- Requires server-side infrastructure
- User experience friction (redirect flows, consent screens)

### Relevance to Chatbox Bridge
For a Chatbox bridge, the most practical approach is **API key passthrough**: the
custom platform provides API keys (or issues scoped tokens) that Chatbox uses to call
the platform's AI endpoint. Chatbox already supports custom OpenAI-compatible endpoints,
making this straightforward. A more sophisticated approach would implement OAuth so
users can authorize the bridge without exposing raw API keys.

---

## 4. Web Component / Shadow DOM Approaches

### How It Works

Web Components (Custom Elements + Shadow DOM + HTML Templates) enable building
encapsulated, reusable UI elements that work across any framework.

**Shadow DOM encapsulation**: Creates an isolated DOM subtree where styles and scripts
cannot leak in or out. This is critical for chat widgets that must maintain consistent
appearance regardless of the host page's CSS.

**Real-world examples**:
- **Langflow Embedded Chat**: Distributed as `<langflow-chat>` custom element via CDN
  or npm. Configuration via HTML attributes (`host_url`, `flow_id`, `api_key`). Supports
  25+ customization properties for styling and behavior. Framework-agnostic -- works
  in React, Vue, Angular, or vanilla HTML.
- **ChatBotKit Widget**: Uses `<chatbotkit-widget>` custom element with automatic
  (data attributes) or manual (programmatic) initialization. Exposes global
  `chatbotkitWidget` object for API access.
- **Helix Chat Widget**: React-based component distributed via npm, renders as a modal
  chat window connecting to any OpenAI-compatible endpoint.
- **Voiceflow react-chat**: Open-sourced web chat widget with full npm distribution.

**2025 adoption data**: Browser support is at 98% globally. Enterprise adoption
increased 156% from 2023-2025, with 73% of Fortune 500 companies implementing Web
Components in their design systems.

### Shadow DOM Modes

- **Open shadow root** (`mode: 'open'`): Host page JavaScript can access the shadow
  DOM via `element.shadowRoot`. Useful for theming and debugging.
- **Closed shadow root** (`mode: 'closed'`): No external access to shadow DOM internals.
  Provides stronger encapsulation and prevents malicious data extraction.

### Distribution Patterns

1. **CDN script tag**: Single `<script>` include, zero build step required
2. **npm package**: Install as dependency, import in build system
3. **Bundled with iframe**: Web component acts as the outer shell, rendering an iframe
   internally for maximum isolation

### Pros
- Framework-agnostic (works everywhere)
- CSS encapsulation prevents style conflicts
- Standard browser APIs, no runtime dependency
- Can be distributed via CDN (single script tag) or npm
- Composable -- can wrap iframe-based approaches for layered isolation

### Cons
- No JavaScript isolation (unlike iframes, Shadow DOM does not prevent script access)
- SSR limitations (Shadow DOM is client-side only)
- Styling customization requires CSS custom properties or parts API
- Event propagation across shadow boundaries requires careful handling
- Testing frameworks may struggle with shadow DOM inspection

### Relevance to Chatbox Bridge
A Web Component wrapper is an excellent distribution mechanism for a Chatbox bridge.
The component would be `<chatbox-bridge>` -- a single HTML element that host pages
include, configured via attributes. Internally, it could render an iframe (for security
isolation) or directly mount a React-based chat UI inside a shadow DOM (for tighter
integration). The Langflow Embedded Chat pattern is a strong template to follow.

---

## 5. SDK/Library Injection Approach

### How It Works

This is the pattern used by analytics tools (Segment, Amplitude) and chat widgets
(Intercom, Drift, Zendesk) to inject functionality into host pages via a small
JavaScript snippet.

**Typical injection pattern**:
```html
<script>
  // 1. Create lightweight stub/queue
  window.MyWidget = window.MyWidget || { queue: [] };
  window.MyWidget.push = function(args) { this.queue.push(args); };

  // 2. Queue any early API calls
  window.MyWidget.push(['init', { appId: 'xxx' }]);

  // 3. Async-load the full SDK
  var s = document.createElement('script');
  s.src = 'https://cdn.example.com/widget.js';
  s.async = true;
  document.head.appendChild(s);

  // 4. When SDK loads, it replays the queue and takes over
</script>
```

**Amplitude's middleware pattern**: SDK middleware runs custom code on every event,
supporting enrichment, transformation, filtering, and routing to third-party
destinations. This is relevant for intercepting and routing AI requests.

**CSP challenges**: When host sites enforce strict CSP with `unsafe-inline` disabled,
dynamically created inline styles and scripts are blocked. Solution: load dedicated
remote JavaScript and CSS files separately from trusted CDN domains.

### Pros
- Minimal integration effort for host page developers (copy/paste snippet)
- Can progressively load (stub -> full SDK)
- Full DOM access if needed (unlike iframe)
- Can use Shadow DOM for style isolation while maintaining JS access
- Familiar pattern to web developers

### Cons
- Runs in the host page's JavaScript context (security risk)
- Subject to host page's CSP restrictions
- Can conflict with host page's JavaScript and CSS
- Host page can inspect and tamper with the widget's code
- No isolation of cookies, localStorage, or network requests

### Relevance to Chatbox Bridge
An SDK injection approach would provide the easiest integration for platform developers
(just add a script tag), but offers the least security isolation. Best combined with
Shadow DOM for style encapsulation and iframe for code isolation. This is the right
choice for the "outer shell" that bootstraps the bridge.

---

## 6. Proxy/Middleware Approaches

### How It Works

Proxy and middleware layers sit between client applications and AI providers, providing
a unified API interface, routing, load balancing, and governance.

**LiteLLM** (open source, 470K+ downloads):
- Self-hosted proxy server implementing OpenAI-compatible `/v1/chat/completions`
- Supports 100+ LLM providers (OpenAI, Anthropic, Vertex AI, Bedrock, etc.)
- Features: weighted load balancing, automatic fallbacks, retry logic, cooldown periods
- Per-project cost tracking, virtual API keys, admin dashboard
- Configuration via YAML files (GitOps-friendly)
- Deployment: Docker, Kubernetes, or embedded Python SDK

**OpenRouter** (managed SaaS, $500M valuation as of June 2025):
- Fully managed edge-distributed API gateway
- 300+ models under unified billing
- ~25ms added latency per request
- Automatic health monitoring and failover
- No self-hosting option

**LibreChat** (open-source chat UI with multi-provider support):
- `librechat.yaml` configuration for custom endpoints
- Supports any OpenAI-compatible API without proxy
- Can layer with LiteLLM for advanced routing
- Authentication via env vars, user-provided keys, or hardcoded

**Chat Relay** (bridge pattern):
- OpenAI-compatible API server + browser extension + WebSocket
- Extension interacts with web-based chat UIs (Gemini, ChatGPT, Claude) via DOM
  manipulation
- API server translates between standard API calls and browser automation
- Enables programmatic access to services without official APIs

**AWS Multi-Provider Gateway**:
- Reference architecture for enterprise multi-provider AI routing
- API Gateway -> Lambda -> multiple provider endpoints

### Comparison

| Feature              | LiteLLM       | OpenRouter    | Custom Proxy  |
|----------------------|---------------|---------------|---------------|
| Self-hosted          | Yes           | No            | Yes           |
| Setup complexity     | Medium        | Low           | High          |
| Provider support     | 100+          | 300+          | Custom        |
| Cost tracking        | Built-in      | Dashboard     | Build it      |
| Load balancing       | Yes           | Yes           | Build it      |
| Compliance control   | Full          | Limited       | Full          |
| Latency overhead     | Minimal       | ~25ms         | Varies        |

### Pros
- Single API interface for multiple providers
- Provider-agnostic client code
- Centralized auth, rate limiting, and cost control
- Can add custom logic (guardrails, logging, transformations)
- Failover and load balancing built in

### Cons
- Additional infrastructure to deploy and maintain (for self-hosted)
- Added latency per request
- Single point of failure if not properly redundant
- Must keep up with provider API changes
- Managed solutions (OpenRouter) mean trusting a third party with API keys

### Relevance to Chatbox Bridge
A proxy/middleware layer is highly relevant. The bridge could implement an
OpenAI-compatible proxy endpoint that Chatbox connects to as a "custom provider."
This proxy would:
1. Receive standard chat completion requests from Chatbox
2. Inject platform-specific context, tools, or system prompts
3. Route to the appropriate AI provider
4. Apply platform-specific business logic (auth, rate limiting, logging)
5. Return responses in OpenAI-compatible format

Since Chatbox already supports custom OpenAI-compatible endpoints, this approach
requires ZERO modifications to Chatbox itself. LiteLLM could serve as the foundation,
or a lightweight custom proxy could be built.

---

## 7. Browser Extension Approaches

### How It Works

Browser extensions use content scripts to inject UI elements and functionality into
any web page. They operate with elevated privileges granted by the browser's permission
model.

**Architecture (Manifest V3, mandatory since Chrome 139 / June 2025)**:
- **Service worker** (background): Replaces persistent background pages. Handles API
  calls, state management, and cross-tab coordination. Wakes on events, sleeps when idle.
- **Content script**: Injected into web pages. Can read/modify DOM. Runs in isolated
  world (separate JS context from page scripts, but shared DOM).
- **Sidebar/popup UI**: Extension-controlled UI surfaces for complex interfaces.

**Shadow DOM injection pattern** (used by Monica, MaxAI, and others):
```javascript
// Content script creates isolated UI container
const wrapper = document.createElement('div');
wrapper.setAttribute('id', 'ai-assistant-container');
document.body.appendChild(wrapper);

// Attach shadow root for style isolation
const shadow = wrapper.attachShadow({ mode: 'closed' });

// Load extension CSS into shadow root
const style = document.createElement('link');
style.rel = 'stylesheet';
style.href = chrome.runtime.getURL('css/sidebar.css');
shadow.appendChild(style);

// Mount React/Vue app inside shadow root
const root = document.createElement('div');
shadow.appendChild(root);
ReactDOM.render(<Sidebar />, root);
```

**Monica AI**: Injects a persistent sidebar on every web page. Accesses page content
via DOM APIs. Routes requests through its own backend to multiple LLM providers
(GPT-4o, Claude, Gemini). Features: text selection hooks, PDF handling, page
summarization, translation.

**MaxAI**: Chrome-first extension with on-page sidebar and context tools. Supports
multiple providers with model switching. Provides reading, writing, translating, and
summarizing capabilities.

**Chat Relay** (hybrid approach): Browser extension connects to a local API server via
WebSocket. Extension manipulates chat UI DOM to send/receive messages. API server
exposes OpenAI-compatible endpoint for external tools.

### Manifest V3 Key Changes
- Service workers instead of persistent background pages
- `chrome.scripting` API for programmatic injection
- `web_accessible_resources` must declare CSS/assets for shadow DOM
- Stricter CSP (no remote code execution)
- `declarativeNetRequest` replaces `webRequest` blocking

### Pros
- Can augment ANY web page (most flexible integration point)
- Access to page content for context
- Shadow DOM provides style isolation
- Extension's isolated world prevents interference with page scripts
- Can intercept and modify network requests
- Native browser permission model for user consent
- Works across all websites without host page cooperation

### Cons
- Requires user to install an extension (adoption barrier)
- Browser-specific (Chrome, Firefox, Safari have different APIs)
- Manifest V3 restrictions limit some capabilities
- Extension review process adds deployment friction
- Cannot work on mobile browsers (except Firefox Android)
- Security concern: extensions have broad permissions
- Page layout conflicts with injected sidebars

### Relevance to Chatbox Bridge
A browser extension could serve as the bridge layer between a web-based platform and
Chatbox. Two sub-approaches:
1. **Extension as UI**: Inject Chatbox's UI directly into the platform's pages (like
   Monica does). The extension reads page context and sends it along with user messages.
2. **Extension as relay**: Like Chat Relay, use an extension to bridge between the
   platform's web UI and Chatbox running as a desktop app, using WebSocket or native
   messaging for communication.

---

## Comparative Analysis for Chatbox Bridge

### Approach Comparison Matrix

| Approach          | Integration Effort | Security | Isolation | Platform Reach | Chatbox Mods Needed |
|-------------------|--------------------|----------|-----------|----------------|---------------------|
| Iframe            | Medium             | High     | High      | Web only       | Need web build      |
| postMessage       | Low (protocol)     | Medium   | N/A       | Web only       | N/A (protocol)      |
| OAuth             | High               | High     | N/A       | Any            | Minimal             |
| Web Component     | Medium             | Medium   | Medium    | Web only       | Need web build      |
| SDK Injection     | Low                | Low      | Low       | Web only       | Need web build      |
| Proxy/Middleware   | Low-Medium         | High     | High      | Any            | **ZERO**            |
| Browser Extension | Medium-High        | Medium   | Medium    | Browsers only  | Minimal to none     |

### Recommended Architecture for Chatbox Bridge

The strongest approach combines multiple patterns:

**Layer 1 -- Proxy/Middleware (core bridge)**:
Build (or configure) an OpenAI-compatible proxy endpoint that Chatbox connects to
natively via its existing "custom provider" configuration. This requires no
modifications to Chatbox. The proxy handles:
- Authentication (API keys or OAuth tokens from the custom platform)
- Context injection (system prompts, RAG context from the platform)
- Tool/function routing (platform-specific tools)
- Usage tracking, rate limiting, guardrails
- Provider routing (forward to OpenAI, Anthropic, etc. as needed)

Technology options: LiteLLM (full-featured), custom Express/Fastify server (lightweight),
or extend LibreChat's endpoint system.

**Layer 2 -- Embeddable Web UI (optional, for web platform integration)**:
For web-based platforms that want an embedded chat experience, build a Web Component
(`<chatbox-bridge>`) that:
- Renders as a chat widget on the platform's pages
- Uses Shadow DOM for style encapsulation
- Internally loads an iframe pointing to a Chatbox web build (for code isolation)
- Communicates with the iframe via postMessage using a typed protocol
- Sends platform context to the proxy layer

**Layer 3 -- Browser Extension (optional, for enhanced context)**:
For platforms that want deep page-context integration without modifying their codebase:
- Content script reads relevant page data
- Injects a sidebar or floating widget
- Communicates with the proxy layer via the extension's service worker
- Can work alongside the desktop Chatbox app via native messaging

### Priority Recommendation

**Start with the proxy approach** (Layer 1). It delivers maximum value with minimum
effort because:
1. Chatbox already supports custom OpenAI-compatible endpoints -- zero client changes
2. All the platform-specific logic lives server-side where it is easier to iterate
3. Works with Chatbox on ALL platforms (desktop, web, mobile)
4. Can be enhanced incrementally with Layers 2 and 3 later

---

## Key Sources

### Iframe & Security
- [Secure and Make Your Iframe Compliant in 2025](https://www.feroot.com/blog/how-to-secure-iframe-compliance-2025/)
- [2026 Iframe Security Risks and 10 Ways to Secure Them](https://qrvey.com/blog/iframe-security/)
- [Securing Drift on Your Site with an iframe](https://devdocs.drift.com/docs/securing-drift-on-your-site-with-an-iframe)
- [I Reverse Engineered ChatGPT Apps Iframe Sandbox](https://dev.to/infoxicator/i-reverse-engineered-chatgpt-apps-iframe-sandbox-2ok3)
- [Building Secure Widget Systems with JavaScript & iframes](https://medium.com/aveva-tech/building-secure-widget-systems-with-javascript-iframes-4efd1e7963cc)
- [Play safely in sandboxed IFrames (web.dev)](https://web.dev/articles/sandboxed-iframes)

### postMessage
- [Window: postMessage() method (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)
- [Securing Cross-Window Communication: A Guide to postMessage](https://www.bindbee.dev/blog/secure-cross-window-communication)
- [PostMessaged and Compromised (Microsoft)](https://msrc.microsoft.com/blog/2025/08/postmessaged-and-compromised/)
- [MCP postMessage Transport Proposal](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1005)
- [ChatBotKit Widget SDK](https://chatbotkit.com/docs/widget-sdk)

### OAuth & AI Auth
- [Claude AI Connectors Guide](https://max-productive.ai/blog/claude-ai-connectors-guide-2025/)
- [Anthropic Locks Down Claude Subscriptions](https://midens.com/articles/2026-02-anthropic-oauth-ban-ai-tool-alternatives/)
- [Claude Can Now Connect to Your World](https://claude.com/blog/integrations)
- [Anthropic Clarifies Ban (The Register)](https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access/)

### Web Components & Shadow DOM
- [Web Components: Working With Shadow DOM (Smashing Magazine)](https://www.smashingmagazine.com/2025/07/web-components-working-with-shadow-dom/)
- [Using Shadow DOM (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_shadow_DOM)
- [Langflow Embedded Chat](https://github.com/langflow-ai/langflow-embedded-chat)
- [Chrome Extensions and Shadow DOM](https://railwaymen.org/blog/chrome-extensions-shadow-dom)

### SDK Injection
- [Amplitude SDK Middleware](https://amplitude.com/docs/sdks/sdk-middleware)
- [Embeddable JS Widget using Shadow DOM](https://github.com/surya304/Embeddable-JS-Widget)
- [TalkDesk Chat Widget V2](https://docs.talkdesk.com/docs/chat-widget-v2)

### Proxy/Middleware
- [LiteLLM Documentation](https://docs.litellm.ai/docs/)
- [LiteLLM vs OpenRouter](https://www.truefoundry.com/blog/litellm-vs-openrouter)
- [OpenRouter vs LiteLLM (Xenoss)](https://xenoss.io/blog/openrouter-vs-litellm)
- [LibreChat Custom Endpoints](https://www.librechat.ai/docs/quick_start/custom_endpoints)
- [Chat Relay](https://github.com/BinaryBeastMaster/chat-relay)
- [AWS Multi-Provider AI Gateway](https://aws-solutions-library-samples.github.io/ai-ml/guidance-for-multi-provider-generative-ai-gateway-on-aws.html)

### Browser Extensions
- [Chrome Manifest V3 Guide](https://dev.to/javediqbal8381/understanding-chrome-extensions-a-developers-guide-to-manifest-v3-233l)
- [Chrome Extension Shadow DOM (React)](https://medium.com/outreach-prague/develop-chrome-extensions-using-react-typescript-and-shadow-dom-1e112935a735)
- [Monica AI](https://monica.im/)
- [MaxAI Review 2025](https://skywork.ai/blog/maxai-chrome-extension-review-2025/)
- [AI Browser Extensions: Pros/Cons (2026)](https://seraphicsecurity.com/learn/ai-browser/ai-browser-extensions-pros-cons-and-8-extensions-to-know-in-2026/)

### Chatbox Architecture
- [Chatbox AI DeepWiki](https://deepwiki.com/chatboxai/chatbox)
- [Chatbox GitHub](https://github.com/chatboxai/chatbox)
- [Chatbox Provider Configuration](https://docs.chatboxai.app/en/guides/providers)

### Protocols & Standards
- [AG-UI Protocol](https://blog.logrocket.com/build-real-ai-with-ag-ui/)
- [OpenAI Apps SDK](https://developers.openai.com/apps-sdk/build/chatgpt-ui)
- [AI UI Patterns](https://www.patterns.dev/react/ai-ui-patterns/)

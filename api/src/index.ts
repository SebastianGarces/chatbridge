import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { join } from "path";
import { auth } from "./auth";
import { chatRoutes } from "./chat";
import { notionOAuthRoutes } from "./plugins/notion/oauth";
import { appRoutes } from "./plugins/routes";
import { db } from "./db";
import { sql } from "drizzle-orm";

// Static file serving for production (frontend + mini apps)
const PUBLIC_DIR = join(import.meta.dir, "../public");
const indexFile = Bun.file(join(PUBLIC_DIR, "index.html"));
const hasPublicDir = await indexFile.exists();

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".webp": "image/webp",
};

function getMimeType(path: string): string {
  const ext = path.slice(path.lastIndexOf("."));
  return MIME_TYPES[ext] || "application/octet-stream";
}

async function serveStatic(pathname: string): Promise<Response | null> {
  if (!hasPublicDir) return null;

  const filePath = join(PUBLIC_DIR, pathname);
  // Prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) return null;

  const file = Bun.file(filePath);
  if (await file.exists()) {
    return new Response(file, {
      headers: { "Content-Type": getMimeType(filePath) },
    });
  }

  // Directory index: try index.html inside the directory
  const indexPath = join(filePath, "index.html");
  if (indexPath.startsWith(PUBLIC_DIR)) {
    const indexF = Bun.file(indexPath);
    if (await indexF.exists()) {
      return new Response(indexF, {
        headers: { "Content-Type": "text/html" },
      });
    }
  }

  return null;
}

const app = new Elysia()
  .use(
    cors({
      origin: true,
      credentials: true,
    })
  )
  // Health check
  .get("/api/health", async () => {
    try {
      await db.execute(sql`SELECT 1`);
      return { status: "ok", db: "connected" };
    } catch (e) {
      return { status: "error", db: "disconnected" };
    }
  })

  // Chat routes
  .use(chatRoutes)
  // Notion OAuth
  .use(notionOAuthRoutes)
  // App listing
  .use(appRoutes);

const port = Number(process.env.PORT) || 3001;

function addCorsHeaders(response: Response, origin: string): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin || "*");
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Use Bun.serve directly to handle auth routing before Elysia
const server = Bun.serve({
  port,
  idleTimeout: 120, // 2 minutes — needed for streaming + tool calls (Notion, etc.)
  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    // Handle CORS preflight for all API routes
    if (request.method === "OPTIONS") {
      return addCorsHeaders(new Response(null, { status: 204 }), origin);
    }

    if (url.pathname.startsWith("/api/auth")) {
      const response = await auth.handler(request);
      return addCorsHeaders(response, origin);
    }

    // API routes → Elysia
    if (url.pathname.startsWith("/api")) {
      return app.fetch(request);
    }

    // Static file serving for production frontend + mini apps
    const staticResponse = await serveStatic(url.pathname);
    if (staticResponse) return staticResponse;

    // SPA fallback: serve index.html for unmatched routes
    // but NOT for /apps/* — those are mini apps with their own index.html
    if (hasPublicDir && !url.pathname.startsWith("/apps/")) {
      return new Response(indexFile, {
        headers: { "Content-Type": "text/html" },
      });
    }

    return app.fetch(request);
  },
});

console.log(`ChatBridge API running at http://localhost:${server.port}`);

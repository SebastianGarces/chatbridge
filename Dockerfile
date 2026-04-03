# Stage 1: Build mini apps
FROM oven/bun:1 AS app-builder

WORKDIR /build

# Build chess app
COPY apps/chess/package.json apps/chess/bun.lock apps/chess/
WORKDIR /build/apps/chess
RUN bun install --frozen-lockfile
COPY apps/chess/ .
RUN bun run build

# Build flashcards app
WORKDIR /build
COPY apps/flashcards/package.json apps/flashcards/bun.lock apps/flashcards/
WORKDIR /build/apps/flashcards
RUN bun install --frozen-lockfile
COPY apps/flashcards/ .
RUN bun run build

# Stage 2: Production image
FROM oven/bun:1

WORKDIR /app

# Install API dependencies
COPY api/package.json api/bun.lock api/
WORKDIR /app/api
RUN bun install --frozen-lockfile

# Copy API source
COPY api/ .

# Copy pre-built chatbox web frontend
COPY chatbox/release/app/dist/renderer/ ./public/

# Copy built mini apps from Stage 1
COPY --from=app-builder /build/apps/chess/dist/ ./public/apps/chess/
COPY --from=app-builder /build/apps/flashcards/dist/ ./public/apps/flashcards/

# Copy start script
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE ${PORT:-3001}

CMD ["/app/start.sh"]

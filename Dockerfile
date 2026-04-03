# Stage 1: Build mini apps
FROM oven/bun:1 AS app-builder

WORKDIR /build/apps/chess
COPY apps/chess/package.json apps/chess/bun.lock ./
RUN bun install --frozen-lockfile
COPY apps/chess/ .
RUN VITE_BASE=/apps/chess/ bun run build

WORKDIR /build/apps/flashcards
COPY apps/flashcards/package.json apps/flashcards/bun.lock ./
RUN bun install --frozen-lockfile
COPY apps/flashcards/ .
RUN VITE_BASE=/apps/flashcards/ bun run build

# Stage 2: Production image
FROM oven/bun:1

WORKDIR /app/api

# Install API dependencies
COPY api/package.json api/bun.lock ./
RUN bun install --frozen-lockfile

# Copy API source
COPY api/ .

# Copy pre-built chatbox web frontend
COPY web-dist/ ./public/

# Copy built mini apps
COPY --from=app-builder /build/apps/chess/dist/ ./public/apps/chess/
COPY --from=app-builder /build/apps/flashcards/dist/ ./public/apps/flashcards/

# Copy start script
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE ${PORT:-3001}

CMD ["/app/start.sh"]

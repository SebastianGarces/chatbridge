#!/bin/bash
set -e

cd /app/api

echo "Running database migrations..."
bunx drizzle-kit push --force || echo "Warning: drizzle-kit push had errors (tables may already exist)"

echo "Applying incremental schema changes..."
bun run src/db/migrate-incremental.ts || echo "Warning: incremental migration had issues"

echo "Seeding database..."
bun run src/db/seed.ts

echo "Starting ChatBridge API..."
exec bun run src/index.ts

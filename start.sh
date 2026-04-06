#!/bin/bash
set -e

cd /app/api

echo "Running database migrations..."
bunx drizzle-kit push --force || echo "Warning: drizzle-kit push had errors (tables may already exist)"

# Ensure new schema additions exist (drizzle push may fail on existing constraints)
echo "Applying incremental schema changes..."
bun -e "
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL);
async function migrate() {
  // Add review_status enum and column if missing
  await sql\`DO \$\$ BEGIN
    CREATE TYPE app_review_status AS ENUM ('pending', 'approved', 'rejected');
  EXCEPTION WHEN duplicate_object THEN NULL; END \$\$\`;
  await sql\`ALTER TABLE app_registrations ADD COLUMN IF NOT EXISTS review_status app_review_status NOT NULL DEFAULT 'approved'\`;

  // Add oauth_states table if missing
  await sql\`CREATE TABLE IF NOT EXISTS oauth_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    state TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )\`;

  await sql.end();
  console.log('Schema additions applied.');
}
migrate().catch(e => { console.error('Schema migration warning:', e.message); process.exit(0); });
" || echo "Warning: incremental migration had issues"

echo "Seeding database..."
bun run src/db/seed.ts

echo "Starting ChatBridge API..."
exec bun run src/index.ts

.PHONY: dev api web db seed chess flashcards

# Start everything
dev: db
	@echo "Starting API and Web..."
	@cd api && bun run dev &
	@cd chatbox && pnpm dev:web &
	@wait

# Individual services
api:
	cd api && bun run dev

web:
	cd chatbox && pnpm dev:web

db:
	docker compose up -d

seed:
	cd api && bun run src/db/seed.ts

chess:
	cd apps/chess && bun run dev

flashcards:
	cd apps/flashcards && bun run dev

# DB management
db-push:
	cd api && bunx drizzle-kit push

db-studio:
	cd api && bunx drizzle-kit studio

# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

Kindred — a minimal self-hosted friend/relationship CRM. Next.js (App
Router) + TypeScript + Tailwind + better-sqlite3, single SQLite file at
`data/kindred.db`. See `README.md` for deployment, backups, and the ICS feed.

## Core principle: agent-API-first

**Features should generally be exposed via the agent API** (`/api/agent/*`),
not just the web UI. The project exists so that AI agents can manage the
data — anything a user can do in the UI should also be doable through the
token-authenticated JSON API.

When adding or changing a feature:

1. Put business logic in `lib/` as plain functions with no Next.js imports
   (see `lib/contacts.ts`) so UI pages and API routes share it.
2. Add routes under `app/api/agent/` following the existing pattern:
   - Start with `export const runtime = "nodejs";` and
     `export const dynamic = "force-dynamic";`
   - Gate **every** handler with `isAgentAuthorized(request)` from
     `lib/agent-auth.ts` (the Bearer token is the ICS feed token); on failure
     return `401` with `{"error": "Unauthorized"}`.
   - Validate input with validators in `lib/`; return
     `400 {"error": "<message>"}` for bad input and `404` for missing rows.
3. Update all three documentation surfaces **in the same change**:
   - `skills/kindred/SKILL.md` — the skill agents consume
   - `app/api-docs/ApiDocsClient.tsx` — the in-app `/api-docs` page
   - `README.md` — "AI agent API" section and the layout listing
4. Never weaken the auth model: `/api/agent/*` stays Bearer-gated.
   `/api/contacts/*` and `/api/feed/*` are deliberately open (see the
   comments in `middleware.ts`) — don't "fix" that without being asked.

## Layout

```
app/            pages (server components) + API route handlers
  api/agent/    token-authenticated API for AI agents — add features here
  api-docs/     in-app API documentation page
lib/            shared logic: db, contacts, agent-auth, ics, backups, auth
skills/kindred/ agent skill (SKILL.md) teaching AI to use the API
scripts/        node helpers + in-container shell scripts
proxmox/        LXC provision/update scripts
docs/           design docs (e.g. BACKUPS.md)
kindred-mcp/    standalone MCP server wrapping the agent API (own package.json,
                tsconfig, tests; separate build/test lifecycle from the app)
```

## Commands

- `npm run dev` — dev server on :3000
- `npm run build` — type-check + production build; must pass before committing
- `npm run print:feed-token` — print the API/feed token
- Test API changes with curl against a throwaway DB:
  `DATABASE_PATH=/tmp/kindred-test.db PORT=3100 npm start`

For the `kindred-mcp/` package (separate lifecycle):
`cd kindred-mcp && npm install && npm run build && npm test`

## Conventions

- TypeScript, 2-space indent, server components by default; `"use client"`
  only where interactivity requires it.
- SQLite via the better-sqlite3 singleton in `lib/db.ts` (WAL mode);
  key/value app state goes in the `settings` table.
- Tailwind styling in the existing stone/amber palette — match nearby
  components rather than introducing new patterns.
- Keep it minimal: small focused changes, no new dependencies without a
  strong reason (the app is sized for a 1-core/1 GB LXC).

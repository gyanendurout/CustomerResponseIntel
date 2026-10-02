# Community Intel: notes for Claude

Read-only analytics API (REST `/api/v1`) and MCP server (`/api/mcp`) over the JOOLA social-listening data in Supabase.
Live at https://customer-response-intel.vercel.app (Vercel, auto-deploys on push to `main`).

## Where to find things

| Question | Look in |
|---|---|
| Keys, tokens, passwords, connection strings, connector URL, Vercel/Supabase details | `PRIVATE_NOTES.md` (local only, git-ignored), then `.env` |
| Plain-language overview, status, what is left to do | `docs/OVERVIEW.md` |
| Every design decision and why (D1–D30) | `docs/plans/2026-10-02-community-intel.md` |
| Connecting Claude Code / Desktop / the Claude app | `docs/CONNECT_CLAUDE.md` |
| Source tables and columns | `docs/SCHEMA.md` |
| Known data problems and how the views handle them | `docs/DATA_QUALITY.md` |
| REST routes and MCP tools (generated) | `docs/API.md`, `docs/MCP_TOOLS.md` |
| Suggested scraper fixes | `docs/BACKEND_FIXES.md` |

## Rules

- **The GitHub repo is PUBLIC.** Never put secrets in a committed file. Secrets live only in `.env` and
  `PRIVATE_NOTES.md` (both git-ignored). Scan staged files for secrets before every commit.
- **Read-only.** Never INSERT/UPDATE/DELETE/TRUNCATE/DROP in existing tables. New database objects only as files in
  `supabase/sql/`, shown to the owner and applied by the owner after approval.
- **No customer PII in any output**: no usernames, handles, display names, profile URLs, commenter IDs or emails.
- **Never invent column names**; check `docs/SCHEMA.md`.
- Ask before anything irreversible (applying SQL, deploys, changing Vercel/Supabase settings, rotating secrets).

## Commands

```bash
npm test                                  # unit, SQL (PGlite), capabilities, REST, MCP, docs (no real DB needed)
npm run typecheck && npm run build
npm run expected && npm run test:real     # read-only checks against the real DB (needs DATABASE_URL in .env)
node scripts/hash-key.mjs                 # new API key / MCP token and its sha256
UPDATE_DOCS=1 npx vitest run tests/docs.test.ts   # regenerate docs/API.md and docs/MCP_TOOLS.md
```

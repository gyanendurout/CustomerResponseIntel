# Community Intel — REST API + MCP server

Read-only analytics over the JOOLA social-listening dataset (JOOLA + 10 competitors; Instagram, YouTube, Reddit,
TikTok, X and retailer product reviews). One Next.js app on Vercel serves:

* **REST** `/api/v1/*` for the dashboard (`x-api-key`, OpenAPI 3.1 at `/api/v1/openapi.json`)
* **MCP** `/api/mcp` for Claude (Streamable HTTP; `Authorization: Bearer <token>`)

Both call the same core layer, so every capability exists as a REST route **and** an MCP tool.

```
supabase/sql/          numbered migrations: intel schema, adapter views, v_signals, other views, read-only role
src/core/              shared query layer: normalise, filters, periods, registry, capabilities/ (one file each)
src/server/            REST handler, MCP tool registration, auth, rate limit, OpenAPI, docs generator
app/                   thin Next.js routes: api/v1/[...route], api/mcp
tests/                 unit · sql (PGlite) · capabilities · api · mcp · real (read-only, real DB)
docs/                  SCHEMA, DATA_QUALITY, API, MCP_TOOLS, CONNECT_CLAUDE, BACKEND_FIXES, plans/
```

## Setup

```bash
npm install
cp .env.example .env      # fill in values; never commit .env
```

1. **Database objects:** review the migrations in `supabase/sql/` (001 → 090), then run them in order in the Supabase
   SQL editor. In `090_readonly_role.sql`, replace the password placeholder **in the editor only**.
2. **DATABASE_URL:** transaction pooler (port 6543) as `intel_reader.<project-ref>`. The role has
   `default_transaction_read_only = on`, a 15 s `statement_timeout`, and can read only the published `intel` views.
3. **API keys and MCP tokens:** `node scripts/hash-key.mjs` prints a new key and its sha256. Put `label:sha256` in
   `API_KEYS` (REST) or `MCP_TOKENS` (MCP).

## Run locally

```bash
npm run dev               # http://localhost:3000
curl -H "x-api-key: <key>" "http://localhost:3000/api/v1/volume?brands=JOOLA&granularity=month"
npx @modelcontextprotocol/inspector   # Streamable HTTP → http://localhost:3000/api/mcp, header Authorization: Bearer <token>
```

## Test

```bash
npm test                  # unit + SQL (PGlite, synthetic data) + capabilities + REST + MCP end-to-end + docs sync
npm run coverage
npm run typecheck
npm run expected && npm run test:real   # read-only checks on the real DB (after migrations are applied)
```

The SQL tests load the **real column layout** of every source table (`tests/fixtures/public-schema.sql`, generated
from the live schema) plus every migration into embedded Postgres, with synthetic rows covering each known data
problem. No customer data is copied locally.

## Deploy (each step needs the owner's go-ahead)

1. Create the Vercel project from this repo. The region is pinned to `iad1` (Washington, D.C.) in `vercel.json`,
   matching Supabase `us-east-1`.
2. Set the environment variables from `.env.example` (Production and Preview).
3. Deploy a **preview**, test it with MCP Inspector, then promote to production.
4. Add the server to Claude Code with your token (docs/CONNECT_CLAUDE.md).

## Adding more tables later

* **New mention-like source** (e.g. `x_replies`): one migration with `intel.v_src_x_replies` following the adapter
  contract (see `011_v_src_ig_comments.sql`), plus one `UNION ALL` line in `020_v_signals.sql`. Every capability picks
  it up; `tests/sql/contract.test.ts` checks the contract.
* **New kind of data** (e.g. prices): one migration with an `intel.v_<thing>` view (grant it in a new migration), and
  one file in `src/core/capabilities/` added to `src/core/registry.ts`. The REST route, MCP tool, OpenAPI entry and
  docs are generated; run `UPDATE_DOCS=1 npx vitest run tests/docs.test.ts`.
* **New metric or grouping:** add it to the whitelists in `src/core/capabilities/metrics.ts`.

# Community Intel: plain-language overview and handoff

Status on 2026-10-02 (updated). Secrets and exact connection details are in `PRIVATE_NOTES.md` (local only).

- The build is complete. 205 tests pass, and the typecheck and production build succeed.
- The SQL views and the read-only login are applied in Supabase. Checked against the real data: the login is
  read-only, all 17 views exist, totals match an independent recount (51,762 items, 53,323 signals), and all 15 tools
  work with no usernames, handles or emails in their output.
- Speed (decision D28): 0–3.1 s of database time per tool. No pre-built copy, so new data shows up instantly.
- Deployed: https://customer-response-intel.vercel.app. All 15 REST routes and MCP tools checked live; no PII found.

---

## 1. How the system fits together

There is **one database**. The "cleaned" layer is a set of read-only **views** inside that same Supabase database, in
a separate `intel` schema. It is not a second database.

```
Scrapers ──writes──▶ ┌──────────── Supabase (one database) ────────────┐
                     │  public schema: your raw tables (unchanged)     │
                     │        │                                        │
                     │        ▼  views are live saved queries, no copy │
                     │  intel schema: cleaned views                    │
                     └────────────────────┬────────────────────────────┘
                                          │ read-only login (intel_reader)
                                          ▼
                                shared query code (15 capabilities)
                                     │                 │
                                     ▼                 ▼
                         REST API /api/v1        MCP /api/mcp
                           (x-api-key)       (Authorization: Bearer token)
                                     │                 │
                                     ▼                 ▼
                                 Dashboard     Claude Code / Claude Desktop
```

- **REST and MCP sit side by side.** They are two doors into the same query code, so their numbers always match.
- **MCP never calls the REST API.**
  - MCP is the format Claude understands. REST is the format a dashboard or app expects.
  - Each tool answers a fixed, safe question, such as "volume by month" or "top complaints". No tool runs free SQL.

## 2. Why there are SQL files when the data is already in Supabase

The SQL files **create views only**. They do not copy data or change your tables. A view is a saved query that runs
against the raw tables every time it is read.

The raw tables have problems that would give wrong answers if queried directly:

| Problem in the data | What the views do |
|---|---|
| 3,856 duplicate rows in `mention_facts` | Count each item once |
| About 96% of YouTube comments have no date | Use the video's publish date instead |
| Product reviews are mixed in with Reddit | Keep them as their own channel |
| Usernames inside comment text and links | Mask them (`@user`, `[link]`) |
| 9 source tables, each with different columns | Combine them into one common shape |

Doing the counting inside Postgres also avoids Supabase's 1,000-row limit on API responses.

The **read-only login** (`090_readonly_role.sql`) is what the app connects with, instead of the admin key. With it,
even a bug cannot write or delete anything, and it has no access to the username columns.

### What the 17 SQL files are

| What | Files | Why it exists |
|---|---|---|
| Helper functions (mask usernames, normalise sentiment and channel) | 1 | Hides usernames and makes labels consistent |
| Brand list view | 1 | One clean list of the 11 brands |
| One view per source table (`v_src_*`) | 9 | Maps each table's columns into the common shape |
| Combined view (`v_signals`) | 1 | Joins all 9 sources, removes duplicates, fills in brands and dates |
| Topic views (switches, weekly topics, replies, data health) | 4 | Pre-built answers for specific capabilities |
| Read-only login | 1 | No writes possible, and username columns unreachable |

Removing the whole layer takes one command, `DROP SCHEMA intel CASCADE`, and the raw data stays untouched.

## 3. Authentication

**OAuth has been removed** (decision D27 in `docs/plans/2026-10-02-community-intel.md`).

| Endpoint | How to log in | Setting |
|---|---|---|
| REST `/api/v1` | `x-api-key: <key>` header | `API_KEYS=label:sha256,...` |
| MCP `/api/mcp` | `Authorization: Bearer <token>` header | `MCP_TOKENS=label:sha256,...` |

- Generate a key or token, together with its hash, by running `node scripts/hash-key.mjs`.
- Only the hashes are stored. Give each person or device its own label, and revoke one by deleting its entry.
- Both endpoints are rate-limited per key or token.
- **What this rules out:** custom connectors in the claude.ai website and mobile app support only OAuth, so they
  cannot connect.
  - **Claude Code** and **Claude Desktop** work. Setup steps are in `docs/CONNECT_CLAUDE.md`.
  - If claude.ai web access is ever needed, OAuth would have to be added back.

## 4. When new data arrives from scraping

| What happens | Changes needed |
|---|---|
| Scrapers add more rows to existing tables | **None.** The views read live data, so new rows show up in the next query, already cleaned. |
| A new brand is added to `brands` | **None.** Brand filters and keyword matching pick it up. Optionally add a colour in `src/core/brand-palette.ts`; until then it shows grey. |
| A new column is added to a table | **None.** Views ignore extra columns. Update that table's view only if the API should use the new column. |
| A column is renamed or dropped | **Update that one view.** Postgres blocks the change while a view depends on the column. |
| A new source table is added (e.g. `fb_comments`) | **One view file plus one line.** Add `supabase/sql/02x_v_src_fb_comments.sql` (copy the Instagram one), add one `UNION ALL` line to `020_v_signals.sql`, run the tests, then apply both files. All 15 capabilities include it automatically. |
| A new kind of data (e.g. prices) | **One view plus one capability file** in `src/core/capabilities/`, registered in `src/core/registry.ts`. The REST route, MCP tool and docs are generated from it. |

To spot problems early, the `data_health` capability shows how fresh each channel's data is.

## 5. What the system guarantees

- **Read-only access.**
  - Every query runs in a read-only transaction, with a time limit.
  - The database login itself is read-only.
- **No customer PII in any output.**
  - No usernames, handles, profile links or emails.
  - Post and video links are rewritten into forms that don't contain the account's handle.
- **Secrets stay out of the code.** They live only in environment variables, and `.env` is git-ignored.
- **The database connection is always encrypted.** The server certificate is not verified yet (decision D29);
  adding `DATABASE_CA_CERT` in Vercel turns verification on with no code change.

## 6. Where things are

```
supabase/sql/   migrations 001–090 (views + read-only role), applied in order in the Supabase SQL editor
supabase/diagnostics/  optional read-only queries (indexes, constraints); not a migration
scripts/        hash-key (make keys), expected-signals (real-data check), openapi + gen-* (refresh schema/test fixture)
src/core/       shared query layer; capabilities/ holds one file per capability
src/server/     REST handler, MCP tools, auth, rate limit, OpenAPI, docs generator
app/            thin Next.js routes: api/v1/[...route], api/mcp
tests/          unit, sql (PGlite), capabilities, api, mcp, real (read-only checks against the real DB)
docs/           SCHEMA, DATA_QUALITY, API, MCP_TOOLS, CONNECT_CLAUDE, BACKEND_FIXES, plans/ (decision log)
```

Commands: `npm test`, `npm run typecheck`, `npm run build`, and `npm run expected && npm run test:real`. The last one
needs `DATABASE_URL`.

## 7. Still to do (each needs the owner's go-ahead)

Done: service key rotated, migrations applied, `DATABASE_URL` set, real-data checks passing, keys made, code on
GitHub (gyanendurout/CustomerResponseIntel, public), deployed to https://customer-response-intel.vercel.app.

1. **Connect Claude.** In the Claude app or claude.ai, use Add custom connector with the private connector URL
   (`/api/mcp/<token>`, in `PRIVATE_NOTES.md`). Claude Code and Desktop can use the header instead (`docs/CONNECT_CLAUDE.md`).
2. **Optional: verify the database certificate.** Add `DATABASE_CA_CERT` (from `.env`) in Vercel and redeploy.
3. **TikTok link format:** on hold (currently the `tiktok.com/embed/v2/<id>` form).
4. **Optional Supabase settings:** turn on "Enforce SSL"; turn off "Automatically expose new tables".

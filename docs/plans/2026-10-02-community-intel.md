# Community Intel Backend — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A read-only analytics backend over the JOOLA social-listening data. It exposes 15 capabilities as
REST routes (`/api/v1/*`) and as MCP tools (`/api/mcp`) from one Next.js deployment on Vercel (`iad1`).

**Architecture:** Each source table gets an adapter view in a dedicated `intel` schema. All adapters share one
column contract. `intel.v_signals` is their `UNION ALL`, de-duplicated and brand-fanned-out using `mention_facts`.
A TypeScript capability registry (one file per capability: zod input, handler, MCP description, summariser) drives
the REST routes, MCP tools, OpenAPI spec and docs. Queries are compiled with Kysely; every value is bound and every
identifier comes from a whitelist.

**Tech stack:** Node 20+ (dev on 24), TypeScript strict, Next.js 16 App Router, `mcp-handler` 2.2 +
`@modelcontextprotocol/server` 2.2, zod 4, Kysely 0.29 (used as a query compiler only), `pg` 8 → Supavisor
transaction pooler, vitest 5, PGlite 0.5 (embedded Postgres for SQL tests), jose 6 (JWT verification for OAuth; removed with D27).

Status: sections 1–3 were approved interactively on 2026-10-02. The owner approved the defaults for sections 4–6
("build with defaults, review the plan doc later").

---

## 1. Understanding summary (confirmed)

* **What:** a read-only REST and MCP backend; 15 capabilities; one shared core layer.
* **Why:** so the dashboard and Claude can answer social-listening questions, including unplanned ones, via `metrics`.
* **Who:** the owner, the owner's dashboard, and Claude (custom connector).
* **Constraints:** no writes; new DB objects only as approved migrations in `supabase/sql/`; no PII; all counting in SQL;
  p95 < 2 s; secrets in env vars only.
* **Non-goals:** UI (apart from a minimal OAuth consent page, which OAuth requires); scraper changes; raw-SQL tools;
  `joola_ig_comments`.
* **Must stay easy to expand to more tables** (owner requirement).

## 2. Assumptions

1. Traffic is low (well under 10 rps). A per-instance in-memory rate limit is acceptable (60 req/min/key).
2. About 55k signals, growing slowly. Plain views are enough; no materialised views.
3. Data refreshes daily (around 07:30–08:03 UTC).
4. Best-effort availability; no SLA.
5. The owner applies migrations by hand in the Supabase SQL editor.
6. `topic_lifecycle.week_number` is an ISO week. This is verified by a test against `first_seen_at`.

## 3. Decision log

| # | Decision | Alternatives | Why |
|---|---|---|---|
| D1 | Approach A: adapter views + TS query builder + capability registry | B: one plpgsql RPC per capability; C: materialised rollups | Best for expansion: a new capability needs no migration. TS logic is unit-testable. C needs write access. |
| D2 | All new objects live in schema `intel`; the read-only role can read only `intel` views | Grant SELECT on raw tables | PII columns become unreachable by construction. `public` stays untouched. |
| D3 | Grain = raw row × distinct brand (stored ∪ mention_facts ∪ keyword fallback) | Primary brand only | Owner choice (#1). Correct share of voice for multi-brand posts. |
| D4 | De-dup via `mention_facts(source_table, source_id)` ID linkage + `DISTINCT` | Text + brand + channel match | An exact ID link exists (0 orphans). Text matching is lossy. |
| D5 | Engagement and type from the raw row; mention_facts only for enrichment and brand | mf as the base | Brief rule #3; raw text is full length. |
| D6 | YouTube and IG date fallback = parent video/post publish date; `date_source ∈ {posted, parent_published, none}` | `scraped_at` | Owner choice (#2). Scrape time is not when the comment happened. |
| D7 | Brand colours in `src/core/brand-palette.ts` (colour-blind-safe; JOOLA fixed accent) | DB column; none | No DB write; the owner can swap in official hex codes. |
| D8 | Complaints = `paddle_reviews.complaint_category` (reviews) + `crisis_keywords` (social) | One of them | Owner choice (#4). |
| D9 | Mask `@handle` → `@user` in all returned text | Return as-is | Owner choice (#5). 18 % of IG comments carry tags. |
| D10 | Reddit brand inference: mention_facts brand, then `brands.reddit_keywords` text match | Parent post (impossible: 0 parents) | Owner choice (#6). |
| D11 | Channels: instagram, youtube, reddit, tiktok, x, product_review, other. Exclude `joola_ig_comments` | Include it | It is JOOLA-only and would bias share of voice. |
| D12 | `mcp-handler` 2.x + `@modelcontextprotocol/server` v2 + zod 4 | mcp-handler 1.x + sdk 1.x | Current line (Sep 2026); stateless; no Redis. |
| D13 | MCP auth Phase A = static bearer (Inspector only); Phase B = Supabase Auth OAuth 2.1 server (DCR) | Hosted IdP; self-built AS | Owner choice. Free; same project. Claude requires OAuth (static headers are limited beta). |
| D14 | Default date window = last 90 days ending at the newest data date, not today | Ending today | Avoids fake trailing drops when scrapes lag. |
| D15 | Spike = value > mean + k·sd of the previous N periods (N=8, k=2, min 4 baseline periods) | Seasonal decomposition | Simple, explainable, documented. |
| D16 | Kysely used only as a SQL compiler; execution goes through a tiny `Db` interface (pg Pool in prod, PGlite in tests) | Raw strings; Kysely with a driver | Safe dynamic SQL, and the same code runs on both engines. |
| D17 | OpenAPI 3.1 generated from the registry with zod 4's `z.toJSONSchema` | zod-openapi lib | No extra dependency; JSON Schema 2020-12 is what OAS 3.1 uses. |
| D18 | Pre-apply validation against real data: migration bodies are rewritten into CTEs and run in `READ ONLY` transactions | Wait for approval | The SQL can be verified on real data without creating any object. |
| D19 | `search_posts` uses `ILIKE` (no `pg_trgm`) | Install pg_trgm | Installing an extension is a DB change. About 55k rows is fine. Revisit if p95 > 2 s. |
| D20 | X/TikTok links rewritten to handle-free forms (`x.com/i/status/<id>`, `tiktok.com/embed/v2/<id>`) by `intel.canonical_url` | Return as stored | 1,213 X and 1,461 TikTok URLs embed the poster's handle (found in review). |
| D21 | `mask_pii` also turns links in text into `[link]`; Unicode-aware; any handle length | ASCII-only masking | Security review: profile URLs and non-ASCII handles leaked. |
| D22 | Brand assignment split into `intel.v_signal_brands`; `v_signals` uses the adapter union once; one combined keyword regex per brand | One view with CTEs used several times | DB review: CTEs referenced more than once are materialised, which blocks filter pushdown; the regex cache thrashes. |
| D23 | Every query runs in `BEGIN READ ONLY` + `SET LOCAL statement_timeout` | Startup `-c` options | Pooler may ignore startup options; this enforces read-only per transaction for any role. |
| D24 | MCP OAuth tokens must carry `client_id`; audience checked when present; algorithms pinned; static bearer refused when `VERCEL_ENV=production`; per-caller MCP rate limit | issuer-only check | Security review: ordinary Supabase session tokens could otherwise be replayed. |
| D25 | Production DB TLS requires `DATABASE_CA_CERT` (or explicit `DATABASE_SSL_INSECURE=1`) | Silent unverified TLS | Fail closed. |
| D26 | Kept EXECUTE grants on helper functions | Drop them (DB reviewer) | PostgreSQL docs: functions in a view are permission-checked as the querying user. |
| D27 | **Supersedes D13/D24.** OAuth removed. MCP uses per-device bearer tokens (`MCP_TOKENS`, `label:sha256`, same scheme as `API_KEYS`), allowed in production | Keep Supabase OAuth | Owner choice: fewer moving parts. Works in Claude Code / Desktop; claude.ai web connectors would need OAuth back. |
| D28 | No materialized view: tools query live views (DB time 0–3.1 s per tool on real data; new rows visible instantly). Example/search queries rank on cheap columns, then mask text for the winners only (`fetchItems`) | Materialized `v_signals` refreshed every 15 min by pg_cron (< 1 s per tool, up to 15 min lag) | Owner choice (A): mainly used from Claude, where a few seconds is fine. Revisit if a dashboard needs sub-second responses. |
| D29 | **Supersedes D25.** `DATABASE_CA_CERT` is optional: with it TLS is verified, without it the connection is encrypted but unverified (no startup error) | Require the CA in production | Owner choice: simpler deploy. Verification can be switched on later by adding the variable. |
| D30 | MCP also accepts the token as the last URL segment (`/api/mcp/<token>`), checked against the same `MCP_TOKENS` hashes | Bring back OAuth | The Claude app's "Add custom connector" dialog takes only a URL. Trade-off: a URL token appears in Vercel request logs. |
| D31 | MCP tool results also include the full `{data, meta}` as a JSON text block, next to the summary and `structuredContent` | Summary text only | The Claude apps pass only `content` to the model, so comment text and links never reached Claude. The MCP spec recommends this for structured results. |

## 4. Design

### 4.1 Architecture (approved)

```
REST  app/api/v1/[...route]/route.ts ─┐  auth → zod → core → envelope
MCP   app/api/mcp/route.ts           ─┤  auth → zod → core → structuredContent + text summary
                                      ▼
src/core/registry.ts → src/core/capabilities/<name>.ts  {name, route, description, input, run, summarise}
src/core/filters.ts   common filters → WHERE + excluded counts
src/core/normalise.ts enums, sentiment rollup, granularity, brand resolution
src/core/db.ts        Db interface; pg Pool (pooler :6543, read-only role, statement_timeout 15s)
                                      ▼
intel.v_src_<table> (adapters) → intel.v_signals ; intel.v_brands, v_switch_events, v_topic_weekly, v_replies
```

**Expansion recipes**
* New mention-like table: add an `intel.v_src_<t>` migration and one `UNION ALL` line in `v_signals`. All capabilities pick it up.
* New kind of data: add an `intel.v_<thing>` migration and one capability file. The REST route, MCP tool, OpenAPI entry and docs follow automatically.
* New `metrics` measure or grouping: one whitelist entry in TS.
* A contract test checks that every `v_src_*` exposes exactly the signal column set (same names, order and types).

### 4.2 `v_signals` (approved)

Column contract (in order): `signal_id uuid, source_table text, source_row_id uuid, brand_id uuid, brand_source text,
brand_method text, channel text, signal_type text, sentiment_5 text, sentiment_3 text, is_crisis boolean, text text,
post_url text, engagement bigint, engagement_kind text, complaint_keywords text[], occurred_at timestamptz,
date_source text`.

* Each adapter emits one row per raw row: `raw_brand_id` plus the common columns.
* `v_signals` joins `(SELECT DISTINCT source_table, source_id, brand_id FROM mention_facts)` to fan out brands.
  The brand set = {raw brand} ∪ {mf brands}. If empty, use the keyword match on `brands.reddit_keywords`, else NULL.
* `brand_source = 'stored'` when brand = raw brand, else `'inferred'`. `brand_method ∈ {raw, mention_facts, keyword, none}`.
* `signal_id = md5(source_table||':'||source_row_id||':'||coalesce(brand_id::text,'none'))::uuid`.
* `sentiment_5 = coalesce(lower(sentiment_label), 'unlabelled')`. A value outside the 5 levels also becomes `unlabelled`.
* `sentiment_3`: very_negative/negative → negative; very_positive/positive → positive; neutral; unlabelled.
* Text masking: `regexp_replace(text, '(^|[^A-Za-z0-9_.])@[A-Za-z0-9_.]{2,30}', '\1@user', 'g')`.
  The guard before `@` keeps e-mail-like strings from being half-masked; they are also masked by a second email pattern.
* Reconciliation: `count(v_signals) = Σ raw rows × |brand set|` (an integration test asserts this per source table).

### 4.3 Other views and the query layer (approved)

* `v_switch_events`: `occurred_at = coalesce(posted_at, detected_at)`; `date_source ∈ {posted, detected, none}`;
  `has_date` (posted), `has_from`, `has_to`; channel NULL → `reddit` if `source_mention_id` resolves, else `unknown`.
* `v_topic_weekly`: `week_start = to_date(year||'-'||lpad(week_number,2,'0'),'IYYY-IW')`; `twitter → x`; `lag()` growth.
* `v_replies`: brand_replies columns, masked text. The capability reports `insufficient_data` while rows < 30.
* `v_brands`: id, name, slug, is_joola, is_active, reddit_keywords. Colours are added in TS.
* Filters → SQL in one place. `excluded` counts come from `FILTER` clauses in the same query. Undated rows never get
  a period; lists use `NULLS LAST`; "recent" lists exclude undated rows.

### 4.4 Contracts (default, owner to review)

**REST**
* `GET /api/v1/<route>`. Array params are comma-separated (`brands=joola,selkirk`) or repeated.
* Booleans are `true|false`.
* Success: `200 {data, meta}`. Failure: `{error:{code,message,details}}` with:
  * `400 VALIDATION_ERROR | UNKNOWN_BRAND | UNSUPPORTED_COMBINATION`
  * `401 UNAUTHORIZED`
  * `429 RATE_LIMITED` (with `Retry-After`)
  * `500 INTERNAL` (generic message; details only in server logs)
  * `503 DB_TIMEOUT`
* `GET /api/v1/openapi.json` is public.

**MCP**
* Tool name = capability name. `inputSchema` = the same zod object.
* Result `{ content:[{type:'text', text: summary}], structuredContent: {data, meta} }`.
* Results are kept under 25 KB by a shared guard: it truncates lists and adds a note.
* Errors return `isError: true` with a helpful text, e.g. "Unknown brand 'jola' — did you mean JOOLA? Valid: …".

**Common filters**
* `from`, `to` (ISO date), `brands[]`, `channels[]`, `sentiments[]` (5-level or 3-level values), `crisis_only`,
  `granularity` (day|week|month), `include_undated`.
* Brand inputs accept a name, slug, UUID or unique prefix, case-insensitive. An unknown brand gets a Levenshtein suggestion.

**Meta**
`{filters, generated_at, rows_counted, excluded:{undated, unbranded, unlabelled_sentiment}, notes[], units?, series?, page?}`.

**Paging**
* Keyset cursor = base64url(JSON `{k: sortValue, id: signal_id}`). `limit` is 1–50 (default 20).
* `search_posts` sorts by `date` (default) or `engagement`.

**`metrics` whitelist**
* measure ∈ count, negative_pct, positive_pct, crisis_count, avg_engagement, total_engagement.
* group_by is 1–2 of period, brand, channel, sentiment_5, sentiment_3, signal_type, topic.
* `topic` reads `v_topic_weekly`. Only `count` (= Σ mention_count) is valid with `topic`; any other measure → `400 UNSUPPORTED_COMBINATION`.
* Results are capped at 500 groups, with a note.

| # | Tool | Route | Notes |
|---|---|---|---|
| 1 | list_brands | /brands | + colour, is_joola |
| 2 | channel_overview | /channels | total, dated, undated, first/last occurred_at, last scrape (max scraped_at/created_at per channel) |
| 3 | volume_over_time | /volume | split_by brand\|channel; growth % vs previous period |
| 4 | share_of_voice | /share-of-voice | brand % per period |
| 5 | sentiment_breakdown | /sentiment | group_by brand\|channel\|period; 5 + 3 level counts and % |
| 6 | top_complaints | /complaints | top N keywords per brand; monthly trend; 3 examples each |
| 7 | search_posts | /posts | q (ILIKE, 2–100 chars), sort, cursor, limit ≤ 50, text ≤ 500 chars |
| 8 | crisis_monitor | /crises | crisis count per period + 10 most recent dated crisis signals |
| 9 | detect_spikes | /spikes | metric volume\|negative_pct; N, k params |
| 10 | brand_switching | /switches | JOOLA (or the given brand) inflow/outflow/net, matrix, monthly trend, gaps |
| 11 | topic_trends | /topics | weekly volume, fastest growing, peak week, JOOLA vs competitor share |
| 12 | compare_brands | /compare | 2–5 brands: volume, SoV, negative %, crisis count, top complaint |
| 13 | metrics | /metrics | whitelist above |
| 14 | data_health | /data-health | null date/brand per table, last scrape per channel, known-issue checklist with live counts |
| 15 | brand_replies | /replies | reply stats + `insufficient_data` |

`data_health` needs per-table null counts over raw tables. It reads `intel.v_data_health`, an aggregate-only view
with no row-level output.

### 4.5 Auth, rate limiting, CORS (default)

* **REST:** `x-api-key`. `API_KEYS` env = comma list of `label:sha256hex`. The incoming key is hashed and compared with
  `crypto.timingSafeEqual` against every entry. The label is logged; the key never is.
* **Rate limit:** in-memory sliding window per key label, 60 req/min, per instance (documented as best-effort).
* **MCP, Phase A** (`MCP_AUTH_MODE=bearer`): `MCP_BEARER_TOKEN_SHA256`; constant-time compare; for local and Inspector use only.
* **MCP, Phase B — REMOVED (see D27; kept here for history).** (`MCP_AUTH_MODE=oauth`): `withMcpAuth` + `verifyToken`:
  * Validate the Supabase Auth JWT via JWKS (`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`) with `jose`.
  * Check `iss`, `exp`, and that `sub` ∈ `MCP_ALLOWED_USER_IDS`.
  * Serve `/.well-known/oauth-protected-resource` with `protectedResourceHandler({authServerUrls:[SUPABASE_URL + '/auth/v1']})`.
  * Add a minimal consent page at `/oauth/consent`.
  * **The owner enables the OAuth server and DCR in the Supabase dashboard; that is not done by Claude.**
* **CORS:** REST only; `ALLOWED_ORIGIN` env (exact match); `OPTIONS` preflight; MCP is not CORS-enabled.
* **Response headers:** `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.

### 4.6 Testing and deployment (default)

* **Unit (vitest):** normalise.ts (100 % coverage), filters, cursor, auth, rate limit, summarise, size guard, PII scanner.
* **SQL tests (PGlite):** apply the real migration files (minus role/grant statements) to a synthetic `public` schema
  that mirrors the real column definitions. Assert de-dup, brand fan-out, keyword inference, date fallback, masking,
  ISO weeks, and the adapter contract.
* **Real-data validation (read-only):**
  * `DATABASE_URL` + `default_transaction_read_only=on`.
  * Migration bodies are rewritten into CTEs (D18).
  * Reconciliation vs source counts; no truncation over full history; distinct DB values ⊆ TS enums.
* **Capability tests:** every capability with no filters, with each filter alone, and with an empty range (PGlite fixtures),
  plus the PII scanner over every output (forbidden keys + `@handle` regex).
* **MCP:** an SDK client (`@modelcontextprotocol/client`, or the server package's in-memory transport) lists and calls every
  tool; outputs are validated against the documented shapes. Inspector CLI commands are documented for the owner.
* **Perf:** not built yet. Measure p95 per capability against the real DB once `DATABASE_URL` is available.
* **Deploy (owner approves each step):** Vercel project (region `iad1`) → env vars → preview → Inspector → production →
  `docs/CONNECT_CLAUDE.md`.

## 5. Migration files (to be shown to the owner; NOT applied by Claude)

| File | Creates |
|---|---|
| `001_intel_schema.sql` | schema `intel`; revoke from public/anon/authenticated |
| `010_v_brands.sql` | `intel.v_brands` |
| `011_v_src_ig_comments.sql` … `019_v_src_paddle_reviews.sql` | one adapter per source (9 files) |
| `020_v_signals.sql` | `intel.v_signals` |
| `030_v_switch_events.sql` | `intel.v_switch_events` |
| `031_v_topic_weekly.sql` | `intel.v_topic_weekly` |
| `032_v_replies.sql` | `intel.v_replies` |
| `033_v_data_health.sql` | `intel.v_data_health` (aggregate-only) |
| `090_readonly_role.sql` | role `intel_reader` (LOGIN; password set by the owner), USAGE on intel, SELECT on intel views, role-level `statement_timeout=15s`, `default_transaction_read_only=on` |

No indexes are proposed until the benchmark shows a need.

## 6. Tasks (phase by phase; each task = test first, then implementation, then run)

**Phase 2a — scaffold:** package.json, tsconfig (strict), vitest config, Next app skeleton, `.env.example`, README stub.
**Phase 2b — migrations + SQL tests:** synthetic fixture schema generated from `scripts/out/openapi.json`; tests per
adapter, `v_signals`, the other views; then real-data CTE validation (when `DATABASE_URL` exists).
**Phase 3a — core:** normalise.ts → brand resolution → filters → db → registry types → envelope/errors.
**Phase 3b — capabilities 1–15:** one at a time, each with PGlite tests (no filter / each filter / empty range / PII scan).
**Phase 4 — REST:** catch-all route, auth, rate limit, CORS, OpenAPI; route tests via `Request` objects.
**Phase 5 — MCP:** handler, bearer auth, tool registration from the registry, SDK client tests; OAuth Phase B code + consent page.
**Phase 6 — docs:** API.md, MCP_TOOLS.md (generated from the registry), CONNECT_CLAUDE.md, BACKEND_FIXES.md, README.
**Phase 7 — verification:** full test run + coverage, typecheck, `next build`, bench (if DB access), code + security review agents.
Deployment is not started without owner approval.

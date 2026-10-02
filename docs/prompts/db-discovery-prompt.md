# Prompt: database discovery for Community Intel expansion

Give everything below the line to a coding agent that has a connection to the Supabase database. Its output file is
the input for the next round of Community Intel development (new views, REST routes and MCP tools).

---

You are surveying a Supabase Postgres database so another engineer can extend a read-only analytics API on top of it.
Your only job is to **observe and report**. Produce one Markdown file, `db-discovery-<YYYY-MM-DD>.md`, in exactly the
structure given in "Output format" below.

## Hard rules (follow strictly)

1. **Read-only.** Run only `SELECT`, `SHOW`, `EXPLAIN` (without `ANALYZE` on large tables) and catalog queries. Never
   run INSERT, UPDATE, DELETE, TRUNCATE, DROP, ALTER, CREATE, GRANT, REVOKE, COMMENT, VACUUM, REFRESH or any function
   that changes state. Start every session with `set default_transaction_read_only = on;` and
   `set statement_timeout = '30s';`. If a query times out, report that instead of retrying with a longer timeout.
2. **Do not change anything** in the Supabase dashboard: no settings, extensions, keys, roles, policies or schemas.
3. **No personal data in your output.** Never copy usernames, handles, display names, real names, emails, phone
   numbers, profile URLs, avatar URLs, user/commenter/account IDs, IP addresses or addresses into the report.
   - You MAY report column names, types, counts, null rates, min/max dates, and distinct values of
     low-cardinality category columns (status, channel, sentiment label, category, language, country code).
   - Free text (comments, posts, reviews, captions) may appear only as **at most 3 examples per table**, each passed
     through `intel.mask_pii(...)` (it exists in the database) and cut to 150 characters. If in doubt, leave it out.
4. **No secrets.** Do not print connection strings, passwords, API keys, JWT secrets or service keys.
5. **Do not touch the `intel` schema** except to read it (it is the existing analytics layer, described below).
6. **Never guess.** If something cannot be determined from the database, write "unknown" and say what would answer it.
   Every column name you report must come from the catalog, not from assumption.

## Context: what already exists

The analytics layer lives in schema `intel` (views and helper functions; do not modify). It already covers these
`public` tables:

`brands`, `mention_facts`, `ig_comments`, `ig_posts`, `yt_comments`, `yt_videos`, `reddit_mentions`,
`reddit_comments`, `tiktok_comments`, `tiktok_videos`, `x_posts`, `influencer_x_posts`, `paddle_reviews`,
`competitor_switch_events`, `topic_lifecycle`, `brand_replies`.

The core view `intel.v_signals` turns every mention, comment, post and review into one row per (item × brand) with:
`source_table, source_row_id, brand_id, channel, signal_type, sentiment_5, sentiment_3, is_crisis, text (masked),
post_url, engagement, engagement_kind, complaint_keywords, occurred_at, date_source`. New "mention-like" tables are
added through one adapter view each (`intel.v_src_<table>`), so for every candidate table the most important facts are:
**which columns map to those fields**, and **how the table links to `brands`**.

The public schema has about 138 tables and views in total. The goal of this survey is to find what else is worth
exposing (for example: products, prices, sales, inventory, ads, campaigns, influencers, events, web/SEO, support
tickets, or any other data JOOLA would ask questions about) and everything needed to build it safely.

## What to collect

### A. Inventory (all schemas except pg_catalog, information_schema, pg_toast, auth, storage, realtime, vault, supabase_*)
For every table, view and materialized view:
- schema, name, kind (table / view / matview), estimated rows (`pg_class.reltuples`) and exact `count(*)` when the
  estimate is below 5 million, total size (`pg_total_relation_size`), table comment (`obj_description`).
- Mark each one: **covered** (in the list above), **candidate** (new and looks useful for analytics), **internal**
  (logs, queues, migrations, staging, backups, auth/system), or **empty** (0 rows).
- For views: the view definition (`pg_get_viewdef`), shortened if very long.

### B. Detail for every *candidate* table (and for covered tables only if their columns changed)
1. **Columns:** name, type, nullable, default, PK, FK target, unique, check constraints, column comment.
2. **Indexes:** full definitions (`pg_indexes.indexdef`). Note whether there is an index on the time column and on the
   brand/foreign-key column.
3. **Grain:** what one row represents, and the natural key (which columns are unique together). Verify with
   `count(*)` vs `count(distinct (...))`.
4. **Time:** every date/timestamp column with null %, min, max, and which one is the business date (when the thing
   happened) vs ingestion date (`created_at`, `scraped_at`). Rows per month for the last 12 months (one query).
5. **Brand linkage:** does it have `brand_id` (FK to `brands`)? If not, how could it be linked (product → brand,
   text keyword, another table)? Report match rates (% of rows that resolve to a brand).
6. **Relationships:** FKs in and out, and likely joins without declared FKs (same-named id columns). For each, the %
   of rows that actually resolve (orphan check).
7. **Category columns:** for every text/enum column with fewer than 50 distinct values, list the values with counts.
   Flag inconsistent spellings/casing (e.g. `Instagram` vs `instagram`).
8. **Measures:** numeric columns (likes, views, price, quantity, revenue, rating, score) with null %, min, max, avg,
   and units/currency if knowable.
9. **Text columns:** which columns hold free text, their average length, null %, and the masked examples (rule 3).
10. **Sentiment / labels / AI fields:** any sentiment, topic, category, crisis or score columns, with their value sets.
11. **PII classification:** list every column that identifies a person (see rule 3) as `PII: never expose`.
12. **Data quality:** duplicates on the natural key, nulls in important columns, impossible values (negative counts,
    future dates), stale data (max date far in the past), and anything surprising.
13. **Freshness and growth:** rows added per day over the last 30 days (by ingestion date) and the newest row's
    timestamp, so we know how often the scraper or sync runs.

### C. Database-wide facts
- Postgres version (`select version()`), installed extensions (`pg_extension`) and available ones of interest
  (`pg_trgm`, `pg_cron`, `unaccent`, `vector`, `pg_stat_statements`).
- Functions/RPCs in `public` (name, arguments, return type, language, volatility); one line each on what they do.
- Triggers on candidate tables (`pg_trigger`, non-internal), and scheduled jobs (`cron.job` if it exists; read only).
- RLS: which candidate tables have row level security enabled, and their policies (`pg_policies`).
- Which schemas are exposed through the Supabase Data API (Dashboard → Project Settings → Data API; read only).
- Roles: confirm `intel_reader` exists and list its current table privileges (`information_schema.role_table_grants`).

### D. Your recommendations (clearly marked as opinion)
For each candidate table or group of related tables:
- **Business questions it can answer** (3–6 concrete examples, e.g. "Which JOOLA paddles get the most 1-star reviews
  per retailer this quarter?").
- **Proposed capability/tool names** and their main inputs/outputs (e.g. `product_ratings(brand, product, from, to,
  group_by=retailer|month)` → rows of {product, retailer, avg_rating, review_count}).
- **How it joins** to the existing signals (brand, date, channel) so it can be compared with social data.
- **Risks:** PII, size/performance (need for indexes), data quality issues, unclear meaning of columns.
- **Priority:** high / medium / low, with a one-line reason.

## Output format (exact)

Write `db-discovery-<YYYY-MM-DD>.md` with these sections, in this order, using Markdown tables wherever possible:

```
# DB discovery – <date>
## 0. Summary            (10 bullets max: biggest opportunities, biggest risks, counts of candidate/internal/empty)
## 1. Inventory          (one table: schema | name | kind | rows | size | status | comment)
## 2. Candidate tables   (one subsection per table, items B1–B13, in that order)
## 3. Relationships      (diagram in text or Mermaid + table of joins with resolve %)
## 4. Database facts     (section C)
## 5. PII register       (table: schema.table | column | why it is PII)
## 6. Data quality issues (table: table | issue | rows affected | severity)
## 7. Recommendations    (section D, sorted by priority)
## 8. Open questions     (things only the data owner can answer)
## 9. Queries used       (every SQL statement you ran, in order, so results can be reproduced)
```

Before finishing, re-read the whole file and remove anything that breaks rule 3 or rule 4. At the end of the file,
add a line: `Checked: no PII values, no secrets, read-only queries only.`

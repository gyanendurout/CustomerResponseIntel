# DATA_QUALITY — measured facts (Phase 0)

> Measured 2026-10-02 against the live database with read-only GET/HEAD requests
> (one-off read-only profiling scripts, since removed; the counts below are a snapshot).
> Newest data: 2026-09-28. "Last 90 days" = 2026-06-30 → 2026-09-28.

## 1. Per-table profile

| Table | Rows | Primary date | Min | Max | % null date | % null brand |
|---|---|---|---|---|---|---|
| brands | 11 | — | — | — | — | — |
| mention_facts | 50,660 | posted_at | 2009-01-16 | 2026-09-28 | 8.3 % (4,227) | 0 % |
| ig_comments | 12,057 | posted_at | 2025-04-18 | 2026-09-28 | 1.1 % (132) | 0 % |
| yt_comments | 3,777 | posted_at | 2026-06-09 | 2026-09-28 | **95.7 % (3,616)** | 0 % |
| reddit_mentions | 1,493 | posted_at | 2025-04-11 | 2026-09-28 | 0 % | 0 % |
| reddit_comments | 3,064 | posted_at | 2025-04-11 | 2026-09-28 | 0 % | **49.3 % (1,510)** |
| tiktok_comments | 1,077 | posted_at | 2023-06-28 | 2026-09-27 | 0 % | 0 % |
| competitor_switch_events | 147 | posted_at | 2025-11-25 | 2026-09-21 | **70.1 % (103)** | from 8.2 % / to 21.1 % |
| topic_lifecycle | 82,558 | year+week | 2026-W26 | 2026-W40 | first_seen_at 11.8 % | 0 % (NOT NULL) |
| brand_replies | 4 | replied_at | 2026-05-18 | 2026-05-29 | 0 % | 0 % |
| paddle_reviews | 27,579 | posted_at | — | 2026-09-22 | 0 % | 0 % |

Scrape recency (max `scraped_at` / `created_at`): every channel last ran on **2026-09-28 between 07:32 and 08:03 UTC**.
Reviews: newest `posted_at` 2026-09-22.

## 2. Distinct values

**`mention_facts.channel`:** product_review 25,908 · ig_comment 12,136 · yt_comment 4,258 · reddit_comment 2,391 ·
reddit 2,113 · tiktok 1,497 · tiktok_comment 1,085 · x_influencer 775 · x 497.

**`topic_lifecycle.channel`:** instagram 29,954 · reddit 21,656 · tiktok 13,463 · youtube 10,879 · **twitter** 6,606.
It uses `twitter` where `mention_facts` uses `x`; normalisation must map both to `x`.

**Sentiment (`sentiment_label`):** exactly the 5 expected values, stored lowercase with underscores:
`very_negative, negative, neutral, positive, very_positive`. NULL ("unlabelled") counts:

| Table | very_neg | neg | neutral | pos | very_pos | NULL |
|---|---|---|---|---|---|---|
| mention_facts | 725 | 2,937 | 14,348 | 31,019 | 1,587 | 44 |
| ig_comments | 225 | 324 | 7,337 | 3,103 | 1,058 | 10 |
| yt_comments | 231 | 455 | 1,946 | 929 | 216 | 0 |
| reddit_mentions | 48 | 296 | 643 | 501 | 5 | 0 |
| reddit_comments | 166 | 429 | 1,636 | 757 | 36 | 40 |
| tiktok_comments | 47 | 64 | 591 | 301 | 73 | 1 |

`reddit_mentions.sentiment` is a legacy 3-level column (1,042 NULL) and will be ignored.

## 3. Duplicate overlap: `mention_facts` vs raw tables

**There is an exact ID linkage:** `mention_facts(source_table, source_id)` → raw row `id`. No text matching is needed.

* **0 orphans.** Every `source_id` resolves to a live raw row.
* **IG text identity:** 12,071 / 12,136 snippets are identical to `comment_text`; the remaining 65 are truncated prefixes. 0 differ.
* **IG engagement:** `mention_facts.engagement = ig_comments.comment_likes` on 100 % of rows.
* **Enrichment agreement:** where brand matches, `sentiment_label` and `is_crisis` agree with the raw row on **100 %**
  of rows, across all 6 tables checked.
* **`mention_facts` contains internal duplicates (not in the brief):** 4,483 source rows appear more than once (max 24×).
  * **3,856 extra rows are exact repeats** (same source row + same brand). This is a fan-out bug in the builder.
    paddle_reviews accounts for 3,698 of them.
  * **1,204 source rows legitimately map to several brands** (one row per brand mentioned).
  * Sentiment/crisis never differ inside a group.
* Missing from `mention_facts`: 1,147 reddit_comments and 5,369 paddle_reviews (the 5,369 are exactly the reviews with
  `complaint_category IS NULL`, i.e. not yet enriched).

**Reconciliation target for `v_signals`** (to be asserted by integration tests in Phase 2):
`count(v_signals) = Σ over raw rows of |brand set|` (brand set = stored brand ∪ mention_facts brands, else keyword match,
else one unbranded row). mention_facts rows whose source table has no adapter are not signals; `v_data_health` counts
them (`mention_facts_unmapped`, currently 0). Measured numbers are in §6.

## 4. The 9 known problems, re-measured

| # | Brief said | Measured | Verdict |
|---|---|---|---|
| 1 | product_review ≈ 832 rows in 90 days, 329 crisis | **902** in last 90 days, **11** crisis. 329 is the **all-time** crisis count, out of **25,908** total review rows (51 % of mention_facts). Source is `paddle_reviews` (okendo/yotpo/judgeme/bazaarvoice). 10,891 reviews pre-date 2025. | **Corrected.** Own channel confirmed. |
| 2 | 5 sentiment levels | Confirmed exact values (see §2). 44 NULL in mf; 95 NULL across comment tables. | Confirmed |
| 3 | IG duplicated in mf with identical text | Confirmed, plus an **ID linkage** (`source_id`) and **3,856 exact duplicate rows inside mention_facts**. | Confirmed + extra issue |
| 4 | 3,616 / 3,777 YT have no posted date | Confirmed 3,616. `scraped_at` is 100 % populated. **3,604 of the 3,616 have a parent `yt_videos.published_at`**. The 161 "dated" rows all carry microsecond timestamps (2026-06-09 onward), which looks machine-generated rather than a real YouTube publish time. | Confirmed + suspicion |
| 5 | 1,510 / 3,064 reddit comments lack brand | Confirmed 1,510. **All 1,510 also lack `parent_post_id`**, so parent inference is impossible. `mention_facts` already assigns a brand to 460 of them. The rest can only be text-matched via `brands.reddit_keywords`. | Confirmed; inference path changed |
| 6 | Switch events: 103 no date, 12 no from, 31 no to | Confirmed 103 / 12 / 31. **All 103 undated rows have `detected_at`** (0 rows lack both). `mention_id` is never populated; `source_mention_id` → reddit_mentions resolves 103/103. `channel` is NULL on 44. | Confirmed + fallback exists |
| 7 | 251 crisis rows have no date | Confirmed **251**, and **all are `yt_comment`** (problem 7 is a consequence of problem 4). | Confirmed |
| 8 | 1,000-row cap | Confirmed: PostgREST aggregates are **disabled** (`PGRST123`). All counting must be in SQL. | Confirmed |
| 9 | brand_replies: 4 rows, 0-minute response | Confirmed: 4 rows, all `ig_comments`, all `response_time_mins = 0`, all `joola_responded = true`, dates 2026-05-18 → 05-29. `is_brand_reply` is `false` on **every** comment row in all tables. | Confirmed |

## 5. Other findings not in the brief

1. **`brands` has no colour column.** `list_brands` cannot return colours without a new source (see open questions).
2. **No "complaint keywords" column on social tables.** Options: `crisis_keywords text[]` (social) and
   `paddle_reviews.complaint_category` (reviews, 13 categories: customer_service 246, durability_other 197,
   delamination 99, dead_spot 78, price 77, edge_guard 74, shipping_damage 65, broken_handle 44, grip_wear 40,
   core_crush 35, paint_chipping 27, wrong_item 12; plus `none` 21,216 and NULL 5,369).
3. **Channels beyond the brief:** `tiktok_videos` (1,461), `x_posts` (484) and `influencer_x_posts` (770) feed `mention_facts`.
4. **`reddit_mentions` includes 88 rows with `content_type = 'Comment'`.**
5. **Old content:** mention_facts has posted dates back to 2009 (product reviews and X influencer posts). The default
   "last 90 days" window avoids this.
6. **`topic_lifecycle` covers only 2026 weeks 26–40** (≈ 15 weeks), with 2,947 distinct topics.
7. **`mention_facts` is fully rebuilt each run**, so its `id` is not stable. `signal_id` must be derived from the raw row id.
8. **PII inside free text:** text containing `@` appears in 2,224 IG comments (18 %), 238 YT, 48 TikTok and 3,155 mf
   snippets. These are mostly `@user` tags. I recommend masking `@handle` → `@user` in `v_signals.text`.
9. `joola_ig_comments` (13,782 rows) exists separately from `ig_comments`. It is out of scope unless you say otherwise.
10. `product_reviews` is empty (0 rows). Reviews live in `paddle_reviews`.

## 6. Reconciliation: expected `intel.v_signals` counts (computed 2026-10-02)

`scripts/expected-signals.mjs` recomputes the view logic **independently** (in JS, from the live source tables,
GET-only) so the applied view can be checked against it (`tests/real/real.test.ts`). Grain: one *signal* per raw row ×
distinct brand; one *item* per raw row.

| Source | Items (raw rows) | Signals | Stored brand | + mention_facts brands | + keyword | Unbranded | Multi-brand items |
|---|---|---|---|---|---|---|---|
| ig_comments | 12,057 | 12,124 | 12,057 | 67 | 0 | 0 | 50 |
| yt_comments | 3,777 | 4,234 | 3,777 | 457 | 0 | 0 | 414 |
| reddit_mentions | 1,493 | 2,071 | 1,493 | 578 | 0 | 0 | 390 |
| reddit_comments | 3,064 | 3,475 | 1,554 | 771 | 10 | **1,140** | 344 |
| tiktok_comments | 1,077 | 1,083 | 1,077 | 6 | 0 | 0 | 6 |
| tiktok_videos | 1,461 | 1,487 | 1,461 | 26 | 0 | 0 | 26 |
| x_posts | 484 | 495 | 484 | 11 | 0 | 0 | 11 |
| influencer_x_posts | 770 | 775 | 770 | 5 | 0 | 0 | 5 |
| paddle_reviews | 27,579 | 27,579 | 27,579 | 0 | 0 | 0 | 0 |
| **Total** | **51,762** | **53,323** | | | | | |

How this reconciles with `mention_facts` (50,660 rows):

* 50,660 − 3,856 exact duplicates = 46,804 distinct (source row, brand) pairs.
* `v_signals` adds raw rows that `mention_facts` never covered: 1,147 reddit_comments and 5,369 paddle_reviews
  (not yet enriched). These count with their stored brand, or as unbranded.
* Engagement and type always come from the raw row. Text comes from the raw row (full length, `@handles` masked),
  never from the 286-character `text_snippet`.

**Surprise:** brand inference rescues only 370 of the 1,510 unbranded Reddit comments (360 via `mention_facts`, 10 via
keywords). **1,140 (37 % of all Reddit comments) stay unbranded.** They are mostly thread replies that never name a brand.
They are reported as `excluded.unbranded` in brand-split results, and they are counted in channel totals.

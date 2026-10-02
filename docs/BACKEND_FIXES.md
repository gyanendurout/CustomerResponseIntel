# BACKEND_FIXES — recommended fixes for scrapers and enrichment

> **Recommendations only. None of these are implemented by this repository.** The analytics layer works around each
> problem (see DATA_QUALITY.md); fixing them at the source would make the numbers more complete. Counts are from
> 2026-10-02.

## 1. Store real posted dates for YouTube comments (highest impact)

* **Problem:** 3,616 of 3,777 `yt_comments` (95.7 %) have `posted_at = NULL`. The 161 that do have one carry microsecond
  timestamps starting 2026-06-09, which looks like a processing time rather than YouTube's `publishedAt`. All 251
  undated crisis rows in the system are YouTube comments.
* **Workaround today:** the comment inherits the parent video's `published_at` (`date_source = parent_published`).
  That is a lower bound and can be months early.
* **Fix:** read `snippet.topLevelComment.snippet.publishedAt` (and `updatedAt`) from the YouTube Data API
  `commentThreads.list` response and store it in `posted_at`. Backfill existing rows by `youtube_comment_id`
  (`comments.list?id=…`, 50 ids per call). Also store `likeCount` in one column only: `comment_likes` is populated,
  `like_count` never is.

## 2. Store brand ids on Reddit comments, and link them to their post

* **Problem:** 1,510 of 3,064 `reddit_comments` have no `brand_id`, and **all 1,510 also have no `parent_post_id`**, so
  the brand cannot be inherited from the thread. After inference (mention_facts brands, then keyword match), **1,140
  remain unbranded**.
* **Fix:** when scraping a thread's comments, set `parent_post_id` to the `reddit_mentions.id` of the thread (match on
  `link_id` = `t3_<reddit_post_id>`) and copy the post's `brand_id`. Run brand detection on the comment text as well and
  store all brands mentioned. Backfill: resolve `link_id` for existing comments via the Reddit API `info` endpoint.
  1,147 Reddit comments are also missing from `mention_facts` entirely; include them in the next enrichment run.

## 3. Dates and brands on competitor switch events

* **Problem:** 103 of 147 events have no `posted_at` (they do have `detected_at`), 12 have no `from_brand_id`,
  31 have no `to_brand_id`, `channel` is NULL on 44, and `mention_id` (FK to mention_facts) is never populated.
* **Fix:** copy `posted_at` from the source mention (`source_mention_id` → `reddit_mentions.posted_at` resolves for all
  103). Resolve brand names in the detector's output with the same alias list as `brands.reddit_keywords`, and store
  NULL with a `from_brand_text` / `to_brand_text` column when no tracked brand matches ("my old paddle") instead of
  dropping it. Always set `channel`. Either populate `mention_id` or drop it: mention_facts ids change on every rebuild,
  so `source_table` + `source_id` is the stable reference.

## 4. Schedule and fix the reply detector

* **Problem:** `brand_replies` has 4 rows (May 18–29, 2026), all Instagram, all with `response_time_mins = 0`, and
  `is_brand_reply` is `false` on every comment in every table. Meanwhile `joola_ig_comments` contains **28 rows with
  `is_joola_reply = true`**, so replies are being scraped but not detected.
* **Fix:** run the detector on a schedule (daily, after the comment scrapes). Mark brand replies by comparing the
  commenter with each brand's own account handles (`ig_accounts` / `yt_channels` / `tiktok_accounts`). Compute
  `response_time_mins` as `reply.posted_at − parent.posted_at`, and store NULL rather than 0 when either date is
  missing. Use `joola_ig_comments.is_joola_reply` + `parent_comment_id` as a second source.

## 5. Fix `mention_facts` duplicates

* **Problem:** 3,856 rows are exact duplicates (same `source_table`, `source_id`, `brand_id`), up to 24 copies of one
  source row, mostly product reviews (3,698). The table is fully rebuilt each run (all `created_at` within 35 s).
* **Fix:** add a unique index on `(source_table, source_id, brand_id)` and build with `INSERT … ON CONFLICT DO
  NOTHING`. The likely cause is a join fan-out against a product/variant table in the review branch of the builder.
  5,369 `paddle_reviews` with `complaint_category IS NULL` are also missing from mention_facts; enrich them.

## 6. Fix the old dashboard's broken queries

* `reddit_mentions` has `post_title`, `content_text`, `upvotes`, `post_url`, **not** `title`, `body`, `score`, `url`.
* `topic_lifecycle` has `topic`, `channel`, `mention_count`, `first_seen_at`, `week_number`, `year`, **not**
  `topic_slug`, `peak_at`, `channels_touched`. Peaks must be computed (see `intel.v_topic_weekly`).
* Channel `product_review` must not be folded into Reddit.
* Counting through PostgREST is capped at 1,000 rows per request, so any count done in the browser is wrong past that.
  Point the dashboard at this API (`/api/v1/*`) instead of querying tables directly.

## 7. Smaller items

* `topic_lifecycle.channel` uses `twitter` while everything else uses `x`; standardise on `x`.
* `reddit_mentions.sentiment` (legacy 3-level, 1,042 NULL) duplicates `sentiment_label`; drop it.
* 88 `reddit_mentions` rows have `content_type = 'Comment'`; decide whether they belong in `reddit_comments`.
* `product_reviews` is empty; reviews live in `paddle_reviews`. Remove the empty table or document it.
* `brands` has no colour column. If charts outside this API need colours, add `brand_colour` there and keep
  `src/core/brand-palette.ts` in sync.

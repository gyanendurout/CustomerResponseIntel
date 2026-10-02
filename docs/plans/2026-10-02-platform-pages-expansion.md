# Platform pages expansion: plan

Status (2026-10-02): LIVE. Views 040–046 + 091 applied; every view reconciles exactly with independent counts from the raw
tables (`node scripts/check-platform.mjs`); real-data suite passes; all 8 tools verified on the live connector, no PII.

Goal: the Community Intel API and MCP can answer everything the dashboard pages `/v2/instagram`, `/v2/youtube`,
`/v2/twitter`, `/v2/tiktok` and `/v2/reddit` show, computed correctly in the database instead of in the browser.

Inputs: `joola-intel-nextjs/docs/db-discovery-2026-10-02.md` (tables), a read of each page's source and its data
helpers (`frontend/lib/v2/data.ts`, `playbook.ts`), and the live column list refreshed on 2026-10-02.

## 1. What the pages need, and what exists today

| Page section (all five pages unless noted) | Tables | Today in Community Intel |
|---|---|---|
| Followers / subscribers, weekly delta, growth trend | `ig_profiles_weekly`, `yt_channel_weekly`, `x_profiles_weekly`, `tiktok_profiles_weekly` | **missing** |
| Following, content count, lifetime hearts (TikTok), lifetime views (YouTube) | same weekly tables | **missing** |
| Posts/videos per brand, avg views/likes/comments, engagement rate | `ig_posts`, `yt_videos`, `x_posts`, `tiktok_videos` | **missing** (v_signals has brand posts as "signals" but not per-platform content metrics) |
| Top posts/videos by likes/views/ER within a date window, with link and caption | same content tables | partial (`search_posts` is item search, not platform content ranking) |
| Format mix / best format (IG Reel vs Carousel vs Image; YT Shorts vs long-form) | `ig_posts.post_format`, `yt_videos.is_short`, `duration_seconds` | **missing** |
| Posting cadence (IG: last 28 days by weekday) | `ig_posts.posted_at` | **missing** |
| Reply ratio (X: replies per tweet), comments per video (TikTok) | `x_posts.reply_count`, `tiktok_videos.comment_count` | **missing** |
| Comment sentiment by brand (TikTok, Reddit, YouTube, IG) | `*_comments`, `reddit_mentions` | **exists** (`sentiment_breakdown`, `channel_overview` with channel filter) |
| Reddit mentions per brand, net sentiment, weekly trend | `reddit_mentions` | **exists** (`volume_over_time`, `sentiment_breakdown`, `metrics`) |
| Reddit subreddit distribution with JOOLA share | `reddit_mentions.subreddit` | **missing** (subreddit not in v_signals) |
| Reddit viral posts (velocity per hour), comment counts per post | `reddit_mentions.velocity_per_hour`, `reddit_comments.parent_post_id` | **missing** |
| Crisis keyword clusters | `crisis_keywords` | **exists** (`top_complaints`, `crisis_monitor`) |
| YouTube "why videos worked": content type, performance thesis, products | `yt_video_analysis` | **missing** |
| Dominant content theme (IG) | `ig_profiles_weekly.dominant_content_theme` | **missing** |
| Paddle mentions in comments (TikTok, IG) | `mention_facts.product_id` → `products_catalog` | **missing** |
| Player mentions in IG comments | `mention_facts.athlete_id` → `influencers` | **missing** (needs PII decision) |
| Playbook findings (rule-based comparisons vs JOOLA) | derived | Claude can derive from the tools above; a dedicated tool is optional |

## 2. Database layer (new SQL files, owner reviews and applies)

| File | View | Grain | Notes |
|---|---|---|---|
| `040_v_brand_accounts.sql` | `intel.v_brand_accounts` | platform account | brand-owned handle + profile URL only |
| `041_v_audience_weekly.sql` | `intel.v_audience_weekly` | platform × brand × ISO week | followers, following, content_count, total_hearts (TikTok), total_views (YouTube); `week_start` date; gap and >50% drop flags computed later in SQL; no handles, bios or links |
| `042_v_content.sql` | `intel.v_content` | one brand post/video | platform, brand_id, posted_at, format (normalised: reel/video/carousel/image/short/long/tweet), likes, comments, shares, views, retweets, replies, duration_s, caption (masked), canonical content URL, de-duplicated (IG by instagram_post_id/post_url) |
| `043_v_video_analysis.sql` | `intel.v_video_analysis` | one analysed YouTube video | content_type, is_paid_promo, performance_thesis and summary (masked), product ids, video date/views; excludes sentiment/crisis/opportunity (they never vary) and players_mentioned (PII) |
| `044_v_reddit_posts.sql` | `intel.v_reddit_posts` | one Reddit post | subreddit, velocity_per_hour, upvotes, captured comment count, is_removed, posted_at, brand_id(s) via v_signals rules |
| `045_v_product_mentions.sql` | `intel.v_product_mentions` | mention × product | via `mention_facts.product_id` → `products_catalog.display_name`, channel, sentiment, date |
| `046_v_athlete_mentions.sql` | `intel.v_athlete_mentions` | mention × athlete | only if the owner allows athlete names (decision 2) |
| `091_grant_platform_views.sql` | grants | | SELECT on the new views for intel_reader (run after 090) |

Each view is read-only, reads only `public` tables, and goes through the same PII rules (masking, no person columns).

## 3. New capabilities (each = REST route + MCP tool)

| Tool | Route | Answers |
|---|---|---|
| `audience_growth` | `/audience` | followers/subscribers per brand and platform: latest, weekly/monthly delta and %, trend, gaps flagged, "no account" vs 0 |
| `content_performance` | `/content` | per brand and platform: posts in window, avg views/likes/comments, engagement rate (defined per platform), format mix and best format, replies or comments per post |
| `top_content` | `/top-content` | top posts/videos by likes, views, comments, shares or engagement rate **within** the date window (fixes the dashboard's "top-N before filter" bug), with caption and link |
| `posting_cadence` | `/posting-cadence` | posts per week and per weekday, active days, trend vs previous week |
| `video_insights` | `/youtube-insights` | content-type mix, top videos with performance thesis, paid promo count, shorts vs long-form |
| `reddit_insights` | `/reddit-insights` | subreddit distribution with JOOLA share, viral posts by velocity, posts with comment counts |
| `product_mentions` | `/product-mentions` | paddle mentions by brand, product and channel, with sentiment |
| `athlete_mentions` | `/athlete-mentions` | sponsored-pro names (decision 2: allowed) |

Existing tools gain nothing breaking; `channel_overview` and `data_health` will report the new sources.

## 4. Definitions fixed on purpose (dashboard inconsistencies found)

The dashboard computes several numbers differently per page. The API will use one definition each and document it:

- **Engagement rate** = (likes + comments [+ shares where the platform has them]) / views × 100 for video platforms;
  (likes + comments) / followers × 100 for Instagram and X. The dashboard's X "Eng Rate" is really an average count.
- **Weekly delta** is by ISO week, not "previous scrape row".
- **Post counts and averages** cover all posts in the window, not a top-200 sample.
- **Totals** are paged in SQL (no 1,000-row truncation).

## 5. Dashboard bugs found (outside this repo, for the frontend owner)

`/v2/instagram`: `products_catalog.name` does not exist (`display_name`); `mention_facts` read capped at 1,000 rows;
"sponsoring brand" label is the mentioned brand; theme panel ignores the brand filter.
`/v2/youtube`: "Sub Δ" always "—" (delta hard-coded null); video counts truncated at 1,000.
`/v2/twitter`: "Eng Rate" shown as % but is an average count; handle maps disagree between pages.
`/v2/tiktok`: double "@@" on handles; comment stats capped at 1,000 rows; sentiment ignores filters.
`/v2/reddit`: "Δ Mentions" always "—"; four fetches run and are never displayed; KPIs ignore the date range.
All pages: top-N lists are cut before the date filter, so filtered views are incomplete.

## 6. Steps

1. Owner decisions (section 7).
2. Regenerate the test fixture schema for the new tables (`scripts/openapi.mjs`, `gen-fixture-schema.mjs`).
3. Write each view test-first against the fixture (PGlite); then the SQL file.
4. Owner reviews and applies 040–04x and the updated grants in the Supabase SQL editor.
5. Capabilities, test-first; REST + MCP + OpenAPI + docs are generated from the registry.
6. Real-data reconciliation: each new tool's numbers checked against an independent count.
7. Push; Vercel deploys; live check of every new tool, including the PII scan.

## 7. Decisions (owner, 2026-10-02)

Answered: 1 = yes, brand-owned accounts only; 2 = show names of sponsored pros; 3 = all five pages at once.
The Instagram content theme is returned by `audience_growth` (field `content_theme`) instead of a separate tool.

Original questions:

1. **Brand account handles and profile links** (e.g. `@joolapickleball`): these are company accounts, not customers.
   Allow them in output? Recommended: yes, for brand-owned accounts only, taken from the `*_accounts` tables.
2. **Athlete names** (sponsored pros, public figures) in player-mention tools: allow, or show anonymous ids only?
3. **Scope of the first release**: all of section 3, or start with audience + content (the parts every page uses)?

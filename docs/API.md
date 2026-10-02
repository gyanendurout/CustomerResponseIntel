<!-- GENERATED from src/core/registry.ts by tests/docs.test.ts. Run `UPDATE_DOCS=1 npx vitest run tests/docs.test.ts` after changing a capability. -->
# REST API (v1)

Base URL: `https://<your-deployment>/api/v1`. Machine-readable spec: `GET /api/v1/openapi.json` (OpenAPI 3.1, public).

## Conventions

* **Auth:** header `x-api-key: <key>` on every request except `/openapi.json`. Keys are configured as sha256 hashes in `API_KEYS`.
* **Method:** `GET` only. Lists: `brands=JOOLA,Selkirk` or repeated `brands=JOOLA&brands=Selkirk`. Singular aliases `brand`, `channel`, `sentiment` are accepted. Booleans: `true` / `false`. Unknown parameters are rejected (catches typos).
* **Success:** `200 {"data": …, "meta": {filters, generated_at, rows_counted, excluded:{undated, unbranded, unlabelled_sentiment}, notes[], units?, series?, page?}}`.
* **Failure:** `{"error": {"code", "message", "details"}}` with `400 VALIDATION_ERROR | UNKNOWN_BRAND | UNSUPPORTED_COMBINATION`, `401 UNAUTHORIZED`, `404 NOT_FOUND`, `429 RATE_LIMITED` (+ `Retry-After`), `503 DB_TIMEOUT`, `500 INTERNAL` (details logged server-side only).
* **Rate limit:** `RATE_LIMIT_PER_MINUTE` per key (default 60), best-effort per server instance. `x-ratelimit-remaining` is returned.
* **CORS:** only `ALLOWED_ORIGIN` (exact match) gets CORS headers.
* **Counting:** results split by brand count one *signal* per brand mentioned; all other results count each *item* once. Undated items are never placed in a period; they are reported in `meta.excluded.undated` and `meta.notes`.
* **Dates:** `from`/`to` are inclusive UTC dates. Default = last 90 days of *available data*, ending on the newest data date (not today).

## Common filters (accepted by most routes)

| Parameter | Type | Required | Description |
|---|---|---|---|
| `from` | string (date) | no | Start date, inclusive (YYYY-MM-DD). Default: 89 days before `to`. |
| `to` | string (date) | no | End date, inclusive (YYYY-MM-DD). Default: the newest date in the data (not today). |
| `brands` | list of string | no | Brand names, slugs or ids, case-insensitive (e.g. ["JOOLA","Selkirk"]). Default: all brands. |
| `channels` | list of instagram \| youtube \| reddit \| tiktok \| x \| product_review \| other | no | Normalised channels. product_review is its own channel. Default: all. |
| `sentiments` | list of very_negative \| negative \| neutral \| positive \| very_positive \| unlabelled \| negative_all \| positive_all | no | 5-level values (very_negative … very_positive, unlabelled) or 3-level groups negative_all / positive_all. |
| `crisis_only` | boolean | no | Only signals flagged as crisis. Default false. |
| `granularity` | day \| week \| month | no | Time bucket. Default: month if the range is over 60 days, else day. |
| `include_undated` | boolean | no | Include signals with no date in totals (never placed in a time period). Default false. |


## `GET /api/v1/brands` — List brands

Lists the 11 tracked brands (JOOLA plus 10 competitors) with ids, names, slugs, is_joola and a chart colour. Use it to discover valid brand names before calling other tools, or to colour charts consistently. Other tools already accept brand names case-insensitively, so you rarely need ids. Output: data = [{brand_id, name, slug, is_joola, is_active, colour:{light, dark, slot, shares_colour}}]. shares_colour=true means the brand has no unique hue (only 8 are colour-blind safe), so fold it into "Other" when charting many brands. Example: "Which competitors do we track?"

_No parameters beyond the common filters._

**Example** (Which competitors do we track?):

```bash
curl -H "x-api-key: $API_KEY" "https://<your-deployment>/api/v1/brands"
```

## `GET /api/v1/channels` — Channel overview

Per normalised channel (instagram, youtube, reddit, tiktok, x, product_review): total items, how many are dated vs undated, how many dates come from the parent post/video (date_from_parent), first and last item date, and the last scrape time. Unlike other tools it covers FULL HISTORY unless from/to are given, because it describes data coverage. Use it to check coverage and freshness before trusting a trend; use data_health for known data problems. Items are counted once even if they mention several brands. Output: data = [{channel, total, dated, undated, date_from_parent, first_date, last_date, last_scrape_at}]. Example: "How fresh is our YouTube data and how much of it has dates?"

_No parameters beyond the common filters._

**Example** (How fresh is each channel and how much of it is dated?):

```bash
curl -H "x-api-key: $API_KEY" "https://<your-deployment>/api/v1/channels"
```

## `GET /api/v1/volume` — Volume over time

Time series of mention volume, split by brand (default), channel, or none, with period-over-period growth % per series. Use for "how many mentions / is volume rising"; use share_of_voice for relative share, metrics for other measures. Split by brand counts one signal per brand mentioned; other splits count each item once. Periods are zero-filled. Output: data.points = [{period (YYYY-MM-DD start), series, value, growth_pct}], data.totals = [{label, value}]. Example: "How did JOOLA mention volume trend month by month since May?"

| Parameter | Type | Required | Description |
|---|---|---|---|
| `split_by` | brand \| channel \| none | no | Series dimension. Default brand. |

**Example** (Monthly JOOLA vs Selkirk mention volume since May):

```bash
curl -H "x-api-key: $API_KEY" "https://<your-deployment>/api/v1/volume?brands=JOOLA%2CSelkirk&from=2026-05-01&granularity=month"
```

## `GET /api/v1/share-of-voice` — Share of voice

Each brand's percentage of all brand mentions per period, plus the overall share for the whole range. If brands are given, shares are computed among THOSE brands only (they sum to 100%). Use for relative position vs competitors; use volume_over_time for absolute counts. Output: data.points = [{period, series (brand), value (%), count}], data.overall = [{label, value (%), count}]. Example: "What was JOOLA's share of voice vs all competitors each month?"

_No parameters beyond the common filters._

**Example** (JOOLA's monthly share of voice against all competitors):

```bash
curl -H "x-api-key: $API_KEY" "https://<your-deployment>/api/v1/share-of-voice?granularity=month"
```

## `GET /api/v1/sentiment` — Sentiment breakdown

Counts and percentages of the 5 sentiment levels (very_negative … very_positive) and the 3-level rollup (very_* folded into its parent), grouped by brand (default), channel, period, or none. Unlabelled items are counted separately and excluded from percentage denominators. Use for "how negative is X"; use metrics for negative % over time with custom grouping, detect_spikes for anomalies. Output: data.five_level/three_level = [{group, label (level), value (count), pct}], data.groups = [{group, total, labelled, negative_pct, positive_pct}]. Example: "How does JOOLA sentiment compare with Selkirk on Instagram?"

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_by` | brand \| channel \| period \| none | no | Default brand. |

**Example** (Sentiment by brand over the last 90 days):

```bash
curl -H "x-api-key: $API_KEY" "https://<your-deployment>/api/v1/sentiment"
```

## `GET /api/v1/complaints` — Top complaints

Top complaint keywords per brand with a monthly trend and 3 example items each. Keywords come from two sources: product-review complaint categories (e.g. delamination, dead_spot, customer_service) and social crisis keywords (the words that triggered a crisis flag); `kinds` says which. Use for "what are people complaining about"; use search_posts to read more items for one keyword. Output: data = [{brand, keyword, count, kinds, trend:[{period, value}], examples:[item]}]. Example: "What are the top complaints about JOOLA paddles this quarter?"

| Parameter | Type | Required | Description |
|---|---|---|---|
| `top_n` | integer ≥1, ≤20 | no | Keywords per brand. Default 5. |

**Example** (Top complaints about JOOLA this quarter):

```bash
curl -H "x-api-key: $API_KEY" "https://<your-deployment>/api/v1/complaints?brands=JOOLA"
```

## `GET /api/v1/posts` — Search posts

Finds individual posts, comments and reviews, optionally matching a text query (q, case-insensitive substring), with all common filters. Sort by date (newest first, default; undated items only appear with include_undated=true and sort last) or engagement. Cursor-paged: pass meta.page.next_cursor back as `cursor` for the next page. limit ≤ 50; text truncated to 500 chars; @handles are masked. Each item appears once, with all brands it mentions. Use to read real examples or quotes; use the aggregate tools for counts. Output: data.items = [{item_id, channel, signal_type, brands, sentiment_5, sentiment_3, is_crisis, occurred_at, date_source, text, text_truncated, post_url, engagement, engagement_kind}]. Example: "Show the most-liked negative Instagram comments about JOOLA edge guards."

| Parameter | Type | Required | Description |
|---|---|---|---|
| `q` | string | no | Text to search for (substring, case-insensitive). |
| `sort` | date \| engagement | no | date (default) or engagement. |
| `limit` | integer ≥1, ≤50 | no | Page size, default 20, max 50. |
| `cursor` | string | no | next_cursor from the previous page. |

**Example** (Most-liked negative JOOLA comments mentioning "edge guard"):

```bash
curl -H "x-api-key: $API_KEY" "https://<your-deployment>/api/v1/posts?brands=JOOLA&q=edge%20guard&sentiments=negative_all&sort=engagement"
```

## `GET /api/v1/crises` — Crisis monitor

Crisis-flagged items per period (optionally split by brand or channel) plus the 10 most recent DATED crisis items. Undated crisis items are never shown as recent; their count is reported in meta.excluded/notes. Use for "are there any crises / what are the latest"; use detect_spikes for unusual negativity, top_complaints for themes. Output: data.points = [{period, series, value}], data.recent = [item], data.total. Example: "Any JOOLA crises in the last two weeks? Show the latest ones."

| Parameter | Type | Required | Description |
|---|---|---|---|
| `split_by` | none \| brand \| channel | no | Default none. |

**Example** (Latest JOOLA crises):

```bash
curl -H "x-api-key: $API_KEY" "https://<your-deployment>/api/v1/crises?brands=JOOLA"
```

## `GET /api/v1/spikes` — Detect spikes

Finds periods where a brand's volume or negative % jumped above its own rolling baseline. Method: for each period, baseline = the previous `window` periods (default 8, the period itself excluded); spike when value > mean + k·sd (default k=2, population sd), needing at least 4 baseline periods. negative_pct ignores periods with fewer than min_volume labelled items (default 10). Default granularity is week. Use for "anything unusual?"; use crisis_monitor for flagged crises. Output: data.spikes = [{brand, period, value, baseline_mean, baseline_sd, z, threshold}], data.series = [{period, series, value, volume}]. Example: "Were there any unusual spikes in negative sentiment for JOOLA this summer?"

| Parameter | Type | Required | Description |
|---|---|---|---|
| `metric` | volume \| negative_pct | no | volume (default) or negative_pct. |
| `window` | integer ≥3, ≤26 | no | Baseline periods. Default 8. |
| `k` | number ≥1, ≤5 | no | Std-dev multiplier. Default 2. |
| `min_volume` | integer ≥1, ≤10000 | no | negative_pct only: minimum labelled items per period. Default 10. |

**Example** (Unusual weekly negative-sentiment spikes for JOOLA since May):

```bash
curl -H "x-api-key: $API_KEY" "https://<your-deployment>/api/v1/spikes?brands=JOOLA&metric=negative_pct&from=2026-05-01"
```

## `GET /api/v1/switches` — Brand switching

People saying they switched from one brand to another. For a focus brand (default JOOLA): inflow (switched TO it), outflow (switched FROM it), net, a full from→to matrix, a monthly inflow/outflow trend, and data-gap counts. Event date = posted date, else detection date (date_from_detection counts those). Events with an unknown side are shown as "Unknown" in the matrix and counted in gaps; they never silently disappear. Output: data = {focus_brand, inflow, outflow, net, matrix:[{from,to,value}], trend:[{period, series, value}], gaps}. Example: "Are more people switching to JOOLA or away from it, and to whom?"

| Parameter | Type | Required | Description |
|---|---|---|---|
| `brand` | string | no | Focus brand (name/slug/id). Default JOOLA. |

**Example** (Net switching to/from JOOLA):

```bash
curl -H "x-api-key: $API_KEY" "https://<your-deployment>/api/v1/switches"
```

## `GET /api/v1/topics` — Topic trends

Weekly topic volume (from the topic tracker; weeks start Monday) for the top topics, the fastest-growing topics (last week vs the week before, topics with at least 5 mentions the week before), the computed peak week per topic, and JOOLA vs competitor share per topic. Topic data covers 2026 ISO weeks 26 onward only. Use for "what are people talking about / what is rising"; use top_complaints for complaints, metrics(group_by topic) for custom cuts. Output: data = {weekly:[{period, series (topic), value}], fastest_growing:[...], peaks:[...], joola_share:[...]}. Example: "Which topics are growing fastest for JOOLA on Instagram?"

| Parameter | Type | Required | Description |
|---|---|---|---|
| `top_n` | integer ≥1, ≤25 | no | Number of topics. Default 10. |

**Example** (Fastest-growing topics overall):

```bash
curl -H "x-api-key: $API_KEY" "https://<your-deployment>/api/v1/topics"
```

## `GET /api/v1/compare` — Compare brands

Side-by-side metrics for 2–5 brands over one period: volume, share of voice (vs ALL tracked brands), negative %, positive % (of labelled items), crisis count and top complaint keyword. Use for head-to-head questions; use share_of_voice / volume_over_time for trends over time. Output: data = [{brand, volume, share_of_voice_pct, negative_pct, positive_pct, crisis_count, top_complaint:{keyword,count}|null}]. Example: "Compare JOOLA, Selkirk and CRBN over the last 90 days."

_No parameters beyond the common filters._

**Example** (Compare JOOLA, Selkirk and CRBN):

```bash
curl -H "x-api-key: $API_KEY" "https://<your-deployment>/api/v1/compare?brands=JOOLA%2CSelkirk%2CCRBN"
```

## `GET /api/v1/metrics` — Flexible metrics

The flexible tool for questions no other tool covers. Pick ONE measure (count, negative_pct, positive_pct, crisis_count, avg_engagement, total_engagement) and 1–2 group_by dimensions (period, brand, channel, sentiment_5, sentiment_3, signal_type, topic), plus any common filters. Whitelisted only; there is no free SQL. negative_pct/positive_pct use labelled items as the denominator. group_by topic reads the weekly topic tracker and supports only measure=count with period/brand/channel. Results are capped at 500 groups (meta.notes says when). Output: data.rows = [{<dim>: value, ..., value, n}] (n = items in the group); data.points = [{period, series, value}] when period is a dimension. Example: "Weekly negative % for JOOLA vs Selkirk on Reddit since May" → measure=negative_pct, group_by=[period, brand], granularity=week, brands=[JOOLA, Selkirk], channels=[reddit], from=2026-05-01.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `measure` | count \| negative_pct \| positive_pct \| crisis_count \| avg_engagement \| total_engagement | yes | What to compute. |
| `group_by` | list of period \| brand \| channel \| sentiment_5 \| sentiment_3 \| signal_type \| topic | yes | 1–2 dimensions. |

**Example** (Weekly negative % for JOOLA vs Selkirk on Reddit since May):

```bash
curl -H "x-api-key: $API_KEY" "https://<your-deployment>/api/v1/metrics?measure=negative_pct&group_by=period%2Cbrand&granularity=week&brands=JOOLA%2CSelkirk&channels=reddit&from=2026-05-01"
```

## `GET /api/v1/data-health` — Data health

Data-quality report: per source table rows, null dates, null brands, date range and last load; last scrape per channel; and a checklist of known data issues with LIVE counts (undated YouTube comments, unbranded Reddit comments, mention_facts duplicates, switch-event gaps, undated crises, product reviews as own channel, unlabelled sentiment, reply-detector coverage). Use before drawing conclusions, or when a number looks odd. Takes no filters. Output: data = {tables:[...], channels:[{channel, last_scrape_at, items}], known_issues:[{id, title, status, live_count, detail}]}. Example: "Can I trust the YouTube numbers? What data problems should I know about?"

_No parameters beyond the common filters._

**Example** (What data problems should I know about?):

```bash
curl -H "x-api-key: $API_KEY" "https://<your-deployment>/api/v1/data-health"
```

## `GET /api/v1/replies` — Brand replies

How often and how fast brands reply to comments. Returns insufficient_data=true while fewer than 30 replies exist (currently the reply detector has captured very few, all with 0-minute response times), in which case treat the statistics as unreliable and say so. Output: data = {insufficient_data, total_replies, by_brand:[{brand, replies, median_response_mins, avg_response_mins}], first_reply_at, last_reply_at, sample:[...]}. Example: "How quickly does JOOLA reply to comments?"

_No parameters beyond the common filters._

**Example** (How quickly does JOOLA reply to comments?):

```bash
curl -H "x-api-key: $API_KEY" "https://<your-deployment>/api/v1/replies"
```

## `GET /api/v1/audience` — Audience growth

Followers (YouTube: subscribers) of each brand's OWN account on Instagram, YouTube, X and TikTok, from weekly snapshots: latest value, change vs the previous week, change over the date range, plus following, content count, TikTok lifetime hearts, YouTube lifetime views and the Instagram dominant content theme. Also returns the brand account handle and profile link. Missing weeks and scrape glitches (0 followers or a >50% one-week drop) are flagged and excluded from changes, never interpolated. no_data lists brand/platform pairs with no snapshots in range. Use for "who is growing fastest / how many followers"; use content_performance for post engagement. Output: data = {accounts:[{platform, brand, account_handle, account_url, latest_week, followers, change_vs_previous_week, change_vs_previous_week_pct, change_in_range, change_in_range_pct, ...}], weeks:[YYYY-MM-DD…], series:[{platform, brand, followers:[one per week], flags:[ok|suspect|missing|not_tracked per week]}], no_data:[...]}. Example: "Which brand gained the most Instagram followers this quarter?"

| Parameter | Type | Required | Description |
|---|---|---|---|
| `platforms` | list of instagram \| youtube \| x \| tiktok | no | Platforms: instagram, youtube, x, tiktok. Default: all four. |

**Example** (Follower growth for all brands on every platform):

```bash
curl -H "x-api-key: $API_KEY" "https://<your-deployment>/api/v1/audience"
```

## `GET /api/v1/content` — Content performance

How each brand's OWN posts and videos perform on Instagram, YouTube, X and TikTok in the date range: number of posts, posts per week, average views / likes / comments / shares / reposts / interactions, engagement rate by views and by followers, and a per-format breakdown (Instagram reel/carousel/image, YouTube short/long_form) with the best format (needs 3+ posts). Covers ALL posts in the range, not a top-N sample. Use for "whose content gets the most engagement / which format works"; use top_content for individual posts, audience_growth for followers, posting_cadence for how often brands post. Output: data = [{platform, brand, account_handle, posts, posts_per_week, avg_views, avg_interactions, engagement_rate_by_views, engagement_rate_by_followers, followers, best_format, formats:[{format, posts, avg_views, avg_interactions}]}]. Example: "Which brand has the best Instagram engagement rate, and do reels beat carousels?"

| Parameter | Type | Required | Description |
|---|---|---|---|
| `platforms` | list of instagram \| youtube \| x \| tiktok | no | Platforms: instagram, youtube, x, tiktok. Default: all four. |

**Example** (Engagement by brand on every platform, last 90 days):

```bash
curl -H "x-api-key: $API_KEY" "https://<your-deployment>/api/v1/content"
```

## `GET /api/v1/top-content` — Top content

The best-performing posts and videos from the brands' OWN accounts (Instagram, YouTube, X, TikTok) published in the date range, ranked by interactions (default), views, likes, comments, shares, engagement_rate (interactions/views) or recent. The ranking is computed within the range, over all posts. Returns caption (masked), content link, format and every metric. Filter by platforms, brands and formats (reel, carousel, image, short, long_form, post, video). Use for "show me the top posts / most viewed videos"; use content_performance for averages per brand. Output: data.items = [{platform, brand, account_handle, format, posted_at, caption, url, views, likes, comments, shares, reposts, interactions, engagement_rate_by_views}]. Example: "What were Selkirk's most-viewed YouTube Shorts last month?"

| Parameter | Type | Required | Description |
|---|---|---|---|
| `platforms` | list of instagram \| youtube \| x \| tiktok | no | Platforms: instagram, youtube, x, tiktok. Default: all four. |
| `formats` | list of reel \| carousel \| image \| short \| long_form \| post \| video \| unknown | no | Content formats to include. Default: all. |
| `sort_by` | interactions \| views \| likes \| comments \| shares \| engagement_rate \| recent | no | Ranking. Default interactions. |
| `limit` | integer ≥1, ≤50 | no | Number of items. Default 10. |

**Example** (Top 10 brand posts by interactions across all platforms):

```bash
curl -H "x-api-key: $API_KEY" "https://<your-deployment>/api/v1/top-content"
```

## `GET /api/v1/posting-cadence` — Posting cadence

How often each brand posts on its OWN Instagram, YouTube, X and TikTok accounts: posts per period (zero-filled, weekly by default), posts by weekday (UTC), active days, posts per week, busiest weekday, and the last vs previous period. Brands with a tracked account but no posts in the range appear with 0 (silent), not missing. Use for "who posts most / is JOOLA posting less"; use content_performance for engagement. Output: data = {summary:[{platform, brand, posts, active_days, days_in_range, posts_per_week, busiest_weekday, last_period_posts, previous_period_posts}], periods:[YYYY-MM-DD…], weekdays:[Mon…Sun], series:[{platform, brand, posts:[one count per period], by_weekday:[one count per weekday]}]}. Example: "How often did each brand post on Instagram over the last 4 weeks?"

| Parameter | Type | Required | Description |
|---|---|---|---|
| `platforms` | list of instagram \| youtube \| x \| tiktok | no | Platforms: instagram, youtube, x, tiktok. Default: all four. |

**Example** (Weekly posting cadence on Instagram, last 28 days):

```bash
curl -H "x-api-key: $API_KEY" "https://<your-deployment>/api/v1/posting-cadence?platforms=instagram&from=2026-09-01&to=2026-09-28"
```

## `GET /api/v1/youtube-insights` — YouTube video insights

YouTube content strategy for the brands' OWN channels in the date range: Shorts vs long-form (videos, average views and interactions), content-type mix from the AI video analysis (tutorial, review, highlight, unboxing, comparison, …) with average views and paid-promo counts, analysis coverage per brand, and the top analysed videos with the AI "performance thesis" (why it worked), signals and products shown. Only some videos are analysed (see coverage). Use for "what kind of YouTube content works for competitors"; use top_content for raw top videos. Output: data = {formats:[...], content_types:[...], coverage:[{brand, videos, analysed}], top_videos:[{brand, title, url, content_type, views, performance_thesis, performance_signals, products}]}. Example: "Why are Selkirk's YouTube videos getting more views than JOOLA's?"

| Parameter | Type | Required | Description |
|---|---|---|---|
| `top_n` | integer ≥1, ≤25 | no | Top analysed videos to return. Default 5. |

**Example** (What YouTube content works for each brand?):

```bash
curl -H "x-api-key: $API_KEY" "https://<your-deployment>/api/v1/youtube-insights"
```

## `GET /api/v1/reddit-insights` — Reddit insights

Reddit-specific views that mention counts do not give: which subreddits the brands are discussed in (posts per subreddit, per brand, and JOOLA's share), viral posts ranked by upvote velocity (upvotes per hour), and the most discussed posts by captured replies. Removed posts are excluded. Brand attribution matches the other tools. Use for "where on Reddit are people talking about X / what is blowing up"; use volume_over_time or sentiment_breakdown with channels=["reddit"] for counts and sentiment. Output: data = {subreddits:[{subreddit, posts, joola_posts, joola_share_pct, brands:[{brand, posts}]}], viral:[post], most_discussed:[post]} where post = {brands, subreddit, title, url, posted_at, upvotes, velocity_per_hour, captured_comments, sentiment_5}. Example: "Which subreddits talk about JOOLA most, and what Reddit posts are going viral?"

| Parameter | Type | Required | Description |
|---|---|---|---|
| `top_n` | integer ≥1, ≤50 | no | Posts per list. Default 10. |

**Example** (Where on Reddit are the brands discussed, and what is going viral?):

```bash
curl -H "x-api-key: $API_KEY" "https://<your-deployment>/api/v1/reddit-insights"
```

## `GET /api/v1/product-mentions` — Product mentions

Which paddles (catalogue products) people mention, across Instagram, YouTube, Reddit, TikTok, X comments and posts and product reviews: mentions per product with positive / neutral / negative counts, negative % (of labelled) and a channel split. brands filters by the brand that MAKES the product; products filters by product name (case-insensitive). Each source item counts once per product. Use for "which JOOLA paddles get talked about / which paddle has the most negative buzz"; use top_complaints for complaint themes and search_posts to read the items. Output: data = [{product, brand, mentions, positive, neutral, negative, unlabelled, negative_pct, channels:[{channel, mentions}]}]. Example: "Which JOOLA paddles are mentioned most this quarter, and with what sentiment?"

| Parameter | Type | Required | Description |
|---|---|---|---|
| `products` | list of string | no | Product names, e.g. ["Perseus"]. Default: all. |
| `top_n` | integer ≥1, ≤100 | no | Products to return. Default 20. |

**Example** (Most-mentioned paddles in the last 90 days):

```bash
curl -H "x-api-key: $API_KEY" "https://<your-deployment>/api/v1/product-mentions"
```

## `GET /api/v1/athlete-mentions` — Athlete mentions

Mentions of sponsored pro athletes (the brands' athlete roster) in comments and posts: per athlete, the sponsoring brand, contract type, mentions, positive / neutral / negative counts, negative % and a channel split. brands filters by the SPONSORING brand. Only roster athletes are named; personal social handles are never returned. Use for "how much do people talk about JOOLA's athletes vs competitors' / which athlete's mentions skew negative". Output: data = [{athlete, sponsor_brand, contract_type, is_active, mentions, positive, neutral, negative, unlabelled, negative_pct, channels}]. Example: "Which sponsored athletes get the most mentions on Instagram?"

| Parameter | Type | Required | Description |
|---|---|---|---|
| `top_n` | integer ≥1, ≤100 | no | Athletes to return. Default 20. |

**Example** (Most-mentioned sponsored athletes, last 90 days):

```bash
curl -H "x-api-key: $API_KEY" "https://<your-deployment>/api/v1/athlete-mentions"
```

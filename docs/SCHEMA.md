# SCHEMA — Community Intel source tables

> Discovered 2026-10-02 from the live Supabase project (PostgREST OpenAPI introspection, `public` schema).
> Column lists below are **generated** by `scripts/gen-schema-md.mjs`. No column name here is hand-typed.
> Unique constraints, indexes and CHECK constraints are **not visible** through PostgREST; see
> `supabase/diagnostics/introspection.sql` (read-only; run it in the SQL editor) to complete them.

The `public` schema exposes **138** tables/views. This backend reads the 10 tables in the brief **plus 6
source tables** that `mention_facts` is built from (needed for de-duplication and enrichment).

## 1. How the tables relate

```
brands (11) ─┬─< mention_facts.brand_id          mention_facts (50,660) is a DERIVED table:
             ├─< ig_comments.brand_id              (source_table, source_id) → raw row id
             ├─< yt_comments.brand_id              rebuilt in full on every run (all created_at
             ├─< reddit_mentions.brand_id          within 35 s on 2026-09-28 08:03 UTC)
             ├─< reddit_comments.brand_id
             ├─< tiktok_comments.brand_id     ig_posts (1,320)   ─< ig_comments.post_id
             ├─< topic_lifecycle.brand_id     yt_videos (884)    ─< yt_comments.video_id
             ├─< competitor_switch_events.from_brand_id / to_brand_id
             ├─< brand_replies.replying_brand_id
             └─< paddle_reviews.brand_id (no FK declared)
reddit_mentions (1,493) ─< reddit_comments.parent_post_id
reddit_mentions          ─< competitor_switch_events.source_mention_id (no FK declared; 103/103 resolve)
mention_facts            ─< competitor_switch_events.mention_id (FK declared, but 0/147 populated)
ig_comments              ─< brand_replies.source_row_id (polymorphic via source_table; 4/4 resolve)
```

### `mention_facts.source_table` → raw table (measured)

| source_table | mention_facts.channel | raw rows | mf rows | distinct ids in mf | raw rows missing from mf |
|---|---|---|---|---|---|
| ig_comments | ig_comment | 12,057 | 12,136 | 12,057 | 0 |
| yt_comments | yt_comment | 3,777 | 4,258 | 3,777 | 0 |
| reddit_mentions | reddit | 1,493 | 2,113 | 1,493 | 0 |
| reddit_comments | reddit_comment | 3,064 | 2,391 | 1,917 | **1,147** |
| tiktok_comments | tiktok_comment | 1,077 | 1,085 | 1,077 | 0 |
| tiktok_videos | tiktok | 1,461 | 1,497 | 1,461 | 0 |
| x_posts | x | 484 | 497 | 484 | 0 |
| influencer_x_posts | x_influencer | 770 | 775 | 770 | 0 |
| paddle_reviews | product_review | 27,579 | 25,908 | 22,210 | **5,369** |

No orphans: every `mention_facts.source_id` resolves to a live raw row.

## 2. Likely meaning of key columns

| Column | Meaning |
|---|---|
| `brands.is_joola` | `true` for exactly one brand (JOOLA). `reddit_keywords text[]` are brand-name match terms (2–4 per brand). **No colour column exists.** |
| `mention_facts.channel` | Fine-grained channel code: `ig_comment, yt_comment, reddit, reddit_comment, tiktok, tiktok_comment, x, x_influencer, product_review`. |
| `mention_facts.engagement` | Unified engagement count. Equals `ig_comments.comment_likes` on 12,136/12,136 IG rows. |
| `mention_facts.text_snippet` | Truncated text (max observed 286 chars). Raw tables hold full text. |
| `mention_facts.link_url` | Content link. |
| `*.sentiment_label` | 5 levels `very_negative, negative, neutral, positive, very_positive`, or NULL. |
| `reddit_mentions.sentiment` | **Legacy** 3-level column (1,042/1,493 NULL). Superseded by `sentiment_label`. |
| `reddit_mentions.content_type` | `Post` (1,405) or `Comment` (88). Some "mentions" are actually comments. |
| `*.crisis_keywords text[]` | The keywords that triggered `is_crisis`. This is the closest thing to "complaint keywords" in social tables. |
| `paddle_reviews.complaint_category` | Real complaint taxonomy (13 values + `none`), reviews only. |
| `topic_lifecycle` | Grain = (brand_id, topic, channel, year, week_number), with no duplicates. Channels: `instagram, youtube, reddit, tiktok, twitter`. Only 2026 weeks 26–40. |
| `competitor_switch_events.detected_at` | Present on every row that lacks `posted_at`, so it is usable as a date fallback. |
| `yt_videos.published_at` | Parent-video publish date, a lower bound for a comment's date. |

## 3. PII inventory (never selected into any view or response)

`commenter_username`, `author`, `handle`, `reviewer_name`, `reviewer_location`, `account_id`,
`influencer_id`, `athlete_id`, platform comment IDs (`instagram_comment_id`, `youtube_comment_id`,
`tiktok_comment_id`, `reddit_comment_id`, `reply_to_comment_id`), and media/thumbnail/avatar URLs.
Free text (`comment_text`, `content_text`, `body`, `text`) may itself contain `@handles` (see DATA_QUALITY §8).

## 4. Column tables

### `brands`

| Column | Type | Null | Key | Notes |
|---|---|---|---|---|
| `id` | uuid | NO | PK |  |
| `name` | text | NO |  |  |
| `slug` | text | NO |  |  |
| `website_url` | text | yes |  |  |
| `headquarters` | text | yes |  |  |
| `founded_year` | integer | yes |  |  |
| `amazon_brand_name` | text | yes |  |  |
| `reddit_keywords` | text[] | yes |  |  |
| `is_joola` | boolean | yes |  |  |
| `is_active` | boolean | yes |  |  |
| `country_code` | text | yes |  |  |
| `created_at` | timestamp with time zone | yes |  |  |
| `timezone` | text | yes |  |  |

### `mention_facts`

| Column | Type | Null | Key | Notes |
|---|---|---|---|---|
| `id` | uuid | NO | PK |  |
| `channel` | text | NO |  |  |
| `source_table` | text | NO |  |  |
| `source_id` | uuid | NO |  |  |
| `brand_id` | uuid | yes | FK → brands.id |  |
| `product_id` | uuid | yes | FK → products_catalog.id |  |
| `athlete_id` | uuid | yes | FK → influencers.id | **PII – never exposed** |
| `sentiment_score` | numeric | yes |  |  |
| `sentiment_label` | text | yes |  |  |
| `is_crisis` | boolean | yes |  |  |
| `is_opportunity` | boolean | yes |  |  |
| `is_purchase_intent` | boolean | yes |  |  |
| `is_competitor_switch` | boolean | yes |  |  |
| `country_code` | text | yes |  |  |
| `text_snippet` | text | yes |  |  |
| `posted_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | yes |  |  |
| `engagement` | bigint | NO |  |  |
| `link_url` | text | yes |  |  |

### `ig_comments`

| Column | Type | Null | Key | Notes |
|---|---|---|---|---|
| `id` | uuid | NO | PK |  |
| `instagram_comment_id` | text | yes |  | **PII – never exposed** |
| `post_id` | uuid | yes | FK → ig_posts.id |  |
| `brand_id` | uuid | yes | FK → brands.id |  |
| `commenter_username` | text | yes |  | **PII – never exposed** |
| `comment_text` | text | yes |  |  |
| `comment_likes` | integer | yes |  |  |
| `is_brand_reply` | boolean | yes |  |  |
| `reply_to_comment_id` | text | yes |  | **PII – never exposed** |
| `posted_at` | timestamp with time zone | yes |  |  |
| `scraped_at` | timestamp with time zone | yes |  |  |
| `sentiment_score` | numeric | yes |  |  |
| `sentiment_label` | text | yes |  |  |
| `topics` | jsonb | yes |  |  |
| `brands_mentioned` | text[] | yes |  |  |
| `players_mentioned` | text[] | yes |  |  |
| `products_mentioned` | text[] | yes |  |  |
| `is_crisis` | boolean | yes |  |  |
| `is_opportunity` | boolean | yes |  |  |
| `purchase_intent_score` | numeric | yes |  |  |
| `crisis_keywords` | text[] | yes |  |  |
| `enriched_at` | timestamp with time zone | yes |  |  |
| `post_url` | text | yes |  |  |

### `yt_comments`

| Column | Type | Null | Key | Notes |
|---|---|---|---|---|
| `id` | uuid | NO | PK |  |
| `youtube_comment_id` | text | yes |  | **PII – never exposed** |
| `video_id` | uuid | yes | FK → yt_videos.id |  |
| `brand_id` | uuid | yes | FK → brands.id |  |
| `commenter_username` | text | yes |  | **PII – never exposed** |
| `comment_text` | text | yes |  |  |
| `comment_likes` | integer | yes |  |  |
| `is_brand_reply` | boolean | yes |  |  |
| `reply_to_comment_id` | text | yes |  | **PII – never exposed** |
| `posted_at` | timestamp with time zone | yes |  |  |
| `scraped_at` | timestamp with time zone | yes |  |  |
| `sentiment_score` | numeric | yes |  |  |
| `sentiment_label` | text | yes |  |  |
| `topics` | jsonb | yes |  |  |
| `brands_mentioned` | text[] | yes |  |  |
| `players_mentioned` | text[] | yes |  |  |
| `products_mentioned` | text[] | yes |  |  |
| `is_crisis` | boolean | yes |  |  |
| `is_opportunity` | boolean | yes |  |  |
| `purchase_intent_score` | numeric | yes |  |  |
| `crisis_keywords` | text[] | yes |  |  |
| `enriched_at` | timestamp with time zone | yes |  |  |
| `like_count` | integer | yes |  |  |

### `reddit_mentions`

| Column | Type | Null | Key | Notes |
|---|---|---|---|---|
| `id` | uuid | NO | PK |  |
| `brand_id` | uuid | yes | FK → brands.id |  |
| `reddit_post_id` | text | yes |  |  |
| `subreddit` | text | yes |  |  |
| `country_code` | text | yes |  |  |
| `post_title` | text | yes |  |  |
| `post_url` | text | yes |  |  |
| `content_type` | text | yes |  |  |
| `content_text` | text | yes |  |  |
| `author` | text | yes |  | **PII – never exposed** |
| `upvotes` | integer | yes |  |  |
| `posted_at` | timestamp with time zone | yes |  |  |
| `sentiment` | text | yes |  |  |
| `competitor_switch` | boolean | yes |  |  |
| `switch_direction` | text | yes |  |  |
| `scraped_at` | timestamp with time zone | yes |  |  |
| `topics` | text[] | yes |  |  |
| `brands_mentioned` | text[] | yes |  |  |
| `players_mentioned` | text[] | yes |  |  |
| `is_crisis` | boolean | yes |  |  |
| `is_opportunity` | boolean | yes |  |  |
| `sentiment_score` | numeric | yes |  |  |
| `sentiment_label` | text | yes |  |  |
| `products_mentioned` | text[] | yes |  |  |
| `purchase_intent_score` | numeric | yes |  |  |
| `competitor_switch_from` | text | yes |  |  |
| `competitor_switch_to` | text | yes |  |  |
| `crisis_keywords` | text[] | yes |  |  |
| `enriched_at` | timestamp with time zone | yes |  |  |
| `upvotes_last_scrape` | integer | yes |  |  |
| `velocity_per_hour` | numeric | yes |  |  |
| `awards` | jsonb | yes |  |  |
| `is_removed` | boolean | yes |  |  |

### `reddit_comments`

| Column | Type | Null | Key | Notes |
|---|---|---|---|---|
| `id` | uuid | NO | PK |  |
| `parent_post_id` | uuid | yes | FK → reddit_mentions.id |  |
| `reddit_comment_id` | text | NO |  | **PII – never exposed** |
| `brand_id` | uuid | yes | FK → brands.id |  |
| `subreddit` | text | yes |  |  |
| `author` | text | yes |  | **PII – never exposed** |
| `comment_text` | text | yes |  |  |
| `upvotes` | integer | yes |  |  |
| `depth` | integer | yes |  |  |
| `posted_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | yes |  |  |
| `sentiment_score` | numeric | yes |  |  |
| `sentiment_label` | text | yes |  |  |
| `topics` | jsonb | yes |  |  |
| `brands_mentioned` | text[] | yes |  |  |
| `players_mentioned` | text[] | yes |  |  |
| `products_mentioned` | text[] | yes |  |  |
| `is_crisis` | boolean | yes |  |  |
| `is_opportunity` | boolean | yes |  |  |
| `purchase_intent_score` | numeric | yes |  |  |
| `competitor_switch_from` | text | yes |  |  |
| `competitor_switch_to` | text | yes |  |  |
| `crisis_keywords` | text[] | yes |  |  |
| `enriched_at` | timestamp with time zone | yes |  |  |

### `tiktok_comments`

| Column | Type | Null | Key | Notes |
|---|---|---|---|---|
| `id` | uuid | NO | PK |  |
| `tiktok_comment_id` | text | yes |  | **PII – never exposed** |
| `video_id` | uuid | yes | FK → tiktok_videos.id |  |
| `brand_id` | uuid | yes | FK → brands.id |  |
| `commenter_username` | text | yes |  | **PII – never exposed** |
| `comment_text` | text | yes |  |  |
| `comment_likes` | integer | yes |  |  |
| `reply_to_comment_id` | text | yes |  | **PII – never exposed** |
| `posted_at` | timestamp with time zone | yes |  |  |
| `scraped_at` | timestamp with time zone | yes |  |  |
| `sentiment_score` | numeric | yes |  |  |
| `sentiment_label` | text | yes |  |  |
| `topics` | text[] | yes |  |  |
| `brands_mentioned` | text[] | yes |  |  |
| `players_mentioned` | text[] | yes |  |  |
| `products_mentioned` | text[] | yes |  |  |
| `is_crisis` | boolean | yes |  |  |
| `is_opportunity` | boolean | yes |  |  |
| `purchase_intent_score` | numeric | yes |  |  |
| `crisis_keywords` | text[] | yes |  |  |
| `enriched_at` | timestamp with time zone | yes |  |  |
| `is_brand_reply` | boolean | yes |  |  |

### `competitor_switch_events`

| Column | Type | Null | Key | Notes |
|---|---|---|---|---|
| `id` | uuid | NO | PK |  |
| `mention_id` | uuid | yes | FK → mention_facts.id |  |
| `from_brand_id` | uuid | yes | FK → brands.id |  |
| `to_brand_id` | uuid | yes | FK → brands.id |  |
| `confidence` | numeric | yes |  |  |
| `text_snippet` | text | yes |  |  |
| `posted_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | yes |  |  |
| `channel` | text | yes |  |  |
| `source_mention_id` | uuid | yes |  |  |
| `detected_at` | timestamp with time zone | yes |  |  |
| `post_url` | text | yes |  |  |

### `topic_lifecycle`

| Column | Type | Null | Key | Notes |
|---|---|---|---|---|
| `id` | uuid | NO | PK |  |
| `brand_id` | uuid | NO | FK → brands.id |  |
| `topic` | text | NO |  |  |
| `channel` | text | NO |  |  |
| `mention_count` | integer | yes |  |  |
| `first_seen_at` | timestamp with time zone | yes |  |  |
| `week_number` | integer | NO |  |  |
| `year` | integer | NO |  |  |
| `created_at` | timestamp with time zone | yes |  |  |

### `brand_replies`

| Column | Type | Null | Key | Notes |
|---|---|---|---|---|
| `id` | uuid | NO | PK |  |
| `replying_brand_id` | uuid | yes | FK → brands.id |  |
| `source_table` | text | NO |  |  |
| `source_row_id` | uuid | NO |  |  |
| `original_text` | text | yes |  |  |
| `reply_text` | text | yes |  |  |
| `replied_at` | timestamp with time zone | yes |  |  |
| `response_time_mins` | integer | yes |  |  |
| `joola_responded` | boolean | yes |  |  |
| `sentiment` | text | yes |  |  |
| `created_at` | timestamp with time zone | yes |  |  |

### `paddle_reviews`

| Column | Type | Null | Key | Notes |
|---|---|---|---|---|
| `id` | uuid | NO | PK |  |
| `brand_id` | uuid | yes |  |  |
| `source` | text | NO |  |  |
| `external_review_id` | text | NO |  |  |
| `product_id` | uuid | yes | FK → paddle_products.id |  |
| `source_product_id` | text | yes |  |  |
| `family_id` | text | yes |  |  |
| `canonical_name` | text | yes |  |  |
| `brand` | text | yes |  |  |
| `retailer` | text | yes |  |  |
| `reviewer_name` | text | yes |  | **PII – never exposed** |
| `reviewer_location` | text | yes |  | **PII – never exposed** |
| `rating` | smallint | yes |  |  |
| `title` | text | yes |  |  |
| `body` | text | yes |  |  |
| `pros` | text | yes |  |  |
| `cons` | text | yes |  |  |
| `secondary_ratings` | jsonb | yes |  |  |
| `context_values` | jsonb | yes |  |  |
| `posted_at` | timestamp with time zone | yes |  |  |
| `is_verified` | boolean | yes |  |  |
| `is_recommended` | boolean | yes |  |  |
| `is_incentivized` | boolean | yes |  |  |
| `is_syndicated` | boolean | yes |  |  |
| `helpful_count` | integer | yes |  |  |
| `unhelpful_count` | integer | yes |  |  |
| `brand_response` | text | yes |  |  |
| `brand_response_at` | timestamp with time zone | yes |  |  |
| `media_urls` | text[] | yes |  | **PII – never exposed** |
| `language_code` | text | yes |  |  |
| `source_sentiment` | text | yes |  |  |
| `content_hash` | character varying | yes |  |  |
| `scraped_at` | timestamp with time zone | yes |  |  |
| `sentiment_label` | text | yes |  |  |
| `sentiment_score` | numeric | yes |  |  |
| `topics` | text[] | yes |  |  |
| `is_crisis` | boolean | yes |  |  |
| `is_opportunity` | boolean | yes |  |  |
| `complaint_category` | text | yes |  |  |
| `mentioned_competitors` | text[] | yes |  |  |
| `created_at` | timestamp with time zone | NO |  |  |

### `tiktok_videos`

| Column | Type | Null | Key | Notes |
|---|---|---|---|---|
| `id` | uuid | NO | PK |  |
| `account_id` | uuid | yes | FK → tiktok_accounts.id | **PII – never exposed** |
| `brand_id` | uuid | yes | FK → brands.id |  |
| `handle` | text | yes |  | **PII – never exposed** |
| `tiktok_video_id` | text | yes |  |  |
| `video_url` | text | yes |  |  |
| `text` | text | yes |  |  |
| `view_count` | bigint | yes |  |  |
| `like_count` | integer | yes |  |  |
| `comment_count` | integer | yes |  |  |
| `share_count` | integer | yes |  |  |
| `duration_seconds` | integer | yes |  |  |
| `thumbnail_url` | text | yes |  | **PII – never exposed** |
| `posted_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | yes |  |  |
| `sentiment_score` | numeric | yes |  |  |
| `sentiment_label` | text | yes |  |  |
| `topics` | jsonb | yes |  |  |
| `brands_mentioned` | text[] | yes |  |  |
| `players_mentioned` | text[] | yes |  |  |
| `products_mentioned` | text[] | yes |  |  |
| `is_crisis` | boolean | yes |  |  |
| `is_opportunity` | boolean | yes |  |  |
| `purchase_intent_score` | numeric | yes |  |  |
| `crisis_keywords` | text[] | yes |  |  |
| `enriched_at` | timestamp with time zone | yes |  |  |

### `x_posts`

| Column | Type | Null | Key | Notes |
|---|---|---|---|---|
| `id` | uuid | NO | PK |  |
| `account_id` | uuid | yes | FK → x_accounts.id | **PII – never exposed** |
| `brand_id` | uuid | yes | FK → brands.id |  |
| `handle` | text | yes |  | **PII – never exposed** |
| `tweet_id` | text | yes |  |  |
| `post_url` | text | yes |  |  |
| `text` | text | yes |  |  |
| `like_count` | integer | yes |  |  |
| `retweet_count` | integer | yes |  |  |
| `reply_count` | integer | yes |  |  |
| `view_count` | integer | yes |  |  |
| `posted_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | yes |  |  |
| `sentiment_score` | numeric | yes |  |  |
| `sentiment_label` | text | yes |  |  |
| `topics` | jsonb | yes |  |  |
| `brands_mentioned` | text[] | yes |  |  |
| `players_mentioned` | text[] | yes |  |  |
| `products_mentioned` | text[] | yes |  |  |
| `is_crisis` | boolean | yes |  |  |
| `is_opportunity` | boolean | yes |  |  |
| `purchase_intent_score` | numeric | yes |  |  |
| `crisis_keywords` | text[] | yes |  |  |
| `enriched_at` | timestamp with time zone | yes |  |  |

### `influencer_x_posts`

| Column | Type | Null | Key | Notes |
|---|---|---|---|---|
| `id` | uuid | NO | PK |  |
| `influencer_id` | uuid | yes | FK → influencers.id | **PII – never exposed** |
| `brand_id` | uuid | yes | FK → brands.id |  |
| `handle` | text | yes |  | **PII – never exposed** |
| `tweet_id` | text | yes |  |  |
| `post_url` | text | yes |  |  |
| `text` | text | yes |  |  |
| `like_count` | integer | yes |  |  |
| `retweet_count` | integer | yes |  |  |
| `reply_count` | integer | yes |  |  |
| `view_count` | integer | yes |  |  |
| `posted_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | yes |  |  |
| `sentiment_score` | numeric | yes |  |  |
| `sentiment_label` | text | yes |  |  |
| `topics` | jsonb | yes |  |  |
| `brands_mentioned` | text[] | yes |  |  |
| `products_mentioned` | text[] | yes |  |  |
| `is_crisis` | boolean | yes |  |  |
| `is_opportunity` | boolean | yes |  |  |
| `purchase_intent_score` | numeric | yes |  |  |
| `enriched_at` | timestamp with time zone | yes |  |  |

### `yt_videos`

| Column | Type | Null | Key | Notes |
|---|---|---|---|---|
| `id` | uuid | NO | PK |  |
| `youtube_video_id` | text | yes |  |  |
| `channel_id` | uuid | yes | FK → yt_channels.id |  |
| `brand_id` | uuid | yes | FK → brands.id |  |
| `region` | text | yes |  |  |
| `title` | text | yes |  |  |
| `video_url` | text | yes |  |  |
| `thumbnail_url` | text | yes |  | **PII – never exposed** |
| `published_at` | timestamp with time zone | yes |  |  |
| `duration_seconds` | integer | yes |  |  |
| `video_type` | text | yes |  |  |
| `description` | text | yes |  |  |
| `hashtags` | text[] | yes |  |  |
| `tags` | text[] | yes |  |  |
| `view_count` | bigint | yes |  |  |
| `like_count` | integer | yes |  |  |
| `comment_count` | integer | yes |  |  |
| `is_short` | boolean | yes |  |  |
| `is_sponsored` | boolean | yes |  |  |
| `is_live_recording` | boolean | yes |  |  |
| `first_scraped_at` | timestamp with time zone | yes |  |  |
| `last_updated_at` | timestamp with time zone | yes |  |  |

### `ig_posts`

| Column | Type | Null | Key | Notes |
|---|---|---|---|---|
| `id` | uuid | NO | PK |  |
| `instagram_post_id` | text | yes |  |  |
| `account_id` | uuid | yes | FK → ig_accounts.id | **PII – never exposed** |
| `brand_id` | uuid | yes | FK → brands.id |  |
| `region` | text | yes |  |  |
| `handle` | text | yes |  | **PII – never exposed** |
| `post_url` | text | yes |  |  |
| `posted_at` | timestamp with time zone | yes |  |  |
| `post_format` | text | yes |  |  |
| `caption` | text | yes |  |  |
| `hashtags` | text[] | yes |  |  |
| `tagged_accounts` | text[] | yes |  | **PII – never exposed** |
| `location_tag` | text | yes |  |  |
| `like_count` | integer | yes |  |  |
| `comment_count` | integer | yes |  |  |
| `view_count` | integer | yes |  |  |
| `image_url` | text | yes |  | **PII – never exposed** |
| `all_media_urls` | text[] | yes |  | **PII – never exposed** |
| `is_sponsored` | boolean | yes |  |  |
| `first_scraped_at` | timestamp with time zone | yes |  |  |
| `last_updated_at` | timestamp with time zone | yes |  |  |
| `sentiment_score` | numeric | yes |  |  |
| `sentiment_label` | text | yes |  |  |
| `topics` | jsonb | yes |  |  |
| `brands_mentioned` | text[] | yes |  |  |
| `players_mentioned` | text[] | yes |  |  |
| `products_mentioned` | text[] | yes |  |  |
| `is_crisis` | boolean | yes |  |  |
| `is_opportunity` | boolean | yes |  |  |
| `purchase_intent_score` | numeric | yes |  |  |
| `crisis_keywords` | text[] | yes |  |  |
| `enriched_at` | timestamp with time zone | yes |  |  |

## 5. The `intel` analytics layer (new, read-only; migrations in `supabase/sql/`)

| Object | Kind | Grain / purpose | Granted to `intel_reader` |
|---|---|---|---|
| `intel.sentiment_5/3`, `normalise_channel`, `mask_pii`, `regex_escape` | SQL functions (immutable) | normalisation helpers, mirrored in `src/core/normalise.ts` | EXECUTE |
| `intel.v_brands` | view | 1 row per brand | SELECT |
| `intel.v_src_<table>` (9) | views | 1 row per raw row, common adapter contract | **no** (internal) |
| `intel.v_brand_keyword_regex` | view | 1 combined word-boundary regex per brand | **no** (internal) |
| `intel.v_signal_brands` | view | brand set per raw row (raw / mention_facts / keyword / none) | **no** (internal) |
| `intel.v_signals` | view | 1 row per raw row × distinct brand (see 020) | SELECT |
| `intel.v_switch_events` | view | 1 row per switch event + has_date/has_from/has_to | SELECT |
| `intel.v_topic_weekly` | view | brand × topic × channel × ISO week, week_start, WoW growth | SELECT |
| `intel.v_replies` | view | 1 row per brand reply (masked text) | SELECT |
| `intel.v_data_health` | view | 1 row per source table, aggregate counts only | SELECT |

`v_signals` columns: `signal_id, source_table, source_row_id, brand_id, brand_source (stored|inferred|none),
brand_method (raw|mention_facts|keyword|none), channel, signal_type (post|comment|review), sentiment_5, sentiment_3,
is_crisis, text, post_url, engagement, engagement_kind (likes|upvotes|helpful_votes), complaint_keywords, occurred_at,
date_source (posted|parent_published|none), scraped_at`. It contains no user-identifying column
(`tests/sql/contract.test.ts` enforces this).

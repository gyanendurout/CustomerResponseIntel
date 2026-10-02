-- 033_v_data_health.sql
-- Aggregate-only health counts per source table (no row-level data). One row per table.
--   duplicate_rows: mention_facts = rows beyond the first per (source_table, source_id, brand_id);
--                   topic_lifecycle = rows with an invalid week_number (skipped by v_topic_weekly);
--                   mention_facts_unmapped = mention_facts rows whose source_table has no adapter in v_signals.

create or replace view intel.v_data_health as
select 'mention_facts'::text as table_name, count(*)::bigint as row_count,
       count(*) filter (where posted_at is null)::bigint as null_date,
       count(*) filter (where brand_id is null)::bigint as null_brand,
       min(posted_at) as min_date, max(posted_at) as max_date, max(created_at) as last_loaded_at,
       (count(*) - (select count(*) from (select distinct source_table, source_id, brand_id from public.mention_facts) d))::bigint as duplicate_rows
from public.mention_facts
union all
select 'ig_comments', count(*), count(*) filter (where posted_at is null), count(*) filter (where brand_id is null),
       min(posted_at), max(posted_at), max(scraped_at), null from public.ig_comments
union all
select 'yt_comments', count(*), count(*) filter (where posted_at is null), count(*) filter (where brand_id is null),
       min(posted_at), max(posted_at), max(scraped_at), null from public.yt_comments
union all
select 'reddit_mentions', count(*), count(*) filter (where posted_at is null), count(*) filter (where brand_id is null),
       min(posted_at), max(posted_at), max(scraped_at), null from public.reddit_mentions
union all
select 'reddit_comments', count(*), count(*) filter (where posted_at is null), count(*) filter (where brand_id is null),
       min(posted_at), max(posted_at), max(created_at), null from public.reddit_comments
union all
select 'tiktok_comments', count(*), count(*) filter (where posted_at is null), count(*) filter (where brand_id is null),
       min(posted_at), max(posted_at), max(scraped_at), null from public.tiktok_comments
union all
select 'tiktok_videos', count(*), count(*) filter (where posted_at is null), count(*) filter (where brand_id is null),
       min(posted_at), max(posted_at), max(created_at), null from public.tiktok_videos
union all
select 'x_posts', count(*), count(*) filter (where posted_at is null), count(*) filter (where brand_id is null),
       min(posted_at), max(posted_at), max(created_at), null from public.x_posts
union all
select 'influencer_x_posts', count(*), count(*) filter (where posted_at is null), count(*) filter (where brand_id is null),
       min(posted_at), max(posted_at), max(created_at), null from public.influencer_x_posts
union all
select 'paddle_reviews', count(*), count(*) filter (where posted_at is null), count(*) filter (where brand_id is null),
       min(posted_at), max(posted_at), max(scraped_at), null from public.paddle_reviews
union all
select 'competitor_switch_events', count(*), count(*) filter (where posted_at is null),
       count(*) filter (where from_brand_id is null or to_brand_id is null),
       min(posted_at), max(posted_at), max(created_at), null from public.competitor_switch_events
union all
select 'topic_lifecycle', count(*), count(*) filter (where first_seen_at is null), count(*) filter (where brand_id is null),
       min(first_seen_at), max(first_seen_at), max(created_at),
       count(*) filter (where week_number not between 1 and 53) from public.topic_lifecycle
union all
select 'brand_replies', count(*), count(*) filter (where replied_at is null), count(*) filter (where replying_brand_id is null),
       min(replied_at), max(replied_at), max(created_at), null from public.brand_replies
union all
select 'mention_facts_unmapped', count(*), 0, 0, null, null, null, count(*)
from public.mention_facts
where source_table not in ('ig_comments', 'yt_comments', 'reddit_mentions', 'reddit_comments', 'tiktok_comments',
                           'tiktok_videos', 'x_posts', 'influencer_x_posts', 'paddle_reviews');

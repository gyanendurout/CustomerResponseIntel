-- 044_v_reddit_posts.sql
-- Reddit posts (reddit_mentions) with what the signals view does not carry: subreddit, upvote velocity and the
-- number of replies captured in reddit_comments. One row per (post × brand), using the same brand attribution as
-- intel.v_signals (raw brand, then mention_facts). Removed posts are excluded. Author is never selected.
--
-- subreddit:         lower-case, without a leading "r/"
-- captured_comments: replies we scraped (a floor, not Reddit's own comment count)

create or replace view intel.v_reddit_posts as
with comments as (
  select parent_post_id, count(*)::int as n
  from public.reddit_comments
  where parent_post_id is not null
  group by parent_post_id
)
select
  m.id                                                                        as post_id,
  sb.brand_id,
  nullif(regexp_replace(lower(btrim(m.subreddit)), '^/?r/', ''), '')         as subreddit,
  m.posted_at,
  coalesce(m.upvotes, 0)::bigint                                              as upvotes,
  m.velocity_per_hour::numeric                                                as velocity_per_hour,
  coalesce(c.n, 0)                                                            as captured_comments,
  intel.mask_pii(coalesce(nullif(btrim(m.post_title), ''), left(m.content_text, 120))) as title,
  intel.canonical_url(m.post_url)                                             as url,
  intel.sentiment_5(m.sentiment_label)                                        as sentiment_5,
  coalesce(m.is_crisis, false)                                                as is_crisis
from public.reddit_mentions m
join intel.v_signal_brands sb on sb.source_table = 'reddit_mentions' and sb.source_row_id = m.id
left join comments c on c.parent_post_id = m.id
where not coalesce(m.is_removed, false);

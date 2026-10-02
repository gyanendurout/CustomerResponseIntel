-- 014_v_src_reddit_comments.sql
-- Adapter: Reddit comments. Half have no brand_id (and no parent post); v_signals infers their brand
-- from mention_facts, then from a brands.reddit_keywords text match. post_url = parent post URL.

create or replace view intel.v_src_reddit_comments as
select
  'reddit_comments'::text                          as source_table,
  c.id                                             as source_row_id,
  c.brand_id                                       as raw_brand_id,
  'reddit'::text                                   as channel,
  'comment'::text                                  as signal_type,
  intel.sentiment_5(c.sentiment_label)             as sentiment_5,
  coalesce(c.is_crisis, false)                     as is_crisis,
  intel.mask_pii(c.comment_text)                   as text,
  p.post_url                                       as post_url,
  coalesce(c.upvotes, 0)::bigint                   as engagement,
  'upvotes'::text                                  as engagement_kind,
  coalesce(c.crisis_keywords, '{}'::text[])        as complaint_keywords,
  coalesce(c.posted_at, p.posted_at)               as occurred_at,
  case when c.posted_at is not null then 'posted'
       when p.posted_at is not null then 'parent_published'
       else 'none' end                             as date_source,
  c.created_at                                     as scraped_at
from public.reddit_comments c
left join public.reddit_mentions p on p.id = c.parent_post_id;

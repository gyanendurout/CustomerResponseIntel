-- 017_v_src_x_posts.sql
-- Adapter: X (Twitter) posts from tracked accounts. Engagement = like_count.

create or replace view intel.v_src_x_posts as
select
  'x_posts'::text                                  as source_table,
  x.id                                             as source_row_id,
  x.brand_id                                       as raw_brand_id,
  'x'::text                                        as channel,
  'post'::text                                     as signal_type,
  intel.sentiment_5(x.sentiment_label)             as sentiment_5,
  coalesce(x.is_crisis, false)                     as is_crisis,
  intel.mask_pii(x.text)                           as text,
  x.post_url                                       as post_url,
  coalesce(x.like_count, 0)::bigint                as engagement,
  'likes'::text                                    as engagement_kind,
  coalesce(x.crisis_keywords, '{}'::text[])        as complaint_keywords,
  x.posted_at                                      as occurred_at,
  case when x.posted_at is not null then 'posted' else 'none' end as date_source,
  x.created_at                                     as scraped_at
from public.x_posts x;

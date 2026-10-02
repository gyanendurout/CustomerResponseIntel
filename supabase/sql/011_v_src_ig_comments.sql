-- 011_v_src_ig_comments.sql
-- Adapter: Instagram comments -> signal contract. Date falls back to the parent post's posted_at.
-- Brand-account replies (is_brand_reply) are not community signals and are excluded.
-- Contract (order matters, checked by tests/sql/contract.test.ts):
--   source_table, source_row_id, raw_brand_id, channel, signal_type, sentiment_5, is_crisis, text, post_url,
--   engagement, engagement_kind, complaint_keywords, occurred_at, date_source, scraped_at

create or replace view intel.v_src_ig_comments as
select
  'ig_comments'::text                              as source_table,
  c.id                                             as source_row_id,
  c.brand_id                                       as raw_brand_id,
  'instagram'::text                                as channel,
  'comment'::text                                  as signal_type,
  intel.sentiment_5(c.sentiment_label)             as sentiment_5,
  coalesce(c.is_crisis, false)                     as is_crisis,
  intel.mask_pii(c.comment_text)                   as text,
  coalesce(c.post_url, p.post_url)                 as post_url,
  coalesce(c.comment_likes, 0)::bigint             as engagement,
  'likes'::text                                    as engagement_kind,
  coalesce(c.crisis_keywords, '{}'::text[])        as complaint_keywords,
  coalesce(c.posted_at, p.posted_at)               as occurred_at,
  case when c.posted_at is not null then 'posted'
       when p.posted_at is not null then 'parent_published'
       else 'none' end                             as date_source,
  c.scraped_at                                     as scraped_at
from public.ig_comments c
left join public.ig_posts p on p.id = c.post_id
where not coalesce(c.is_brand_reply, false);

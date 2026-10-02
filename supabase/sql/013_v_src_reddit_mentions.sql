-- 013_v_src_reddit_mentions.sql
-- Adapter: Reddit posts that name a brand. content_type 'Comment' rows (88) are typed as comments.
-- Uses sentiment_label (5-level); the legacy 3-level `sentiment` column is ignored. Removed posts excluded.

create or replace view intel.v_src_reddit_mentions as
select
  'reddit_mentions'::text                          as source_table,
  m.id                                             as source_row_id,
  m.brand_id                                       as raw_brand_id,
  'reddit'::text                                   as channel,
  case when lower(m.content_type) = 'comment' then 'comment' else 'post' end as signal_type,
  intel.sentiment_5(m.sentiment_label)             as sentiment_5,
  coalesce(m.is_crisis, false)                     as is_crisis,
  intel.mask_pii(concat_ws(chr(10) || chr(10), nullif(btrim(m.post_title), ''), nullif(btrim(m.content_text), ''))) as text,
  m.post_url                                       as post_url,
  coalesce(m.upvotes, 0)::bigint                   as engagement,
  'upvotes'::text                                  as engagement_kind,
  coalesce(m.crisis_keywords, '{}'::text[])        as complaint_keywords,
  m.posted_at                                      as occurred_at,
  case when m.posted_at is not null then 'posted' else 'none' end as date_source,
  m.scraped_at                                     as scraped_at
from public.reddit_mentions m
where not coalesce(m.is_removed, false);

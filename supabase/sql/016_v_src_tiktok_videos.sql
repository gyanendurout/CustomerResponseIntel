-- 016_v_src_tiktok_videos.sql
-- Adapter: TikTok videos (posts). Engagement = like_count.

create or replace view intel.v_src_tiktok_videos as
select
  'tiktok_videos'::text                            as source_table,
  v.id                                             as source_row_id,
  v.brand_id                                       as raw_brand_id,
  'tiktok'::text                                   as channel,
  'post'::text                                     as signal_type,
  intel.sentiment_5(v.sentiment_label)             as sentiment_5,
  coalesce(v.is_crisis, false)                     as is_crisis,
  intel.mask_pii(v.text)                           as text,
  v.video_url                                      as post_url,
  coalesce(v.like_count, 0)::bigint                as engagement,
  'likes'::text                                    as engagement_kind,
  coalesce(v.crisis_keywords, '{}'::text[])        as complaint_keywords,
  v.posted_at                                      as occurred_at,
  case when v.posted_at is not null then 'posted' else 'none' end as date_source,
  v.created_at                                     as scraped_at
from public.tiktok_videos v;

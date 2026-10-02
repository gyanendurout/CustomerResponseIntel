-- 015_v_src_tiktok_comments.sql
-- Adapter: TikTok comments. post_url = parent video URL.

create or replace view intel.v_src_tiktok_comments as
select
  'tiktok_comments'::text                          as source_table,
  c.id                                             as source_row_id,
  c.brand_id                                       as raw_brand_id,
  'tiktok'::text                                   as channel,
  'comment'::text                                  as signal_type,
  intel.sentiment_5(c.sentiment_label)             as sentiment_5,
  coalesce(c.is_crisis, false)                     as is_crisis,
  intel.mask_pii(c.comment_text)                   as text,
  v.video_url                                      as post_url,
  coalesce(c.comment_likes, 0)::bigint             as engagement,
  'likes'::text                                    as engagement_kind,
  coalesce(c.crisis_keywords, '{}'::text[])        as complaint_keywords,
  coalesce(c.posted_at, v.posted_at)               as occurred_at,
  case when c.posted_at is not null then 'posted'
       when v.posted_at is not null then 'parent_published'
       else 'none' end                             as date_source,
  c.scraped_at                                     as scraped_at
from public.tiktok_comments c
left join public.tiktok_videos v on v.id = c.video_id
where not coalesce(c.is_brand_reply, false);

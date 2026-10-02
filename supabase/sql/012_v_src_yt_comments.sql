-- 012_v_src_yt_comments.sql
-- Adapter: YouTube comments. 96 % have no posted_at; fall back to the parent video's published_at
-- (date_source = 'parent_published'). Engagement = comment_likes (like_count is never populated).

create or replace view intel.v_src_yt_comments as
select
  'yt_comments'::text                              as source_table,
  c.id                                             as source_row_id,
  c.brand_id                                       as raw_brand_id,
  'youtube'::text                                  as channel,
  'comment'::text                                  as signal_type,
  intel.sentiment_5(c.sentiment_label)             as sentiment_5,
  coalesce(c.is_crisis, false)                     as is_crisis,
  intel.mask_pii(c.comment_text)                   as text,
  v.video_url                                      as post_url,
  coalesce(c.comment_likes, 0)::bigint             as engagement,
  'likes'::text                                    as engagement_kind,
  coalesce(c.crisis_keywords, '{}'::text[])        as complaint_keywords,
  coalesce(c.posted_at, v.published_at)            as occurred_at,
  case when c.posted_at is not null then 'posted'
       when v.published_at is not null then 'parent_published'
       else 'none' end                             as date_source,
  c.scraped_at                                     as scraped_at
from public.yt_comments c
left join public.yt_videos v on v.id = c.video_id
where not coalesce(c.is_brand_reply, false);

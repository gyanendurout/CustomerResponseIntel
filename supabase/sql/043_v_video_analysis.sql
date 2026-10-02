-- 043_v_video_analysis.sql
-- AI analysis of brand YouTube videos (yt_video_analysis) joined to the video: content type, paid-promo flag,
-- summary, performance thesis and signals (all masked), matched product names, and current video metrics.
-- Not selected: players_mentioned (people), and sentiment / crisis / opportunity fields, which never vary in the data
-- (always positive or neutral, never crisis), so they would mislead.

create or replace view intel.v_video_analysis as
select
  a.video_id                                                         as content_id,
  coalesce(a.brand_id, v.brand_id)                                   as brand_id,
  v.published_at                                                     as posted_at,
  intel.mask_pii(v.title)                                            as title,
  intel.canonical_url(coalesce(nullif(btrim(v.video_url), ''),
                               'https://www.youtube.com/watch?v=' || nullif(btrim(v.youtube_video_id), ''))) as url,
  coalesce(v.is_short, v.duration_seconds <= 60, false)              as is_short,
  nullif(lower(btrim(a.content_type)), '')                           as content_type,
  coalesce(a.is_paid_promo, false)                                   as is_paid_promo,
  intel.mask_pii(a.summary)                                          as summary,
  intel.mask_pii(a.performance_thesis)                               as performance_thesis,
  coalesce((select array_agg(intel.mask_pii(s) order by ord)
            from unnest(a.performance_signals) with ordinality as u(s, ord)), '{}'::text[]) as performance_signals,
  coalesce((select array_agg(pc.display_name order by pc.display_name)
            from public.products_catalog pc where pc.id = any(a.products_matched_ids)), '{}'::text[]) as products,
  coalesce(v.view_count, a.view_count_at_analysis)::bigint           as views,
  coalesce(v.like_count, a.like_count_at_analysis)::bigint           as likes,
  coalesce(v.comment_count, a.comment_count_at_analysis)::bigint     as comments,
  a.enriched_at                                                      as analysed_at
from public.yt_video_analysis a
join public.yt_videos v on v.id = a.video_id;

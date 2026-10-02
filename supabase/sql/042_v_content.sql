-- 042_v_content.sql
-- The brands' own posts and videos on Instagram, YouTube, X and TikTok: one row per piece of content.
-- Re-scraped duplicates are collapsed on the platform's own id (latest update wins).
--
-- format:       instagram reel | carousel | image | unknown;  youtube short | long_form;  x post;  tiktok video
-- views:        NULL where the platform does not report views for that item (e.g. Instagram images report 0)
-- comments:     on X these are replies
-- reposts:      X retweets;  shares: TikTok shares
-- interactions: likes + comments + shares + reposts (missing ones count as 0)
-- caption:      masked text (Instagram caption, YouTube title, X / TikTok text)
-- url:          content link without the account handle (intel.canonical_url)

create or replace view intel.v_content as
with ig as (
  select distinct on (coalesce(nullif(btrim(p.instagram_post_id), ''), nullif(btrim(p.post_url), ''), p.id::text))
    'instagram'::text as platform, p.id as content_id, p.brand_id, p.posted_at,
    case
      when lower(btrim(p.post_format)) in ('video', 'reel', 'reels', 'clips') then 'reel'
      when lower(btrim(p.post_format)) in ('carousel', 'sidecar', 'carousel_album') then 'carousel'
      when lower(btrim(p.post_format)) in ('image', 'photo') then 'image'
      else 'unknown'
    end as format,
    nullif(p.view_count, 0)::bigint as views, coalesce(p.like_count, 0)::bigint as likes,
    coalesce(p.comment_count, 0)::bigint as comments, null::bigint as shares, null::bigint as reposts,
    null::int as duration_s, intel.mask_pii(p.caption) as caption,
    intel.canonical_url(coalesce(nullif(btrim(p.post_url), ''),
                                 'https://www.instagram.com/p/' || nullif(btrim(p.instagram_post_id), '') || '/')) as url,
    coalesce(p.is_sponsored, false) as is_sponsored
  from public.ig_posts p
  order by coalesce(nullif(btrim(p.instagram_post_id), ''), nullif(btrim(p.post_url), ''), p.id::text),
           p.last_updated_at desc nulls last, p.first_scraped_at desc nulls last
),
yt as (
  select distinct on (coalesce(nullif(btrim(v.youtube_video_id), ''), v.id::text))
    'youtube'::text, v.id, v.brand_id, v.published_at,
    case when coalesce(v.is_short, v.duration_seconds <= 60, false) then 'short' else 'long_form' end,
    v.view_count::bigint, coalesce(v.like_count, 0)::bigint, coalesce(v.comment_count, 0)::bigint, null::bigint, null::bigint,
    v.duration_seconds, intel.mask_pii(v.title),
    intel.canonical_url(coalesce(nullif(btrim(v.video_url), ''),
                                 'https://www.youtube.com/watch?v=' || nullif(btrim(v.youtube_video_id), ''))),
    coalesce(v.is_sponsored, false)
  from public.yt_videos v
  order by coalesce(nullif(btrim(v.youtube_video_id), ''), v.id::text), v.last_updated_at desc nulls last
),
x as (
  select distinct on (coalesce(nullif(btrim(t.tweet_id), ''), nullif(btrim(t.post_url), ''), t.id::text))
    'x'::text, t.id, t.brand_id, t.posted_at, 'post'::text,
    nullif(t.view_count, 0)::bigint, coalesce(t.like_count, 0)::bigint, coalesce(t.reply_count, 0)::bigint,
    null::bigint, coalesce(t.retweet_count, 0)::bigint, null::int, intel.mask_pii(t.text),
    intel.canonical_url(t.post_url), false
  from public.x_posts t
  order by coalesce(nullif(btrim(t.tweet_id), ''), nullif(btrim(t.post_url), ''), t.id::text), t.created_at desc nulls last
),
tt as (
  select distinct on (coalesce(nullif(btrim(v.tiktok_video_id), ''), nullif(btrim(v.video_url), ''), v.id::text))
    'tiktok'::text, v.id, v.brand_id, v.posted_at, 'video'::text,
    v.view_count::bigint, coalesce(v.like_count, 0)::bigint, coalesce(v.comment_count, 0)::bigint,
    coalesce(v.share_count, 0)::bigint, null::bigint, v.duration_seconds, intel.mask_pii(v.text),
    intel.canonical_url(v.video_url), false
  from public.tiktok_videos v
  order by coalesce(nullif(btrim(v.tiktok_video_id), ''), nullif(btrim(v.video_url), ''), v.id::text), v.created_at desc nulls last
),
allc as (
  select * from ig union all select * from yt union all select * from x union all select * from tt
)
select
  platform, content_id, brand_id, posted_at, format, views, likes, comments, shares, reposts,
  likes + comments + coalesce(shares, 0) + coalesce(reposts, 0) as interactions,
  duration_s, caption, url, is_sponsored
from allc
where brand_id is not null;

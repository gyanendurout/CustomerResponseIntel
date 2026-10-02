-- 041_v_audience_weekly.sql
-- Weekly audience snapshots for the brands' own accounts on Instagram, YouTube, X and TikTok, on one grain:
-- platform × brand × ISO week. week_start = Monday of the ISO week (year, week_number).
-- When a week was scraped more than once, the latest scrape wins. Handles, bios and bio links are not selected.
-- Scrape glitches (0 followers, sudden drops) and missing weeks are flagged by the capability, not hidden here.

create or replace view intel.v_audience_weekly as
with raw as (
  select 'instagram'::text as platform, p.brand_id, p.year, p.week_number,
         p.followers::bigint as followers, p.following::bigint as following, p.post_count::bigint as content_count,
         null::bigint as total_hearts, null::bigint as total_views,
         nullif(lower(btrim(p.dominant_content_theme)), '') as content_theme, p.scraped_at
  from public.ig_profiles_weekly p
  union all
  select 'youtube', w.brand_id, w.year, w.week_number,
         w.subscribers::bigint, null::bigint, w.total_videos::bigint, null::bigint, w.total_views::bigint, null::text, w.scraped_at
  from public.yt_channel_weekly w
  union all
  select 'x', x.brand_id, x.year, x.week_number,
         x.followers::bigint, x.following::bigint, x.tweet_count::bigint, null::bigint, null::bigint, null::text, x.scraped_at
  from public.x_profiles_weekly x
  union all
  select 'tiktok', t.brand_id, t.year, t.week_number,
         t.followers::bigint, t.following::bigint, t.video_count::bigint, t.total_hearts::bigint, null::bigint, null::text, t.scraped_at
  from public.tiktok_profiles_weekly t
)
select distinct on (platform, brand_id, year, week_number)
  platform,
  brand_id,
  year,
  week_number,
  to_date(year::text || '-' || lpad(week_number::text, 2, '0') || '-1', 'IYYY-IW-ID') as week_start,
  followers,
  following,
  content_count,
  total_hearts,
  total_views,
  content_theme,
  scraped_at
from raw
-- An invalid year/week would make to_date() fail the whole view; such rows are skipped.
where brand_id is not null and year between 2000 and 2100 and week_number between 1 and 53
order by platform, brand_id, year, week_number, scraped_at desc nulls last;

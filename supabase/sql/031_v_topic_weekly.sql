-- 031_v_topic_weekly.sql
-- Weekly topic volume per brand and channel. week_start = Monday of ISO week (year, week_number).
-- Channel 'twitter' -> 'x'. Topic is trimmed and lower-cased so case variants merge.
-- prev_count is the immediately preceding ISO week only (a gap week counts as 0 -> growth NULL, i.e. "new").

create or replace view intel.v_topic_weekly as
with t as (
  select
    tl.brand_id,
    lower(btrim(tl.topic))                                                       as topic,
    intel.normalise_channel(tl.channel)                                          as channel,
    tl.year,
    tl.week_number,
    to_date(tl.year::text || '-' || lpad(tl.week_number::text, 2, '0') || '-1', 'IYYY-IW-ID') as week_start,
    sum(coalesce(tl.mention_count, 0))::bigint                                   as mention_count,
    min(tl.first_seen_at)                                                        as first_seen_at
  from public.topic_lifecycle tl
  -- An invalid week would make to_date() fail the whole view; such rows are skipped (counted by v_data_health).
  where tl.week_number between 1 and 53
  group by 1, 2, 3, 4, 5, 6
),
w as (
  select t.*,
         lag(t.week_start)    over win as prev_week_start,
         lag(t.mention_count) over win as prev_row_count
  from t
  window win as (partition by t.brand_id, t.topic, t.channel order by t.week_start)
)
select
  w.brand_id, w.topic, w.channel, w.year, w.week_number, w.week_start, w.mention_count, w.first_seen_at,
  case when w.prev_week_start = w.week_start - 7 then w.prev_row_count else 0 end as prev_count,
  case when w.prev_week_start = w.week_start - 7 and w.prev_row_count > 0
       then round(100.0 * (w.mention_count - w.prev_row_count) / w.prev_row_count, 1) end as wow_growth_pct
from w;

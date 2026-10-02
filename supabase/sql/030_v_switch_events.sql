-- 030_v_switch_events.sql
-- Normalised "switched from X to Y" events. Missing dates/brands are flagged, never hidden.
--   occurred_at = posted_at, else detected_at (date_source says which); has_date = a real posted date exists.
--   channel: stored value normalised; NULL -> 'reddit' when the source Reddit mention resolves, else 'unknown'.

create or replace view intel.v_switch_events as
select
  e.id                                         as switch_id,
  e.from_brand_id,
  e.to_brand_id,
  coalesce(e.posted_at, e.detected_at)         as occurred_at,
  case when e.posted_at is not null then 'posted'
       when e.detected_at is not null then 'detected'
       else 'none' end                         as date_source,
  e.posted_at is not null                      as has_date,
  e.from_brand_id is not null                  as has_from,
  e.to_brand_id is not null                    as has_to,
  coalesce(intel.normalise_channel(e.channel),
           case when rm.id is not null then 'reddit' else 'unknown' end) as channel,
  e.confidence,
  intel.mask_pii(e.text_snippet)               as text,
  intel.canonical_url(coalesce(e.post_url, rm.post_url)) as post_url
from public.competitor_switch_events e
left join public.reddit_mentions rm on rm.id = e.source_mention_id;

-- 046_v_athlete_mentions.sql
-- Mentions of sponsored pro athletes (the influencers roster), one row per (source item × athlete).
-- Owner decision (2026-10-02): sponsored pros' names may be returned. Their personal handles and channel URLs
-- (instagram_handle, tiktok_handle, x_handle, youtube_channel_url) are never selected.

create or replace view intel.v_athlete_mentions as
select distinct on (m.source_table, m.source_id, m.athlete_id)
  btrim(i.name)                            as athlete_name,
  i.brand_id                               as sponsor_brand_id,
  i.contract_type,
  coalesce(i.is_active, true)              as is_active,
  intel.normalise_channel(m.channel)       as channel,
  m.source_table,
  m.source_id                              as source_row_id,
  intel.sentiment_5(m.sentiment_label)     as sentiment_5,
  m.posted_at                              as occurred_at
from public.mention_facts m
join public.influencers i on i.id = m.athlete_id
order by m.source_table, m.source_id, m.athlete_id, m.posted_at nulls last;

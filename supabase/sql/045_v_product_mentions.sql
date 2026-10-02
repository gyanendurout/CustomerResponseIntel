-- 045_v_product_mentions.sql
-- Paddle mentions: mention_facts rows matched to a catalogue product. One row per (source item × product), so
-- mention_facts' exact duplicates count once. product_brand_id is the brand that makes the product.
-- occurred_at is the item's date from mention_facts; NULL when the source has no date (counted as undated).

create or replace view intel.v_product_mentions as
select distinct on (m.source_table, m.source_id, m.product_id)
  m.product_id,
  pc.display_name                          as product_name,
  pc.brand_id                              as product_brand_id,
  intel.normalise_channel(m.channel)       as channel,
  m.source_table,
  m.source_id                              as source_row_id,
  intel.sentiment_5(m.sentiment_label)     as sentiment_5,
  m.posted_at                              as occurred_at,
  coalesce(m.is_crisis, false)             as is_crisis
from public.mention_facts m
join public.products_catalog pc on pc.id = m.product_id
order by m.source_table, m.source_id, m.product_id, m.posted_at nulls last;

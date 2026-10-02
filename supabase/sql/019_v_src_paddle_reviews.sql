-- 019_v_src_paddle_reviews.sql
-- Adapter: retailer product reviews (okendo / yotpo / judgeme / bazaarvoice) -> channel 'product_review'.
-- Its own channel, never folded into Reddit. complaint_keywords = [complaint_category] unless NULL/'none'.
-- Engagement = helpful_count. No content URL exists for reviews. reviewer_name/location/media are NOT selected.

create or replace view intel.v_src_paddle_reviews as
select
  'paddle_reviews'::text                           as source_table,
  r.id                                             as source_row_id,
  r.brand_id                                       as raw_brand_id,
  'product_review'::text                           as channel,
  'review'::text                                   as signal_type,
  intel.sentiment_5(r.sentiment_label)             as sentiment_5,
  coalesce(r.is_crisis, false)                     as is_crisis,
  intel.mask_pii(concat_ws(chr(10) || chr(10), nullif(btrim(r.title), ''), nullif(btrim(r.body), ''))) as text,
  null::text                                       as post_url,
  coalesce(r.helpful_count, 0)::bigint             as engagement,
  'helpful_votes'::text                            as engagement_kind,
  case when r.complaint_category is null or lower(r.complaint_category) = 'none' then '{}'::text[]
       else array[lower(r.complaint_category)] end as complaint_keywords,
  r.posted_at                                      as occurred_at,
  case when r.posted_at is not null then 'posted' else 'none' end as date_source,
  r.scraped_at                                     as scraped_at
from public.paddle_reviews r;

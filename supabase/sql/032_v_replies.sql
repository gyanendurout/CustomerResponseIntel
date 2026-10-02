-- 032_v_replies.sql
-- Brand replies to comments (currently 4 rows; the capability flags insufficient_data).

create or replace view intel.v_replies as
select
  r.id                                    as reply_id,
  r.replying_brand_id                     as brand_id,
  r.source_table,
  r.source_row_id,
  r.replied_at,
  r.response_time_mins,
  coalesce(r.joola_responded, false)      as joola_responded,
  intel.mask_pii(r.original_text)         as original_text,
  intel.mask_pii(r.reply_text)            as reply_text
from public.brand_replies r;

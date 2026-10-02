-- 020_v_signals.sql
-- One unified, de-duplicated row per (raw mention/comment/review row × distinct brand).
--
-- Brand set for a raw row; for each brand the best method wins:
--   1. raw            the raw row's own brand_id                                    -> brand_source 'stored'
--   2. mention_facts  DISTINCT brand_ids mention_facts assigns to the row           -> brand_source 'inferred'
--                     (DISTINCT removes mention_facts' exact duplicates; multi-brand rows fan out, one signal per brand)
--   3. keyword        only when 1 and 2 give nothing: word-boundary match of brands.reddit_keywords
--                                                                                   -> brand_source 'inferred'
--   No brand at all -> one row with brand_id NULL, brand_source/brand_method 'none' (reported as "unbranded").
-- Engagement, type, text and dates always come from the RAW row (adapters); mention_facts only contributes brands.
-- No user-identifying column exists in any adapter, so none can reach this view.
--
-- Performance design: brand assignment (intel.v_signal_brands) is built from cheap id/brand columns only. v_signals
-- references the adapter union exactly once, so the planner inlines it and pushes date/channel/brand filters down
-- into each adapter. Keyword matching uses ONE combined regex per brand (stays inside the backend regex cache).
--
-- To add a new source: create intel.v_src_<table> (adapter contract), add it to the UNION ALL in v_signals, and add
-- its (id, brand_id) to raw_brands in v_signal_brands.

create or replace view intel.v_brand_keyword_regex as
select b.id as brand_id,
       '\m(' || string_agg(intel.regex_escape(lower(btrim(k))), '|' order by k) || ')\M' as pattern
from public.brands b, unnest(coalesce(b.reddit_keywords, '{}'::text[])) k
where btrim(k) <> ''
group by b.id;

create or replace view intel.v_signal_brands as
with raw_brands as (
  select 'ig_comments'::text as source_table, id as source_row_id, brand_id from public.ig_comments where not coalesce(is_brand_reply, false)
  union all select 'yt_comments', id, brand_id from public.yt_comments where not coalesce(is_brand_reply, false)
  union all select 'reddit_mentions', id, brand_id from public.reddit_mentions where not coalesce(is_removed, false)
  union all select 'reddit_comments', id, brand_id from public.reddit_comments
  union all select 'tiktok_comments', id, brand_id from public.tiktok_comments where not coalesce(is_brand_reply, false)
  union all select 'tiktok_videos', id, brand_id from public.tiktok_videos
  union all select 'x_posts', id, brand_id from public.x_posts
  union all select 'influencer_x_posts', id, brand_id from public.influencer_x_posts
  union all select 'paddle_reviews', id, brand_id from public.paddle_reviews
),
mf as (
  select distinct m.source_table, m.source_id as source_row_id, m.brand_id
  from public.mention_facts m
  where m.brand_id is not null
),
-- Keyword fallback: only Reddit comments carry missing brands (stored text, unmasked; output is a brand id only).
keyword as (
  select 'reddit_comments'::text as source_table, c.id as source_row_id, r.brand_id
  from public.reddit_comments c
  join intel.v_brand_keyword_regex r on c.comment_text ~* r.pattern
  where c.brand_id is null
    and not exists (select 1 from public.mention_facts m
                    where m.source_table = 'reddit_comments' and m.source_id = c.id and m.brand_id is not null)
),
candidates as (
  select source_table, source_row_id, brand_id, case when brand_id is null then 9 else 1 end as method_rank from raw_brands
  union all select source_table, source_row_id, brand_id, 2 from mf
  union all select source_table, source_row_id, brand_id, 3 from keyword
),
best as (
  select distinct on (source_table, source_row_id, brand_id) source_table, source_row_id, brand_id, method_rank
  from candidates
  order by source_table, source_row_id, brand_id, method_rank
)
select b.source_table, b.source_row_id, b.brand_id, b.method_rank
from (
  select best.*, count(brand_id) over (partition by source_table, source_row_id) as n_brands from best
) b
-- keep every real brand; keep the NULL placeholder only when the row has no brand at all.
-- (mention_facts rows for sources without an adapter never match an adapter row and are reported by v_data_health.)
where b.brand_id is not null or b.n_brands = 0;

create or replace view intel.v_signals as
select
  md5(s.source_table || ':' || s.source_row_id::text || ':' || coalesce(bs.brand_id::text, 'none'))::uuid as signal_id,
  s.source_table,
  s.source_row_id,
  bs.brand_id,
  case bs.method_rank when 1 then 'stored' when 2 then 'inferred' when 3 then 'inferred' else 'none' end as brand_source,
  case bs.method_rank when 1 then 'raw' when 2 then 'mention_facts' when 3 then 'keyword' else 'none' end as brand_method,
  s.channel,
  s.signal_type,
  s.sentiment_5,
  intel.sentiment_3(s.sentiment_5) as sentiment_3,
  s.is_crisis,
  s.text,
  intel.canonical_url(s.post_url) as post_url,
  s.engagement,
  s.engagement_kind,
  s.complaint_keywords,
  s.occurred_at,
  s.date_source,
  s.scraped_at
from (
            select * from intel.v_src_ig_comments
  union all select * from intel.v_src_yt_comments
  union all select * from intel.v_src_reddit_mentions
  union all select * from intel.v_src_reddit_comments
  union all select * from intel.v_src_tiktok_comments
  union all select * from intel.v_src_tiktok_videos
  union all select * from intel.v_src_x_posts
  union all select * from intel.v_src_influencer_x_posts
  union all select * from intel.v_src_paddle_reviews
) s
join intel.v_signal_brands bs
  on bs.source_table = s.source_table and bs.source_row_id = s.source_row_id;

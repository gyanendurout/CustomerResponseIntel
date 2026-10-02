-- 010_v_brands.sql
-- Brand dimension. Colours are not stored in the database; they come from src/core/brand-palette.ts.

create or replace view intel.v_brands as
select
  b.id                                    as brand_id,
  b.name,
  b.slug,
  coalesce(b.is_joola, false)             as is_joola,
  coalesce(b.is_active, true)             as is_active,
  coalesce(b.reddit_keywords, '{}'::text[]) as reddit_keywords
from public.brands b;

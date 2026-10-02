-- 040_v_brand_accounts.sql
-- The brands' OWN social accounts (company accounts, not people): one row per platform account.
-- Owner decision (2026-10-02): brand-owned handles and profile links may be returned. Customer, commenter and athlete
-- handles never are. Handles are stored with or without a leading '@'; it is stripped here.

create or replace view intel.v_brand_accounts as
select 'instagram'::text as platform, a.brand_id,
       ltrim(btrim(a.handle), '@')                                         as account_handle,
       'https://www.instagram.com/' || ltrim(btrim(a.handle), '@') || '/'  as account_url
from public.ig_accounts a
where a.brand_id is not null and nullif(ltrim(btrim(a.handle), '@'), '') is not null and coalesce(a.is_active, true)
union all
select 'youtube', c.brand_id, btrim(c.channel_name), btrim(c.channel_url)
from public.yt_channels c
where c.brand_id is not null and nullif(btrim(c.channel_url), '') is not null and coalesce(c.is_active, true)
union all
select 'x', a.brand_id, ltrim(btrim(a.handle), '@'),
       coalesce(nullif(btrim(a.profile_url), ''), 'https://x.com/' || ltrim(btrim(a.handle), '@'))
from public.x_accounts a
where a.brand_id is not null and nullif(ltrim(btrim(a.handle), '@'), '') is not null
union all
select 'tiktok', a.brand_id, ltrim(btrim(a.handle), '@'),
       coalesce(nullif(btrim(a.profile_url), ''), 'https://www.tiktok.com/@' || ltrim(btrim(a.handle), '@'))
from public.tiktok_accounts a
where a.brand_id is not null and nullif(ltrim(btrim(a.handle), '@'), '') is not null;

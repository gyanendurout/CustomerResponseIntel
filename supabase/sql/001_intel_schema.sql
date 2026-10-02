-- 001_intel_schema.sql
-- Creates the dedicated `intel` schema for every new read-only object, plus small pure helper functions.
-- Changes NO existing table. Nothing here is exposed through PostgREST: `intel` is not an exposed API schema,
-- and anon/authenticated get no privileges on it.

create schema if not exists intel;
comment on schema intel is 'Community Intel read-only analytics layer (views + pure helpers). Owned by migrations in supabase/sql/.';

revoke all on schema intel from public;
revoke all on schema intel from anon, authenticated;

-- Sentiment: keep the 5 stored levels; anything else (NULL, typos, legacy values) becomes 'unlabelled'.
create or replace function intel.sentiment_5(label text) returns text
language sql immutable parallel safe as $$
  select case lower(btrim(label))
    when 'very_negative' then 'very_negative'
    when 'negative'      then 'negative'
    when 'neutral'       then 'neutral'
    when 'positive'      then 'positive'
    when 'very_positive' then 'very_positive'
    else 'unlabelled'
  end
$$;

-- 3-level rollup: very_* folds into its parent.
create or replace function intel.sentiment_3(s5 text) returns text
language sql immutable parallel safe as $$
  select case s5
    when 'very_negative' then 'negative'
    when 'negative'      then 'negative'
    when 'neutral'       then 'neutral'
    when 'positive'      then 'positive'
    when 'very_positive' then 'positive'
    else 'unlabelled'
  end
$$;

-- Channel normalisation for tables that store a free channel string (topic_lifecycle, competitor_switch_events).
-- Mirrors CHANNEL_ALIASES in src/core/normalise.ts (a test keeps the two in sync).
create or replace function intel.normalise_channel(raw text) returns text
language sql immutable parallel safe as $$
  select case
    when raw is null or btrim(raw) = '' then null
    when lower(btrim(raw)) in ('instagram', 'ig', 'ig_comment')            then 'instagram'
    when lower(btrim(raw)) in ('youtube', 'yt', 'yt_comment')              then 'youtube'
    when lower(btrim(raw)) in ('reddit', 'reddit_comment')                 then 'reddit'
    when lower(btrim(raw)) in ('tiktok', 'tiktok_comment')                 then 'tiktok'
    when lower(btrim(raw)) in ('x', 'twitter', 'x_influencer')             then 'x'
    when lower(btrim(raw)) in ('product_review', 'review', 'paddle_review') then 'product_review'
    else 'other'
  end
$$;

-- PII masking for free text, in order:
--   1. links (http(s)://… and www.…) -> [link]   (profile URLs such as instagram.com/<user> carry usernames)
--   2. e-mail addresses             -> [email]
--   3. @handles of any length       -> @user    (requires a non-word char or start of text before '@')
-- Character classes are Unicode-aware ([[:alnum:]]), so non-ASCII handles and addresses are masked too.
create or replace function intel.mask_pii(t text) returns text
language sql immutable parallel safe as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(t, '(https?://|www\.)[^[:space:]]+', '[link]', 'gi'),
             '[[:alnum:]._%+-]+@[[:alnum:]-]+(\.[[:alnum:]-]+)*\.[[:alpha:]]{2,}', '[email]', 'g'),
           '(^|[^[:alnum:]_])@[[:alnum:]_]+(\.[[:alnum:]_]+)*', '\1@user', 'g')
$$;

-- Content links without account handles. X and TikTok URLs embed the poster's username
-- (x.com/<handle>/status/<id>, tiktok.com/@<user>/video/<id>); rewrite them to handle-free links that still open
-- the same content. Other URLs are returned unchanged.
create or replace function intel.canonical_url(u text) returns text
language sql immutable parallel safe as $$
  select case
    when u ~* '^https?://([a-z]+\.)?(x|twitter)\.com/[^/?#]+/status(es)?/[0-9]+'
      then 'https://x.com/i/status/' || substring(u from '/status(?:es)?/([0-9]+)')
    when u ~* '^https?://([a-z]+\.)?tiktok\.com/@[^/?#]*/video/[0-9]+'
      then 'https://www.tiktok.com/embed/v2/' || substring(u from '/video/([0-9]+)')
    else u
  end
$$;

-- Escapes regex metacharacters so a brand keyword can be used inside a word-boundary pattern.
create or replace function intel.regex_escape(t text) returns text
language sql immutable parallel safe as $$
  select regexp_replace(t, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g')
$$;

revoke all on all functions in schema intel from public;

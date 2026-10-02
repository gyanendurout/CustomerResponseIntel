-- 034_mask_reddit_users.sql
-- Extends intel.mask_pii with Reddit user mentions ("u/name", "/u/name") -> "u/user". Read-only change: replaces one
-- function in the intel schema; no table is touched. Same signature, so existing grants and views keep working and
-- pick up the new rule immediately (decision D32).
--
-- Order of masking:
--   1. links (http(s)://… and www.…) -> [link]   (so reddit.com/u/<name> URLs become [link] first)
--   2. e-mail addresses             -> [email]
--   3. @handles of any length       -> @user
--   4. Reddit mentions u/<3–20 chars> or /u/<…> -> u/user   (not r/subreddits, not words like menu/items)

create or replace function intel.mask_pii(t text) returns text
language sql immutable parallel safe as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(t, '(https?://|www\.)[^[:space:]]+', '[link]', 'gi'),
               '[[:alnum:]._%+-]+@[[:alnum:]-]+(\.[[:alnum:]-]+)*\.[[:alpha:]]{2,}', '[email]', 'g'),
             '(^|[^[:alnum:]_])@[[:alnum:]_]+(\.[[:alnum:]_]+)*', '\1@user', 'g'),
           '(^|[^[:alnum:]_/])/?[uU]/[[:alnum:]_-]{3,20}(?![[:alnum:]_-])', '\1u/user', 'g')
$$;

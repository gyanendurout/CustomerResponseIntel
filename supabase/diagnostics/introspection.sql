-- 000_phase0_introspection.sql
-- READ-ONLY. SELECT statements only; changes nothing. Run in the Supabase SQL editor and paste the results back.
-- Fills the gaps PostgREST cannot show: unique/check constraints, indexes, RLS, views, roles, server version.

-- A. Constraints on the in-scope tables
select tc.table_name, tc.constraint_type, tc.constraint_name,
       string_agg(kcu.column_name, ', ' order by kcu.ordinal_position) as columns,
       pg_get_constraintdef(pgc.oid) as definition
from information_schema.table_constraints tc
join pg_constraint pgc on pgc.conname = tc.constraint_name
left join information_schema.key_column_usage kcu
  on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
where tc.table_schema = 'public'
  and tc.table_name in ('brands','mention_facts','ig_comments','yt_comments','reddit_mentions','reddit_comments',
                        'tiktok_comments','competitor_switch_events','topic_lifecycle','brand_replies',
                        'paddle_reviews','tiktok_videos','x_posts','influencer_x_posts','yt_videos','ig_posts')
group by tc.table_name, tc.constraint_type, tc.constraint_name, pgc.oid
order by tc.table_name, tc.constraint_type;

-- B. Indexes on the same tables
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('brands','mention_facts','ig_comments','yt_comments','reddit_mentions','reddit_comments',
                    'tiktok_comments','competitor_switch_events','topic_lifecycle','brand_replies',
                    'paddle_reviews','tiktok_videos','x_posts','influencer_x_posts','yt_videos','ig_posts')
order by tablename, indexname;

-- C. RLS status and table sizes
select c.relname as table_name, c.relrowsecurity as rls_enabled, pg_size_pretty(pg_total_relation_size(c.oid)) as size
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('mention_facts','ig_comments','yt_comments','reddit_mentions','reddit_comments','tiktok_comments',
                    'competitor_switch_events','topic_lifecycle','brand_replies','paddle_reviews','brands')
order by pg_total_relation_size(c.oid) desc;

-- D. Existing views / functions that may overlap (e.g. from the old dashboard)
select table_name as view_name from information_schema.views where table_schema = 'public' order by 1;
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' order by 1;

-- E. Existing roles (to avoid name clashes) and server version
select rolname, rolcanlogin, rolbypassrls from pg_roles where rolname not like 'pg\_%' order by 1;
select version();

-- F. Is pg_trgm available (for the search_posts text index)?
select name, installed_version, default_version from pg_available_extensions where name in ('pg_trgm','unaccent');

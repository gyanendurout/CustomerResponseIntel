-- 091_grant_platform_views.sql
-- Lets the read-only login read the platform views added in 040–046. Run after 090 (the role must exist).
-- Nothing else changes: intel_reader still cannot read any public table, and anon/authenticated get nothing.

grant select on
  intel.v_brand_accounts,
  intel.v_audience_weekly,
  intel.v_content,
  intel.v_video_analysis,
  intel.v_reddit_posts,
  intel.v_product_mentions,
  intel.v_athlete_mentions
to intel_reader;

revoke all on all tables in schema intel from public, anon, authenticated;

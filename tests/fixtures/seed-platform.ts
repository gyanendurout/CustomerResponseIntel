// Synthetic data for the platform views (accounts, weekly audience, brand content, video analysis, Reddit posts,
// product and athlete mentions). Loaded on top of seed(); only the platform tests use it, so the counts the original
// tests rely on are unchanged. Every edge case has a named row.
import type { PGlite } from '@electric-sql/pglite';
import { B, ID } from './seed';

export const P = {
  perseus: '80000000-0000-4000-8000-000000000001', // JOOLA paddle
  vanguard: '80000000-0000-4000-8000-000000000002', // Selkirk paddle
  athlete: '81000000-0000-4000-8000-000000000001', // JOOLA-sponsored pro
  igJ1: '90000000-0000-4000-8000-000000000001', // JOOLA reel
  igJ2: '90000000-0000-4000-8000-000000000002', // JOOLA carousel
  igJ2dup: '90000000-0000-4000-8000-000000000003', // same instagram_post_id as igJ2, older -> dropped
  igJ3: '90000000-0000-4000-8000-000000000004', // JOOLA image, caption with @handle + e-mail
  ytShort: '91000000-0000-4000-8000-000000000001', // JOOLA short (analysed)
  ytLong: '91000000-0000-4000-8000-000000000002', // Selkirk long-form
  x2: '92000000-0000-4000-8000-000000000001', // JOOLA post with retweets/replies/views
  ttCrbn: '93000000-0000-4000-8000-000000000001', // CRBN video with shares
  rm3: '94000000-0000-4000-8000-000000000001', // Selkirk post, viral
  rm4: '94000000-0000-4000-8000-000000000002', // removed post -> excluded
} as const;

export async function seedPlatform(pg: PGlite): Promise<void> {
  await pg.exec(`
    insert into public.ig_accounts (brand_id, handle, is_primary, is_active) values
      ('${B.joola}', 'joolapickleball', true, true), ('${B.selkirk}', '@selkirksport', true, true);
    insert into public.yt_channels (brand_id, channel_name, channel_url, is_active) values
      ('${B.joola}', 'JOOLA Pickleball', 'https://www.youtube.com/@joolapickleball', true);
    insert into public.x_accounts (brand_id, handle, profile_url) values
      ('${B.joola}', 'joolapickleball', 'https://x.com/joolapickleball');
    insert into public.tiktok_accounts (brand_id, handle, profile_url) values
      ('${B.joola}', 'joolapickleball', null), ('${B.crbn}', 'crbnpickleball', 'https://www.tiktok.com/@crbnpickleball');

    -- Instagram weekly: JOOLA W35-W39 with a scrape failure (0) in W38; Selkirk has a gap (no W37/W38).
    -- 2026-W35 starts Mon 2026-08-24; W39 starts Mon 2026-09-21.
    insert into public.ig_profiles_weekly (brand_id, handle, followers, following, post_count, bio_text, bio_link,
                                           week_number, year, scraped_at, dominant_content_theme) values
      ('${B.joola}', 'joolapickleball', 1000, 50, 100, 'Contact @secret_bio_person', 'https://linktr.ee/x', 35, 2026, '2026-08-25T07:00:00Z', 'pickleball'),
      ('${B.joola}', 'joolapickleball', 1010, 50, 102, null, null, 36, 2026, '2026-09-01T07:00:00Z', 'pickleball'),
      ('${B.joola}', 'joolapickleball', 1030, 51, 104, null, null, 37, 2026, '2026-09-08T07:00:00Z', 'Pickleball '),
      ('${B.joola}', 'joolapickleball', 0, 0, 0, null, null, 38, 2026, '2026-09-15T07:00:00Z', null),
      ('${B.joola}', 'joolapickleball', 1060, 52, 107, null, null, 39, 2026, '2026-09-22T07:00:00Z', 'paddle-review'),
      ('${B.selkirk}', 'selkirksport', 2000, 10, 300, null, null, 35, 2026, '2026-08-25T07:00:00Z', 'pickleball'),
      ('${B.selkirk}', 'selkirksport', 1990, 10, 301, null, null, 36, 2026, '2026-09-01T07:00:00Z', 'pickleball'),
      ('${B.selkirk}', 'selkirksport', 2100, 10, 305, null, null, 39, 2026, '2026-09-22T07:00:00Z', 'paddle-review');
    insert into public.yt_channel_weekly (brand_id, subscribers, total_views, total_videos, week_number, year, scraped_at) values
      ('${B.joola}', 500, 10000, 50, 38, 2026, '2026-09-15T07:00:00Z'),
      ('${B.joola}', 520, 12000, 52, 39, 2026, '2026-09-22T07:00:00Z');
    insert into public.x_profiles_weekly (brand_id, handle, followers, following, tweet_count, week_number, year, scraped_at) values
      ('${B.joola}', 'joolapickleball', 290, 20, 890, 38, 2026, '2026-09-15T07:00:00Z'),
      ('${B.joola}', 'joolapickleball', 300, 20, 900, 39, 2026, '2026-09-22T07:00:00Z');
    -- TikTok: two scrapes in the same ISO week for JOOLA; the later one (5000) wins.
    insert into public.tiktok_profiles_weekly (brand_id, handle, followers, following, video_count, total_hearts, week_number, year, scraped_at) values
      ('${B.joola}', 'joolapickleball', 4800, 5, 98, 88000, 39, 2026, '2026-09-21T07:00:00Z'),
      ('${B.joola}', 'joolapickleball', 5000, 5, 100, 90000, 39, 2026, '2026-09-27T07:00:00Z'),
      ('${B.crbn}', 'crbnpickleball', 1500, 3, 40, 20000, 39, 2026, '2026-09-27T07:00:00Z');

    -- Brand content.
    insert into public.ig_posts (id, instagram_post_id, brand_id, handle, post_url, posted_at, post_format, caption,
                                 like_count, comment_count, view_count, is_sponsored, last_updated_at) values
      ('${P.igJ1}', 'J1', '${B.joola}', 'joolapickleball', 'https://www.instagram.com/p/J1/', '2026-09-20T15:00:00Z', 'Video', 'New reel', 100, 10, 1000, false, '2026-09-27T00:00:00Z'),
      ('${P.igJ2}', 'J2', '${B.joola}', 'joolapickleball', 'https://www.instagram.com/p/J2/', '2026-09-21T15:00:00Z', 'Sidecar', 'Carousel', 50, 5, 0, false, '2026-09-27T00:00:00Z'),
      ('${P.igJ2dup}', 'J2', '${B.joola}', 'joolapickleball', 'https://www.instagram.com/p/J2/', '2026-09-21T15:00:00Z', 'Sidecar', 'Carousel OLD', 40, 4, 0, false, '2026-09-22T00:00:00Z'),
      ('${P.igJ3}', 'J3', '${B.joola}', 'joolapickleball', null, '2026-09-23T15:00:00Z', 'Image', 'Thanks @fan_person, mail fan@example.com', 20, 2, 0, true, '2026-09-27T00:00:00Z');
    insert into public.yt_videos (id, youtube_video_id, brand_id, title, video_url, published_at, duration_seconds,
                                  view_count, like_count, comment_count, is_short) values
      ('${P.ytShort}', 'S1', '${B.joola}', 'Quick tip with @coach_person', null, '2026-09-15T00:00:00Z', 40, 5000, 50, 5, true),
      ('${P.ytLong}', 'L1', '${B.selkirk}', 'Full review', 'https://www.youtube.com/watch?v=L1', '2026-09-10T00:00:00Z', 900, 20000, 300, 40, false);
    insert into public.x_posts (id, brand_id, handle, tweet_id, post_url, text, like_count, retweet_count, reply_count, view_count, posted_at) values
      ('${P.x2}', '${B.joola}', 'joolapickleball', '2002', 'https://x.com/joolapickleball/status/2002', 'Launch day', 30, 5, 8, 2000, '2026-09-14T00:00:00Z');
    insert into public.tiktok_videos (id, brand_id, handle, tiktok_video_id, video_url, text, view_count, like_count, comment_count, share_count, duration_seconds, posted_at) values
      ('${P.ttCrbn}', '${B.crbn}', 'crbnpickleball', '9009', 'https://www.tiktok.com/@crbnpickleball/video/9009', 'Drop', 10000, 800, 50, 20, 30, '2026-09-18T00:00:00Z');

    -- YouTube analysis: the short is analysed; players_mentioned holds a name that must never be output.
    insert into public.products_catalog (id, brand_id, sku, display_name, aliases, category) values
      ('${P.perseus}', '${B.joola}', 'J-PER', 'Perseus', array['perseus'], 'paddle'),
      ('${P.vanguard}', '${B.selkirk}', 'S-VAN', 'Vanguard', array['vanguard'], 'paddle');
    insert into public.yt_video_analysis (video_id, youtube_video_id, brand_id, summary, performance_thesis, performance_signals,
                                          content_type, is_paid_promo, sentiment_label, products_matched_ids, players_mentioned,
                                          view_count_at_analysis, enriched_at) values
      ('${P.ytShort}', 'S1', '${B.joola}', 'Short featuring @someone_else', 'Fast hook in first 2s', array['hook', 'ask @fan_person'],
       'Highlight', false, 'positive', array['${P.perseus}']::uuid[], array['Secret Player'], 4000, '2026-09-20T00:00:00Z');

    -- Athletes: name allowed (sponsored pro); personal handles never output.
    insert into public.influencers (id, brand_id, name, type, instagram_handle, x_handle, contract_type, is_active) values
      ('${P.athlete}', '${B.joola}', 'Pro Athlete One', 'Pro Athlete', 'pro_one_ig', 'pro_one_x', 'Sponsored', true);

    -- Product / athlete mentions (mention_facts). igC1 has a duplicate Perseus row; ytC1 is undated.
    insert into public.mention_facts (channel, source_table, source_id, brand_id, product_id, athlete_id, sentiment_label, posted_at) values
      ('ig_comment', 'ig_comments', '${ID.igC1}', '${B.joola}', '${P.perseus}', '${P.athlete}', 'very_negative', '2026-09-10T12:00:00Z'),
      ('ig_comment', 'ig_comments', '${ID.igC1}', '${B.joola}', '${P.perseus}', null, 'very_negative', '2026-09-10T12:00:00Z'),
      ('tiktok_comment', 'tiktok_comments', '${ID.ttC1}', '${B.joola}', '${P.perseus}', '${P.athlete}', 'very_positive', '2026-09-06T00:00:00Z'),
      ('product_review', 'paddle_reviews', '${ID.pr2}', '${B.selkirk}', '${P.vanguard}', null, 'positive', '2026-09-13T00:00:00Z'),
      ('yt_comment', 'yt_comments', '${ID.ytC1}', '${B.joola}', '${P.perseus}', null, 'neutral', null);

    -- Reddit posts: subreddits in mixed forms, velocity, a removed post.
    update public.reddit_mentions set subreddit = 'Pickleball', velocity_per_hour = 3.0 where id = '${ID.rm1}';
    update public.reddit_mentions set subreddit = 'r/pickleball' where id = '${ID.rm2}';
    insert into public.reddit_mentions (id, brand_id, subreddit, post_title, content_text, content_type, upvotes, velocity_per_hour,
                                        posted_at, sentiment_label, post_url, author, is_removed) values
      ('${P.rm3}', '${B.selkirk}', 'PickleballPaddles', 'Selkirk drop thread', 'thoughts?', 'Post', 100, 12.5,
       '2026-09-24T00:00:00Z', 'positive', 'https://reddit.com/r/PickleballPaddles/3', 'redditor3', false),
      ('${P.rm4}', '${B.selkirk}', 'pickleball', 'Removed post', '[removed]', 'Post', 999, 50,
       '2026-09-24T00:00:00Z', null, 'https://reddit.com/r/pickleball/4', 'redditor4', true);
  `);
}

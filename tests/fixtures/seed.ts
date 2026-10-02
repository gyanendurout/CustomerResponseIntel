// Synthetic fixture data. Every edge case the views must handle has a named row here.
import type { PGlite } from '@electric-sql/pglite';

export const B = {
  joola: '00000000-0000-4000-8000-000000000001',
  selkirk: '00000000-0000-4000-8000-000000000002',
  crbn: '00000000-0000-4000-8000-000000000003',
} as const;

export const ID = {
  igPost: '10000000-0000-4000-8000-000000000001',
  igC1: '11000000-0000-4000-8000-000000000001', // joola, posted, @handle, mf dup x3 + selkirk fan-out
  igC2: '11000000-0000-4000-8000-000000000002', // selkirk, no posted_at -> parent post date
  igReply: '11000000-0000-4000-8000-000000000003', // brand reply -> excluded
  ytVideo: '20000000-0000-4000-8000-000000000001',
  ytC1: '21000000-0000-4000-8000-000000000001', // no posted_at, video published -> parent_published
  ytC2: '21000000-0000-4000-8000-000000000002', // no posted_at, no video -> none (crisis, undated)
  rm1: '30000000-0000-4000-8000-000000000001', // joola Post
  rm2: '30000000-0000-4000-8000-000000000002', // crbn, content_type Comment
  rc1: '31000000-0000-4000-8000-000000000001', // no brand, mf says joola
  rc2: '31000000-0000-4000-8000-000000000002', // no brand, no mf, text "SLK" -> keyword selkirk
  rc3: '31000000-0000-4000-8000-000000000003', // no brand, "slkx" / "ahead" -> no match -> unbranded
  rc4: '31000000-0000-4000-8000-000000000004', // crbn with parent rm2
  ttVideo: '40000000-0000-4000-8000-000000000001',
  ttC1: '41000000-0000-4000-8000-000000000001',
  xPost: '50000000-0000-4000-8000-000000000001',
  ixPost: '51000000-0000-4000-8000-000000000001',
  pr1: '60000000-0000-4000-8000-000000000001', // joola review, delamination, crisis
  pr2: '60000000-0000-4000-8000-000000000002', // selkirk review, complaint 'none'
  sw1: '70000000-0000-4000-8000-000000000001',
  sw2: '70000000-0000-4000-8000-000000000002',
} as const;

export async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`
    insert into public.brands (id, name, slug, is_joola, reddit_keywords) values
      ('${B.joola}', 'JOOLA', 'joola', true, array['joola','joola paddle']),
      ('${B.selkirk}', 'Selkirk Sport', 'selkirk', false, array['selkirk','slk']),
      ('${B.crbn}', 'CRBN Pickleball', 'crbn', false, array['crbn','crbn paddle']);

    insert into public.ig_posts (id, brand_id, post_url, posted_at, handle) values
      ('${ID.igPost}', '${B.selkirk}', 'https://instagram.com/p/AAA', '2026-09-01T10:00:00Z', 'secret_handle');

    insert into public.ig_comments (id, post_id, brand_id, commenter_username, comment_text, comment_likes, is_brand_reply,
                                    posted_at, scraped_at, sentiment_label, is_crisis, crisis_keywords, post_url) values
      ('${ID.igC1}', '${ID.igPost}', '${B.joola}', 'bob_the_user', '@bob_smith this paddle broke, email me at bob@example.com', 5, false,
       '2026-09-10T12:00:00Z', '2026-09-28T07:00:00Z', 'very_negative', true, array['broke'], 'https://instagram.com/p/AAA'),
      ('${ID.igC2}', '${ID.igPost}', '${B.selkirk}', 'alice', 'Love it', 2, false,
       null, '2026-09-28T07:00:00Z', 'Positive', false, null, null),
      ('${ID.igReply}', '${ID.igPost}', '${B.selkirk}', 'selkirk_official', 'Thanks!', 0, true,
       '2026-09-02T10:00:00Z', '2026-09-28T07:00:00Z', 'positive', false, null, null);

    insert into public.yt_videos (id, brand_id, video_url, published_at) values
      ('${ID.ytVideo}', '${B.joola}', 'https://youtube.com/watch?v=V1', '2026-08-15T00:00:00Z');
    insert into public.yt_comments (id, video_id, brand_id, commenter_username, comment_text, comment_likes, posted_at, scraped_at, sentiment_label, is_crisis) values
      ('${ID.ytC1}', '${ID.ytVideo}', '${B.joola}', 'yt_user', 'meh', 1, null, '2026-09-28T07:50:00Z', 'neutral', false),
      ('${ID.ytC2}', null, '${B.joola}', 'yt_user2', 'worst paddle ever', 0, null, '2026-09-28T07:50:00Z', null, true);

    insert into public.reddit_mentions (id, brand_id, post_title, content_text, content_type, upvotes, posted_at, scraped_at,
                                        sentiment, sentiment_label, is_crisis, post_url, author) values
      ('${ID.rm1}', '${B.joola}', 'JOOLA Perseus review', 'Pretty good', 'Post', 40, '2026-09-20T00:00:00Z', '2026-09-28T07:51:00Z',
       'positive', 'positive', false, 'https://reddit.com/r/pickleball/1', 'redditor1'),
      ('${ID.rm2}', '${B.crbn}', null, 'CRBN is fine', 'Comment', 3, '2026-09-21T00:00:00Z', '2026-09-28T07:51:00Z',
       null, 'neutral', false, 'https://reddit.com/r/pickleball/2', 'redditor2');

    insert into public.reddit_comments (id, parent_post_id, reddit_comment_id, brand_id, author, comment_text, upvotes, posted_at, created_at, sentiment_label) values
      ('${ID.rc1}', null, 't1_a', null, 'u1', 'this one is mine', 7, '2026-09-22T00:00:00Z', '2026-09-28T07:57:00Z', 'negative'),
      ('${ID.rc2}', null, 't1_b', null, 'u2', 'Switched to an SLK paddle', 1, '2026-09-23T00:00:00Z', '2026-09-28T07:57:00Z', 'very_positive'),
      ('${ID.rc3}', null, 't1_c', null, 'u3', 'ahead of slkx things', 0, '2026-09-24T00:00:00Z', '2026-09-28T07:57:00Z', null),
      ('${ID.rc4}', '${ID.rm2}', 't1_d', '${B.crbn}', 'u4', 'agree', 2, '2026-09-25T00:00:00Z', '2026-09-28T07:57:00Z', 'neutral');

    insert into public.tiktok_videos (id, brand_id, handle, video_url, text, like_count, posted_at, created_at, sentiment_label) values
      ('${ID.ttVideo}', '${B.joola}', 'tt_handle', 'https://www.tiktok.com/@tt_handle/video/7301', 'new paddle drop', 100, '2026-09-05T00:00:00Z', '2026-09-28T07:34:00Z', 'positive');
    insert into public.tiktok_comments (id, video_id, brand_id, commenter_username, comment_text, comment_likes, posted_at, scraped_at, sentiment_label) values
      ('${ID.ttC1}', '${ID.ttVideo}', '${B.joola}', 'tt_user', 'fire', 9, '2026-09-06T00:00:00Z', '2026-09-28T07:34:00Z', 'very_positive');

    insert into public.x_posts (id, brand_id, handle, post_url, text, like_count, posted_at, created_at, sentiment_label) values
      ('${ID.xPost}', '${B.joola}', 'joola', 'https://x.com/joola/status/1001', 'Big news', 12, '2026-09-07T00:00:00Z', '2026-09-28T07:00:00Z', 'neutral');
    insert into public.influencer_x_posts (id, brand_id, handle, post_url, text, like_count, posted_at, created_at, sentiment_label) values
      ('${ID.ixPost}', '${B.selkirk}', 'pro_player', 'https://x.com/pro_player/status/1002', 'Selkirk all day', 30, '2026-09-08T00:00:00Z', '2026-09-28T07:00:00Z', 'positive');

    insert into public.paddle_reviews (id, brand_id, source, external_review_id, reviewer_name, title, body, rating, posted_at,
                                       helpful_count, sentiment_label, is_crisis, complaint_category, scraped_at) values
      ('${ID.pr1}', '${B.joola}', 'okendo', 'r1', 'Jane Doe', 'Delaminated', 'after 2 weeks', 1, '2026-09-12T00:00:00Z', 4, 'very_negative', true, 'delamination', '2026-09-28T07:00:00Z'),
      ('${ID.pr2}', '${B.selkirk}', 'yotpo', 'r2', 'John Roe', 'Great', 'love it', 5, '2026-09-13T00:00:00Z', 0, 'positive', false, 'none', '2026-09-28T07:00:00Z');

    -- mention_facts: igC1 duplicated 3x for joola (builder bug) + 1 row for selkirk (multi-brand fan-out);
    -- rc1 has no raw brand but mention_facts assigns joola.
    insert into public.mention_facts (channel, source_table, source_id, brand_id, sentiment_label, is_crisis, text_snippet, posted_at, engagement) values
      ('ig_comment', 'ig_comments', '${ID.igC1}', '${B.joola}', 'very_negative', true, 'x', '2026-09-10T12:00:00Z', 5),
      ('ig_comment', 'ig_comments', '${ID.igC1}', '${B.joola}', 'very_negative', true, 'x', '2026-09-10T12:00:00Z', 5),
      ('ig_comment', 'ig_comments', '${ID.igC1}', '${B.joola}', 'very_negative', true, 'x', '2026-09-10T12:00:00Z', 5),
      ('ig_comment', 'ig_comments', '${ID.igC1}', '${B.selkirk}', 'very_negative', true, 'x', '2026-09-10T12:00:00Z', 5),
      ('reddit_comment', 'reddit_comments', '${ID.rc1}', '${B.joola}', 'negative', false, 'x', '2026-09-22T00:00:00Z', 7);

    insert into public.competitor_switch_events (id, from_brand_id, to_brand_id, posted_at, detected_at, channel, source_mention_id, text_snippet, created_at) values
      ('${ID.sw1}', '${B.selkirk}', '${B.joola}', '2026-09-15T00:00:00Z', '2026-09-15T00:00:00Z', 'reddit', null, 'moved to joola @someone', '2026-09-28T08:00:00Z'),
      ('${ID.sw2}', '${B.joola}', null, null, '2026-09-16T00:00:00Z', null, '${ID.rm1}', 'leaving joola', '2026-09-28T08:00:00Z');

    insert into public.topic_lifecycle (brand_id, topic, channel, mention_count, first_seen_at, week_number, year) values
      ('${B.joola}', 'Power', 'instagram', 10, '2026-06-22T00:00:00Z', 26, 2026),
      ('${B.joola}', 'power ', 'instagram', 15, '2026-06-29T00:00:00Z', 27, 2026),
      ('${B.joola}', 'Power', 'instagram', 5, '2026-07-13T00:00:00Z', 29, 2026),
      ('${B.selkirk}', 'Power', 'twitter', 8, null, 27, 2026);

    insert into public.brand_replies (replying_brand_id, source_table, source_row_id, original_text, reply_text, replied_at, response_time_mins, joola_responded) values
      ('${B.joola}', 'ig_comments', '${ID.igC1}', '@bob_smith this paddle broke', 'Sorry @bob_smith, DM us', '2026-09-10T12:00:00Z', 0, true);
  `);
}

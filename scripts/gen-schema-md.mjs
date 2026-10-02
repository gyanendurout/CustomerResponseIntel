// Generates the column tables for docs/SCHEMA.md from the live PostgREST OpenAPI document.
import { readFileSync, writeFileSync } from 'node:fs';

const defs = JSON.parse(readFileSync(new URL('./out/openapi.json', import.meta.url))).definitions;
const TABLES = [
  'brands', 'mention_facts', 'ig_comments', 'yt_comments', 'reddit_mentions', 'reddit_comments', 'tiktok_comments',
  'competitor_switch_events', 'topic_lifecycle', 'brand_replies',
  'paddle_reviews', 'tiktok_videos', 'x_posts', 'influencer_x_posts', 'yt_videos', 'ig_posts',
];
// Columns that identify a person (or let you look one up). Never selected into any view or output.
const PII = new Set([
  'commenter_username', 'author', 'handle', 'reviewer_name', 'reviewer_location', 'account_id', 'influencer_id', 'athlete_id',
  'instagram_comment_id', 'youtube_comment_id', 'tiktok_comment_id', 'reddit_comment_id', 'reply_to_comment_id',
  'media_urls', 'tagged_accounts', 'thumbnail_url', 'image_url', 'all_media_urls',
]);

let md = '';
for (const t of TABLES) {
  const d = defs[t];
  const req = new Set(d.required || []);
  md += `\n### \`${t}\`\n\n| Column | Type | Null | Key | Notes |\n|---|---|---|---|---|\n`;
  for (const [c, p] of Object.entries(d.properties)) {
    const desc = p.description || '';
    const fk = desc.match(/Foreign Key to `([^`]+)`/);
    const key = desc.includes('<pk/>') ? 'PK' : fk ? `FK → ${fk[1]}` : '';
    md += `| \`${c}\` | ${p.format} | ${req.has(c) ? 'NO' : 'yes'} | ${key} | ${PII.has(c) ? '**PII – never exposed**' : ''} |\n`;
  }
}
writeFileSync(new URL('./out/schema-tables.md', import.meta.url), md);
console.log('written', md.split('\n').length, 'lines');

import { describe, expect, it } from 'vitest';
import {
  CHANNELS, CHANNEL_ALIASES, normaliseChannel, toSentiment5, rollupSentiment3, SENTIMENT_5, resolveGranularity,
  resolveBrands, UnknownBrandError, defaultRange, levenshtein, sentimentFilterValues, maskUserMentions, type BrandRecord,
} from '@/core/normalise';

describe('maskUserMentions', () => {
  it('masks Reddit user mentions in every common form', () => {
    expect(maskUserMentions('/u/Example_Person1 on Authenticity Check')).toBe('u/user on Authenticity Check');
    expect(maskUserMentions('thanks u/some_user-2!')).toBe('thanks u/user!');
    expect(maskUserMentions('(U/Someone) said')).toBe('(u/user) said');
    expect(maskUserMentions('ping /u/abc and u/def_ghi')).toBe('ping u/user and u/user');
  });
  it('leaves ordinary text, paths and short tokens alone', () => {
    expect(maskUserMentions('see menu/items and you/me')).toBe('see menu/items and you/me');
    expect(maskUserMentions('r/Pickleball is great')).toBe('r/Pickleball is great');
    expect(maskUserMentions('u/ab is too short')).toBe('u/ab is too short');
    expect(maskUserMentions(null)).toBeNull();
  });
});

const BRANDS: BrandRecord[] = [
  { brand_id: 'b-joola', name: 'JOOLA', slug: 'joola', is_joola: true, is_active: true },
  { brand_id: 'b-selkirk', name: 'Selkirk Sport', slug: 'selkirk', is_joola: false, is_active: true },
  { brand_id: 'b-six', name: 'Six Zero', slug: 'six-zero', is_joola: false, is_active: true },
  { brand_id: 'b-head', name: 'Head Pickleball', slug: 'head', is_joola: false, is_active: true },
  { brand_id: 'b-franklin', name: 'Franklin Pickleball', slug: 'franklin', is_joola: false, is_active: true },
  { brand_id: 'b-gamma', name: 'Gamma Sports', slug: 'gamma', is_joola: false, is_active: true },
];

describe('channels', () => {
  it('maps every stored channel code to the 7 normalised channels', () => {
    expect(normaliseChannel('ig_comment')).toBe('instagram');
    expect(normaliseChannel('yt_comment')).toBe('youtube');
    expect(normaliseChannel('reddit_comment')).toBe('reddit');
    expect(normaliseChannel('tiktok_comment')).toBe('tiktok');
    expect(normaliseChannel('twitter')).toBe('x');
    expect(normaliseChannel('x_influencer')).toBe('x');
    expect(normaliseChannel(' Instagram ')).toBe('instagram');
  });
  it('keeps product_review as its own channel, never reddit', () => {
    expect(normaliseChannel('product_review')).toBe('product_review');
    expect(normaliseChannel('paddle_review')).toBe('product_review');
  });
  it('returns other for unknown and null for empty', () => {
    expect(normaliseChannel('myspace')).toBe('other');
    expect(normaliseChannel('')).toBeNull();
    expect(normaliseChannel(null)).toBeNull();
    expect(normaliseChannel(undefined)).toBeNull();
  });
  it('alias targets are all valid channels', () => {
    for (const target of Object.values(CHANNEL_ALIASES)) expect(CHANNELS).toContain(target);
  });
});

describe('sentiment', () => {
  it('keeps all 5 levels', () => {
    for (const s of SENTIMENT_5.filter(s => s !== 'unlabelled')) expect(toSentiment5(s)).toBe(s);
    expect(toSentiment5('VERY_POSITIVE')).toBe('very_positive');
  });
  it('labels null / unknown as unlabelled (never dropped)', () => {
    expect(toSentiment5(null)).toBe('unlabelled');
    expect(toSentiment5(undefined)).toBe('unlabelled');
    expect(toSentiment5('mixed')).toBe('unlabelled');
  });
  it('rolls very_* into the parent', () => {
    expect(rollupSentiment3('very_negative')).toBe('negative');
    expect(rollupSentiment3('negative')).toBe('negative');
    expect(rollupSentiment3('neutral')).toBe('neutral');
    expect(rollupSentiment3('positive')).toBe('positive');
    expect(rollupSentiment3('very_positive')).toBe('positive');
    expect(rollupSentiment3('unlabelled')).toBe('unlabelled');
  });
  it('expands filter values: 5-level kept, 3-level groups expand to their members', () => {
    expect(sentimentFilterValues(['very_negative'])).toEqual(['very_negative']);
    expect(sentimentFilterValues(['negative_all'])).toEqual(['very_negative', 'negative']);
    expect(sentimentFilterValues(['positive_all', 'neutral'])).toEqual(['positive', 'very_positive', 'neutral']);
    expect(sentimentFilterValues(undefined)).toBeNull();
    expect(sentimentFilterValues([])).toBeNull();
  });
});

describe('granularity', () => {
  const d = (s: string) => new Date(s + 'T00:00:00Z');
  it('defaults to month above 60 days, day otherwise', () => {
    expect(resolveGranularity(d('2026-01-01'), d('2026-03-15'))).toBe('month');
    expect(resolveGranularity(d('2026-09-01'), d('2026-09-28'))).toBe('day');
    expect(resolveGranularity(d('2026-08-01'), d('2026-09-29'))).toBe('day'); // exactly 59 days
  });
  it('respects an explicit choice', () => {
    expect(resolveGranularity(d('2026-01-01'), d('2026-09-28'), 'week')).toBe('week');
  });
});

describe('defaultRange', () => {
  it('ends at the newest data date and spans 90 days inclusive', () => {
    const r = defaultRange(new Date('2026-09-28T05:47:46Z'));
    expect(r.from.toISOString().slice(0, 10)).toBe('2026-07-01');
    expect(r.to.toISOString().slice(0, 10)).toBe('2026-09-28');
  });
  it('falls back to today when there is no data', () => {
    const r = defaultRange(null, new Date('2026-10-02T12:00:00Z'));
    expect(r.to.toISOString().slice(0, 10)).toBe('2026-10-02');
  });
});

describe('brand resolution', () => {
  it('resolves by name, slug or id, case-insensitively', () => {
    expect(resolveBrands(['joola'], BRANDS)).toEqual(['b-joola']);
    expect(resolveBrands(['JOOLA'], BRANDS)).toEqual(['b-joola']);
    expect(resolveBrands(['selkirk sport'], BRANDS)).toEqual(['b-selkirk']);
    expect(resolveBrands(['Selkirk'], BRANDS)).toEqual(['b-selkirk']);
    expect(resolveBrands(['b-six'], BRANDS)).toEqual(['b-six']);
    expect(resolveBrands(['six zero'], BRANDS)).toEqual(['b-six']);
    expect(resolveBrands(['SixZero'], BRANDS)).toEqual(['b-six']);
  });
  it('ignores generic suffixes like "pickleball" / "sports"', () => {
    expect(resolveBrands(['Head'], BRANDS)).toEqual(['b-head']);
    expect(resolveBrands(['franklin sports'], BRANDS)).toEqual(['b-franklin']);
    expect(resolveBrands(['Gamma Pickleball'], BRANDS)).toEqual(['b-gamma']);
  });
  it('accepts a unique prefix and de-duplicates', () => {
    expect(resolveBrands(['selk', 'Selkirk'], BRANDS)).toEqual(['b-selkirk']);
  });
  it('throws a helpful error with a suggestion and the valid list', () => {
    try {
      resolveBrands(['jola'], BRANDS);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(UnknownBrandError);
      const err = e as UnknownBrandError;
      expect(err.message).toBe("Unknown brand 'jola' — did you mean JOOLA? Valid brands: Franklin Pickleball, Gamma Sports, Head Pickleball, JOOLA, Selkirk Sport, Six Zero");
      expect(err.suggestion).toBe('JOOLA');
    }
  });
  it('rejects an ambiguous prefix without guessing', () => {
    expect(() => resolveBrands(['s'], BRANDS)).toThrow(UnknownBrandError);
  });
  it('still matches a brand whose name is only generic words', () => {
    const brands = [...BRANDS, { brand_id: 'b-pb', name: 'Pickleball', slug: 'pickleball', is_joola: false, is_active: true }];
    expect(resolveBrands(['PICKLEBALL'], brands)).toEqual(['b-pb']);
  });
  it('omits the suggestion when nothing is close', () => {
    expect(() => resolveBrands(['zzzzzzzz'], BRANDS)).toThrow(/^Unknown brand 'zzzzzzzz'\. Valid brands:/);
  });
});

describe('levenshtein', () => {
  it('computes edit distance', () => {
    expect(levenshtein('jola', 'joola')).toBe(1);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
    expect(levenshtein('same', 'same')).toBe(0);
  });
});

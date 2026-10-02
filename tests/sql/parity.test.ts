// Keeps the SQL normalisation helpers and src/core/normalise.ts in lock-step.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDb } from '../helpers/pglite';
import { CHANNEL_ALIASES, normaliseChannel, rollupSentiment3, toSentiment5 } from '@/core/normalise';

let pg: PGlite;
beforeAll(async () => { pg = await createTestDb(); });

const CHANNEL_INPUTS = [...Object.keys(CHANNEL_ALIASES), 'TWITTER', ' Reddit ', 'myspace', '', 'facebook'];
const SENTIMENT_INPUTS = ['very_negative', 'negative', 'neutral', 'positive', 'very_positive', 'Very_Positive', ' negative', 'mixed', ''];

describe('SQL / TS parity', () => {
  it('normalise_channel matches normaliseChannel for every alias', async () => {
    for (const input of CHANNEL_INPUTS) {
      const { rows } = await pg.query<{ c: string | null }>(`select intel.normalise_channel($1) c`, [input]);
      expect(rows[0]!.c, input).toBe(normaliseChannel(input));
    }
  });
  it('sentiment_5 / sentiment_3 match toSentiment5 / rollupSentiment3', async () => {
    for (const input of [...SENTIMENT_INPUTS, null]) {
      const { rows } = await pg.query<{ s5: string; s3: string }>(`select intel.sentiment_5($1) s5, intel.sentiment_3(intel.sentiment_5($1)) s3`, [input]);
      const ts5 = toSentiment5(input);
      expect(rows[0], String(input)).toEqual({ s5: ts5, s3: rollupSentiment3(ts5) });
    }
  });
});

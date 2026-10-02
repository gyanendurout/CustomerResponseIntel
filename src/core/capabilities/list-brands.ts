import { z } from 'zod';
import { defineCapability, meta, NO_EXCLUSIONS } from '../capability';
import { brandColour } from '../brand-palette';

const output = z.array(z.object({
  brand_id: z.string(),
  name: z.string(),
  slug: z.string(),
  is_joola: z.boolean(),
  is_active: z.boolean(),
  colour: z.object({ light: z.string(), dark: z.string(), slot: z.number().nullable(), shares_colour: z.boolean() }),
}));

export const listBrands = defineCapability({
  name: 'list_brands',
  route: '/brands',
  title: 'List brands',
  description: [
    'Lists the 11 tracked brands (JOOLA plus 10 competitors) with ids, names, slugs, is_joola and a chart colour.',
    'Use it to discover valid brand names before calling other tools, or to colour charts consistently. Other tools',
    'already accept brand names case-insensitively, so you rarely need ids.',
    'Output: data = [{brand_id, name, slug, is_joola, is_active, colour:{light, dark, slot, shares_colour}}].',
    'shares_colour=true means the brand has no unique hue (only 8 are colour-blind safe), so fold it into "Other" when charting many brands.',
    'Example: "Which competitors do we track?"',
  ].join(' '),
  input: z.object({}),
  output,
  examples: [{ question: 'Which competitors do we track?', input: {} }],
  async run(_input, ctx) {
    const brands = await ctx.brands();
    const data = brands
      .map(b => ({ ...b, colour: brandColour(b.slug) }))
      .sort((a, b) => Number(b.is_joola) - Number(a.is_joola) || a.name.localeCompare(b.name));
    return {
      data,
      meta: meta({ filters: {}, rows_counted: data.length, excluded: NO_EXCLUSIONS, notes: [] }, ctx),
    };
  },
  summarise: r => {
    const comp = r.data.filter(b => !b.is_joola).map(b => b.name);
    return `${r.data.length} brands: JOOLA + ${comp.length} competitors (${comp.join(', ')}).`;
  },
});

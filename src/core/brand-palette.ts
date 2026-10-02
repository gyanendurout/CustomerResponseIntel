// Brand colours for charts. Not stored in the database (no colour column exists, and we never write to brands).
// Values are the validated 8-slot categorical palette (CVD-safe on the adjacent pairlist, light + dark steps).
// Colour follows the ENTITY, never its rank: each slug owns a fixed slot. JOOLA always owns slot 1.
// Only 8 hues are distinguishable, so brands without a slot share a neutral and are flagged `shares_colour`,
// meaning a chart should fold them into "Other" or use small multiples. To use official brand hex codes or
// re-prioritise, edit SLOT_BY_SLUG / PALETTE only.

export interface BrandColour {
  light: string;
  dark: string;
  slot: number | null;
  shares_colour: boolean;
}

const PALETTE: ReadonlyArray<{ light: string; dark: string }> = [
  { light: '#2a78d6', dark: '#3987e5' }, // 1 blue (JOOLA)
  { light: '#eb6834', dark: '#d95926' }, // 2 orange
  { light: '#1baf7a', dark: '#199e70' }, // 3 aqua
  { light: '#eda100', dark: '#c98500' }, // 4 yellow
  { light: '#e87ba4', dark: '#d55181' }, // 5 magenta
  { light: '#008300', dark: '#008300' }, // 6 green
  { light: '#4a3aa7', dark: '#9085e9' }, // 7 violet
  { light: '#e34948', dark: '#e66767' }, // 8 red
];
const NEUTRAL = { light: '#8a8983', dark: '#9c9b94' };

// Fixed slot per brand slug (1-based). JOOLA first; competitors by all-time mention volume measured once on
// 2026-10-02 (crbn 13.8k, selkirk 11.9k, engage 4.6k, six-zero 4.3k, paddletek 3.0k, franklin 2.5k, gamma 2.1k).
// This is a frozen config, not live ranking, so colours never shift. Unlisted slugs share NEUTRAL.
const SLOT_BY_SLUG: Readonly<Record<string, number>> = {
  joola: 1,
  crbn: 2,
  selkirk: 3,
  engage: 4,
  'six-zero': 5,
  paddletek: 6,
  franklin: 7,
  gamma: 8,
  // onix (448), wilson (434), head (385): neutral; fold into "Other" or facet when charting more than 8 brands
};

export function brandColour(slug: string): BrandColour {
  const slot = SLOT_BY_SLUG[slug.toLowerCase()];
  const c = slot ? PALETTE[slot - 1] : undefined;
  return c
    ? { light: c.light, dark: c.dark, slot: slot!, shares_colour: false }
    : { ...NEUTRAL, slot: null, shares_colour: true };
}

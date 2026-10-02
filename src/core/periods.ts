// Period bucketing helpers. SQL buckets with date_trunc (UTC); TS enumerates the expected periods so
// time series are zero-filled and chart-ready.
import type { Granularity } from './normalise';
import { keyword, sql, type Sql } from './sql';
import { GRANULARITIES } from './normalise';

/** SQL expression: 'YYYY-MM-DD' of the period start containing `col` (weeks start Monday, ISO). */
export function periodExpr(col: Sql, g: Granularity): Sql {
  return sql`to_char(date_trunc(${keyword(GRANULARITIES, g)}, ${col} at time zone 'UTC'), 'YYYY-MM-DD')`;
}

export function periodStart(d: Date, g: Granularity): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (g === 'month') return new Date(Date.UTC(y, m, 1));
  const day = new Date(Date.UTC(y, m, d.getUTCDate()));
  if (g === 'week') {
    const dow = (day.getUTCDay() + 6) % 7; // Monday = 0
    return new Date(day.getTime() - dow * 86_400_000);
  }
  return day;
}

function addPeriod(d: Date, g: Granularity): Date {
  if (g === 'month') return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return new Date(d.getTime() + (g === 'week' ? 7 : 1) * 86_400_000);
}

export const MAX_PERIODS = 2_000;

/** Number of periods from the one containing `from` through the one containing `to`. */
export function countPeriods(from: Date, to: Date, g: Granularity): number {
  const a = periodStart(from, g);
  const b = periodStart(to, g);
  if (g === 'month') return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth() + 1;
  return Math.round((b.getTime() - a.getTime()) / ((g === 'week' ? 7 : 1) * 86_400_000)) + 1;
}

/** All period keys ('YYYY-MM-DD') from the period containing `from` through the one containing `to`. */
export function periodsBetween(from: Date, to: Date, g: Granularity): string[] {
  const out: string[] = [];
  for (let p = periodStart(from, g); p <= to && out.length < MAX_PERIODS; p = addPeriod(p, g)) {
    out.push(p.toISOString().slice(0, 10));
  }
  return out;
}

export interface SeriesPoint { period: string; series: string; value: number }

/** Zero-fills a sparse [{period, series, value}] list over the expected periods × series. */
export function zeroFill(points: SeriesPoint[], periods: string[], series: string[]): SeriesPoint[] {
  const have = new Map(points.map(p => [`${p.period}|${p.series}`, p.value]));
  const out: SeriesPoint[] = [];
  for (const s of series) for (const p of periods) out.push({ period: p, series: s, value: have.get(`${p}|${s}`) ?? 0 });
  return out;
}

/** Percent change vs previous value; null when there is no previous value or it was 0. */
export function growthPct(prev: number | undefined, cur: number): number | null {
  if (prev === undefined || prev === 0) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

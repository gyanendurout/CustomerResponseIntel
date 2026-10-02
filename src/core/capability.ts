// The capability contract. One file per capability under src/core/capabilities/ implements this; the registry
// turns each into a REST route, an MCP tool, an OpenAPI operation and a docs entry.
import type { z } from 'zod';
import type { Ctx } from './context';
import type { Excluded } from './filters';

export interface MetaCore {
  filters: Record<string, unknown>;
  generated_at: string;
  rows_counted: number;
  excluded: Excluded;
  notes: string[];
  units?: Record<string, string>;
  series?: string[];
  page?: { next_cursor: string | null; limit: number };
}

/** Core fields plus capability-specific extras (e.g. insufficient_data, method). */
export type Meta = MetaCore & Record<string, unknown>;

export interface Result<D = unknown> {
  data: D;
  meta: Meta;
}

export interface Capability<I extends z.ZodObject = z.ZodObject, D = unknown> {
  /** MCP tool name (snake_case). */
  name: string;
  /** REST path under /api/v1, e.g. "/volume". */
  route: string;
  title: string;
  /** Written for Claude: what it answers, when to use it vs other tools, output shape, an example question. */
  description: string;
  input: I;
  /** Schema of `data` (documentation + MCP outputSchema + tests). */
  output: z.ZodType<D>;
  /** Example questions with a valid input each. Used in the MCP description, docs and generic tests. */
  examples: ReadonlyArray<{ question: string; input: z.input<I> }>;
  run(input: z.output<I>, ctx: Ctx): Promise<Result<D>>;
  /** One-to-three line plain-English summary for the MCP text content. */
  summarise(result: Result<D>): string;
}

export const NO_EXCLUSIONS: Excluded = { undated: 0, unbranded: 0, unlabelled_sentiment: 0 };

export function meta(partial: Omit<MetaCore, 'generated_at'> & Record<string, unknown> & { generated_at?: string }, ctx: Ctx): Meta {
  return { ...partial, generated_at: partial.generated_at ?? ctx.now.toISOString() };
}

export function defineCapability<I extends z.ZodObject, D>(c: Capability<I, D>): Capability<I, D> {
  return c;
}

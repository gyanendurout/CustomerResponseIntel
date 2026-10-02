// OpenAPI 3.1 document generated from the capability registry (zod 4 → JSON Schema 2020-12, which OAS 3.1 uses).
import { z } from 'zod';
import { CAPABILITIES } from '@/core/registry';

const META_SCHEMA = {
  type: 'object',
  required: ['filters', 'generated_at', 'rows_counted', 'excluded', 'notes'],
  properties: {
    filters: { type: 'object' },
    generated_at: { type: 'string', format: 'date-time' },
    rows_counted: { type: 'integer' },
    excluded: {
      type: 'object',
      properties: { undated: { type: 'integer' }, unbranded: { type: 'integer' }, unlabelled_sentiment: { type: 'integer' } },
    },
    notes: { type: 'array', items: { type: 'string' } },
    units: { type: 'object', additionalProperties: { type: 'string' } },
    series: { type: 'array', items: { type: 'string' } },
    page: { type: 'object', properties: { next_cursor: { type: ['string', 'null'] }, limit: { type: 'integer' } } },
  },
};

const ERROR_SCHEMA = {
  type: 'object',
  properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} } } },
};

function jsonSchema(schema: z.ZodType, io: 'input' | 'output'): Record<string, unknown> {
  const s = z.toJSONSchema(schema, { io, unrepresentable: 'any', target: 'draft-2020-12' }) as Record<string, unknown>;
  delete s.$schema;
  return s;
}

export function buildOpenApi(serverUrl: string): Record<string, unknown> {
  const paths: Record<string, unknown> = {};
  for (const cap of CAPABILITIES) {
    const input = jsonSchema(cap.input, 'input') as { properties?: Record<string, Record<string, unknown>>; required?: string[] };
    const parameters = Object.entries(input.properties ?? {}).map(([name, schema]) => ({
      name,
      in: 'query',
      required: (input.required ?? []).includes(name),
      description: (schema.description as string | undefined) ?? undefined,
      schema,
      ...(schema.type === 'array' ? { style: 'form', explode: false } : {}),
    }));
    paths[`/api/v1${cap.route}`] = {
      get: {
        operationId: cap.name,
        summary: cap.title,
        description: cap.description,
        security: [{ apiKey: [] }],
        parameters,
        responses: {
          200: {
            description: 'Success',
            content: { 'application/json': { schema: { type: 'object', required: ['data', 'meta'], properties: { data: jsonSchema(cap.output, 'output'), meta: META_SCHEMA } } } },
          },
          400: { description: 'Invalid input (VALIDATION_ERROR, UNKNOWN_BRAND, UNSUPPORTED_COMBINATION)', content: { 'application/json': { schema: ERROR_SCHEMA } } },
          401: { description: 'Missing or invalid x-api-key', content: { 'application/json': { schema: ERROR_SCHEMA } } },
          429: { description: 'Rate limited (see Retry-After)', content: { 'application/json': { schema: ERROR_SCHEMA } } },
          503: { description: 'Database timeout', content: { 'application/json': { schema: ERROR_SCHEMA } } },
        },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Community Intel API',
      version: '1.0.0',
      description: 'Read-only social-listening analytics for JOOLA and 10 competitors. Envelope: {data, meta} on success, {error:{code,message,details}} on failure.',
    },
    servers: [{ url: serverUrl }],
    components: { securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' } } },
    paths,
  };
}

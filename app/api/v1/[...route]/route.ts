// REST entry point: every /api/v1/* GET is handled by the registry-driven handler in src/server/rest.ts.
import { handleRest } from '@/server/rest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const GET = (req: Request) => handleRest(req);
export const OPTIONS = (req: Request) => handleRest(req);

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getMetadata, getCapabilities } from '../src/db/german-law-db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pkg = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
) as { version: string };

const SERVER_NAME = 'german-law-mcp';
const SERVER_VERSION = pkg.version;
const REPO_URL = 'https://github.com/Ansvar-Systems/German-law-mcp';
const FRESHNESS_MAX_DAYS = 30;

function detectCapabilityNames(): string[] {
  const caps = getCapabilities();
  const names: string[] = ['statutes'];
  if (caps.has('basic_case_law' as never)) names.push('case_law');
  if (caps.has('preparatory_works' as never)) names.push('preparatory_works');
  if (caps.has('eu_cross_references' as never)) names.push('eu_cross_references');
  return names;
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  const url = new URL(req.url ?? '/', `https://${req.headers.host}`);

  // DB may not be available on cold start (Strategy B: runtime download).
  // Degrade gracefully — health should always respond, even without DB.
  let meta: ReturnType<typeof getMetadata>;
  let capabilities: string[];
  try {
    meta = getMetadata();
    capabilities = detectCapabilityNames();
  } catch {
    meta = { tier: 'unknown', schema_version: '1', built_at: 'unknown', builder: 'unknown' };
    capabilities = ['statutes'];
  }
  const tier = meta.tier === 'unknown' ? 'free' : meta.tier;

  if (url.pathname === '/version' || url.searchParams.has('version')) {
    res.status(200).json({
      name: SERVER_NAME,
      version: SERVER_VERSION,
      node_version: process.version,
      transport: ['stdio', 'streamable-http'],
      capabilities,
      tier,
      source_schema_version: meta.schema_version,
      repo_url: REPO_URL,
      report_issue_url: `${REPO_URL}/issues/new?template=data-error.md`,
    });
    return;
  }

  res.status(200).json({
    status: 'ok',
    server: SERVER_NAME,
    version: SERVER_VERSION,
    uptime_seconds: Math.floor(process.uptime()),
    data_freshness: {
      max_age_days: FRESHNESS_MAX_DAYS,
      built_at: meta.built_at,
      note: tier === 'professional'
        ? 'Serving full professional-tier database'
        : 'Serving runtime-downloaded free-tier database',
    },
    capabilities,
    tier,
  });
}

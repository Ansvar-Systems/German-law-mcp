/**
 * Premium tool support for law MCP servers.
 *
 * Injected by build-all.sh into each MCP's src/ directory.
 * Detects premium tables (case_law, preparatory_works, agency_guidance)
 * and their FTS5 indexes at runtime, then wraps the server's existing
 * ListTools and CallTool handlers to expose search tools for any tables
 * that are present.
 *
 * Safe to inject into any law MCP — if no premium tables exist, this
 * function is a no-op.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type Database from '@ansvar/mcp-sqlite';

// ---------------------------------------------------------------------------
// FTS query building (self-contained, no external dependency)
// ---------------------------------------------------------------------------

const EXPLICIT_FTS_RE = /["*():^]|\bAND\b|\bOR\b|\bNOT\b/iu;

function sanitizeToken(token: string): string {
  return token.replace(/[^\p{L}\p{N}_]/gu, '');
}

function extractTokens(query: string): string[] {
  const matches = query.normalize('NFC').match(/[\p{L}\p{N}_]+/gu) ?? [];
  return matches.map(sanitizeToken).filter(t => t.length > 1);
}

interface FtsVariants {
  primary: string;
  fallback?: string;
}

function buildFtsVariants(query: string): FtsVariants {
  const trimmed = query.trim();
  if (!trimmed) return { primary: '' };

  if (EXPLICIT_FTS_RE.test(trimmed)) {
    // User is writing explicit FTS5 syntax — pass through with minimal escaping.
    return { primary: trimmed.replace(/[()^:]/g, ch => `"${ch}"`) };
  }

  const tokens = extractTokens(trimmed);
  if (tokens.length === 0) {
    return { primary: trimmed.replace(/[()^:]/g, ch => `"${ch}"`) };
  }

  const primary = tokens.map(t => `${t}*`).join(' ');
  if (tokens.length === 1) return { primary };

  return { primary, fallback: tokens.map(t => `${t}*`).join(' OR ') };
}

// ---------------------------------------------------------------------------
// Table / FTS detection helpers
// ---------------------------------------------------------------------------

interface PremiumCapabilities {
  caseLaw: boolean;
  preparatoryWorks: boolean;
  agencyGuidance: boolean;
  laenderStatutes: boolean;
}

interface TableColumns {
  caseLaw: Set<string>;
  preparatoryWorks: Set<string>;
  agencyGuidance: Set<string>;
  laenderStatutes: Set<string>;
  laenderProvisions: Set<string>;
}

function getTableColumns(db: InstanceType<typeof Database>, table: string): Set<string> {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return new Set(rows.map(r => r.name));
  } catch {
    return new Set();
  }
}

function detectPremiumTables(db: InstanceType<typeof Database>): { caps: PremiumCapabilities; columns: TableColumns } {
  const tables = new Set<string>();
  try {
    const rows = db.prepare(
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')"
    ).all() as { name: string }[];
    for (const r of rows) tables.add(r.name);
  } catch {
    return {
      caps: { caseLaw: false, preparatoryWorks: false, agencyGuidance: false, laenderStatutes: false },
      columns: { caseLaw: new Set(), preparatoryWorks: new Set(), agencyGuidance: new Set(), laenderStatutes: new Set(), laenderProvisions: new Set() },
    };
  }

  const caps = {
    caseLaw: tables.has('case_law') && tables.has('case_law_fts'),
    preparatoryWorks: tables.has('preparatory_works') && tables.has('preparatory_works_fts'),
    agencyGuidance: tables.has('agency_guidance') && tables.has('agency_guidance_fts'),
    laenderStatutes: tables.has('laender_statutes') && tables.has('laender_statutes_fts'),
  };

  return {
    caps,
    columns: {
      caseLaw: caps.caseLaw ? getTableColumns(db, 'case_law') : new Set(),
      preparatoryWorks: caps.preparatoryWorks ? getTableColumns(db, 'preparatory_works') : new Set(),
      agencyGuidance: caps.agencyGuidance ? getTableColumns(db, 'agency_guidance') : new Set(),
      laenderStatutes: caps.laenderStatutes ? getTableColumns(db, 'laender_statutes') : new Set(),
      laenderProvisions: caps.laenderStatutes ? getTableColumns(db, 'laender_provisions') : new Set(),
    },
  };
}

// ---------------------------------------------------------------------------
// Tool definitions (MCP Tool schema)
// ---------------------------------------------------------------------------

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

function caseLawToolDef(): ToolDef {
  return {
    name: 'search_case_law',
    description:
      'Full-text search across court decisions. Returns document_id, title, court, case_number, ' +
      'decision_date, snippet, and keywords. Ranked by BM25 relevance. ' +
      'Do NOT use for statute text — use search_legislation or get_provision instead.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, description: 'Search query (supports FTS5 syntax)' },
        court: { type: 'string', description: 'Filter by court name' },
        date_from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Start date (YYYY-MM-DD)' },
        date_to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'End date (YYYY-MM-DD)' },
        limit: { type: 'number', default: 10, minimum: 1, maximum: 50, description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
  };
}

function prepWorksToolDef(): ToolDef {
  return {
    name: 'search_preparatory_works',
    description:
      'Full-text search across preparatory works (legislative history, bills, committee reports). ' +
      'Returns document_id, title, type, date, and snippet. Ranked by BM25 relevance.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, description: 'Search query (supports FTS5 syntax)' },
        type: { type: 'string', description: 'Filter by document type' },
        limit: { type: 'number', default: 10, minimum: 1, maximum: 50, description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
  };
}

function agencyGuidanceToolDef(): ToolDef {
  return {
    name: 'search_agency_guidance',
    description:
      'Full-text search across agency guidance documents (circulars, opinions, rulings). ' +
      'Returns document_id, title, agency, date, and snippet. Ranked by BM25 relevance.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, description: 'Search query (supports FTS5 syntax)' },
        agency: { type: 'string', description: 'Filter by issuing agency' },
        limit: { type: 'number', default: 10, minimum: 1, maximum: 50, description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
  };
}

function laenderSearchToolDef(): ToolDef {
  return {
    name: 'search_laender_legislation',
    description:
      'Full-text search across German state (Laender) legislation. ' +
      'Returns statute title, state, type, date, and matching provision snippets. ' +
      'Use state_code filter for a specific Bundesland (e.g. "BY" for Bayern, "NW" for NRW). ' +
      'Do NOT use for federal law — use search_legislation or get_provision instead.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, description: 'Search query (supports FTS5 syntax)' },
        state_code: {
          type: 'string',
          description: 'Filter by state: BW, BY, BE, BB, HB, HH, HE, MV, NI, NW, RP, SL, SN, ST, SH, TH',
        },
        type: { type: 'string', description: 'Filter by type: Gesetz, Verordnung, Verwaltungsvorschrift' },
        limit: { type: 'number', default: 10, minimum: 1, maximum: 50, description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
  };
}

function laenderGetProvisionToolDef(): ToolDef {
  return {
    name: 'get_laender_provision',
    description:
      'Get a specific provision from a German state law. ' +
      'Provide the statute_id and optionally a section_number. ' +
      'Use search_laender_legislation first to find the statute_id.',
    inputSchema: {
      type: 'object',
      properties: {
        statute_id: { type: 'string', description: 'The statute ID from search results' },
        section_number: { type: 'string', description: 'Section/paragraph number (e.g. "1", "2a"). Omit to get all sections.' },
      },
      required: ['statute_id'],
    },
  };
}

function laenderListStatesToolDef(): ToolDef {
  return {
    name: 'list_laender_states',
    description:
      'List all available German states (Bundeslaender) with counts of statutes and provisions in the database.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  };
}

// ---------------------------------------------------------------------------
// Query execution
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

function clampLimit(raw: number | undefined): number {
  return Math.min(Math.max(raw ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
}

function runSearchCaseLaw(
  db: InstanceType<typeof Database>,
  args: Record<string, unknown>,
  cols: Set<string>,
): unknown {
  const query = String(args.query ?? '').trim();
  if (!query) return { results: [], count: 0 };

  const limit = clampLimit(args.limit as number | undefined);
  const variants = buildFtsVariants(query);

  // Resolve document_id column (varies across jurisdictions)
  const docIdCol = cols.has('document_id') ? 'cl.document_id'
    : cols.has('case_id') ? 'cl.case_id'
    : cols.has('document_uri') ? 'cl.document_uri'
    : cols.has('neutral_citation') ? 'cl.neutral_citation'
    : "cl.id";

  // Build SELECT columns based on what actually exists in this DB
  const selects: string[] = [
    `${docIdCol} AS document_id`,
    cols.has('title') ? 'cl.title' : `${docIdCol} AS title`,
    cols.has('court') ? 'cl.court' : "NULL AS court",
    cols.has('case_number') ? 'cl.case_number' : "NULL AS case_number",
    cols.has('decision_date') ? 'cl.decision_date'
      : cols.has('date_decided') ? 'cl.date_decided AS decision_date'
      : "NULL AS decision_date",
    "snippet(case_law_fts, 0, '>>>', '<<<', '...', 32) AS snippet",
    cols.has('keywords') ? 'cl.keywords' : "NULL AS keywords",
    'bm25(case_law_fts) AS relevance',
  ];

  let sql = `
    SELECT ${selects.join(',\n      ')}
    FROM case_law_fts
    JOIN case_law cl ON cl.id = case_law_fts.rowid
    WHERE case_law_fts MATCH ?
  `;

  const params: (string | number)[] = [];

  if (args.court && cols.has('court')) {
    sql += ' AND cl.court = ?';
    params.push(String(args.court));
  }
  const dateCol = cols.has('decision_date') ? 'cl.decision_date'
    : cols.has('date_decided') ? 'cl.date_decided' : null;
  if (args.date_from && dateCol) {
    sql += ` AND ${dateCol} >= ?`;
    params.push(String(args.date_from));
  }
  if (args.date_to && dateCol) {
    sql += ` AND ${dateCol} <= ?`;
    params.push(String(args.date_to));
  }

  sql += ' ORDER BY relevance LIMIT ?';
  params.push(limit);

  const run = (fts: string) =>
    db.prepare(sql).all(fts, ...params) as Record<string, unknown>[];

  let results = run(variants.primary);
  if (results.length === 0 && variants.fallback) {
    results = run(variants.fallback);
  }

  return { results, count: results.length };
}

function runSearchPrepWorks(
  db: InstanceType<typeof Database>,
  args: Record<string, unknown>,
  cols: Set<string>,
): unknown {
  const query = String(args.query ?? '').trim();
  if (!query) return { results: [], count: 0 };

  const limit = clampLimit(args.limit as number | undefined);
  const variants = buildFtsVariants(query);

  // Build date expression from available columns
  let dateExpr = "NULL AS date";
  if (cols.has('date_introduced') && cols.has('date_enacted')) {
    dateExpr = "COALESCE(pw.date_introduced, pw.date_enacted) AS date";
  } else if (cols.has('date_introduced')) {
    dateExpr = "pw.date_introduced AS date";
  } else if (cols.has('date_enacted')) {
    dateExpr = "pw.date_enacted AS date";
  } else if (cols.has('publication_date')) {
    dateExpr = "pw.publication_date AS date";
  } else if (cols.has('date')) {
    dateExpr = "pw.date AS date";
  }

  // Schema-adaptive document_id: fall back to dip_id, id
  const docIdExpr = cols.has('document_id') ? 'pw.document_id'
    : cols.has('dip_id') ? 'pw.dip_id AS document_id'
    : 'pw.id AS document_id';
  const titleFallback = cols.has('document_id') ? 'pw.document_id' : 'pw.id';

  const selects: string[] = [
    docIdExpr,
    cols.has('title') ? 'pw.title' : `${titleFallback} AS title`,
    cols.has('type') ? 'pw.type' : cols.has('work_type') ? 'pw.work_type AS type' : "NULL AS type",
    dateExpr,
    "snippet(preparatory_works_fts, 0, '>>>', '<<<', '...', 32) AS snippet",
    'bm25(preparatory_works_fts) AS relevance',
  ];

  let sql = `
    SELECT ${selects.join(',\n      ')}
    FROM preparatory_works_fts
    JOIN preparatory_works pw ON pw.id = preparatory_works_fts.rowid
    WHERE preparatory_works_fts MATCH ?
  `;

  const params: (string | number)[] = [];

  if (args.type && cols.has('type')) {
    sql += ' AND pw.type = ?';
    params.push(String(args.type));
  }

  sql += ' ORDER BY relevance LIMIT ?';
  params.push(limit);

  const run = (fts: string) =>
    db.prepare(sql).all(fts, ...params) as Record<string, unknown>[];

  let results = run(variants.primary);
  if (results.length === 0 && variants.fallback) {
    results = run(variants.fallback);
  }

  return { results, count: results.length };
}

function runSearchAgencyGuidance(
  db: InstanceType<typeof Database>,
  args: Record<string, unknown>,
): unknown {
  const query = String(args.query ?? '').trim();
  if (!query) return { results: [], count: 0 };

  const limit = clampLimit(args.limit as number | undefined);
  const variants = buildFtsVariants(query);

  let sql = `
    SELECT
      ag.document_id,
      ag.title,
      ag.agency,
      ag.issued_date AS date,
      snippet(agency_guidance_fts, 0, '>>>', '<<<', '...', 32) AS snippet,
      bm25(agency_guidance_fts) AS relevance
    FROM agency_guidance_fts
    JOIN agency_guidance ag ON ag.id = agency_guidance_fts.rowid
    WHERE agency_guidance_fts MATCH ?
  `;

  const params: (string | number)[] = [];

  if (args.agency) {
    sql += ' AND ag.agency = ?';
    params.push(String(args.agency));
  }

  sql += ' ORDER BY relevance LIMIT ?';
  params.push(limit);

  const run = (fts: string) =>
    db.prepare(sql).all(fts, ...params) as Record<string, unknown>[];

  let results = run(variants.primary);
  if (results.length === 0 && variants.fallback) {
    results = run(variants.fallback);
  }

  return { results, count: results.length };
}

function runSearchLaender(
  db: InstanceType<typeof Database>,
  args: Record<string, unknown>,
): unknown {
  const query = String(args.query ?? '').trim();
  if (!query) return { results: [], count: 0 };

  const limit = clampLimit(args.limit as number | undefined);
  const variants = buildFtsVariants(query);

  // Search statutes by default, join provisions for snippets
  let sql = `
    SELECT
      ls.id AS statute_id,
      ls.title,
      ls.short_title,
      ls.state_code,
      ls.state_name,
      ls.type,
      ls.date_enacted,
      ls.source_url,
      snippet(laender_statutes_fts, 0, '>>>', '<<<', '...', 32) AS snippet,
      bm25(laender_statutes_fts) AS relevance
    FROM laender_statutes_fts
    JOIN laender_statutes ls ON ls.rowid = laender_statutes_fts.rowid
    WHERE laender_statutes_fts MATCH ?
  `;

  const params: (string | number)[] = [];

  if (args.state_code) {
    sql += ' AND ls.state_code = ?';
    params.push(String(args.state_code).toUpperCase());
  }
  if (args.type) {
    sql += ' AND ls.type = ?';
    params.push(String(args.type));
  }

  sql += ' ORDER BY relevance LIMIT ?';
  params.push(limit);

  const run = (fts: string) =>
    db.prepare(sql).all(fts, ...params) as Record<string, unknown>[];

  let results = run(variants.primary);
  if (results.length === 0 && variants.fallback) {
    results = run(variants.fallback);
  }

  // If no statute matches, try provision-level search
  if (results.length === 0) {
    let provSql = `
      SELECT
        lp.statute_id,
        ls.title AS statute_title,
        ls.state_code,
        ls.state_name,
        lp.section_number,
        lp.title AS section_title,
        snippet(laender_provisions_fts, 1, '>>>', '<<<', '...', 32) AS snippet,
        bm25(laender_provisions_fts) AS relevance
      FROM laender_provisions_fts
      JOIN laender_provisions lp ON lp.rowid = laender_provisions_fts.rowid
      JOIN laender_statutes ls ON ls.id = lp.statute_id
      WHERE laender_provisions_fts MATCH ?
    `;
    const provParams: (string | number)[] = [];
    if (args.state_code) {
      provSql += ' AND lp.state_code = ?';
      provParams.push(String(args.state_code).toUpperCase());
    }
    provSql += ' ORDER BY relevance LIMIT ?';
    provParams.push(limit);

    const runProv = (fts: string) =>
      db.prepare(provSql).all(fts, ...provParams) as Record<string, unknown>[];

    results = runProv(variants.primary);
    if (results.length === 0 && variants.fallback) {
      results = runProv(variants.fallback);
    }
  }

  return { results, count: results.length };
}

function runGetLaenderProvision(
  db: InstanceType<typeof Database>,
  args: Record<string, unknown>,
): unknown {
  const statuteId = String(args.statute_id ?? '').trim();
  if (!statuteId) return { error: 'statute_id is required' };

  const sectionNumber = args.section_number ? String(args.section_number).trim() : null;

  if (sectionNumber) {
    const row = db.prepare(`
      SELECT lp.id, lp.statute_id, lp.state_code, lp.section_number, lp.title, lp.content, lp.order_index,
             ls.title AS statute_title, ls.state_name
      FROM laender_provisions lp
      JOIN laender_statutes ls ON ls.id = lp.statute_id
      WHERE lp.statute_id = ? AND lp.section_number = ?
    `).get(statuteId, sectionNumber) as Record<string, unknown> | undefined;

    if (!row) return { error: `Provision ${sectionNumber} not found in ${statuteId}` };
    return row;
  }

  // Return all provisions for this statute
  const rows = db.prepare(`
    SELECT lp.id, lp.section_number, lp.title, lp.content, lp.order_index
    FROM laender_provisions lp
    WHERE lp.statute_id = ?
    ORDER BY lp.order_index
  `).all(statuteId) as Record<string, unknown>[];

  const statute = db.prepare(`
    SELECT id, state_code, state_name, title, short_title, type, date_enacted, source_url
    FROM laender_statutes WHERE id = ?
  `).get(statuteId) as Record<string, unknown> | undefined;

  return { statute: statute ?? null, provisions: rows, count: rows.length };
}

function runListLaenderStates(
  db: InstanceType<typeof Database>,
): unknown {
  const rows = db.prepare(`
    SELECT
      state_code,
      state_name,
      COUNT(*) AS statute_count,
      (SELECT COUNT(*) FROM laender_provisions lp WHERE lp.state_code = ls.state_code) AS provision_count
    FROM laender_statutes ls
    GROUP BY state_code, state_name
    ORDER BY state_name
  `).all() as Record<string, unknown>[];

  return { states: rows, count: rows.length };
}

// ---------------------------------------------------------------------------
// Public API — wrap a Server with premium tools
// ---------------------------------------------------------------------------

/**
 * Detect premium tables in the database and, if any exist, wrap the server's
 * ListTools and CallTool handlers to include premium search tools.
 *
 * This is safe to call on any law MCP server. If no premium tables exist the
 * function returns immediately without modifying the server.
 */
/**
 * Return premium tool definitions and handlers for direct integration.
 * Use this instead of wrapWithPremiumTools when the server has a custom
 * http-server.ts that registers its own handlers.
 */
export function getPremiumTools(db: InstanceType<typeof Database>): {
  tools: ToolDef[];
  handlers: Map<string, (args: Record<string, unknown>) => unknown>;
} | null {
  const { caps, columns } = detectPremiumTables(db);

  if (!caps.caseLaw && !caps.preparatoryWorks && !caps.agencyGuidance && !caps.laenderStatutes) {
    return null;
  }

  const tools: ToolDef[] = [];
  const handlers = new Map<string, (args: Record<string, unknown>) => unknown>();

  if (caps.caseLaw) {
    tools.push(caseLawToolDef());
    handlers.set('search_case_law', (args) => runSearchCaseLaw(db, args, columns.caseLaw));
  }
  if (caps.preparatoryWorks) {
    tools.push(prepWorksToolDef());
    handlers.set('search_preparatory_works', (args) => runSearchPrepWorks(db, args, columns.preparatoryWorks));
  }
  if (caps.agencyGuidance) {
    tools.push(agencyGuidanceToolDef());
    handlers.set('search_agency_guidance', (args) => runSearchAgencyGuidance(db, args));
  }
  if (caps.laenderStatutes) {
    tools.push(laenderSearchToolDef());
    handlers.set('search_laender_legislation', (args) => runSearchLaender(db, args));
    tools.push(laenderGetProvisionToolDef());
    handlers.set('get_laender_provision', (args) => runGetLaenderProvision(db, args));
    tools.push(laenderListStatesToolDef());
    handlers.set('list_laender_states', () => runListLaenderStates(db));
  }

  const names = tools.map(t => t.name).join(', ');
  console.error(`[premium-tools] Available ${tools.length} premium tools: ${names}`);
  return { tools, handlers };
}

export function wrapWithPremiumTools(server: Server, db: InstanceType<typeof Database>): void {
  const { caps, columns } = detectPremiumTables(db);

  // Nothing to add — leave the server untouched.
  if (!caps.caseLaw && !caps.preparatoryWorks && !caps.agencyGuidance && !caps.laenderStatutes) {
    return;
  }

  // Build the set of premium tool definitions and their executors.
  const premiumTools: ToolDef[] = [];
  const premiumHandlers = new Map<
    string,
    (args: Record<string, unknown>) => unknown
  >();

  if (caps.caseLaw) {
    premiumTools.push(caseLawToolDef());
    premiumHandlers.set('search_case_law', (args) => runSearchCaseLaw(db, args, columns.caseLaw));
  }

  if (caps.preparatoryWorks) {
    premiumTools.push(prepWorksToolDef());
    premiumHandlers.set('search_preparatory_works', (args) => runSearchPrepWorks(db, args, columns.preparatoryWorks));
  }

  if (caps.agencyGuidance) {
    premiumTools.push(agencyGuidanceToolDef());
    premiumHandlers.set('search_agency_guidance', (args) => runSearchAgencyGuidance(db, args));
  }

  if (caps.laenderStatutes) {
    premiumTools.push(laenderSearchToolDef());
    premiumHandlers.set('search_laender_legislation', (args) => runSearchLaender(db, args));
    premiumTools.push(laenderGetProvisionToolDef());
    premiumHandlers.set('get_laender_provision', (args) => runGetLaenderProvision(db, args));
    premiumTools.push(laenderListStatesToolDef());
    premiumHandlers.set('list_laender_states', () => runListLaenderStates(db));
  }

  const premiumToolNames = new Set(premiumHandlers.keys());

  // Grab the existing handlers so we can delegate to them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const srv = server as any;
  const existingListTools = srv._requestHandlers?.get('tools/list');
  const existingCallTool = srv._requestHandlers?.get('tools/call');

  if (!existingListTools || !existingCallTool) {
    // Server hasn't registered tool handlers yet — cannot wrap.
    console.error('[premium-tools] No existing tool handlers found; skipping premium injection.');
    return;
  }

  // Replace ListTools: base tools + premium tools (deduplicated by name).
  srv._requestHandlers.set('tools/list', async (request: unknown, extra: unknown) => {
    const baseResult = await existingListTools(request, extra);
    const baseTools: ToolDef[] = baseResult?.tools ?? [];

    // Remove any base tools that share a name with a premium tool (premium wins).
    const filtered = baseTools.filter((t: ToolDef) => !premiumToolNames.has(t.name));

    return { tools: [...filtered, ...premiumTools] };
  });

  // Replace CallTool: handle premium tool names, delegate the rest.
  srv._requestHandlers.set('tools/call', async (request: unknown, extra: unknown) => {
    const params = (request as { params?: { name?: string; arguments?: Record<string, unknown> } })?.params;
    const toolName = params?.name ?? '';
    const args = params?.arguments ?? {};

    const handler = premiumHandlers.get(toolName);
    if (!handler) {
      // Not a premium tool — delegate to the base handler.
      return existingCallTool(request, extra);
    }

    try {
      const result = handler(args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Error executing ${toolName}: ${message}` }],
        isError: true,
      };
    }
  });

  const names = premiumTools.map(t => t.name).join(', ');
  console.error(`[premium-tools] Injected ${premiumTools.length} premium tools: ${names}`);
}
